import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

// GET: Return the user's configured sheetsUrl
export async function GET() {
    try {
        const session = await getSession();
        if (!session) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });

        const user = await prisma.user.findUnique({
            where: { id: session.userId },
            select: { sheetsUrl: true }
        });

        return NextResponse.json({
            success: true,
            sheetsUrl: user?.sheetsUrl || null
        });
    } catch (error: any) {
        console.error("Error fetching sheets URL:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

// PUT: Update the user's sheetsUrl
export async function PUT(req: Request) {
    try {
        const session = await getSession();
        if (!session) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });

        const body = await req.json();
        const { sheetsUrl } = body;

        // Allow clearing the URL (set to null)
        if (sheetsUrl === null || sheetsUrl === '') {
            await prisma.user.update({
                where: { id: session.userId },
                data: { sheetsUrl: null }
            });
            return NextResponse.json({ success: true, sheetsUrl: null });
        }

        // Validate it's a Google Sheets URL
        if (!sheetsUrl.includes('docs.google.com/spreadsheets')) {
            return NextResponse.json({ 
                success: false, 
                error: 'URL inválida. Debe ser un link de Google Sheets (docs.google.com/spreadsheets/...)' 
            }, { status: 400 });
        }

        const updatedUser = await prisma.user.update({
            where: { id: session.userId },
            data: { sheetsUrl }
        });

        return NextResponse.json({
            success: true,
            sheetsUrl: updatedUser.sheetsUrl
        });
    } catch (error: any) {
        console.error("Error updating sheets URL:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
