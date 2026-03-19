import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { hashPassword, createToken, getTokenCookieOptions } from '@/lib/auth';

export async function POST(req: Request) {
    try {
        const { email, password, name } = await req.json();

        if (!email || !password) {
            return NextResponse.json({ success: false, error: 'Email y contraseña son requeridos' }, { status: 400 });
        }

        const normalizedEmail = email.toLowerCase().trim();

        // Check if user already exists
        const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
        if (existing) {
            return NextResponse.json({ success: false, error: 'Ya existe una cuenta con este email' }, { status: 409 });
        }

        const passwordHash = await hashPassword(password);

        const user = await prisma.user.create({
            data: {
                email: normalizedEmail,
                passwordHash,
                name: name?.trim() || null,
            }
        });

        const token = await createToken(user.id, user.email);
        const response = NextResponse.json({
            success: true,
            user: { id: user.id, email: user.email, name: user.name }
        });

        response.cookies.set(getTokenCookieOptions(token));
        return response;
    } catch (error: any) {
        console.error('Register error:', error);
        return NextResponse.json({ success: false, error: 'Error interno del servidor' }, { status: 500 });
    }
}
