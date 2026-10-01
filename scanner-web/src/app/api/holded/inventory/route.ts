import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { isHoldedConfigured, listHoldedInventory, listHoldedSalesDocs } from '@/lib/holded';
import { calcularCostoPonderado, Lote } from '@/lib/costing';

export const dynamic = 'force-dynamic';

const DIA_MS = 24 * 60 * 60 * 1000;
const BACKFILL_MS = 730 * DIA_MS;       // primera sincronización o reconstrucción: 2 años de ventas
const SOLAPE_MS = 2 * DIA_MS;           // incremental: desde la última sync menos 2 días
const RECONCILIAR_CADA_MS = DIA_MS;      // una vez al día se revisa la ventana reciente completa
const VENTANA_RECONCILIACION_MS = 90 * DIA_MS; // ...para detectar facturas borradas o editadas
const LOTE_UPSERT = 200;

/**
 * Sincroniza las ventas de Holded en la tabla local HoldedSaleDoc y devuelve mapas
 * de última venta por holdedId / SKU / nombre.
 *
 * - Incremental (cada carga): solo documentos nuevos o modificados recientemente.
 * - Reconciliación (una vez al día, o si se pide reconstruir): vuelve a listar la ventana
 *   completa y elimina los documentos que Holded ya no devuelve (facturas borradas),
 *   reemplazando los editados (cantidades, productos, fecha).
 */
async function sincronizarVentas(userId: string, reconstruir: boolean) {
    const estado = await prisma.holdedSyncState.findUnique({ where: { userId } });
    const ahora = Date.now();
    let desde: number;
    let reconciliar: boolean;
    if (reconstruir || !estado?.salesSyncedAt) {
        desde = ahora - BACKFILL_MS; reconciliar = true;
    } else if (!estado.salesReconciledAt || ahora - estado.salesReconciledAt.getTime() > RECONCILIAR_CADA_MS) {
        desde = ahora - VENTANA_RECONCILIACION_MS; reconciliar = true;
    } else {
        desde = estado.salesSyncedAt.getTime() - SOLAPE_MS; reconciliar = false;
    }

    const { docs, errores } = await listHoldedSalesDocs(desde);

    // Reemplazar cada documento completo (así una factura editada queda con sus líneas nuevas)
    for (let i = 0; i < docs.length; i += LOTE_UPSERT) {
        await prisma.$transaction(docs.slice(i, i + LOTE_UPSERT).map(d => prisma.holdedSaleDoc.upsert({
            where: { userId_docId: { userId, docId: d.docId } },
            create: { userId, docId: d.docId, tipo: d.tipo, date: new Date(d.date), keys: d.keys },
            update: { tipo: d.tipo, date: new Date(d.date), keys: d.keys },
        })));
    }

    let borrados = 0;
    if (errores === 0) {
        if (reconciliar) {
            // Lo que está en la ventana y Holded ya no devolvió, fue borrado allá
            const vivos = docs.map(d => d.docId);
            const r = await prisma.holdedSaleDoc.deleteMany({ where: { userId, date: { gte: new Date(desde) }, docId: { notIn: vivos } } });
            borrados = r.count;
        }
        await prisma.holdedSyncState.upsert({
            where: { userId },
            create: { userId, salesSyncedAt: new Date(ahora), salesReconciledAt: reconciliar ? new Date(ahora) : null },
            update: { salesSyncedAt: new Date(ahora), ...(reconciliar ? { salesReconciledAt: new Date(ahora) } : {}) },
        });
    }

    const todos = await prisma.holdedSaleDoc.findMany({ where: { userId }, select: { date: true, keys: true } });
    const byProductId = new Map<string, number>(), bySku = new Map<string, number>(), byName = new Map<string, number>();
    for (const d of todos) {
        const ts = d.date.getTime();
        for (const k of d.keys) {
            const map = k.startsWith('pid:') ? byProductId : k.startsWith('sku:') ? bySku : k.startsWith('name:') ? byName : null;
            if (!map) continue;
            const val = k.slice(k.indexOf(':') + 1);
            if (ts > (map.get(val) || 0)) map.set(val, ts);
        }
    }
    return {
        byProductId, bySku, byName,
        info: { modo: reconstruir ? 'reconstruccion' : reconciliar ? 'reconciliacion' : 'incremental', documentos: docs.length, borrados, errores, totalDocs: todos.length },
    };
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
        const params = new URL(req.url).searchParams;
        const force = params.get('force') === '1';
        const rebuild = params.get('rebuild') === '1';

        // 1. Stock y precio desde Holded (con caché corto) + últimas ventas (índice local, sync incremental)
        const [inventarioCompleto, ventas] = await Promise.all([
            listHoldedInventory(force),
            sincronizarVentas(authSession.userId, rebuild),
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
            ventas: ventas.info,
            data: rows,
        });
    } catch (error: any) {
        console.error('Error consultando inventario de Holded:', error);
        return NextResponse.json({ success: false, error: error?.message || 'Error inesperado' }, { status: 500 });
    }
}
