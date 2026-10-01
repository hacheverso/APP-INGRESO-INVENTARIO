import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { isHoldedConfigured, listHoldedInventory, getHoldedLastSales } from '@/lib/holded';
import { calcularCostoPonderado, Lote } from '@/lib/costing';

export const dynamic = 'force-dynamic';

/**
 * Inventario activo según Holded (stock > 0) con el costo ponderado por lotes
 * calculado a partir de los ingresos guardados en INGRESADOS.
 */
export async function GET() {
    try {
        const authSession = await getSession();
        if (!authSession) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
        if (!isHoldedConfigured()) {
            return NextResponse.json({ success: false, error: 'HOLDED_API_KEY no está configurada en el servidor' }, { status: 500 });
        }

        // 1. Stock y precio desde Holded (solo lo que tiene unidades) + últimas ventas (últimos 2 años)
        const DOS_ANIOS_MS = 730 * 24 * 60 * 60 * 1000;
        const [inventarioCompleto, ventas] = await Promise.all([
            listHoldedInventory(),
            getHoldedLastSales(Date.now() - DOS_ANIOS_MS),
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

        return NextResponse.json({ success: true, count: rows.length, fetchedAt: new Date().toISOString(), ventasConsultadas: ventas.documentos, data: rows });
    } catch (error: any) {
        console.error('Error consultando inventario de Holded:', error);
        return NextResponse.json({ success: false, error: error?.message || 'Error inesperado' }, { status: 500 });
    }
}
