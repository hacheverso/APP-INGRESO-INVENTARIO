import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Siguiente código interno libre para productos usados / sin UPC.
 * GET /api/products/next-code?prefix=U20261001  →  { code: "U20261001005" }
 * Se calcula en el servidor (base de datos) para que varios dispositivos no generen el mismo código.
 */
export async function GET(req: Request) {
    try {
        const session = await getSession();
        if (!session) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });

        const prefix = (new URL(req.url).searchParams.get('prefix') || '').trim();
        if (!/^U\d{8}$/.test(prefix)) {
            return NextResponse.json({ success: false, error: 'Prefijo inválido' }, { status: 400 });
        }

        const existentes = await prisma.product.findMany({
            where: { userId: session.userId, upc: { startsWith: prefix } },
            select: { upc: true }
        });
        const re = new RegExp(`^${prefix}-?(\\d{3,4})$`);
        let maxSeq = 0;
        for (const p of existentes) {
            const m = p.upc.match(re);
            if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
        }
        const code = `${prefix}${String(maxSeq + 1).padStart(3, '0')}`;
        return NextResponse.json({ success: true, code, existentes: existentes.length });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error?.message || 'Error inesperado' }, { status: 500 });
    }
}
