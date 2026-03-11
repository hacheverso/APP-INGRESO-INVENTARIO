import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const sessions = await prisma.historySession.findMany({
            include: {
                records: true // Bring all records within each session
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        // Map the Prisma ORM structure back to the shape expected by the frontend's HistorySession interface
        const formattedSessions = sessions.map(session => ({
            id: session.id, // Keep the UUID
            fecha: session.date,
            lote: session.batchName || "",
            proveedor: session.provider || "",
            totalRecords: session.records.length,
            totalUnidades: session.totalItems,
            costoTotalCOP: session.totalCop,
            monedaBase: 'COP', // Resumed base currency
            records: session.records.map(r => {
                const serialesArray = JSON.parse(r.seriales || '[]');
                const isUSD = r.costoUsd > 0;
                return {
                    ID: r.id,
                    FechaHora: r.fecha,
                    Lote: session.batchName || "",
                    Proveedor: session.provider || "",
                    Tipo: "NUBESYNC",
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
                    Imagen: "" // Ignored in history history view
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
        const body = await req.json();
        const { id, date, batchName, proveedor, totalItems, totalCop, records } = body;

        if (!id || !records || !Array.isArray(records)) {
            return NextResponse.json({ success: false, error: 'Invalid session payload' }, { status: 400 });
        }

        // Use Prisma Transaction to ensure the Session and all its Records are created together
        const newSession = await prisma.$transaction(async (tx) => {

            // 1. Create the parent session
            const session = await tx.historySession.create({
                data: {
                    id: id,
                    date: date,
                    batchName: batchName || null,
                    provider: proveedor || null,
                    totalItems: totalItems,
                    totalCop: totalCop
                }
            });

            // 2. Insert all child records tied to the session id
            if (records.length > 0) {
                await tx.historyRecord.createMany({
                    data: records.map((r: any) => ({
                        id: r.ID || crypto.randomUUID(),
                        sessionId: session.id,
                        fecha: r.FechaHora || new Date().toISOString(),
                        cantidad: r.Cantidad || 1,
                        seriales: JSON.stringify(r.Serial ? [r.Serial] : []),
                        upc: r.UPC,
                        sku: r.SKU || '',
                        nombre: r.Nombre || 'Producto Sin Nombre',
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
        // If it's a unique constraint violation (session already exists), catch it
        if (error.code === 'P2002') {
            return NextResponse.json({ success: false, error: 'Session ID already exists in the database' }, { status: 409 });
        }
        console.error("Error creating session transaction:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
