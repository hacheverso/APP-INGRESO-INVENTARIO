import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { fetchSheetsProducts } from '@/lib/sheets';
import { createHoldedProduct, updateHoldedProduct, isHoldedConfigured } from '@/lib/holded';

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
                CATEGORIA: p.category || "",
                LastCost: p.lastCost || 0
            };
        });

        // 2. Merge/override with Google Sheets data (live source of truth)
        if (sheetsResult.success && sheetsResult.data) {
            const sheetsData = sheetsResult.data as Record<string, any>;
            for (const [key, sheetProduct] of Object.entries(sheetsData)) {
                if (productDB[key]) {
                    // Merge: la BD manda en la identidad del producto (nombre, SKU, imagen,
                    // categoría) porque es lo que el usuario cura y edita en la app; el Sheets
                    // solo rellena cuando la BD no tiene el dato, y aporta los campos vivos
                    // (stock, precio, margen...) que la BD no maneja.
                    productDB[key] = {
                        ...productDB[key],
                        NOMBRE: productDB[key].NOMBRE || sheetProduct.NOMBRE,
                        SKU: productDB[key].SKU || sheetProduct.SKU,
                        IMAGEN: productDB[key].IMAGEN || sheetProduct.IMAGEN,
                        LastCost: productDB[key].LastCost || 0, // DB is source of truth for LastCost (USD)
                        // Extended fields from Sheets
                        STOCK: sheetProduct.STOCK,
                        PRECIO: sheetProduct.PRECIO,
                        COSTO: sheetProduct.COSTO,
                        MARGEN: sheetProduct.MARGEN,
                        CATEGORIA: productDB[key].CATEGORIA || sheetProduct.CATEGORIA,
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
                        ...(item.CATEGORIA !== undefined ? { category: item.CATEGORIA || '' } : {}),
                        ...(item.LastCost !== undefined && item.LastCost > 0 ? { lastCost: item.LastCost } : {})
                    },
                    create: {
                        upc: item.UPC,
                        sku: item.SKU || '',
                        name: item.NOMBRE,
                        image: item.IMAGEN || null,
                        category: item.CATEGORIA || '',
                        lastCost: item.LastCost || 0,
                        userId: session.userId
                    }
                });
            });

            const results = await prisma.$transaction(operations);
            return NextResponse.json({ success: true, count: results.length, data: results });
        } 
        
        // Branch 2: Single Product Process (Object)
        const { UPC, SKU, NOMBRE, IMAGEN, CATEGORIA, syncHolded } = body;

        if (!UPC || !NOMBRE) {
            return NextResponse.json({ success: false, error: 'UPC and NOMBRE are required' }, { status: 400 });
        }

        // Saber si ya existía (y su id en Holded) antes de guardar, para crear vs. actualizar
        const existing = await prisma.product.findUnique({
            where: { upc_userId: { upc: UPC, userId: session.userId } },
            select: { holdedId: true }
        });

        const product = await prisma.product.upsert({
            where: { upc_userId: { upc: UPC, userId: session.userId } },
            update: {
                sku: SKU || '',
                name: NOMBRE,
                image: IMAGEN || null,
                ...(CATEGORIA !== undefined ? { category: CATEGORIA || '' } : {}),
                ...(body.LastCost !== undefined && body.LastCost > 0 ? { lastCost: body.LastCost } : {})
            },
            create: {
                upc: UPC,
                sku: SKU || '',
                name: NOMBRE,
                image: IMAGEN || null,
                category: CATEGORIA || '',
                lastCost: body.LastCost || 0,
                userId: session.userId
            }
        });

        // Sync a Holded cuando el frontend lo pide (crear o editar desde el modal de producto).
        // Best-effort: un fallo en Holded no revierte el guardado local.
        let holded = null;
        if (syncHolded) {
            if (isHoldedConfigured()) {
                holded = existing
                    ? await updateHoldedProduct({ holdedId: existing.holdedId, barcode: UPC, name: NOMBRE, sku: SKU || null, imageUrl: IMAGEN || null })
                    : await createHoldedProduct({ name: NOMBRE, barcode: UPC, sku: SKU || null, imageUrl: IMAGEN || null });

                // Guardar el id de Holded si es nuevo (para futuras ediciones sin buscar por barcode)
                if (holded?.ok && holded.holdedId && holded.holdedId !== existing?.holdedId) {
                    await prisma.product.update({
                        where: { upc_userId: { upc: UPC, userId: session.userId } },
                        data: { holdedId: holded.holdedId }
                    }).catch(() => {});
                }
            } else {
                holded = { ok: false, error: 'HOLDED_API_KEY no está configurada en el servidor' };
            }
        }

        return NextResponse.json({ success: true, data: product, holded });
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
        const { UPC, SKU, NOMBRE, IMAGEN, CATEGORIA } = body;

        if (!UPC || !NOMBRE) {
            return NextResponse.json({ success: false, error: 'UPC and NOMBRE are required for update' }, { status: 400 });
        }

        const updatedProduct = await prisma.product.update({
            where: { upc_userId: { upc: UPC, userId: session.userId } },
            data: {
                sku: SKU || '',
                name: NOMBRE,
                image: IMAGEN || null,
                ...(CATEGORIA !== undefined ? { category: CATEGORIA || '' } : {})
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
