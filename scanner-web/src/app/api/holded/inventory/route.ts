import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { getSession } from '@/lib/auth';
import { isHoldedConfigured, listHoldedInventory, listHoldedSalesDocs, getHoldedSaleDocDetail, normalizarClave } from '@/lib/holded';
import { calcularCostoPonderado, Lote } from '@/lib/costing';

export const dynamic = 'force-dynamic';

const DIA_MS = 24 * 60 * 60 * 1000;
const BACKFILL_MS = 730 * DIA_MS;       // primera sincronización o reconstrucción: 2 años de ventas
const SOLAPE_MS = 2 * DIA_MS;           // incremental: desde la última sync menos 2 días
const RECONCILIAR_CADA_MS = DIA_MS;      // una vez al día se revisa la ventana reciente completa
const VENTANA_RECONCILIACION_MS = 90 * DIA_MS; // ...para detectar facturas borradas o editadas
const LOTE_UPSERT = 200;
const INDEX_VERSION = 2; // 2 = claves normalizadas (sin acentos, espacios simples) + unidades por línea
const MAX_DETALLES_POR_CARGA = 150; // si el listado no trae líneas, se pide el detalle de a 150 documentos por carga

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
    // Índice guardado por una versión anterior del formato → reconstruir una vez
    if (!reconstruir && estado?.salesSyncedAt && (estado.indexVersion ?? 0) < INDEX_VERSION) reconstruir = true;
    let desde: number;
    let reconciliar: boolean;
    if (reconstruir || !estado?.salesSyncedAt) {
        desde = ahora - BACKFILL_MS; reconciliar = true;
    } else if (!estado.salesReconciledAt || ahora - estado.salesReconciledAt.getTime() > RECONCILIAR_CADA_MS) {
        desde = ahora - VENTANA_RECONCILIACION_MS; reconciliar = true;
    } else {
        desde = estado.salesSyncedAt.getTime() - SOLAPE_MS; reconciliar = false;
    }

    const { docs, errores, detalle } = await listHoldedSalesDocs(desde);

    // Si el listado no trae las líneas de producto, pedir el detalle del documento (con tope por carga).
    // Los que no alcanzan quedan "pendientes" (lines = null) y se completan en las siguientes cargas.
    let detallesPedidos = 0;
    const sinLineas = docs.filter(d => d.lines.length === 0);
    const yaCompletos = new Set(sinLineas.length ? (await prisma.holdedSaleDoc.findMany({
        where: { userId, docId: { in: sinLineas.map(d => d.docId) }, NOT: { lines: { equals: Prisma.DbNull } } },
        select: { docId: true }
    })).map(x => x.docId) : []);
    const conDetalle = new Set<string>();
    for (const d of sinLineas.filter(d => !yaCompletos.has(d.docId)).sort((a, b) => b.date - a.date)) {
        if (detallesPedidos >= MAX_DETALLES_POR_CARGA) break;
        const det = await getHoldedSaleDocDetail(d.tipo, d.docId);
        detallesPedidos++;
        if (det.ok) { d.lines = det.lines; d.keys = det.keys; conDetalle.add(d.docId); }
    }

    // Reemplazar cada documento completo (así una factura editada queda con sus líneas nuevas)
    for (let i = 0; i < docs.length; i += LOTE_UPSERT) {
        await prisma.$transaction(docs.slice(i, i + LOTE_UPSERT).map(d => {
            const tieneLineas = d.lines.length > 0 || conDetalle.has(d.docId);
            const lineasJson = tieneLineas ? (d.lines as unknown as Prisma.InputJsonValue) : Prisma.DbNull;
            return prisma.holdedSaleDoc.upsert({
                where: { userId_docId: { userId, docId: d.docId } },
                create: { userId, docId: d.docId, tipo: d.tipo, date: new Date(d.date), keys: d.keys, lines: lineasJson },
                // Si ya teníamos líneas (del detalle) y el listado sigue sin traerlas, no las pisamos
                update: yaCompletos.has(d.docId) && !tieneLineas
                    ? { tipo: d.tipo, date: new Date(d.date) }
                    : { tipo: d.tipo, date: new Date(d.date), keys: d.keys, lines: lineasJson },
            });
        }));
    }

    // Completar documentos pendientes de cargas anteriores (los más recientes primero)
    if (detallesPedidos < MAX_DETALLES_POR_CARGA) {
        const pendientes = await prisma.holdedSaleDoc.findMany({
            where: { userId, lines: { equals: Prisma.DbNull } },
            orderBy: { date: 'desc' },
            take: MAX_DETALLES_POR_CARGA - detallesPedidos,
            select: { docId: true, tipo: true }
        });
        for (const pnd of pendientes) {
            const det = await getHoldedSaleDocDetail(pnd.tipo, pnd.docId);
            detallesPedidos++;
            if (det.ok) {
                await prisma.holdedSaleDoc.update({ where: { userId_docId: { userId, docId: pnd.docId } }, data: { keys: det.keys, lines: det.lines as unknown as Prisma.InputJsonValue } });
            }
        }
    }
    const pendientesRestantes = await prisma.holdedSaleDoc.count({ where: { userId, lines: { equals: Prisma.DbNull } } });

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
            create: { userId, salesSyncedAt: new Date(ahora), salesReconciledAt: reconciliar ? new Date(ahora) : null, indexVersion: INDEX_VERSION },
            update: { salesSyncedAt: new Date(ahora), ...(reconciliar ? { salesReconciledAt: new Date(ahora) } : {}), ...(reconstruir ? { indexVersion: INDEX_VERSION } : {}) },
        });
    }

    // Índice: clave ("pid:..", "sku:..", "name:..") → ventas [{ ts, units }]
    const todos = await prisma.holdedSaleDoc.findMany({ where: { userId }, select: { date: true, keys: true, lines: true } });
    const ventasPorClave = new Map<string, { ts: number; units: number }[]>();
    const add = (k: string, ts: number, units: number) => { const arr = ventasPorClave.get(k) || []; arr.push({ ts, units }); ventasPorClave.set(k, arr); };
    for (const d of todos) {
        const ts = d.date.getTime();
        const lines = Array.isArray(d.lines) ? (d.lines as unknown as { pid?: string; sku?: string; name?: string; units: number }[]) : null;
        if (lines && lines.length) {
            for (const l of lines) {
                const u = Number(l.units) || 0;
                if (l.pid) add(`pid:${l.pid}`, ts, u);
                if (l.sku) add(`sku:${l.sku}`, ts, u);
                if (l.name) add(`name:${l.name}`, ts, u);
            }
        } else {
            for (const k of d.keys) add(k, ts, 1); // documento antiguo sin unidades: cuenta 1
        }
    }
    return {
        ventasPorClave,
        info: {
            modo: reconstruir ? 'reconstruccion' : reconciliar ? 'reconciliacion' : 'incremental',
            documentos: docs.length, borrados, errores, totalDocs: todos.length,
            detallesPedidos, pendientes: pendientesRestantes,
            conLineas: todos.filter(d => Array.isArray(d.lines) && (d.lines as any[]).length > 0).length,
            detalle,
            desde: new Date(desde).toISOString(),
        },
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
        // Varios productos de la app apuntando al mismo producto de Holded = diagnóstico de agrupación indebida
        const vinculadosPorHoldedId = new Map<string, { upc: string; nombre: string }[]>();
        for (const p of productos) {
            if (!p.holdedId) continue;
            const arr = vinculadosPorHoldedId.get(p.holdedId) || [];
            arr.push({ upc: p.upc, nombre: p.name });
            vinculadosPorHoldedId.set(p.holdedId, arr);
        }

        // 3. Lotes por UPC desde los ingresos guardados, del más reciente al más antiguo
        const sesiones = await prisma.historySession.findMany({
            where: { userId: authSession.userId },
            include: { records: true },
            orderBy: { createdAt: 'desc' }
        });
        const lotesPorUpc = new Map<string, Lote[]>();
        const serialesPorLote = new Map<string, string[]>(); // "upc|lote" → seriales ingresados
        const sesionPorLote = new Map<string, string>();      // "upc|lote" → id de la sesión (para reabrirla y corregirla)
        for (const s of sesiones) {
            const porProducto = new Map<string, { unidades: number; costoTotalUsd: number; costoTotalCop: number; trm: number }>();
            for (const r of s.records) {
                const e = porProducto.get(r.upc) || { unidades: 0, costoTotalUsd: 0, costoTotalCop: 0, trm: 1 };
                e.unidades += r.cantidad || 0;
                e.costoTotalUsd += (r.cantidad || 0) * (r.costoUsd || 0);
                e.costoTotalCop += r.costoCop || 0;
                if (r.trm > 1) e.trm = Math.max(e.trm, r.trm);
                porProducto.set(r.upc, e);
                sesionPorLote.set(`${r.upc}|${s.batchName || s.id}`, s.id);
                // seriales se guarda como JSON (["SN1"]); tolerar también texto plano separado por comas
                let ser: string[] = [];
                try { const parsed = JSON.parse(r.seriales || '[]'); ser = Array.isArray(parsed) ? parsed.map(String) : []; }
                catch { ser = (r.seriales || '').split(/[,\n;]+/); }
                ser = ser.map(x => x.trim()).filter(Boolean);
                if (ser.length) {
                    const k = `${r.upc}|${s.batchName || s.id}`;
                    serialesPorLote.set(k, [...(serialesPorLote.get(k) || []), ...ser]);
                }
            }
            for (const [upc, e] of porProducto) {
                if (e.unidades <= 0) continue;
                const arr = lotesPorUpc.get(upc) || [];
                // TRM del lote: la guardada en los registros; si no la hay pero el total en COP es mayor que el
                // total en USD (ingresos antiguos que guardaron el COP sin la tasa), se deduce de la relación COP/USD.
                let trm = e.trm;
                if (!(trm > 1) && e.costoTotalUsd > 0 && e.costoTotalCop > e.costoTotalUsd * 1.5) {
                    trm = Math.round(e.costoTotalCop / e.costoTotalUsd);
                }
                arr.push({
                    lote: s.batchName || s.id,
                    fecha: s.createdAt.toISOString(),
                    unidades: e.unidades,
                    costoUsd: Math.round((e.costoTotalUsd / e.unidades) * 100) / 100,
                    trm,
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
            // Ventas: por id de producto, si no por SKU, si no por nombre (Holded no siempre vincula la línea)
            const claves = [
                `pid:${item.id}`,
                item.sku ? `sku:${normalizarClave(item.sku)}` : '',
                local?.sku ? `sku:${normalizarClave(local.sku)}` : '',
                item.name ? `name:${normalizarClave(item.name)}` : '',
                local?.name ? `name:${normalizarClave(local.name)}` : '',
            ].filter(Boolean);
            const ventasProd = claves.map(k => ventas.ventasPorClave.get(k)).find(v => v && v.length) || [];
            const ventaTs = ventasProd.reduce((m, v) => Math.max(m, v.ts), 0) || null;
            // "Llegada" = el lote MÁS ANTIGUO que todavía tiene unidades en el stock actual
            // (si el stock se compone de varios lotes, el reloj corre desde el más viejo de ellos).
            const loteMasAntiguoEnStock = costo.lotesUsados[costo.lotesUsados.length - 1] || lotes[0] || null;
            const llegadaTs = loteMasAntiguoEnStock ? new Date(loteMasAntiguoEnStock.fecha).getTime() : null;
            const desdeLlegada = llegadaTs ? ventasProd.filter(v => v.ts >= llegadaTs) : [];
            const ultimos90 = ventasProd.filter(v => v.ts >= Date.now() - 90 * 24 * 60 * 60 * 1000);
            return {
                ultimaVenta: ventaTs ? new Date(ventaTs).toISOString() : null,
                ultimaLlegada: loteMasAntiguoEnStock?.fecha || null,
                vendidosDesdeLlegada: desdeLlegada.reduce((a, v) => a + v.units, 0),
                ventasDesdeLlegada: desdeLlegada.length,
                vendidos90d: ultimos90.reduce((a, v) => a + v.units, 0),
                vinculados: vinculadosPorHoldedId.get(item.id) || [],
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
                lotes: costo.lotesUsados.map(l => ({ ...l, seriales: serialesPorLote.get(`${upc}|${l.lote}`) || [], sessionId: sesionPorLote.get(`${upc}|${l.lote}`) || null })),
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
