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
            date: session.date,
            batchName: session.batchName || "",
            proveedor: session.provider || "",
            totalItems: session.totalItems,
            totalCop: session.totalCop,
            records: session.records.map(r => ({
                id: r.id,
                fecha: r.fecha,
                Cantidad: r.cantidad,
                Seriales: JSON.parse(r.seriales || '[]'),
                UPC: r.upc,
                SKU: r.sku,
                NOMBRE: r.nombre,
                CostoUnitarioUSD: r.costoUsd,
                CostoTotalCOP: r.costoCop,
                TrmAcordada: r.trm
            }))
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
                        id: r.id,
                        sessionId: session.id,
                        fecha: r.fecha,
                        cantidad: r.Cantidad,
                        seriales: JSON.stringify(r.Seriales || []),
                        upc: r.UPC,
                        sku: r.SKU,
                        nombre: r.NOMBRE,
                        costoUsd: r.CostoUnitarioUSD || 0,
                        costoCop: r.CostoTotalCOP || 0,
                        trm: r.TrmAcordada || 1
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
