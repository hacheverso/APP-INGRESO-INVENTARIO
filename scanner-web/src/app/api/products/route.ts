import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

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
        const products = await prisma.product.findMany();

        // Transform incoming DB array directly into the dictionary format expected by the frontend
        // format: { "UPC-123": { UPC: "...", SKU: "...", NOMBRE: "...", IMAGEN: "..." } }
        const productDB: Record<string, any> = {};

        products.forEach(p => {
            productDB[p.upc] = {
                UPC: p.upc,
                SKU: p.sku,
                NOMBRE: p.name,
                IMAGEN: p.image || ""
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
        const body = await req.json();
        const { UPC, SKU, NOMBRE, IMAGEN } = body;

        if (!UPC || !NOMBRE) {
            return NextResponse.json({ success: false, error: 'UPC and NOMBRE are required' }, { status: 400 });
        }

        const product = await prisma.product.upsert({
            where: { upc: UPC },
            update: {
                sku: SKU || '',
                name: NOMBRE,
                image: IMAGEN || null
            },
            create: {
                upc: UPC,
                sku: SKU || '',
                name: NOMBRE,
                image: IMAGEN || null
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
        const body = await req.json();
        const { UPC, SKU, NOMBRE, IMAGEN } = body;

        if (!UPC || !NOMBRE) {
            return NextResponse.json({ success: false, error: 'UPC and NOMBRE are required for update' }, { status: 400 });
        }

        const updatedProduct = await prisma.product.update({
            where: { upc: UPC },
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
        const url = new URL(req.url);
        const upc = url.searchParams.get('upc');

        if (!upc) {
            return NextResponse.json({ success: false, error: 'UPC is required for deletion' }, { status: 400 });
        }

        await prisma.product.delete({
            where: { upc: upc }
        });

        return NextResponse.json({ success: true, message: "Product deleted successfully" });
    } catch (error: any) {
        console.error("Error deleting product:", error);
        return NextResponse.json({ success: false, error: error.message }, { status: 500 });
    }
}
