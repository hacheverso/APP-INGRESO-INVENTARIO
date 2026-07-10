// Integración con Holded (https://developers.holded.com)
// Autenticación: header "key" con la API Key generada en Holded → Configuración → Developers.

const HOLDED_API_BASE = 'https://api.holded.com/api/invoicing/v1';
const REQUEST_TIMEOUT_MS = 15000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // Holded rechaza imágenes muy pesadas

export interface HoldedSyncResult {
    ok: boolean;
    holdedId?: string;
    imageUploaded?: boolean;
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
    imageUrl?: string | null;
}): Promise<HoldedSyncResult> {
    const apiKey = process.env.HOLDED_API_KEY;
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

        return { ok: true, holdedId, imageUploaded };
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

async function holdedGetList(apiKey: string, path: string): Promise<HoldedListItem[]> {
    const all: HoldedListItem[] = [];
    const seenIds = new Set<string>();
    const separator = path.includes('?') ? '&' : '?';

    for (let page = 1; page <= MAX_LIST_PAGES; page++) {
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

/** Devuelve un mapa barcode → productId con todos los productos de Holded. */
export async function getHoldedProductsByBarcode(): Promise<Map<string, string>> {
    const apiKey = process.env.HOLDED_API_KEY;
    if (!apiKey) throw new Error('HOLDED_API_KEY no está configurada en el servidor');

    const products = await holdedGetList(apiKey, '/products');
    const map = new Map<string, string>();
    for (const p of products) {
        const barcode = String(p.barcode || '').trim();
        if (barcode && !map.has(barcode)) map.set(barcode, p.id);
    }
    return map;
}

/**
 * Calcula el siguiente número de factura del día: YYYYMMDD-001, YYYYMMDD-002...
 * consultando las facturas de compra ya creadas ese día en Holded.
 */
export async function getNextPurchaseDocNumber(dayKey: string, dayStartTs: number, dayEndTs: number): Promise<string> {
    const apiKey = process.env.HOLDED_API_KEY;
    if (!apiKey) throw new Error('HOLDED_API_KEY no está configurada en el servidor');

    const docs = await holdedGetList(apiKey, `/documents/purchase?starttmp=${dayStartTs}&endtmp=${dayEndTs}`);
    let maxSeq = 0;
    const pattern = new RegExp(`^${dayKey}-(\\d{1,4})$`);
    for (const doc of docs) {
        const match = String(doc.docNumber || '').match(pattern);
        if (match) maxSeq = Math.max(maxSeq, parseInt(match[1], 10));
    }
    return `${dayKey}-${String(maxSeq + 1).padStart(3, '0')}`;
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
