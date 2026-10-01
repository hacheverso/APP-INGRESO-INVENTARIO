import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { getSession } from '@/lib/auth';
import { isHoldedConfigured, muestraVentasCrudas, listHoldedInventory, normalizarClave } from '@/lib/holded';

export const dynamic = 'force-dynamic';

/**
 * Diagnóstico del cruce de ventas (abrir en el navegador estando logueado):
 * /api/holded/diagnose-sales
 * Muestra qué devuelve Holded para los documentos de venta, qué hay guardado en el índice
 * local y, para algunos productos con stock, si sus claves encuentran ventas.
 */
export async function GET(req: Request) {
    try {
        const authSession = await getSession();
        if (!authSession) return NextResponse.json({ success: false, error: 'No autenticado' }, { status: 401 });
        if (!isHoldedConfigured()) return NextResponse.json({ success: false, error: 'HOLDED_API_KEY no está configurada' }, { status: 500 });

        const dias = Number(new URL(req.url).searchParams.get('dias') || 60);
        const userId = authSession.userId;

        const [crudo, estado, totalDocs, conLineas, ejemplos, inventario] = await Promise.all([
            muestraVentasCrudas(dias),
            prisma.holdedSyncState.findUnique({ where: { userId } }),
            prisma.holdedSaleDoc.count({ where: { userId } }),
            prisma.holdedSaleDoc.count({ where: { userId, lines: { not: Prisma.DbNull } } }).catch(() => -1),
            prisma.holdedSaleDoc.findMany({ where: { userId }, orderBy: { date: 'desc' }, take: 3, select: { docId: true, tipo: true, date: true, keys: true, lines: true } }),
            listHoldedInventory().catch(() => []),
        ]);

        // Para los 5 productos con más stock: ¿alguna de sus claves tiene ventas en el índice?
        const todos = await prisma.holdedSaleDoc.findMany({ where: { userId }, select: { keys: true } });
        const clavesConVentas = new Set<string>();
        for (const d of todos) for (const k of d.keys) clavesConVentas.add(k);
        const muestra = inventario.filter(p => p.stock > 0).sort((a, b) => b.stock - a.stock).slice(0, 5).map(p => {
            const claves = [`pid:${p.id}`, p.sku ? `sku:${normalizarClave(p.sku)}` : '', p.name ? `name:${normalizarClave(p.name)}` : ''].filter(Boolean);
            return { nombre: p.name, sku: p.sku, holdedId: p.id, stock: p.stock, claves, clavesConVentas: claves.filter(k => clavesConVentas.has(k)) };
        });

        return NextResponse.json({
            success: true,
            leeme: 'Comparte esta página completa (captura o copia) para revisar por qué no cruzan las ventas.',
            holdedCrudo: crudo,
            indiceLocal: { ultimaSincronizacion: estado?.salesSyncedAt, ultimaReconciliacion: estado?.salesReconciledAt, documentosGuardados: totalDocs, documentosConLineas: conLineas, ejemplosRecientes: ejemplos, clavesDistintasConVentas: clavesConVentas.size },
            productosDeMuestra: muestra,
        });
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error?.message || 'Error inesperado' }, { status: 500 });
    }
}
