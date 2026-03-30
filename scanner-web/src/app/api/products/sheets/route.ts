import { NextResponse } from 'next/server';
import { fetchSheetsProducts } from '@/lib/sheets';

export const dynamic = 'force-dynamic';

export async function GET() {
    const result = await fetchSheetsProducts();
    return NextResponse.json(result);
}
