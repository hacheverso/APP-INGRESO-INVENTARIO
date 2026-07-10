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
