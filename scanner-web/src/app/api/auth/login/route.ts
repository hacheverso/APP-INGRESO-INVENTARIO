import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifyPassword, createToken, getTokenCookieOptions } from '@/lib/auth';

export async function POST(req: Request) {
    try {
        const { email, password } = await req.json();

        if (!email || !password) {
            return NextResponse.json({ success: false, error: 'Email y contraseña son requeridos' }, { status: 400 });
        }

        const user = await prisma.user.findUnique({ where: { email: email.toLowerCase().trim() } });

        if (!user) {
            return NextResponse.json({ success: false, error: 'Credenciales incorrectas' }, { status: 401 });
        }

        const isValid = await verifyPassword(password, user.passwordHash);
        if (!isValid) {
            return NextResponse.json({ success: false, error: 'Credenciales incorrectas' }, { status: 401 });
        }

        const token = await createToken(user.id, user.email);
        const response = NextResponse.json({
            success: true,
            user: { id: user.id, email: user.email, name: user.name }
        });

        response.cookies.set(getTokenCookieOptions(token));
        return response;
    } catch (error: any) {
        console.error('Login error:', error);
        return NextResponse.json({ success: false, error: 'Error interno del servidor' }, { status: 500 });
    }
}
