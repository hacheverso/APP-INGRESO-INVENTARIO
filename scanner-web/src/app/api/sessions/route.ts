import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { fetchSheetsProducts } from '@/lib/sheets';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const session = await getSession();
        if (!session) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });

        const sessions = await prisma.historySession.findMany({
            where: { userId: session.userId },
            include: {
                records: true
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        // Fetch sheets data for image enrichment
        let sheetsData: Record<string, any> = {};
        try {
            const sheets = await fetchSheetsProducts();
            if (sheets.success) sheetsData = sheets.data;
        } catch (_) { /* ignore sheets failures */ }

        const formattedSessions = sessions.map(s => ({
            id: s.id,
            fecha: s.date,
            lote: s.batchName || "",
            proveedor: s.provider || "",
            totalRecords: s.records.length,
            totalUnidades: s.totalItems,
            costoTotalCOP: s.totalCop,
            monedaBase: 'COP',
            records: s.records.map(r => {
                const serialesArray = JSON.parse(r.seriales || '[]');
                const isUSD = r.costoUsd > 0;
                // Image: use stored image, or fall back to sheets data
                const storedImagen = r.imagen || '';
                const sheetsImagen = sheetsData[r.upc]?.IMAGEN || '';
                return {
                    ID: r.id,
                    FechaHora: r.fecha,
                    Lote: s.batchName || "",
                    Proveedor: s.provider || "",
                    Tipo: r.tipo || (serialesArray.length > 0 && serialesArray[0] ? 'SERIAL' : 'MASIVO'),
                    UPC: r.upc,
                    Nombre: r.nombre,
                    SKU: r.sku,
                    Serial: serialesArray.length > 0 ? serialesArray[0] : "",
                    Cantidad: r.cantidad,
                    Nota: "",
                    Moneda: isUSD ? 'USD' : 'COP',
                    CostoUnitario: isUSD ? r.costoUsd : (r.cantidad > 0 ? r.costoCop / r.cantidad : 0),
                    TasaCambio: r.trm || 1,
                    CostoTotalCOP: r.costoCop,
                    Imagen: storedImagen || sheetsImagen
                };
            })
        }));

        return NextResponse.json({ success: true, data: formattedSessions });
    } catch (error: any) {
        console.error("Error fetching sessions:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const authSession = await getSession();
        if (!authSession) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });

        const body = await req.json();
        const { id, date, batchName, proveedor, totalItems, totalCop, records } = body;

        if (!id || !records || !Array.isArray(records)) {
            return NextResponse.json({ success: false, error: 'Invalid session payload' }, { status: 400 });
        }

        const newSession = await prisma.$transaction(async (tx) => {
            // Delete existing session if re-saving (Cascade deletes records)
            await tx.historySession.deleteMany({
                where: { id: id, userId: authSession.userId }
            });

            // Create the parent session
            const session = await tx.historySession.create({
                data: {
                    id: id,
                    date: date,
                    batchName: batchName || null,
                    provider: proveedor || null,
                    totalItems: totalItems,
                    totalCop: totalCop,
                    userId: authSession.userId
                }
            });

            // Insert all child records
            if (records.length > 0) {
                await tx.historyRecord.createMany({
                    data: records.map((r: any) => ({
                        id: crypto.randomUUID(),
                        sessionId: session.id,
                        fecha: r.FechaHora || new Date().toISOString(),
                        cantidad: r.Cantidad || 1,
                        seriales: JSON.stringify(r.Serial ? [r.Serial] : []),
                        tipo: r.Tipo || 'MASIVO',
                        upc: r.UPC,
                        sku: r.SKU || '',
                        nombre: r.Nombre || 'Producto Sin Nombre',
                        imagen: r.Imagen || '',
                        costoUsd: r.Moneda === 'USD' ? (r.CostoUnitario || 0) : 0,
                        costoCop: r.CostoTotalCOP || 0,
                        trm: r.TasaCambio || 1
                    }))
                });
            }

            return session;
        });

        return NextResponse.json({ success: true, data: newSession });
    } catch (error: any) {
        console.error("Error creating session transaction:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
