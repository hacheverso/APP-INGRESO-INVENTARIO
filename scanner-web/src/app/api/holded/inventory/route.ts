import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { isHoldedConfigured, listHoldedInventory, getHoldedLastSales } from '@/lib/holded';
import { calcularCostoPonderado, Lote } from '@/lib/costing';

export const dynamic = 'force-dynamic';

const DIA_MS = 24 * 60 * 60 * 1000;
const BACKFILL_MS = 730 * DIA_MS;  // primera sincronización: 2 años de ventas
const SOLAPE_MS = 2 * DIA_MS;      // siguientes: desde la última sync menos 2 días (por documentos editados/tardíos)
const LOTE_UPSERT = 200;

/**
 * Sincroniza el índice local de últimas ventas con Holded de forma incremental
 * y devuelve mapas por holdedId / SKU / nombre leídos de la base de datos.
 * Así, tras la primera carga, cada apertura del inventario pide a Holded solo los documentos nuevos.
 */
async function sincronizarVentas(userId: string) {
    const estado = await prisma.holdedSyncState.findUnique({ where: { userId } });
    const desde = estado?.salesSyncedAt ? estado.salesSyncedAt.getTime() - SOLAPE_MS : Date.now() - BACKFILL_MS;
    const inicio = Date.now();
    const ventas = await getHoldedLastSales(desde);

    const entradas: { key: string; ts: number }[] = [];
    ventas.byProductId.forEach((ts, id) => entradas.push({ key: `pid:${id}`, ts }));
    ventas.bySku.forEach((ts, sku) => entradas.push({ key: `sku:${sku}`, ts }));
    ventas.byName.forEach((ts, name) => entradas.push({ key: `name:${name}`, ts }));

    // Guardar solo si la venta es más reciente que la ya indexada
    const existentes = entradas.length
        ? await prisma.holdedSalesIndex.findMany({ where: { userId, key: { in: entradas.map(e => e.key) } }, select: { key: true, lastSaleAt: true } })
        : [];
    const actual = new Map(existentes.map(e => [e.key, e.lastSaleAt.getTime()]));
    const nuevas = entradas.filter(e => e.ts > (actual.get(e.key) || 0));
    for (let i = 0; i < nuevas.length; i += LOTE_UPSERT) {
        await prisma.$transaction(nuevas.slice(i, i + LOTE_UPSERT).map(e => prisma.holdedSalesIndex.upsert({
            where: { userId_key: { userId, key: e.key } },
            create: { userId, key: e.key, lastSaleAt: new Date(e.ts) },
            update: { lastSaleAt: new Date(e.ts) },
        })));
    }

    // Avanzar el cursor solo si Holded respondió todos los tipos de documento
    if (ventas.errores === 0) {
        await prisma.holdedSyncState.upsert({
            where: { userId },
            create: { userId, salesSyncedAt: new Date(inicio) },
            update: { salesSyncedAt: new Date(inicio) },
        });
    }

    const indice = await prisma.holdedSalesIndex.findMany({ where: { userId }, select: { key: true, lastSaleAt: true } });
    const byProductId = new Map<string, number>(), bySku = new Map<string, number>(), byName = new Map<string, number>();
    for (const e of indice) {
        const ts = e.lastSaleAt.getTime();
        if (e.key.startsWith('pid:')) byProductId.set(e.key.slice(4), ts);
        else if (e.key.startsWith('sku:')) bySku.set(e.key.slice(4), ts);
        else if (e.key.startsWith('name:')) byName.set(e.key.slice(5), ts);
    }
    return { byProductId, bySku, byName, documentosNuevos: ventas.documentos, incremental: Boolean(estado?.salesSyncedAt), errores: ventas.errores };
}

/**
 * Inventario activo según Holded (stock > 0) con el costo ponderado por lotes
 * calculado a partir de los ingresos guardados en INGRESADOS.
 */
