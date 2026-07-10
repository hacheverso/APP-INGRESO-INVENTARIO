import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';

/**
 * Exportación del catálogo para Google Sheets (Apps Script).
 * GET /api/products/export?token=SHEETS_EXPORT_TOKEN&email=correo@delusuario
 *
 * Protegido con un token compartido (variable de entorno SHEETS_EXPORT_TOKEN)
 * porque Apps Script no puede autenticarse con la cookie de sesión.
 */
export async function GET(req: Request) {
    try {
        const url = new URL(req.url);
        const token = url.searchParams.get('token') || '';
        const email = (url.searchParams.get('email') || '').trim().toLowerCase();

        const expected = process.env.SHEETS_EXPORT_TOKEN;
        if (!expected) {
            return NextResponse.json({ success: false, error: 'SHEETS_EXPORT_TOKEN no está configurada en el servidor' }, { status: 500 });
        }
        if (token !== expected) {
            return NextResponse.json({ success: false, error: 'Token inválido' }, { status: 401 });
        }
        if (!email) {
            return NextResponse.json({ success: false, error: 'Falta el parámetro email' }, { status: 400 });
        }

        const user = await prisma.user.findUnique({ where: { email } });
        if (!user) {
            return NextResponse.json({ success: false, error: `No existe un usuario con el correo ${email}` }, { status: 404 });
        }

        const products = await prisma.product.findMany({
            where: { userId: user.id },
            orderBy: { name: 'asc' }
        });

        return NextResponse.json({
            success: true,
            count: products.length,
            data: products.map(p => ({
                UPC: p.upc,
                SKU: p.sku,
                NOMBRE: p.name,
                CATEGORIA: p.category || '',
                IMAGEN: p.image || '',
                ULTIMO_COSTO_USD: p.lastCost || 0,
                CREADO: p.createdAt.toISOString(),
                ACTUALIZADO: p.updatedAt.toISOString(),
            }))
        });
    } catch (error: any) {
        console.error('Error exportando productos:', error);
        return NextResponse.json({ success: false, error: error?.message || 'Error inesperado' }, { status: 500 });
    }
}
