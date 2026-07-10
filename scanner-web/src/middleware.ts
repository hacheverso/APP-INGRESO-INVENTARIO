import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(process.env.JWT_SECRET || 'fallback-secret-please-change');
const COOKIE_NAME = 'ingresados_token';

// /api/products/export tiene su propia autenticación por token (Apps Script no maneja cookies)
const PUBLIC_PATHS = ['/login', '/api/auth/login', '/api/auth/register', '/api/products/export'];

export async function middleware(request: NextRequest) {
    const { pathname } = request.nextUrl;

    // Allow public paths and static assets
    if (
        PUBLIC_PATHS.some(path => pathname.startsWith(path)) ||
        pathname.startsWith('/_next') ||
        pathname.startsWith('/favicon') ||
        pathname.endsWith('.png') ||
        pathname.endsWith('.ico')
    ) {
        return NextResponse.next();
    }

    const token = request.cookies.get(COOKIE_NAME)?.value;

    if (!token) {
        return NextResponse.redirect(new URL('/login', request.url));
    }

    try {
        await jwtVerify(token, JWT_SECRET);
        return NextResponse.next();
    } catch {
        // Invalid/expired token
        const response = NextResponse.redirect(new URL('/login', request.url));
        response.cookies.delete(COOKIE_NAME);
        return response;
    }
}

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