export async function GET(req: Request) {
    try {
        const authSession = await getSession();
        if (!authSession) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
        if (!isHoldedConfigured()) {
            return NextResponse.json({ success: false, error: 'HOLDED_API_KEY no está configurada en el servidor' }, { status: 500 });
        }
        const force = new URL(req.url).searchParams.get('force') === '1';

        // 1. Stock y precio desde Holded (con caché corto) + últimas ventas (índice local, sync incremental)
        const [inventarioCompleto, ventas] = await Promise.all([
            listHoldedInventory(force),
            sincronizarVentas(authSession.userId),
        ]);
        const inventario = inventarioCompleto.filter(p => p.stock > 0);

        // 2. Catálogo local (imagen, nombre curado, vínculo por holdedId o barcode)
        const productos = await prisma.product.findMany({ where: { userId: authSession.userId } });
        const porHoldedId = new Map(productos.filter(p => p.holdedId).map(p => [p.holdedId as string, p]));
        const porUpc = new Map(productos.map(p => [p.upc, p]));

        // 3. Lotes por UPC desde los ingresos guardados, del más reciente al más antiguo
        const sesiones = await prisma.historySession.findMany({
            where: { userId: authSession.userId },
            include: { records: true },
            orderBy: { createdAt: 'desc' }
        });
        const lotesPorUpc = new Map<string, Lote[]>();
        for (const s of sesiones) {
            const porProducto = new Map<string, { unidades: number; costoTotalUsd: number; trm: number }>();
            for (const r of s.records) {
                const e = porProducto.get(r.upc) || { unidades: 0, costoTotalUsd: 0, trm: 1 };
                e.unidades += r.cantidad || 0;
                e.costoTotalUsd += (r.cantidad || 0) * (r.costoUsd || 0);
                if (r.trm > 1) e.trm = r.trm;
                porProducto.set(r.upc, e);
            }
            for (const [upc, e] of porProducto) {
                if (e.unidades <= 0) continue;
                const arr = lotesPorUpc.get(upc) || [];
                arr.push({
                    lote: s.batchName || s.id,
                    fecha: s.createdAt.toISOString(),
                    unidades: e.unidades,
                    costoUsd: Math.round((e.costoTotalUsd / e.unidades) * 100) / 100,
                    trm: e.trm,
                });
                lotesPorUpc.set(upc, arr);
            }
        }

        // 4. Armar filas con el costo ponderado
        const rows = inventario.map(item => {
            const local = porHoldedId.get(item.id) || (item.barcode ? porUpc.get(item.barcode) : undefined);
            const upc = local?.upc || item.barcode || '';
            const lotes = upc ? (lotesPorUpc.get(upc) || []) : [];
            const costo = calcularCostoPonderado(lotes, item.stock);
            // Última venta: por id de producto, si no por SKU, si no por nombre (Holded no siempre vincula la línea)
            const ventaTs = ventas.byProductId.get(item.id)
                || (item.sku ? ventas.bySku.get(item.sku.toUpperCase()) : undefined)
                || (local?.sku ? ventas.bySku.get(local.sku.toUpperCase()) : undefined)
                || (item.name ? ventas.byName.get(item.name.toUpperCase()) : undefined)
                || null;
            return {
                ultimaVenta: ventaTs ? new Date(ventaTs).toISOString() : null,
                ultimaLlegada: lotes[0]?.fecha || null,
                holdedId: item.id,
                upc,
                nombre: local?.name || item.name,
                sku: local?.sku || item.sku,
                imagen: local?.image || '',
                categoria: local?.category || '',
                stock: item.stock,
                precio: item.price,
                costoUsd: costo.costoUsd,
                costoCop: costo.costoCop,
                cubiertas: costo.cubiertas,
                lotes: costo.lotesUsados,
                ultimoLote: lotes[0] ? { lote: lotes[0].lote, fecha: lotes[0].fecha, costoUsd: lotes[0].costoUsd } : null,
            };
        }).sort((a, b) => (b.stock * (b.costoUsd || 0)) - (a.stock * (a.costoUsd || 0)) || b.stock - a.stock);

        return NextResponse.json({
            success: true,
            count: rows.length,
            fetchedAt: new Date().toISOString(),
            ventas: { documentosNuevos: ventas.documentosNuevos, incremental: ventas.incremental, errores: ventas.errores },
            data: rows,
        });
    } catch (error: any) {
        console.error('Error consultando inventario de Holded:', error);
        return NextResponse.json({ success: false, error: error?.message || 'Error inesperado' }, { status: 500 });
    }
}
