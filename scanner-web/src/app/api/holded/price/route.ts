import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { isHoldedConfigured, updateHoldedPrice } from '@/lib/holded';

export const dynamic = 'force-dynamic';

/** Actualiza el precio de venta de un producto en Holded. Body: { holdedId, price } */
export async function PUT(req: Request) {
    try {
        const authSession = await getSession();
        if (!authSession) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
        if (!isHoldedConfigured()) {
            return NextResponse.json({ success: false, error: 'HOLDED_API_KEY no está configurada en el servidor' }, { status: 500 });
        }

        const { holdedId, price } = await req.json();
        const precio = Number(price);
        if (!holdedId || typeof holdedId !== 'string') {
            return NextResponse.json({ success: false, error: 'Falta holdedId' }, { status: 400 });
        }
        if (!isFinite(precio) || precio < 0) {
            return NextResponse.json({ success: false, error: 'Precio inválido' }, { status: 400 });
        }

        const result = await updateHoldedPrice(holdedId, precio);
        if (!result.ok) {
            return NextResponse.json({ success: false, error: result.error }, { status: 502 });
        }
        return NextResponse.json({ success: true, holdedId, price: precio });
    } catch (error: any) {
        console.error('Error actualizando precio en Holded:', error);
        return NextResponse.json({ success: false, error: error?.message || 'Error inesperado' }, { status: 500 });
    }
}
