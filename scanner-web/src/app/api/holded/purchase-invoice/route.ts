import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import {
    isHoldedConfigured,
    createHoldedProduct,
    findOrCreateSupplier,
    getHoldedProductsByBarcode,
    createPurchaseInvoice,
    HoldedInvoiceItem,
} from '@/lib/holded';

export const dynamic = 'force-dynamic';

// La numeración usa el día calendario de Colombia
const BOGOTA_TZ = 'America/Bogota';
const LOTE_PATTERN = /^\d{8}-\d{1,4}$/;

function getBogotaDayKey(): string {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: BOGOTA_TZ, year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date()).replace(/-/g, ''); // "YYYYMMDD"
}

/**
 * Siguiente consecutivo del día calculado desde NUESTRAS sesiones (títulos de
 * lote y facturas ya emitidas), sin depender del listado de Holded.
 */
async function nextDocNumberFromDb(userId: string, dayKey: string): Promise<string> {
    const sessions = await prisma.historySession.findMany({
        where: { userId },
        select: { batchName: true, holdedInvoiceNum: true }
    });
    const pattern = new RegExp(`^${dayKey}-(\\d{1,4})$`);
    let maxSeq = 0;
    for (const s of sessions) {
        for (const candidate of [s.batchName, s.holdedInvoiceNum]) {
            const m = (candidate || '').trim().match(pattern);
            if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
        }
    }
    return `${dayKey}-${String(maxSeq + 1).padStart(3, '0')}`;
}

export async function POST(req: Request) {
    try {
        const authSession = await getSession();
        if (!authSession) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });

        if (!isHoldedConfigured()) {
            return NextResponse.json({ success: false, error: 'HOLDED_API_KEY no está configurada en el servidor' }, { status: 500 });
        }

        const { sessionId, force } = await req.json();
        if (!sessionId) {
            return NextResponse.json({ success: false, error: 'sessionId es requerido' }, { status: 400 });
        }

        const session = await prisma.historySession.findFirst({
            where: { id: sessionId, userId: authSession.userId },
            include: { records: true }
        });
        if (!session) {
            return NextResponse.json({ success: false, error: 'Sesión no encontrada' }, { status: 404 });
        }

        if (session.holdedInvoiceId && !force) {
            return NextResponse.json({
                success: false,
                alreadyInvoiced: true,
                invoiceNum: session.holdedInvoiceNum,
                error: `Esta sesión ya tiene la factura ${session.holdedInvoiceNum} en Holded`
            }, { status: 409 });
        }

        const providerName = (session.provider || '').trim();
        if (!providerName) {
            return NextResponse.json({ success: false, error: 'La sesión no tiene proveedor asignado. Reábrela, asigna el proveedor y guárdala de nuevo.' }, { status: 400 });
        }

        // Solo sesiones ingresadas en COP (con TRM) tienen valores reales en pesos
        const isCopSession = session.records.some(r => r.trm > 1);
        if (!isCopSession) {
            return NextResponse.json({ success: false, error: 'Esta sesión fue ingresada en USD sin TRM; solo las sesiones en COP se pueden facturar en Holded.' }, { status: 400 });
        }

        // Agrupar registros por UPC: cantidad total y costo total en COP
        const grouped = new Map<string, { upc: string; sku: string; nombre: string; imagen: string; units: number; totalCop: number }>();
        for (const r of session.records) {
            const key = r.upc;
            const entry = grouped.get(key) || { upc: r.upc, sku: r.sku, nombre: r.nombre, imagen: r.imagen, units: 0, totalCop: 0 };
            entry.units += r.cantidad;
            entry.totalCop += r.costoCop;
            if (!entry.nombre && r.nombre) entry.nombre = r.nombre;
            if (!entry.imagen && r.imagen) entry.imagen = r.imagen;
            grouped.set(key, entry);
        }

        if (grouped.size === 0) {
            return NextResponse.json({ success: false, error: 'La sesión no tiene registros para facturar' }, { status: 400 });
        }

        // 1. Resolver proveedor (buscar o crear)
        const supplier = await findOrCreateSupplier(providerName);

        // 2. Vincular productos de Holded por código de barras; crear los que falten
        const barcodeMap = await getHoldedProductsByBarcode();
        let createdProducts = 0;
        const items: HoldedInvoiceItem[] = [];

        for (const line of grouped.values()) {
            let productId = barcodeMap.get(line.upc);
            if (!productId) {
                const created = await createHoldedProduct({
                    name: line.nombre || `Producto ${line.upc}`,
                    barcode: line.upc,
                    sku: line.sku || null,
                    imageUrl: line.imagen || null
                });
                if (created.ok && created.holdedId) {
                    productId = created.holdedId;
                    createdProducts++;
                }
                // Si tampoco se pudo crear, la línea va sin vínculo (solo texto)
            }
            const unitPriceCop = line.units > 0 ? Math.round((line.totalCop / line.units) * 100) / 100 : 0;
            items.push({
                name: line.nombre || line.upc,
                sku: line.sku || line.upc,
                units: line.units,
                unitPriceCop,
                productId
            });
        }

        // 3. Número de factura = título del lote en el historial (ej. 20260710-001),
        // para que factura e ingreso compartan el mismo número. Si el lote no tiene
        // ese formato (sesiones antiguas) o es una re-facturación forzada, se toma
        // el siguiente consecutivo del día según nuestra base de datos.
        const dayKey = getBogotaDayKey();
        const loteName = (session.batchName || '').trim();
        let docNumber: string;
        if (LOTE_PATTERN.test(loteName) && !(force && session.holdedInvoiceNum)) {
            docNumber = loteName;
        } else {
            docNumber = await nextDocNumberFromDb(authSession.userId, dayKey);
        }

        // 4. Crear la factura de compra
        const totalCop = items.reduce((acc, i) => acc + i.unitPriceCop * i.units, 0);
        const holdedInvoiceId = await createPurchaseInvoice({
            contactId: supplier.id,
            docNumber,
            dateTs: Math.floor(Date.now() / 1000),
            notes: `Lote: ${session.batchName || session.id} — creada desde INGRESADOS`,
            items
        });

        // 5. Marcar la sesión como facturada
        await prisma.historySession.update({
            where: { id: session.id },
            data: { holdedInvoiceId, holdedInvoiceNum: docNumber }
        });

        return NextResponse.json({
            success: true,
            holdedInvoiceId,
            invoiceNum: docNumber,
            supplierName: providerName,
            supplierCreated: supplier.created,
            lineCount: items.length,
            totalCop,
            createdProducts
        });
    } catch (error: any) {
        console.error('Error creando factura de compra en Holded:', error);
        return NextResponse.json({ success: false, error: error?.message || 'Error inesperado' }, { status: 500 });
    }
}
