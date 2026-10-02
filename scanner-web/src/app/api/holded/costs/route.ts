import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { isHoldedConfigured, updateHoldedCost } from '@/lib/holded';

export const dynamic = 'force-dynamic';

/**
 * Envía a Holded el costo ponderado (COP) de los productos del inventario.
 * Body: { items: [{ holdedId, upc, costoCop }] }
 * Solo se envían los que cambiaron respecto al último costo enviado (Product.holdedCostCop),
 * para no gastar llamadas de la API en productos que no se movieron.
 */
export async function POST(req: Request) {
    try {
        const authSession = await getSession();
        if (!authSession) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
        if (!isHoldedConfigured()) {
            return NextResponse.json({ success: false, error: 'HOLDED_API_KEY no está configurada en el servidor' }, { status: 500 });
        }

        const body = await req.json().catch(() => ({}));
        const items: { holdedId: string; upc: string; costoCop: number }[] = Array.isArray(body?.items) ? body.items : [];
        const validos = items.filter(i => i && typeof i.holdedId === 'string' && i.holdedId && isFinite(Number(i.costoCop)) && Number(i.costoCop) > 0);
        if (validos.length === 0) {
            return NextResponse.json({ success: true, enviados: 0, sinCambios: 0, errores: [], mensaje: 'No hay costos en COP para enviar.' });
        }

        const productos = await prisma.product.findMany({
            where: { userId: authSession.userId, upc: { in: validos.map(i => i.upc).filter(Boolean) } },
            select: { upc: true, holdedCostCop: true }
        });
        const previo = new Map(productos.map(p => [p.upc, p.holdedCostCop]));

        let enviados = 0, sinCambios = 0;
        const errores: { upc: string; error: string }[] = [];
        for (const it of validos) {
            const costo = Math.round(Number(it.costoCop));
            if (it.upc && previo.has(it.upc) && previo.get(it.upc) === costo) { sinCambios++; continue; }
            const r = await updateHoldedCost(it.holdedId, costo);
            if (!r.ok) { errores.push({ upc: it.upc || it.holdedId, error: r.error || 'error' }); continue; }
            enviados++;
            if (it.upc) {
                await prisma.product.updateMany({ where: { userId: authSession.userId, upc: it.upc }, data: { holdedCostCop: costo } });
            }
        }
        return NextResponse.json({ success: true, enviados, sinCambios, errores });
    } catch (error: any) {
        console.error('Error enviando costos a Holded:', error);
        return NextResponse.json({ success: false, error: error?.message || 'Error inesperado' }, { status: 500 });
    }
}
