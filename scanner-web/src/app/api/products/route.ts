import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';

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

        const products = await prisma.product.findMany({
            where: { userId: session.userId }
        });

        const productDB: Record<string, any> = {};
        products.forEach(p => {
            productDB[p.upc] = {
                UPC: p.upc,
                SKU: p.sku,
                NOMBRE: p.name,
                IMAGEN: p.image || "",
                LastCost: p.lastCost || 0
            };
        });

        return NextResponse.json({ success: true, data: productDB });
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
