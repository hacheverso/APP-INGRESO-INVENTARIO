import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { fetchSheetsProducts } from '@/lib/sheets';

export const dynamic = 'force-dynamic';

// Helper for BigInt serialization (if needed by Prisma)
declare global {
    interface BigInt {
        toJSON(): string;
    }
}

BigInt.prototype.toJSON = function () {
    return this.toString();
};

export async function GET() {
    try {
        const session = await getSession();
        if (!session) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });

        // Fetch user's sheetsUrl from DB
        const user = await prisma.user.findUnique({
            where: { id: session.userId },
            select: { sheetsUrl: true }
        });

        // Fetch DB products and Google Sheets products in parallel
        const [dbProducts, sheetsResult] = await Promise.all([
            prisma.product.findMany({ where: { userId: session.userId } }),
            fetchSheetsProducts(user?.sheetsUrl)
        ]);

        const productDB: Record<string, any> = {};

        // 1. First, load DB products as base
        dbProducts.forEach(p => {
            productDB[p.upc] = {
                UPC: p.upc,
                SKU: p.sku,
                NOMBRE: p.name,
                IMAGEN: p.image || "",
                LastCost: p.lastCost || 0
            };
        });

        // 2. Merge/override with Google Sheets data (live source of truth)
        if (sheetsResult.success && sheetsResult.data) {
            const sheetsData = sheetsResult.data as Record<string, any>;
            for (const [key, sheetProduct] of Object.entries(sheetsData)) {
                if (productDB[key]) {
                    // Merge: Sheets data enriches/overrides DB data
                    productDB[key] = {
                        ...productDB[key],
                        NOMBRE: sheetProduct.NOMBRE || productDB[key].NOMBRE,
                        SKU: sheetProduct.SKU || productDB[key].SKU,
                        IMAGEN: sheetProduct.IMAGEN || productDB[key].IMAGEN,
                        LastCost: productDB[key].LastCost || 0, // DB is source of truth for LastCost (USD)
                        // Extended fields from Sheets
                        STOCK: sheetProduct.STOCK,
                        PRECIO: sheetProduct.PRECIO,
                        COSTO: sheetProduct.COSTO,
                        MARGEN: sheetProduct.MARGEN,
                        CATEGORIA: sheetProduct.CATEGORIA,
                        COSTO_TOTAL: sheetProduct.COSTO_TOTAL,
                        DIAS_SIN_VENDER: sheetProduct.DIAS_SIN_VENDER,
                    };
                } else {
                    // New product only in Sheets — add it
                    productDB[key] = sheetProduct;
                }
            }
        }

        return NextResponse.json({
            success: true,
            data: productDB,
            sheetsConnected: sheetsResult.success === true,
            lastSheetsUpdate: sheetsResult.lastFetched || null
        });
    } catch (error: any) {
        console.error("Error fetching products:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

export async function POST(req: Request) {
    try {
        const session = await getSession();
        if (!session) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });

        const body = await req.json();

        // Branch 1: Batch Process (Array)
        if (Array.isArray(body)) {
            const operations = body.map((item: any) => {
                return prisma.product.upsert({
                    where: { upc_userId: { upc: item.UPC, userId: session.userId } },
                    update: {
                        sku: item.SKU || '',
                        name: item.NOMBRE,
                        image: item.IMAGEN || null,
                        ...(item.LastCost !== undefined && item.LastCost > 0 ? { lastCost: item.LastCost } : {})
                    },
                    create: {
                        upc: item.UPC,
                        sku: item.SKU || '',
                        name: item.NOMBRE,
                        image: item.IMAGEN || null,
                        lastCost: item.LastCost || 0,
                        userId: session.userId
                    }
                });
            });

            const results = await prisma.$transaction(operations);
            return NextResponse.json({ success: true, count: results.length, data: results });
        } 
        
        // Branch 2: Single Product Process (Object)
        const { UPC, SKU, NOMBRE, IMAGEN } = body;

        if (!UPC || !NOMBRE) {
            return NextResponse.json({ success: false, error: 'UPC and NOMBRE are required' }, { status: 400 });
        }

        const product = await prisma.product.upsert({
            where: { upc_userId: { upc: UPC, userId: session.userId } },
            update: {
                sku: SKU || '',
                name: NOMBRE,
                image: IMAGEN || null,
                ...(body.LastCost !== undefined && body.LastCost > 0 ? { lastCost: body.LastCost } : {})
            },
            create: {
                upc: UPC,
                sku: SKU || '',
                name: NOMBRE,
                image: IMAGEN || null,
                lastCost: body.LastCost || 0,
                userId: session.userId
            }
        });

        return NextResponse.json({ success: true, data: product });
    } catch (error: any) {
        console.error("Error upserting product:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

export async function PUT(req: Request) {
    try {
        const session = await getSession();
        if (!session) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });

        const body = await req.json();
        const { UPC, SKU, NOMBRE, IMAGEN } = body;

        if (!UPC || !NOMBRE) {
            return NextResponse.json({ success: false, error: 'UPC and NOMBRE are required for update' }, { status: 400 });
        }

        const updatedProduct = await prisma.product.update({
            where: { upc_userId: { upc: UPC, userId: session.userId } },
            data: {
                sku: SKU || '',
                name: NOMBRE,
                image: IMAGEN || null
            }
        });

        return NextResponse.json({ success: true, data: updatedProduct });
    } catch (error: any) {
        console.error("Error updating product:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}

export async function DELETE(req: Request) {
    try {
        const session = await getSession();
        if (!session) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });

        const url = new URL(req.url);
        const upc = url.searchParams.get('upc');

        if (!upc) {
            return NextResponse.json({ success: false, error: 'UPC is required for deletion' }, { status: 400 });
        }

        // Bulk delete: ?upc=ALL
        if (upc === 'ALL') {
            const result = await prisma.product.deleteMany({
                where: { userId: session.userId }
            });
            return NextResponse.json({ success: true, message: `${result.count} productos eliminados del catálogo.`, count: result.count });
        }

        await prisma.product.delete({
            where: { upc_userId: { upc: upc, userId: session.userId } }
        });

        return NextResponse.json({ success: true, message: "Product deleted successfully" });
    } catch (error: any) {
        console.error("Error deleting product:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
