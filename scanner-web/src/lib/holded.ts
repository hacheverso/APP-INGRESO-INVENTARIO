// Integración con Holded (https://developers.holded.com)
// Autenticación: header "key" con la API Key generada en Holded → Configuración → Developers.

const HOLDED_API_BASE = process.env.HOLDED_API_BASE_URL || 'https://api.holded.com/api/invoicing/v1';
const REQUEST_TIMEOUT_MS = 15000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // Holded rechaza imágenes muy pesadas

export interface HoldedSyncResult {
    ok: boolean;
    holdedId?: string;
    imageUploaded?: boolean;
    action?: 'created' | 'updated';
    error?: string;
}

export function isHoldedConfigured(): boolean {
    return Boolean(process.env.HOLDED_API_KEY);
}

/**
 * Crea un producto simple en Holded con nombre + código de barras (UPC),
 * y si se proporciona un link de imagen intenta subirla al producto creado.
 * Nunca lanza: siempre devuelve un resultado para que el guardado local no se bloquee.
 */
export async function createHoldedProduct(params: {
    name: string;
    barcode: string;
    sku?: string | null;
    imageUrl?: string | null;
}): Promise<HoldedSyncResult> {
    const apiKey = process.env.HOLDED_API_KEY;
    productsCache = null; // la mutación cambia el catálogo de Holded
    if (!apiKey) {
        return { ok: false, error: 'HOLDED_API_KEY no está configurada en el servidor' };
    }

    try {
        const res = await fetch(`${HOLDED_API_BASE}/products`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'key': apiKey,
            },
            body: JSON.stringify({
                kind: 'simple',
                name: params.name,
                barcode: params.barcode,
                ...(params.sku ? { sku: params.sku } : {}),
            }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        const data: any = await res.json().catch(() => null);

        // Holded responde { status: 1, id: "..." } en éxito y { status: 0, info: "..." } en error
        if (!res.ok || !data || data.status === 0) {
            const detail = data?.info || data?.message || `HTTP ${res.status}`;
            return { ok: false, error: `Holded rechazó el producto: ${detail}` };
        }

        const holdedId: string | undefined = data.id;
        let imageUploaded = false;

        if (holdedId && params.imageUrl) {
            imageUploaded = await uploadHoldedProductImage(apiKey, holdedId, params.imageUrl);
        }

        return { ok: true, holdedId, imageUploaded, action: 'created' };
    } catch (error: any) {
        const detail = error?.name === 'TimeoutError' ? 'timeout de conexión' : (error?.message || 'error de red');
        return { ok: false, error: `No se pudo conectar con Holded: ${detail}` };
    }
}

/**
 * Actualiza un producto existente en Holded (nombre, SKU, código de barras) sin
 * crear duplicados. Ubica el producto por su holdedId; si no lo tenemos guardado,
 * lo busca por código de barras. Si de plano no existe en Holded, lo crea.
 * Nunca lanza.
 */
export async function updateHoldedProduct(params: {
    holdedId?: string | null;
    barcode: string;
    name: string;
    sku?: string | null;
    imageUrl?: string | null;
}): Promise<HoldedSyncResult> {
    const apiKey = process.env.HOLDED_API_KEY;
    productsCache = null; // la mutación cambia el catálogo de Holded
    if (!apiKey) {
        return { ok: false, error: 'HOLDED_API_KEY no está configurada en el servidor' };
    }

    try {
        // Resolver el id del producto en Holded
        let holdedId = params.holdedId || undefined;
        if (!holdedId) {
            const map = await getHoldedProductsByBarcode();
            holdedId = map.get(params.barcode);
        }

        // Si no existe en Holded, crearlo en lugar de actualizar
        if (!holdedId) {
            return await createHoldedProduct({
                name: params.name,
                barcode: params.barcode,
                sku: params.sku,
                imageUrl: params.imageUrl,
            });
        }

        const res = await fetch(`${HOLDED_API_BASE}/products/${holdedId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'key': apiKey },
            body: JSON.stringify({
                name: params.name,
                barcode: params.barcode,
                ...(params.sku ? { sku: params.sku } : {}),
            }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        const data: any = await res.json().catch(() => null);
        if (!res.ok || (data && data.status === 0)) {
            const detail = data?.info || data?.message || `HTTP ${res.status}`;
            return { ok: false, error: `Holded rechazó la actualización: ${detail}` };
        }

        return { ok: true, holdedId, action: 'updated' };
    } catch (error: any) {
        const detail = error?.name === 'TimeoutError' ? 'timeout de conexión' : (error?.message || 'error de red');
        return { ok: false, error: `No se pudo conectar con Holded: ${detail}` };
    }
}

// ---------------------------------------------------------------------------
// Facturas de compra
// ---------------------------------------------------------------------------

const MAX_LIST_PAGES = 20;

interface HoldedListItem {
    id: string;
    name?: string;
    barcode?: string;
    docNumber?: string;
    [key: string]: any;
}

// Caché en memoria del listado de productos (evita re-listar todo Holded en ráfagas de llamadas)
const PRODUCTS_CACHE_MS = 60 * 1000;
let productsCache: { at: number; items: HoldedListItem[] } | null = null;
export function invalidateHoldedProductsCache() { productsCache = null; }
async function listHoldedProductsRaw(apiKey: string, force = false): Promise<HoldedListItem[]> {
    if (!force && productsCache && Date.now() - productsCache.at < PRODUCTS_CACHE_MS) return productsCache.items;
    const items = await holdedGetList(apiKey, '/products');
    productsCache = { at: Date.now(), items };
    return items;
}

async function holdedGetList(apiKey: string, path: string, maxPages: number = MAX_LIST_PAGES): Promise<HoldedListItem[]> {
    const all: HoldedListItem[] = [];
    const seenIds = new Set<string>();
    const separator = path.includes('?') ? '&' : '?';

    for (let page = 1; page <= maxPages; page++) {
        const res = await fetch(`${HOLDED_API_BASE}${path}${separator}page=${page}`, {
            headers: { 'key': apiKey },
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!res.ok) {
            throw new Error(`Holded respondió HTTP ${res.status} al listar ${path}`);
        }
        const data: any = await res.json().catch(() => null);
        if (!Array.isArray(data) || data.length === 0) break;

        // Si la API ignora ?page= devuelve siempre lo mismo: cortamos al repetir ids
        const newItems = data.filter((item: any) => item?.id && !seenIds.has(item.id));
        if (newItems.length === 0) break;
        newItems.forEach((item: any) => seenIds.add(item.id));
        all.push(...newItems);
    }
    return all;
}

/** Busca un contacto por nombre (sin distinguir mayúsculas); si no existe lo crea como proveedor. */
export async function findOrCreateSupplier(name: string): Promise<{ id: string; created: boolean }> {
    const apiKey = process.env.HOLDED_API_KEY;
    if (!apiKey) throw new Error('HOLDED_API_KEY no está configurada en el servidor');

    const target = name.trim().toLowerCase();
    const contacts = await holdedGetList(apiKey, '/contacts');
    const existing = contacts.find(c => (c.name || '').trim().toLowerCase() === target);
    if (existing) return { id: existing.id, created: false };

    const res = await fetch(`${HOLDED_API_BASE}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'key': apiKey },
        body: JSON.stringify({ name: name.trim(), type: 'supplier' }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const data: any = await res.json().catch(() => null);
    if (!res.ok || !data || data.status === 0 || !data.id) {
        throw new Error(`No se pudo crear el proveedor "${name}" en Holded: ${data?.info || `HTTP ${res.status}`}`);
    }
    return { id: data.id, created: true };
}

/** Diagnóstico: devuelve TODOS los productos de Holded que tienen un código de barras dado. */
export async function findHoldedProductsByBarcode(barcode: string): Promise<Array<{ id: string; name: string; sku: string; barcode: string }>> {
    const apiKey = process.env.HOLDED_API_KEY;
    if (!apiKey) throw new Error('HOLDED_API_KEY no está configurada en el servidor');

    const products = await listHoldedProductsRaw(apiKey);
    const target = String(barcode).trim();
    return products
        .filter(p => String(p.barcode || '').trim() === target)
        .map(p => ({ id: p.id, name: p.name || '', sku: String(p.sku || ''), barcode: String(p.barcode || '') }));
}

/** Inventario de Holded: todos los productos con su stock y precio de venta. */
export interface HoldedInventoryItem {
    id: string;
    name: string;
    sku: string;
    barcode: string;
    stock: number;
    price: number;
}
export async function listHoldedInventory(force = false): Promise<HoldedInventoryItem[]> {
    const apiKey = process.env.HOLDED_API_KEY;
    if (!apiKey) throw new Error('HOLDED_API_KEY no está configurada en el servidor');

    const products = await listHoldedProductsRaw(apiKey, force);
    return products.map(p => ({
        id: p.id,
        name: p.name || '',
        sku: String(p.sku || ''),
        barcode: String(p.barcode || '').trim(),
        stock: Number(p.stock) || 0,
        price: Number(p.price) || 0,
    }));
}

/**
 * Última fecha de venta por producto según los documentos de venta de Holded
 * (facturas y tickets de venta) desde una fecha dada. Devuelve mapas indexados por
 * productId, por SKU y por nombre para poder cruzar aunque la línea no traiga productId.
 * Nunca lanza: si un tipo de documento falla, se ignora y se sigue con el resto.
 */
export interface HoldedLastSales {
    byProductId: Map<string, number>; // unix ms
    bySku: Map<string, number>;
    byName: Map<string, number>;
    documentos: number;
    errores: number; // tipos de documento que no se pudieron listar
}
export async function getHoldedLastSales(sinceTs: number): Promise<HoldedLastSales> {
    const apiKey = process.env.HOLDED_API_KEY;
    const out: HoldedLastSales = { byProductId: new Map(), bySku: new Map(), byName: new Map(), documentos: 0, errores: 0 };
    if (!apiKey) return out;

    const startSec = Math.floor(sinceTs / 1000);
    const bump = (map: Map<string, number>, key: string, ts: number) => {
        const k = key.trim();
        if (!k) return;
        const prev = map.get(k) || 0;
        if (ts > prev) map.set(k, ts);
    };

    for (const tipo of ['invoice', 'salesreceipt']) {
        let docs: HoldedListItem[] = [];
        try {
            docs = await holdedGetList(apiKey, `/documents/${tipo}?starttmp=${startSec}`, 60);
        } catch (e) {
            console.warn(`No se pudieron listar documentos ${tipo} de Holded:`, (e as any)?.message);
            out.errores++;
            continue;
        }
        for (const d of docs) {
            const rawDate = Number(d.date);
            if (!isFinite(rawDate) || rawDate <= 0) continue;
            const ts = rawDate < 1e12 ? rawDate * 1000 : rawDate; // Holded entrega segundos
            if (ts < sinceTs) continue;
            out.documentos++;
            const lines: any[] = Array.isArray(d.products) ? d.products : (Array.isArray(d.items) ? d.items : []);
            for (const line of lines) {
                if (line?.productId) bump(out.byProductId, String(line.productId), ts);
                if (line?.sku) bump(out.bySku, String(line.sku).toUpperCase(), ts);
                if (line?.name) bump(out.byName, String(line.name).toUpperCase(), ts);
            }
        }
    }
    return out;
}

/** Actualiza únicamente el precio de venta de un producto en Holded. */
export async function updateHoldedPrice(holdedId: string, price: number): Promise<HoldedSyncResult> {
    const apiKey = process.env.HOLDED_API_KEY;
    productsCache = null; // la mutación cambia el catálogo de Holded
    if (!apiKey) return { ok: false, error: 'HOLDED_API_KEY no está configurada en el servidor' };
    try {
        const res = await fetch(`${HOLDED_API_BASE}/products/${holdedId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'key': apiKey },
            body: JSON.stringify({ price }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const data: any = await res.json().catch(() => null);
        if (!res.ok || (data && data.status === 0)) {
            return { ok: false, error: `Holded rechazó el precio: ${data?.info || data?.message || `HTTP ${res.status}`}` };
        }
        return { ok: true, holdedId, action: 'updated' };
    } catch (error: any) {
        const detail = error?.name === 'TimeoutError' ? 'timeout de conexión' : (error?.message || 'error de red');
        return { ok: false, error: `No se pudo conectar con Holded: ${detail}` };
    }
}

/**
 * Elimina un producto en Holded. Usa el holdedId guardado; si no hay, busca por
 * código de barras y elimina todas las coincidencias (evita dejar duplicados huérfanos).
 * Nunca lanza: devuelve cuántos productos se eliminaron o el error.
 */
export async function deleteHoldedProduct(params: { holdedId?: string | null; barcode: string }): Promise<{ ok: boolean; deleted: number; error?: string }> {
    const apiKey = process.env.HOLDED_API_KEY;
    productsCache = null; // la mutación cambia el catálogo de Holded
    if (!apiKey) return { ok: false, deleted: 0, error: 'HOLDED_API_KEY no está configurada en el servidor' };
    try {
        let ids: string[] = [];
        if (params.holdedId) {
            ids = [params.holdedId];
        } else if (params.barcode) {
            ids = (await findHoldedProductsByBarcode(params.barcode)).map(p => p.id);
        }
        if (ids.length === 0) return { ok: true, deleted: 0 };

        let deleted = 0;
        for (const id of ids) {
            const res = await fetch(`${HOLDED_API_BASE}/products/${id}`, {
                method: 'DELETE',
                headers: { 'key': apiKey },
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
            const data: any = await res.json().catch(() => null);
            if (res.status === 404) continue; // ya no existía en Holded
            if (!res.ok || (data && data.status === 0)) {
                return { ok: false, deleted, error: `Holded rechazó el borrado: ${data?.info || data?.message || `HTTP ${res.status}`}` };
            }
            deleted++;
        }
        return { ok: true, deleted };
    } catch (error: any) {
        const detail = error?.name === 'TimeoutError' ? 'timeout de conexión' : (error?.message || 'error de red');
        return { ok: false, deleted: 0, error: `No se pudo conectar con Holded: ${detail}` };
    }
}

/** Devuelve un mapa barcode → productId con todos los productos de Holded. */
export async function getHoldedProductsByBarcode(): Promise<Map<string, string>> {
    const apiKey = process.env.HOLDED_API_KEY;
    if (!apiKey) throw new Error('HOLDED_API_KEY no está configurada en el servidor');

    const products = await listHoldedProductsRaw(apiKey);
    const map = new Map<string, string>();
    for (const p of products) {
        const barcode = String(p.barcode || '').trim();
        if (barcode && !map.has(barcode)) map.set(barcode, p.id);
    }
    return map;
}

export interface HoldedInvoiceItem {
    name: string;
    sku?: string;
    units: number;
    unitPriceCop: number;
    productId?: string;
}

/** Crea la factura de compra en Holded. Devuelve el id del documento creado. */
export async function createPurchaseInvoice(params: {
    contactId: string;
    docNumber: string;
    dateTs: number;
    notes?: string;
    items: HoldedInvoiceItem[];
}): Promise<string> {
    const apiKey = process.env.HOLDED_API_KEY;
    if (!apiKey) throw new Error('HOLDED_API_KEY no está configurada en el servidor');

    const body = {
        contactId: params.contactId,
        date: params.dateTs,
        // Holded usa "invoiceNum" para el número de documento al crear;
        // "docNumber" es como lo devuelve al listar. Enviamos ambos.
        invoiceNum: params.docNumber,
        docNumber: params.docNumber,
        notes: params.notes || '',
        items: params.items.map(item => ({
            name: item.name,
            sku: item.sku || undefined,
            productId: item.productId || undefined,
            units: item.units,
            subtotal: item.unitPriceCop,
            price: item.unitPriceCop,
            tax: 0,
        })),
    };

    const res = await fetch(`${HOLDED_API_BASE}/documents/purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'key': apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const data: any = await res.json().catch(() => null);
    if (!res.ok || !data || data.status === 0 || !data.id) {
        throw new Error(`Holded rechazó la factura: ${data?.info || data?.message || `HTTP ${res.status}`}`);
    }
    return data.id;
}

/**
 * Descarga la imagen desde el link proporcionado y la sube al producto en Holded
 * (PUT /products/{id}/image, multipart form-data). Best-effort: si falla, el
 * producto queda creado en Holded sin imagen.
 */
async function uploadHoldedProductImage(apiKey: string, holdedId: string, imageUrl: string): Promise<boolean> {
    try {
        const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
        if (!imgRes.ok) {
            console.warn(`Holded image: no se pudo descargar ${imageUrl} (HTTP ${imgRes.status})`);
            return false;
        }

        const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
        if (!contentType.startsWith('image/')) {
            console.warn(`Holded image: el link no es una imagen (content-type: ${contentType})`);
            return false;
        }

        const buffer = await imgRes.arrayBuffer();
        if (buffer.byteLength === 0 || buffer.byteLength > MAX_IMAGE_BYTES) {
            console.warn(`Holded image: tamaño inválido (${buffer.byteLength} bytes)`);
            return false;
        }

        const extension = contentType.split('/')[1]?.split(';')[0] || 'jpg';
        const formData = new FormData();
        formData.append('image', new Blob([buffer], { type: contentType }), `producto.${extension}`);

        const uploadRes = await fetch(`${HOLDED_API_BASE}/products/${holdedId}/image`, {
            method: 'PUT',
            headers: { 'key': apiKey },
            body: formData,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!uploadRes.ok) {
            const text = await uploadRes.text().catch(() => '');
            console.warn(`Holded image: subida rechazada (HTTP ${uploadRes.status}) ${text}`);
            return false;
        }

        return true;
    } catch (error: any) {
        console.warn('Holded image: error subiendo imagen:', error?.message || error);
        return false;
    }
}
