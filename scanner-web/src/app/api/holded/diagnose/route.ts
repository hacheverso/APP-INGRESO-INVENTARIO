import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { isHoldedConfigured, findHoldedProductsByBarcode } from '@/lib/holded';

export const dynamic = 'force-dynamic';

/**
 * Diagnóstico: lista todos los productos de Holded que comparten un código de
 * barras. Sirve para detectar duplicados que hacen que una factura muestre el
 * nombre equivocado. GET /api/holded/diagnose?barcode=190021074545
 */
export async function GET(req: Request) {
    try {
        const session = await getSession();
        if (!session) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });

        if (!isHoldedConfigured()) {
            return NextResponse.json({ success: false, error: 'HOLDED_API_KEY no está configurada en el servidor' }, { status: 500 });
        }

        const url = new URL(req.url);
        const barcode = (url.searchParams.get('barcode') || '').trim();
        if (!barcode) {
            return NextResponse.json({ success: false, error: 'Falta el parámetro barcode' }, { status: 400 });
        }

        const matches = await findHoldedProductsByBarcode(barcode);
        return NextResponse.json({
            success: true,
            barcode,
            count: matches.length,
            duplicado: matches.length > 1,
            productos: matches,
        });
    } catch (error: any) {
        console.error('Error en diagnóstico de Holded:', error);
        return NextResponse.json({ success: false, error: error?.message || 'Error inesperado' }, { status: 500 });
    }
}
