// Per-user cache keyed by sheetsUrl
const cacheMap = new Map<string, { data: Record<string, any>; timestamp: number }>();
const CACHE_TTL_MS = 60 * 1000; // 60 seconds

function extractSheetIdAndName(url: string): { sheetId: string; sheetName: string } | null {
    // Supports URLs like:
    // https://docs.google.com/spreadsheets/d/SHEET_ID/edit#gid=0
    // https://docs.google.com/spreadsheets/d/SHEET_ID/edit?gid=0
    // https://docs.google.com/spreadsheets/d/SHEET_ID
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (!match) return null;
    return { sheetId: match[1], sheetName: 'INVENTARIO' }; // Default sheet name
}

function parseCurrencyCOP(val: string): number {
    if (!val) return 0;
    const cleaned = val.replace(/[^0-9-]/g, '');
    const num = parseInt(cleaned, 10);
    return isNaN(num) ? 0 : num;
}

function parseCSVLine(line: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            result.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current);
    return result;
}

export interface SheetProduct {
    UPC: string;
    SKU: string;
    NOMBRE: string;
    IMAGEN: string;
    LastCost: number;
    STOCK: number;
    PRECIO: number;
    COSTO: number;
    MARGEN: string;
    CATEGORIA: string;
    COSTO_TOTAL: number;
    DIAS_SIN_VENDER: number;
    _source: 'sheets';
}

export interface SheetsResult {
    success: boolean;
    data: Record<string, SheetProduct>;
    count: number;
    lastFetched: string;
}

export async function fetchSheetsProducts(sheetsUrl?: string | null): Promise<SheetsResult> {
    // If no URL provided, return empty (no sheets configured for this user)
    if (!sheetsUrl) {
        return { success: false, data: {}, count: 0, lastFetched: '' };
    }

    const parsed = extractSheetIdAndName(sheetsUrl);
    if (!parsed) {
        return { success: false, data: {}, count: 0, lastFetched: '' };
    }

    const csvUrl = `https://docs.google.com/spreadsheets/d/${parsed.sheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(parsed.sheetName)}`;
    const cacheKey = sheetsUrl;

    // Return cached data if still fresh
    const cachedData = cacheMap.get(cacheKey);
    if (cachedData && (Date.now() - cachedData.timestamp) < CACHE_TTL_MS) {
        return {
            success: true,
            data: cachedData.data,
            count: Object.keys(cachedData.data).length,
            lastFetched: new Date(cachedData.timestamp).toISOString(),
        };
    }

    try {
        const response = await fetch(csvUrl);

        if (!response.ok) {
            console.error(`Google Sheets returned ${response.status}`);
            if (cachedData) {
                return {
                    success: true,
                    data: cachedData.data,
                    count: Object.keys(cachedData.data).length,
                    lastFetched: new Date(cachedData.timestamp).toISOString(),
                };
            }
            return { success: false, data: {}, count: 0, lastFetched: '' };
        }

        const csvText = await response.text();
        const lines = csvText.split('\n');
        if (lines.length < 2) {
            return { success: true, data: {}, count: 0, lastFetched: new Date().toISOString() };
        }

        const headers = parseCSVLine(lines[0]);

        const colBarcode = headers.findIndex(h => h.toUpperCase().includes('BARCODE') || h.toUpperCase().includes('UPC'));
        const colSKU = headers.findIndex(h => h.toUpperCase() === 'SKU');
        const colNombre = headers.findIndex(h => h.toUpperCase().includes('NOMBRE') || h.toUpperCase().includes('NAME'));
        const colStock = headers.findIndex(h => h.toUpperCase().includes('STOCK'));
        const colPrecio = headers.findIndex(h => h.toUpperCase().includes('PRECIO'));
        const colCosto = headers.findIndex(h => h.toUpperCase().includes('COSTO') && !h.toUpperCase().includes('TOTAL'));
        const colMargen = headers.findIndex(h => h.toUpperCase().includes('MARGEN'));
        const colCategoria = headers.findIndex(h => h.toUpperCase().includes('CATEGORIA'));
        const colImagen = headers.findIndex(h => h.toUpperCase().includes('IMAGEN'));
        const colCostoTotal = headers.findIndex(h => h.toUpperCase().includes('COSTO TOTAL'));
        const colDiasSinVender = headers.findIndex(h => h.toUpperCase().includes('DIAS'));

        const productDB: Record<string, SheetProduct> = {};
        let count = 0;

        for (let i = 1; i < lines.length; i++) {
            const line = lines[i].trim();
            if (!line) continue;

            const cols = parseCSVLine(line);
            const barcode = colBarcode >= 0 ? (cols[colBarcode] || '').trim() : '';
            const nombre = colNombre >= 0 ? (cols[colNombre] || '').trim() : '';

            if (!barcode && !nombre) continue;

            const sku = colSKU >= 0 ? (cols[colSKU] || '').trim() : '';
            const stock = colStock >= 0 ? parseInt((cols[colStock] || '0').trim(), 10) || 0 : 0;
            const precio = colPrecio >= 0 ? parseCurrencyCOP(cols[colPrecio] || '') : 0;
            const costo = colCosto >= 0 ? parseCurrencyCOP(cols[colCosto] || '') : 0;
            const margen = colMargen >= 0 ? (cols[colMargen] || '0%').trim() : '0%';
            const categoria = colCategoria >= 0 ? (cols[colCategoria] || '').trim() : '';
            const imagen = colImagen >= 0 ? (cols[colImagen] || '').trim() : '';
            const costoTotal = colCostoTotal >= 0 ? parseCurrencyCOP(cols[colCostoTotal] || '') : 0;
            const diasSinVender = colDiasSinVender >= 0 ? parseInt((cols[colDiasSinVender] || '0').trim(), 10) || 0 : 0;

            if (!barcode) continue;

            const key = barcode;
            const cleanImagen = imagen.replace(/[")}]+$/, '').replace(/^[("]+/, '');

            productDB[key] = {
                UPC: barcode,
                SKU: sku,
                NOMBRE: nombre,
                IMAGEN: cleanImagen,
                LastCost: 0,
                STOCK: stock,
                PRECIO: precio,
                COSTO: costo,
                MARGEN: margen,
                CATEGORIA: categoria,
                COSTO_TOTAL: costoTotal,
                DIAS_SIN_VENDER: diasSinVender,
                _source: 'sheets'
            };
            count++;
        }

        // Update cache for this URL
        cacheMap.set(cacheKey, { data: productDB, timestamp: Date.now() });

        return {
            success: true,
            data: productDB,
            count,
            lastFetched: new Date().toISOString(),
        };
    } catch (error) {
        console.error('Error fetching Google Sheets:', error);
        const cachedData = cacheMap.get(cacheKey);
        if (cachedData) {
            return {
                success: true,
                data: cachedData.data,
                count: Object.keys(cachedData.data).length,
                lastFetched: new Date(cachedData.timestamp).toISOString(),
            };
        }
        return { success: false, data: {}, count: 0, lastFetched: '' };
    }
}
