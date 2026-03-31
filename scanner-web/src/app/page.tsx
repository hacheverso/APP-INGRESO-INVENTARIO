"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Trash2, Download, AlertTriangle, CheckCircle, ScanLine, Settings2, PackageCheck, Eraser, Database, UploadCloud, Image as ImageIcon, PlusCircle, X, DollarSign, Calculator, Layers, ChevronDown, ChevronRight, Hash, AlignLeft, Tags, History, FolderOpen, Lock, Unlock, ArrowLeft, Box, Volume2, VolumeX, Save, ArrowUpRight, ArrowDownRight, FileDown, CloudLightning, Search, LogOut, RefreshCw } from 'lucide-react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { v4 as uuidv4 } from 'uuid';

type ScanMode = 'UPC_SERIAL' | 'MASSIVE';
type Currency = 'COP' | 'USD';
type AppView = 'SCANNER' | 'HISTORY' | 'PRODUCTS'; // Nueva capa para gestión de Catálogo Maestro

interface HistorySession {
    id: string; // Timestamp
    fecha: string;
    lote: string;
    proveedor: string;
    totalRecords: number;
    totalUnidades: number;
    costoTotalCOP: number;
    monedaBase: Currency;
    records: InventoryRecord[];
}

interface Product {
    UPC: string;
    NOMBRE: string;
    SKU: string;
    IMAGEN: string;
    LastCost?: number; // Historial del último costo registrado para calcular fluctuación
    // Extended fields from Google Sheets (live data)
    STOCK?: number;
    PRECIO?: number;
    COSTO?: number;
    MARGEN?: string;
    CATEGORIA?: string;
    COSTO_TOTAL?: number;
    DIAS_SIN_VENDER?: number;
    _source?: 'sheets';
}

interface InventoryRecord {
    FechaHora: string;
    Lote: string;
    Proveedor: string;
    Tipo: string;
    UPC: string;
    Nombre: string;
    SKU: string;
    Serial: string;
    Cantidad: number;
    Nota: string;
    ID: string;
    // Finanzas nuevas
    Moneda: Currency;
    CostoUnitario: number;
    TasaCambio: number;
    CostoTotalCOP: number;
    Imagen?: string;
}

interface ProductGroup {
    UPC: string;
    Nombre: string;
    SKU: string;
    Records: InventoryRecord[];
    TotalUnidades: number;
    CostoAcumuladoCOP: number;
    Imagen: string;
    IsExpanded: boolean;
}

interface Toast {
    type: 'success' | 'error' | 'info';
    message: string;
    id: number;
}

export default function InventoryScannerApp() {
    const [records, setRecords] = useState<InventoryRecord[]>([]);
    const [mode, setMode] = useState<ScanMode>('UPC_SERIAL');
    const [view, setView] = useState<AppView>('SCANNER');
    const [currentUser, setCurrentUser] = useState<{ id: string; email: string; name?: string } | null>(null);

    // Finanzas Globales de Sesión
    const [currency, setCurrency] = useState<Currency>('USD');
    const [exchangeRate, setExchangeRate] = useState<string>("4000"); // TRM base

    // History and Navigation State
    const [savedSessions, setSavedSessions] = useState<HistorySession[]>([]);
    const [editingSessionId, setEditingSessionId] = useState<string | null>(null);

    // Product Database State
    const [productDB, setProductDB] = useState<Record<string, Product>>({});
    const [matchedProduct, setMatchedProduct] = useState<Product | null>(null);
    const [showNewProductModal, setShowNewProductModal] = useState(false);
    const [newProductForm, setNewProductForm] = useState({ UPC: '', NOMBRE: '', SKU: '', IMAGEN: '' });
    const [productSearchTerm, setProductSearchTerm] = useState("");
    const [unknownUpc, setUnknownUpc] = useState<string | null>(null); // Product-not-found prompt

    // Google Sheets Connection State
    const [sheetsConnected, setSheetsConnected] = useState(false);
    const [sheetsProductCount, setSheetsProductCount] = useState(0);
    const [sheetsLastSync, setSheetsLastSync] = useState<string | null>(null);
    const [sheetsSyncing, setSheetsSyncing] = useState(false);

    // Flash Feedback System (Phase 10)
    const [scanStatus, setScanStatus] = useState<'idle' | 'success' | 'error'>('idle');
    const [isFlashing, setIsFlashing] = useState(false);

    // UI Grouping State
    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});

    // Control Inputs (Escaneo Individual)
    const [batchName, setBatchName] = useState("");
    const [proveedor, setProveedor] = useState("");
    const [listaProveedores, setListaProveedores] = useState<string[]>([]);
    const [upc, setUpc] = useState("");
    const [serial, setSerial] = useState("");
    const [qty, setQty] = useState("");
    const [note, setNote] = useState("");
    const [keepUpc, setKeepUpc] = useState(false);
    const [isClient, setIsClient] = useState(false);

    // File Input Ref for CSV Upload
    const fileInputRef = useRef<HTMLInputElement>(null);

    // UI State
    const [toasts, setToasts] = useState<Toast[]>([]);
    const [isAudioEnabled, setIsAudioEnabled] = useState(true);
    const [speechRate, setSpeechRate] = useState<number>(1.0);
    const [deleteConfirm, setDeleteConfirm] = useState<{ id: string | null; type: 'record' | 'session' }>({ id: null, type: 'record' });

    // Refs para control de focus
    const upcRef = useRef<HTMLInputElement>(null);
    const serialRef = useRef<HTMLInputElement>(null);
    const qtyRef = useRef<HTMLInputElement>(null);
    const noteRef = useRef<HTMLInputElement>(null);
    const modalNameRef = useRef<HTMLInputElement>(null);

    // Inicialización (Client-side)
    useEffect(() => {
        setIsClient(true);
        const today = new Date().toISOString().split('T')[0];
        setBatchName(`Ingreso ${today}`);

        // Auth: fetch current user
        fetch('/api/auth/me').then(r => r.json()).then(data => {
            if (data.success && data.user) setCurrentUser(data.user);
        }).catch(() => {});

        // Pre-cargar voces de TTS (Fix para macOS/Safari donde la primera vez retorna vacío)
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
            window.speechSynthesis.getVoices();
            window.speechSynthesis.onvoiceschanged = () => {
                window.speechSynthesis.getVoices();
            };
        }

        // Cargar Backup de Escaneos
        const saved = localStorage.getItem('scanner_backup');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                if (parsed && parsed.length > 0) {
                    if (confirm(`Recuperación de sesión: Se encontraron ${parsed.length} registros no exportados.\n¿Deseas recuperarlos?`)) {
                        setRecords(parsed);
                        setBatchName(parsed[parsed.length - 1].Lote);
                    } else {
                        localStorage.removeItem('scanner_backup');
                    }
                }
            } catch (e) {
                console.error("Error cargando backup", e);
            }
        }

        // Fetch Data from Neon Postgres (Products and Sessions)
        const fetchRemoteData = async () => {
            try {
                // Products
                const prodRes = await fetch('/api/products');
                const prodData = await prodRes.json();
                if (prodData.success && prodData.data) {
                    setProductDB(prodData.data);
                    setSheetsConnected(prodData.sheetsConnected === true);
                    if (prodData.sheetsConnected) {
                        setSheetsProductCount(Object.keys(prodData.data).length);
                        setSheetsLastSync(prodData.lastSheetsUpdate || new Date().toISOString());
                    }
                }

                // Sessions
                const sessRes = await fetch('/api/sessions');
                const sessData = await sessRes.json();
                if (sessData.success && sessData.data) {
                    setSavedSessions(sessData.data);
                }
            } catch (err) {
                console.error("Error fetching remote data:", err);
                showToast("Error de conexión con la nube", "error");
            }
        };
        fetchRemoteData();

        // Cargar Historial de Proveedores
        const savedProviders = localStorage.getItem('scanner_proveedores');
        if (savedProviders) {
            try {
                const parsedProviders = JSON.parse(savedProviders);
                if (Array.isArray(parsedProviders)) setListaProveedores(parsedProviders);
            } catch (e) {
                console.error("Error cargando proveedores", e);
            }
        }
    }, []);

    // Set initial focus
    useEffect(() => {
        if (isClient && upcRef.current && !showNewProductModal && view === 'SCANNER') {
            upcRef.current.focus();
        }
    }, [isClient, showNewProductModal, view]);

    // Manejo de LocalStorage Backup
    useEffect(() => {
        if (isClient && records.length > 0) {
            localStorage.setItem('scanner_backup', JSON.stringify(records));
        } else if (isClient) {
            localStorage.removeItem('scanner_backup');
        }
    }, [records, isClient]);

    // Manejo de Base de Datos LocalStorage
    useEffect(() => {
        if (isClient && Object.keys(productDB).length > 0) {
            localStorage.setItem('scanner_product_db', JSON.stringify(productDB));
        }
    }, [productDB, isClient]);

    // Manejo Persistencia Historial de Sesiones
    useEffect(() => {
        if (isClient) {
            localStorage.setItem('scanner_history_sessions', JSON.stringify(savedSessions));
        }
    }, [savedSessions, isClient]);

    // Manejo Persistencia Proveedores
    useEffect(() => {
        if (isClient && listaProveedores.length > 0) {
            localStorage.setItem('scanner_proveedores', JSON.stringify(listaProveedores));
        }
    }, [listaProveedores, isClient]);

    // Retroactividad: Si cambia la moneda global o la TRM, actualizar todos los registros activos en la sesión actual.
    useEffect(() => {
        const currentExRate = parseFloat(exchangeRate) || 0;
        setRecords(prev => {
            if (prev.length === 0) return prev;
            let needsUpdate = false;
            const updated = prev.map(r => {
                const targetTasa = currency === 'USD' ? currentExRate : 1;
                if (r.Moneda !== currency || r.TasaCambio !== targetTasa) {
                    needsUpdate = true;
                    // Recalcular el costo total COP
                    const itemTotalCost = r.Cantidad * r.CostoUnitario;
                    const finalCostoTotalCOP = currency === 'USD' ? (itemTotalCost * currentExRate) : itemTotalCost;
                    return {
                        ...r,
                        Moneda: currency,
                        TasaCambio: targetTasa,
                        CostoTotalCOP: finalCostoTotalCOP
                    };
                }
                return r;
            });
            return needsUpdate ? updated : prev;
        });
    }, [currency, exchangeRate]);

    const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
        const id = Date.now();
        setToasts((prev) => [...prev, { message, type, id }]);
        setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id));
        }, 4000);
    };

    const playBeep = (type: 'success' | 'error' | 'warning' | 'duplicate') => {
        try {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            if (type === 'success') {
                // Satisfying triple-chime (cash register feel)
                const notes = [523.25, 659.25, 783.99]; // C5, E5, G5 (major chord)
                notes.forEach((freq, i) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.08);
                    gain.gain.setValueAtTime(0.25, ctx.currentTime + i * 0.08);
                    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.08 + 0.25);
                    osc.connect(gain).connect(ctx.destination);
                    osc.start(ctx.currentTime + i * 0.08);
                    osc.stop(ctx.currentTime + i * 0.08 + 0.25);
                });
            } else if (type === 'warning') {
                // Questioning two-tone (low-high, like "huh?")
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.type = 'triangle';
                osc.frequency.setValueAtTime(330, ctx.currentTime);
                osc.frequency.setValueAtTime(440, ctx.currentTime + 0.15);
                osc.frequency.setValueAtTime(330, ctx.currentTime + 0.3);
                gain.gain.setValueAtTime(0.3, ctx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.45);
                osc.connect(gain).connect(ctx.destination);
                osc.start(ctx.currentTime);
                osc.stop(ctx.currentTime + 0.45);
            } else if (type === 'duplicate') {
                // Rapid descending triple-beep ("ya lo tienes") — high→mid→low
                const notes = [880, 660, 440];
                notes.forEach((freq, i) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'sawtooth';
                    osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.1);
                    gain.gain.setValueAtTime(0.2, ctx.currentTime + i * 0.1);
                    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.1 + 0.08);
                    osc.connect(gain).connect(ctx.destination);
                    osc.start(ctx.currentTime + i * 0.1);
                    osc.stop(ctx.currentTime + i * 0.1 + 0.08);
                });
            } else {
                // Harsh low double-beep for error
                [0, 0.18].forEach(offset => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.type = 'square';
                    osc.frequency.setValueAtTime(280, ctx.currentTime + offset);
                    gain.gain.setValueAtTime(0.35, ctx.currentTime + offset);
                    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + offset + 0.12);
                    osc.connect(gain).connect(ctx.destination);
                    osc.start(ctx.currentTime + offset);
                    osc.stop(ctx.currentTime + offset + 0.12);
                });
            }
        } catch (e) {
            // Web Audio API not available, silently fail
        }
    };

    const triggerFeedback = (status: 'success' | 'error' | 'duplicate') => {
        setScanStatus(status === 'duplicate' ? 'error' : status);
        setIsFlashing(true);
        if (isAudioEnabled) playBeep(status);
        setTimeout(() => {
            setIsFlashing(false);
            setScanStatus('idle');
        }, 200);
    };

    // Herramienta de migración One-Time de LocalStorage a Postgres
    const migrateLocalToCloud = async () => {
        if (!confirm("⚠️ MIGRACIÓN A LA NUBE: Esto enviará todos tus productos y el historial de sesiones guardadas localmente hacia la Base de Datos Neon. Asegúrate de tener conexión. ¿Continuar con la migración?")) {
            return;
        }

        try {
            showToast("Iniciando Migración... Sincronizando catálogo", "info");

            // 1. Migrar Catálogo de Productos
            const savedDB = localStorage.getItem('scanner_product_db');
            if (savedDB) {
                const parsedDB = JSON.parse(savedDB);
                const productsArray = Object.values(parsedDB) as Product[];

                let successCount = 0;
                for (const prod of productsArray) {
                    try {
                        await fetch('/api/products', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(prod)
                        });
                        successCount++;
                    } catch (e) {
                        console.error("Failed to migrate product:", prod.UPC);
                    }
                }
                showToast(`Catálogo: ${successCount} productos sincronizados.`, "success");
            }

            // 2. Migrar Sesiones Históricas
            showToast("Migrando Historial de Sesiones...", "info");
            const savedHistory = localStorage.getItem('scanner_history_sessions');
            if (savedHistory) {
                const parsedHistory = JSON.parse(savedHistory) as HistorySession[];

                let sessionCount = 0;
                for (const session of parsedHistory) {
                    try {
                        const payload = {
                            id: session.id,
                            date: session.fecha,
                            batchName: session.lote,
                            proveedor: session.proveedor,
                            totalItems: session.totalUnidades,
                            totalCop: session.costoTotalCOP,
                            records: session.records
                        };

                        await fetch('/api/sessions', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(payload)
                        });
                        sessionCount++;
                    } catch (e) {
                        console.error("Failed to migrate session:", session.id);
                    }
                }
                showToast(`Historial: ${sessionCount} sesiones migradas a la nube.`, "success");
            }

            showToast("MIGRACIÓN COMPLETA ✅ Recarga la página para ver los datos frescos.", "success");

        } catch (error) {
            console.error("Error global de migración:", error);
            showToast("Hubo un error fatal durante la migración.", "error");
        }
    };

    // Contador de Sesión actual por UPC
    const getSessionScanCount = (targetUpc: string) => {
        return records.filter(r => r.UPC === targetUpc).reduce((total, r) => total + r.Cantidad, 0);
    };

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: (results) => {
                const newDB: Record<string, Product> = { ...productDB };
                const newProductsToUpload: Product[] = [];
                let addedCount = 0;

                results.data.forEach((row: any) => {
                    const upcKey = Object.keys(row).find(k => {
                        const col = k.trim().toUpperCase();
                        return col.includes('UPC') || col.includes('EAN') || col.includes('BARCODE') || col.includes('CÓDIGO') || col === 'CODIGO';
                    });
                    const nameKey = Object.keys(row).find(k => {
                        const col = k.trim().toUpperCase();
                        return col.includes('NOMBRE') || col.includes('NAME') || col.includes('DESCRIPCION') || col.includes('PRODUCTO');
                    });
                    const skuKey = Object.keys(row).find(k => {
                        const col = k.trim().toUpperCase();
                        return col.includes('SKU') || col.includes('REF');
                    });
                    const imgKey = Object.keys(row).find(k => {
                        const col = k.trim().toUpperCase();
                        return col.includes('IMAGEN') || col.includes('IMAGE') || col.includes('URL') || col.includes('FOTO') || col.includes('PIC');
                    });

                    const _upc = upcKey ? row[upcKey]?.trim() : '';
                    const _nombre = nameKey ? row[nameKey]?.trim() : '';
                    const _sku = skuKey ? row[skuKey]?.trim() : '';
                    const _imagen = imgKey ? row[imgKey]?.trim() : '';

                    if (_upc) {
                        const newProd = { UPC: _upc, NOMBRE: _nombre, SKU: _sku, IMAGEN: _imagen, LastCost: 0 };
                        newDB[_upc] = newProd;
                        newProductsToUpload.push(newProd);
                        addedCount++;
                    }
                });

                if (addedCount > 0) {
                    // 1. Update React State Optimistically
                    setProductDB(newDB);
                    if (matchedProduct && newDB[matchedProduct.UPC]) {
                        setMatchedProduct(newDB[matchedProduct.UPC]);
                    }

                    // 2. Synchronize ONLY New Batch to Neon Cloud Database
                    fetch('/api/products', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(newProductsToUpload)
                    })
                    .then(res => res.json())
                    .then(data => {
                        if (data.success) {
                            const imagesCount = newProductsToUpload.filter(p => p.IMAGEN && p.IMAGEN.trim() !== '').length;
                            if (imagesCount === 0) {
                                const headers = results.data[0] ? Object.keys(results.data[0]).join(', ') : 'Ninguna';
                                showToast(`⚠️ Productos guardados en la Nube SIN FOTOS. Revisa columnas: [ ${headers} ].`, 'error');
                            } else {
                                showToast(`📦 Nube actualizada: ${data.count || addedCount} procesados (${imagesCount} con foto).`, 'success');
                            }
                        } else {
                            showToast(`❌ Error guardando en la Nube: ${data.error}`, 'error');
                        }
                    })
                    .catch(err => {
                        console.error("Batch UPSERT Error:", err);
                        showToast(`❌ Error de red al sincronizar Excel con la Nube.`, 'error');
                    });

                } else {
                    showToast(`Error: No se encontró la columna "UPC". Asegúrate de incluir NOMBRE, UPC, SKU e IMAGEN.`, 'error');
                }

                if (fileInputRef.current) fileInputRef.current.value = "";
                upcRef.current?.focus();
            },
            error: (error) => {
                showToast(`Error leyendo el archivo: ${error.message}`, 'error');
            }
        });
    };

    const triggerFileInput = () => fileInputRef.current?.click();

    const clearFields = () => {
        setSerial("");
        setQty("");
        setNote("");

        if (!keepUpc) {
            setUpc("");
            setMatchedProduct(null);
            upcRef.current?.focus();
        } else {
            if (mode === 'UPC_SERIAL') serialRef.current?.focus();
            else qtyRef.current?.focus();
        }
    };

    // Phase 12: TTS Voice Feedback (Mejorado con voces femeninas)
    const speakProduct = (name: string) => {
        if (!isAudioEnabled) return;

        if ('speechSynthesis' in window) {
            window.speechSynthesis.cancel(); // Detener cualquier lectura anterior

            // Leemos solo el nombre del producto de forma natural
            const utterance = new SpeechSynthesisUtterance(name);
            utterance.lang = 'es-ES';
            utterance.rate = speechRate;  // Velocidad controlada por el usuario
            utterance.pitch = 1.0; // Tono natural

            // Intentar cargar la mejor voz femenina en español disponible en el sistema.
            const voices = window.speechSynthesis.getVoices();

            // En macOS 'Paulina' (MX) o 'Monica' (ES) son excelentes. 'Sabina', 'Helena' en Windows, etc.
            const preferredVoices = ['Paulina', 'Monica', 'Sabina', 'Helena'];
            let selectedVoice = null;

            for (const pName of preferredVoices) {
                selectedVoice = voices.find(v => v.name.includes(pName));
                if (selectedVoice) break;
            }

            // Fallback si no hay premium: Buscar cualquier voz que sea 'es-' y tenga 'Female' o 'Mujer' si fuese posible detectar (difícil en web API), o simplemente la primera 'es-'.
            if (!selectedVoice) {
                selectedVoice = voices.find(v => v.lang.startsWith('es-MX')) || voices.find(v => v.lang.startsWith('es-ES')) || voices.find(v => v.lang.startsWith('es'));
            }

            if (selectedVoice) {
                utterance.voice = selectedVoice;
            }

            window.speechSynthesis.speak(utterance);
        }
    };

    const processUpcScan = () => {
        const upcVal = upc.trim();
        if (!upcVal) return;

        if (productDB[upcVal]) {
            setMatchedProduct(productDB[upcVal]);
            setUnknownUpc(null);
            speakProduct(productDB[upcVal].NOMBRE);

            // Expand latest group automatically and close others briefly for focus
            setExpandedGroups((prev) => ({ ...prev, [upcVal]: true }));

            if (mode === 'UPC_SERIAL') serialRef.current?.focus();
            else qtyRef.current?.focus();
        } else {
            // Product not found — show inline prompt instead of auto-opening modal
            setUnknownUpc(upcVal);
            setMatchedProduct(null);
            if (isAudioEnabled) playBeep('warning');
            showToast(`⚠️ Producto no encontrado: ${upcVal}`, 'error');
        }
    };

    const handleSaveNewProduct = async () => {
        const { UPC, NOMBRE, SKU, IMAGEN } = newProductForm;
        if (!NOMBRE.trim()) {
            showToast("El nombre del producto es obligatorio.", 'error');
            return;
        }

        const newProd: Product = { UPC, NOMBRE: NOMBRE.trim(), SKU: SKU.trim(), IMAGEN, LastCost: 0 };

        try {
            const res = await fetch('/api/products', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newProd)
            });
            const data = await res.json();

            if (data.success) {
                // Optimistic UI Update
                setProductDB(prev => ({ ...prev, [UPC]: newProd }));
                setMatchedProduct(newProd);
                speakProduct(newProd.NOMBRE);
                setShowNewProductModal(false);
                showToast("Producto creado en la nube al instante.", 'success');

                // Auto-expand the newly created group
                setExpandedGroups((prev) => ({ ...prev, [newProd.UPC]: true }));

                if (mode === 'UPC_SERIAL') serialRef.current?.focus();
                else qtyRef.current?.focus();
            } else {
                showToast("Error al guardar en la nube: " + data.error, 'error');
            }
        } catch (error) {
            console.error("Error saving product to cloud:", error);
            showToast("Error de conexión al intentar guardar.", 'error');
        }
    };

    // Helper: Generador Inteligente de SKU
    const generateSKU = (name: string) => {
        if (!name) return "";
        let upperName = name.toUpperCase();
        let isUsed = upperName.includes("USADO") || upperName.includes("OPEN BOX");

        // Limpiar flags para no ponerlos a la mitad
        let cleanName = upperName
            .replace(/USADO/g, '')
            .replace(/OPEN BOX/g, '')
            .trim();

        // Diccionario de abreviaciones comunes
        const dict: Record<string, string> = {
            "APPLE": "APL", "IPHONE": "IPH", "MACBOOK": "MAC", "AMAZON": "AMZ", "ALEXA": "ALX", "ECHO": "ECHP", "LAVANDA": "LVN",
            "TITANIUM": "TI", "NATURAL": "NAT", "TRANSITIONS": "TRNS", "GRAY": "GRY", "SHINY": "SH", "SKYLER": "SKYL",
            "BLACK": "BLK", "WHITE": "WHT", "BLUE": "BLU", "GREEN": "GRN", "PRO": "PRO", "MAX": "MAX", "PLUS": "PLS"
        };

        // Extraer palabras (separadas por espacio o slash)
        let words = cleanName.split(/[\s/]+/).filter(w => w.length > 0);

        let skuParts = words.map(w => {
            // Si existe en nuestro diccionario exacto
            if (dict[w]) return dict[w];
            // Si empieza por número (ej: 15, 256GB, 84%, 869) lo dejamos tal cual
            if (w.match(/^[0-9]+[A-Z]*%?$/)) return w;
            // Palabras completas comunes que el usuario dejó intactas en el ejemplo
            if (w.length <= 3) return w;
            if (w === "CICLOS" || w === "SAPPHIRE" || w === "CHALKY" || w === "META") return w;

            // Si es 'IPHONE15' pegado, intentar separarlo (caso borde) o dejarlo
            if (w.startsWith("IPHONE")) return w.replace("IPHONE", "IPH");

            // Abreviador Genérico Avanzado (Deja la 1ra letra + siguientes 2 o 3 consonantes)
            let consonants = w.substring(1).replace(/[AEIOUÁÉÍÓÚ]/g, '');
            let abv = w[0] + consonants;
            return abv.substring(0, 4); // max 4 caracteres por palabra desconocida
        });

        const suffix = isUsed ? "-U" : "-N";
        return skuParts.join('-') + suffix;
    };

    const addRecord = () => {
        const currentBatch = batchName.trim() || `Ingreso ${new Date().toISOString().split('T')[0]}`;
        if (!batchName.trim()) setBatchName(currentBatch);

        const upcVal = upc.trim();
        const serialVal = serial.trim();
        const qtyVal = qty.trim();

        if (!upcVal) {
            showToast("Error: Debes ingresar el UPC.", 'error');
            upcRef.current?.focus();
            return;
        }

        let parsedQty = 0;
        let finalTipo = "";

        if (mode === 'UPC_SERIAL') {
            if (!serialVal) {
                showToast("Error: Debes ingresar el serial.", 'error');
                triggerFeedback('error');
                serialRef.current?.focus();
                return;
            }
            // Protección: Detectar si escanearon el UPC en el campo de serial por error
            if (serialVal === upcVal) {
                showToast(`⚠️ Error: Escaneaste el UPC de nuevo en vez del serial. Escanea el serial del producto.`, 'error');
                triggerFeedback('error');
                setSerial("");
                serialRef.current?.focus();
                return;
            }
            const serialExceptions = ['XBOX', 'META QUEST', 'META', 'RAY-BAN', 'RAYBAN', 'RAY BAN', 'OAKLEY'];
            const productName = (matchedProduct?.NOMBRE || '').toUpperCase();
            const isException = serialExceptions.some(ex => productName.includes(ex));
            const isIMEI = /^\d{15}$/.test(serialVal);
            const isMixedAlphanumeric = /[A-Za-z]/.test(serialVal) && /\d/.test(serialVal); // Has BOTH letters and numbers
            if (!isException && !isIMEI && !isMixedAlphanumeric && !/^[A-Za-z]/.test(serialVal)) {
                showToast(`Error: El serial debe contener letras (o ser un IMEI de 15 dígitos): ${serialVal}`, 'error');
                triggerFeedback('error');
                serialRef.current?.focus();
                serialRef.current?.select();
                return;
            }
            if (records.some(r => r.Serial === serialVal)) {
                showToast(`⚠️ Serial DUPLICADO: ${serialVal} — ya fue ingresado`, 'error');
                triggerFeedback('duplicate');
                serialRef.current?.focus();
                serialRef.current?.select();
                return;
            }
            finalTipo = "SERIAL";
            parsedQty = 1;
        } else {
            if (!qtyVal) {
                showToast("Error: Debes ingresar una cantidad.", 'error');
                triggerFeedback('error');
                qtyRef.current?.focus();
                return;
            }
            parsedQty = parseInt(qtyVal, 10);
            if (isNaN(parsedQty) || parsedQty <= 0) {
                showToast("Error: Cantidad inválida.", 'error');
                triggerFeedback('error');
                qtyRef.current?.focus();
                qtyRef.current?.select();
                return;
            }
            finalTipo = "MASIVO";
        }

        // Calcular Finanzas (El costo se asignará ahora desde la tarjeta)
        const parsedCost = 0;
        const parsedExRate = parseFloat(exchangeRate) || 0;

        let finalCostoTotalCOP = 0;
        if (currency === 'USD') {
            finalCostoTotalCOP = parsedQty * parsedCost * parsedExRate;
        } else {
            finalCostoTotalCOP = parsedQty * parsedCost; // Directo
        }

        const now = new Date();
        const formattedDate = now.getFullYear() + "-" +
            String(now.getMonth() + 1).padStart(2, '0') + "-" +
            String(now.getDate()).padStart(2, '0') + " " +
            String(now.getHours()).padStart(2, '0') + ":" +
            String(now.getMinutes()).padStart(2, '0') + ":" +
            String(now.getSeconds()).padStart(2, '0');

        const activeProvider = proveedor.trim() || 'No Especificado';

        if (proveedor.trim() && !listaProveedores.includes(proveedor.trim())) {
            setListaProveedores(prev => [...prev, proveedor.trim()]);
        }

        if (mode === 'UPC_SERIAL') {
            const newRecord: InventoryRecord = {
                FechaHora: formattedDate,
                Lote: currentBatch,
                Proveedor: activeProvider,
                Tipo: finalTipo,
                UPC: upcVal,
                Nombre: matchedProduct?.NOMBRE || 'N/A',
                SKU: matchedProduct?.SKU || 'N/A',
                Serial: serialVal,
                Cantidad: parsedQty,
                Nota: note.trim(),
                ID: uuidv4().substring(0, 8),
                Moneda: currency,
                CostoUnitario: parsedCost,
                TasaCambio: currency === 'USD' ? parsedExRate : 1,
                CostoTotalCOP: finalCostoTotalCOP,
                Imagen: matchedProduct?.IMAGEN || ''
            };
            setRecords(prev => [newRecord, ...prev]);
        } else {
            // Generación de Códigos Masivos: MYYMMDD-NNN (ej: M260330-001)
            const yy = String(now.getFullYear()).slice(-2);
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const dd = String(now.getDate()).padStart(2, '0');
            const datePrefix = `M${yy}${mm}${dd}-`;
            
            setRecords(prev => {
                const newRecordsArr: InventoryRecord[] = [];
                let currentCounter = 1;

                // Encontrar el contador más alto existente para este prefijo de fecha
                const existingCodes = prev.map(r => r.Serial).filter(s => s && s.startsWith(datePrefix));
                if (existingCodes.length > 0) {
                    const counters = existingCodes.map(s => parseInt(s.split('-')[1], 10)).filter(n => !isNaN(n));
                    if (counters.length > 0) {
                        currentCounter = Math.max(...counters) + 1;
                    }
                }

                for (let i = 0; i < parsedQty; i++) {
                    const masivoCode = `${datePrefix}${String(currentCounter).padStart(3, '0')}`;
                    currentCounter++;

                    newRecordsArr.push({
                        FechaHora: formattedDate,
                        Lote: currentBatch,
                        Proveedor: activeProvider,
                        Tipo: finalTipo, // "MASIVO"
                        UPC: upcVal,
                        Nombre: matchedProduct?.NOMBRE || 'N/A',
                        SKU: matchedProduct?.SKU || 'N/A',
                        Serial: masivoCode,
                        Cantidad: 1,
                        Nota: note.trim(),
                        ID: uuidv4().substring(0, 8),
                        Moneda: currency,
                        CostoUnitario: parsedCost,
                        TasaCambio: currency === 'USD' ? parsedExRate : 1,
                        CostoTotalCOP: finalCostoTotalCOP,
                        Imagen: matchedProduct?.IMAGEN || ''
                    });
                }
                return [...newRecordsArr.reverse(), ...prev];
            });
        }

        showToast(`Agregado: UPC ${upcVal} (${parsedQty} uds)`, 'success');
        triggerFeedback('success');
        clearFields();
    };

    // ====== SMART SCAN FILTER ======
    // Prevents the TERA scanner from accidentally reading nearby barcodes into the wrong field.
    // Also filters out junk scans: WiFi IDs, Bluetooth MACs, URLs from QR codes, etc.

    const isJunkScan = (val: string): string | null => {
        // MAC addresses (WiFi ID, Bluetooth ID): XX:XX:XX:XX:XX:XX or XX-XX-XX-XX-XX-XX
        if (/^([0-9A-Fa-f]{2}[:\-]){5}[0-9A-Fa-f]{2}$/.test(val)) {
            return '🚫 WiFi/Bluetooth ID detectado — ignorado';
        }
        // URLs from QR codes
        if (/^https?:\/\//i.test(val) || /^www\./i.test(val)) {
            return '🚫 URL/QR detectado — ignorado';
        }
        // URI schemes (ftp://, tel:, mailto:, etc.)
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(val)) {
            return '🚫 Enlace detectado — ignorado';
        }
        // Very long garbage strings (>50 chars usually aren't valid barcodes or serials)
        if (val.length > 50) {
            return '🚫 Código demasiado largo — ignorado';
        }
        return null;
    };

    const isLikelyUPC = (val: string): boolean => {
        // UPCs are purely numeric, 8-13 digits
        return /^\d{8,13}$/.test(val);
    };

    const isLikelySerial = (val: string): boolean => {
        // Serials: start with a letter, OR are 15-digit IMEI, OR mixed alphanumeric (letters+digits)
        const isIMEI = /^\d{15}$/.test(val);
        const startsWithLetter = /^[A-Za-z]/.test(val);
        const isMixedAlphanumeric = /[A-Za-z]/.test(val) && /\d/.test(val); // e.g. Meta serial "4ABC123"
        return startsWithLetter || isIMEI || isMixedAlphanumeric;
    };

    const validateSmartScan = (field: string, value: string): { valid: boolean; message: string } => {
        const val = value.trim();
        if (!val) return { valid: true, message: '' };

        // ---- JUNK FILTER (applies to ALL fields) ----
        const junkMsg = isJunkScan(val);
        if (junkMsg) return { valid: false, message: junkMsg };

        if (field === 'upc') {
            if (productDB[val]) return { valid: true, message: '' };
            // Short codes (≤6 chars) are always valid in UPC — Family IDs, model codes, etc. (e.g. Z1KH)
            if (val.length <= 6) return { valid: true, message: '' };
            if (isLikelySerial(val) && !isLikelyUPC(val)) {
                return { 
                    valid: false, 
                    message: `⚠️ Eso parece un SERIAL, no un UPC. Escanea el código de barras del producto.`
                };
            }
            return { valid: true, message: '' };
        }

        if (field === 'serial') {
            if (isLikelyUPC(val) && !(/^\d{15}$/.test(val))) {
                return {
                    valid: false,
                    message: `⚠️ Eso parece un UPC (${val.length} dígitos), no un serial. Escanea el serial/IMEI del producto.`
                };
            }
            return { valid: true, message: '' };
        }

        return { valid: true, message: '' };
    };


    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, field: string) => {
        if (e.key === 'Escape') {
            e.preventDefault();
            setUpc("");
            setMatchedProduct(null);
            setKeepUpc(false);
            upcRef.current?.focus();
            return;
        }

        if (e.key === 'Enter') {
            e.preventDefault();

            // Smart Scan Filter: Validate before processing
            if (field === 'upc') {
                const validation = validateSmartScan('upc', upc);
                if (!validation.valid) {
                    showToast(validation.message, 'error');
                    triggerFeedback('error');
                    setUpc("");
                    upcRef.current?.focus();
                    return;
                }
                processUpcScan();
            }
            // Automatización Fase 8: Si escanea el serial, guarda inmediatamente y vuelve al UPC sin preguntar.
            else if (field === 'serial' && serial.trim()) {
                const validation = validateSmartScan('serial', serial);
                if (!validation.valid) {
                    showToast(validation.message, 'error');
                    triggerFeedback('error');
                    setSerial("");
                    serialRef.current?.focus();
                    return;
                }
                addRecord();
            }
            // Automatización Fase 8: En masivo, darle Enter a la cantidad guarda inmediatamente.
            else if (field === 'qty' && qty.trim()) addRecord();
            else if (field === 'note') addRecord();
            else if (field === 'modal_submit') handleSaveNewProduct();
        }
    };

    const formatMoney = (amount: number, currencyType: Currency) => {
        const safeAmount = Number(amount) || 0;
        const safeCurrency = currencyType || 'COP';
        if (safeAmount === 0) return '$0';
        try {
            return new Intl.NumberFormat('es-CO', { style: 'currency', currency: safeCurrency, minimumFractionDigits: 0 }).format(safeAmount);
        } catch (e) {
            return `$${safeAmount}`;
        }
    };

    const handleDeleteRecord = (id: string, e: React.MouseEvent) => {
        e.stopPropagation(); // Evitar que colapse la tarjeta al borrar
        setDeleteConfirm({ id, type: 'record' });
    };

    const confirmDelete = () => {
        if (deleteConfirm.type === 'record' && deleteConfirm.id) {
            setRecords((prev) => prev.filter(r => r.ID !== deleteConfirm.id));
            showToast("Registro eliminado", 'success');
            upcRef.current?.focus();
        } else if (deleteConfirm.type === 'session') {
            setRecords([]);
            clearFields();
            localStorage.removeItem('scanner_backup');
            showToast("Sesión vaciada — todos los productos eliminados", 'success');
            upcRef.current?.focus();
        }
        setDeleteConfirm({ id: null, type: 'record' });
    };

    const exportToExcel = (recordsToExport: InventoryRecord[], loteName: string, sessionProvider: string = "", showEmptySessionPrompt: boolean = true) => {
        if (recordsToExport.length === 0) return alert("No hay registros para exportar.");

        const dataToExport = recordsToExport.map(r => {
            // Conversión de Fecha de YYYY-MM-DD HH:MM:SS a DD/MM/YYYY
            let fechaFormatted = r.FechaHora;
            try {
                const datePart = r.FechaHora.split(' ')[0];
                const [year, month, day] = datePart.split('-');
                if (year && month && day) {
                    fechaFormatted = `${day}/${month}/${year}`;
                }
            } catch (e) {
                // Keep original if parsing fails
            }

            return {
                "FECHA": fechaFormatted,
                "SERIALES": r.Serial || '',
                "UPC": r.UPC,
                "SKU": r.SKU,
                "NOMBRE": r.Nombre,
                "COSTO USD": r.Moneda === 'USD' ? r.CostoUnitario : (r.CostoUnitario / r.TasaCambio).toFixed(2), // Aproximación si se entró en COP
                "CAMBIO": r.TasaCambio,
                "COSTO COP": r.CostoTotalCOP,
                "PROVEEDOR": sessionProvider || r.Proveedor
            };
        }).sort((a, b) => {
            // Ordenar alfabéticamente por Nombre del Producto
            if (a.NOMBRE < b.NOMBRE) return -1;
            if (a.NOMBRE > b.NOMBRE) return 1;

            // Si el nombre es igual, mantener orden subyacente
            return 0;
        });

        const worksheet = XLSX.utils.json_to_sheet(dataToExport);

        const colWidths = [
            { wch: 15 }, // FECHA
            { wch: 25 }, // SERIALES
            { wch: 20 }, // UPC
            { wch: 15 }, // SKU
            { wch: 45 }, // NOMBRE
            { wch: 15 }, // COSTO USD
            { wch: 10 }, // CAMBIO
            { wch: 15 }, // COSTO COP
            { wch: 25 }, // PROVEEDOR
        ];
        worksheet['!cols'] = colWidths;

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Ingresos");

        // === HOJA 2: RESUMEN (agrupado por producto) ===
        const summaryMap: Record<string, { SKU: string; NOMBRE: string; UNIDADES: number; COSTO: number; CAMBIO: number; }> = {};

        recordsToExport.forEach(r => {
            const key = r.UPC;
            if (!summaryMap[key]) {
                summaryMap[key] = {
                    SKU: r.SKU || 'N/A',
                    NOMBRE: r.Nombre || 'N/A',
                    UNIDADES: 0,
                    COSTO: r.CostoUnitario || 0,
                    CAMBIO: r.TasaCambio || 0,
                };
            }
            summaryMap[key].UNIDADES += r.Cantidad;
            // Usar el costo más reciente (último escaneado)
            if (r.CostoUnitario > 0) {
                summaryMap[key].COSTO = r.CostoUnitario;
                summaryMap[key].CAMBIO = r.TasaCambio;
            }
        });

        // Fecha del lote (DD/MM/YYYY)
        const now = new Date();
        const summaryFecha = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()}`;

        const summaryData = Object.values(summaryMap)
            .sort((a, b) => a.NOMBRE.localeCompare(b.NOMBRE))
            .map(item => {
                const totalUSD = item.CAMBIO > 0 ? (item.UNIDADES * item.COSTO) : (item.CAMBIO === 1 ? 0 : (item.UNIDADES * item.COSTO));
                return {
                    "FECHA": summaryFecha,
                    "SKU": item.SKU,
                    "NOMBRE": item.NOMBRE,
                    "UNIDADES": item.UNIDADES,
                    "COSTO": item.COSTO,
                    "CAMBIO": item.CAMBIO,
                    "USD": Math.round(item.UNIDADES * item.COSTO * 100) / 100,
                };
            });

        // Fila de totales
        const totalUnidades = summaryData.reduce((acc, r) => acc + r.UNIDADES, 0);
        const totalUSD = summaryData.reduce((acc, r) => acc + r.USD, 0);
        summaryData.push({
            "FECHA": "",
            "SKU": "",
            "NOMBRE": "TOTAL",
            "UNIDADES": totalUnidades,
            "COSTO": 0,
            "CAMBIO": 0,
            "USD": Math.round(totalUSD * 100) / 100,
        });

        const summarySheet = XLSX.utils.json_to_sheet(summaryData);
        summarySheet['!cols'] = [
            { wch: 15 },  // FECHA
            { wch: 20 },  // SKU
            { wch: 45 },  // NOMBRE
            { wch: 12 },  // UNIDADES
            { wch: 12 },  // COSTO
            { wch: 10 },  // CAMBIO
            { wch: 15 },  // USD
        ];
        XLSX.utils.book_append_sheet(workbook, summarySheet, "Resumen");

        const safeLoteName = loteName.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const fileName = `ingreso_${safeLoteName}_${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.xlsx`;
        XLSX.writeFile(workbook, fileName);

        showToast("✅ Exportación exitosa");

        if (showEmptySessionPrompt) {
            setTimeout(() => {
                if (confirm("¿Deseas vaciar la sesión actual ahora que has exportado los datos con éxito?")) setRecords([]);
                upcRef.current?.focus();
            }, 500);
        }
    };

    const saveCurrentSessionToHistory = async () => {
        if (records.length === 0) return;

        // Calcular los totales de la sesión actual
        const currentTotalUnidades = records.reduce((acc, curr) => acc + curr.Cantidad, 0);
        const currentCostoTotalCOP = records.reduce((acc, curr) => acc + curr.CostoTotalCOP, 0);

        // Reuse original session ID if re-saving a reopened session
        const newSessionId = editingSessionId || Date.now().toString();

        const newSessionPayload = {
            id: newSessionId,
            date: new Date().toLocaleString('es-CO'),
            batchName: batchName || `Ingreso ${new Date().toISOString().split('T')[0]}`,
            proveedor: proveedor,
            totalItems: currentTotalUnidades,
            totalCop: currentCostoTotalCOP,
            records: records
        };

        try {
            showToast("Guardando sesión en la nube, por favor espera...", "info");
            const res = await fetch('/api/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newSessionPayload)
            });
            const data = await res.json();

            if (data.success) {
                // Sincronizar UI localmente
                const formattedNewSession: HistorySession = {
                    id: newSessionId,
                    fecha: newSessionPayload.date,
                    lote: newSessionPayload.batchName,
                    proveedor: newSessionPayload.proveedor,
                    totalRecords: records.length,
                    totalUnidades: currentTotalUnidades,
                    costoTotalCOP: currentCostoTotalCOP,
                    monedaBase: currency,
                    records: [...records]
                };

                // Remove old version if re-saving, then add updated
                setSavedSessions(prev => [formattedNewSession, ...prev.filter(s => s.id !== newSessionId)]);
                setRecords([]); // Vaciamos la sesión activa localmente solo si guardó con éxito en la nube
                setEditingSessionId(null); // Reset editing state
                localStorage.removeItem('scanner_backup'); // Limpiamos backup local
                setView('HISTORY');
                showToast(editingSessionId ? "Sesión actualizada en Neon DB" : "Sesión Guardada permanentemente en Neon DB", "success");

                // Sync product LastCost to the cloud for future sessions
                const costUpdates: { UPC: string; LastCost: number }[] = [];
                const seenUpcs = new Set<string>();
                for (const r of records) {
                    if (!seenUpcs.has(r.UPC) && r.CostoUnitario > 0) {
                        seenUpcs.add(r.UPC);
                        costUpdates.push({ UPC: r.UPC, LastCost: r.CostoUnitario });
                    }
                }
                if (costUpdates.length > 0) {
                    // Fire-and-forget: update each product's lastCost
                    for (const update of costUpdates) {
                        const existingProd = productDB[update.UPC];
                        if (existingProd) {
                            fetch('/api/products', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ ...existingProd, LastCost: update.LastCost })
                            }).catch(() => {});
                        }
                    }
                }
            } else {
                showToast("Error al guardar la sesión: " + data.error, "error");
            }
        } catch (error) {
            console.error("Error guardando sesión en Neon:", error);
            showToast("Error de red. Tus registros están a salvo en local.", "error");
        }
    };

    const loadSessionForEditing = (session: HistorySession) => {
        if (records.length > 0) {
            if (!confirm("Tienes una sesión activa en progreso. Si abres otra, esta sesión será reemplazada temporalmente y pausada. ¿Continuar?")) return;
        }

        setRecords(session.records);
        setBatchName(session.lote);
        setProveedor(session.proveedor || '');
        setCurrency(session.monedaBase);
        setEditingSessionId(session.id); // Track original ID for re-save
        setView('SCANNER');

        showToast(`Sesión reabierta para edición: ${session.lote}`, "info");
    };

    const deleteHistorySession = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (confirm("¿Estás seguro de eliminar este registro histórico permanentemente? No se podrá recuperar.")) {
            setSavedSessions(prev => prev.filter(s => s.id !== id));
            showToast("Registro Histórico eliminado.", "info");
        }
    };

    const toggleGroup = (upcKey: string) => {
        setExpandedGroups((prev) => ({
            ...prev,
            [upcKey]: !prev[upcKey]
        }));
    };

    const handleUpdateUpcCost = (upc: string, unitCostValue: string) => {
        const unitCostNum = parseFloat(unitCostValue);
        // Permite borrar el campo permitiendo NaN, caerá en 0 o cadena vacía si usamos strings, pero dejémoslo como NaN/0
        const finalUnitCost = isNaN(unitCostNum) ? 0 : unitCostNum;

        setRecords(prev => prev.map(r => {
            if (r.UPC === upc) {
                // The item's individual total cost is its quantity * unit cost
                const itemTotalCost = r.Cantidad * finalUnitCost;
                // Translate that into COP if necessary
                const finalCostoTotalCOP = r.Moneda === 'USD' ? (itemTotalCost * r.TasaCambio) : itemTotalCost;

                return {
                    ...r,
                    CostoUnitario: isNaN(unitCostNum) ? ("" as any) : finalUnitCost, // Hack to allow empty string
                    CostoTotalCOP: finalCostoTotalCOP
                };
            }
            return r;
        }));

        // Actualizar el costo histórico en la base de datos de productos (ProductDB)
        if (!isNaN(unitCostNum) && unitCostNum > 0) {
            setProductDB(prev => {
                const existingProduct = prev[upc];
                if (existingProduct) {
                    return {
                        ...prev,
                        [upc]: { ...existingProduct, LastCost: unitCostNum }
                    };
                }
                return prev;
            });
        }
    };

    // --------------------------------------------------------------------
    // COMPUTE GROUPS LOGIC
    // --------------------------------------------------------------------
    const groupedRecords = React.useMemo(() => {
        const groupsMap: Record<string, ProductGroup> = {};

        // records viene ordenado LIFO (último escaneado índice 0)
        // Iteramos en reverso (el más viejo primero) para que array de Records quede cronológico natural
        [...records].reverse().forEach(record => {
            const groupKey = record.UPC;
            if (!groupsMap[groupKey]) {
                groupsMap[groupKey] = {
                    UPC: groupKey,
                    Nombre: record.Nombre,
                    SKU: record.SKU,
                    Records: [],
                    TotalUnidades: 0,
                    CostoAcumuladoCOP: 0,
                    Imagen: productDB[groupKey]?.IMAGEN || '',
                    IsExpanded: false
                };
            }
            groupsMap[groupKey].Records.push(record);
            groupsMap[groupKey].TotalUnidades += Number(record.Cantidad) || 0;
            groupsMap[groupKey].CostoAcumuladoCOP += Number(record.CostoTotalCOP) || 0;
        });

        // Convertimos el map a Array y ordenamos para que el grupo con el registro MÁS RECIENTE quede de primero
        return Object.values(groupsMap).sort((a, b) => {
            const lastRecordA = a.Records[a.Records.length - 1];
            const lastRecordB = b.Records[b.Records.length - 1];
            const timeA = new Date(lastRecordA.FechaHora.replace(' ', 'T')).getTime();
            const timeB = new Date(lastRecordB.FechaHora.replace(' ', 'T')).getTime();
            return timeB - timeA;
        });
    }, [records, productDB]);


    const inputClass = "w-full bg-gray-50/50 dark:bg-dark-input border border-gray-200 dark:border-dark-border rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-brand-blue focus:bg-white dark:focus:bg-dark-bg transition-all text-slate-900 dark:text-gray-100 placeholder-gray-400 font-medium";
    const labelClass = "block text-xs font-bold uppercase tracking-wider mb-2 text-gray-500 dark:text-gray-400";

    // Contadores Globales Financieros
    const totalUnits = records.reduce((acc, current) => acc + current.Cantidad, 0);
    const globalTotalCOP = records.reduce((acc, current) => acc + current.CostoTotalCOP, 0);

    if (!isClient) return null;

    return (
        <div className="min-h-[100vh] flex flex-col font-sans bg-dark-bg text-gray-100 transition-colors duration-300">
            {/* Oculto: Input para archivos CSV */}
            <input type="file" accept=".csv" className="hidden" ref={fileInputRef} onChange={handleFileUpload} />

            {/* Confirmation Modal */}
            {deleteConfirm.id && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[100] animate-in fade-in duration-200" onClick={() => setDeleteConfirm({ id: null, type: 'record' })}>
                    <div className="bg-[#0F1014] border border-dark-border rounded-3xl w-[400px] overflow-hidden shadow-2xl shadow-red-500/10" onClick={e => e.stopPropagation()}>
                        <div className="p-6 text-center">
                            <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4 border border-red-500/20">
                                <AlertTriangle className="text-red-500" size={32} />
                            </div>
                            <h3 className="text-xl font-black text-white uppercase tracking-wider mb-2">¿Confirmar Acción?</h3>
                            <p className="text-gray-400 font-bold mb-8">
                                {deleteConfirm.type === 'record' ? '¿Estás completamente seguro de borrar esta entrada?' : '¿Deseas vaciar toda la sesión actual y todos sus registros no guardados?'}
                            </p>
                            <div className="flex gap-4">
                                <button onClick={() => setDeleteConfirm({ id: null, type: 'record' })} className="flex-1 py-3 px-4 rounded-xl font-bold bg-dark-input hover:bg-white/5 text-gray-400 transition-colors">
                                    CANCELAR
                                </button>
                                <button onClick={confirmDelete} className="flex-1 py-3 px-4 rounded-xl font-bold bg-red-600 hover:bg-red-500 text-white shadow-[0_0_15px_rgba(220,38,38,0.3)] transition-all">
                                    ELIMINAR
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Toasts */}
            <div className="fixed top-6 left-1/2 transform -translate-x-1/2 z-[100] flex flex-col items-center gap-3 pointer-events-none">
                {toasts.map((toast) => (
                    <div key={toast.id} className={`flex items-center gap-3 px-6 py-4 rounded-2xl shadow-2xl text-white font-semibold tracking-wide transition-all transform animate-in zoom-in duration-200 ${toast.type === 'success' ? 'bg-[#2E7D32]/95 backdrop-blur-md border border-[#2E7D32]' : toast.type === 'error' ? 'bg-[#C62828]/95 backdrop-blur-md border border-[#C62828]' : 'bg-[#F9A825]/95 backdrop-blur-md border border-[#F9A825]'}`}>
                        {toast.type === 'success' ? <CheckCircle size={22} className="opacity-90" /> : toast.type === 'error' ? <AlertTriangle size={22} className="opacity-90" /> : <Database size={22} className="opacity-90" />}
                        {toast.message}
                    </div>
                ))}
            </div>

            {/* Modal: Agregar Producto Nuevo */}
            {showNewProductModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="px-6 py-4 border-b border-gray-100 dark:border-dark-border flex justify-between items-center bg-brand-blue text-white">
                            <div className="flex items-center gap-2"><AlertTriangle size={20} className="text-yellow-400" /><h3 className="font-bold text-lg tracking-wide">UPC No Registrado</h3></div>
                            <button onClick={() => { setShowNewProductModal(false); upcRef.current?.select(); }} className="text-white/60 hover:text-white transition-colors"><X size={24} /></button>
                        </div>
                        <div className="p-6 flex flex-col gap-4">
                            <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Ingresa los datos para que el sistema aprenda este código.</p>
                            <div><label className={labelClass}>UPC</label><input type="text" value={newProductForm.UPC} disabled className={`${inputClass} bg-gray-100 dark:bg-dark-bg cursor-not-allowed`} /></div>

                            <div className="relative">
                                <label className={labelClass}>Nombre del Producto *</label>
                                <input
                                    ref={modalNameRef}
                                    list="existing-product-names"
                                    type="text"
                                    value={newProductForm.NOMBRE}
                                    onChange={e => {
                                        const newName = e.target.value;
                                        setNewProductForm(prev => ({
                                            ...prev,
                                            NOMBRE: newName,
                                            SKU: generateSKU(newName) // Auto-generar SKU al teclear
                                        }));
                                    }}
                                    onKeyDown={e => handleKeyDown(e, 'modal_submit')}
                                    className={`${inputClass} pr-24`}
                                    placeholder="Descripción exacta..."
                                />
                                <datalist id="existing-product-names">
                                    {Array.from(new Set(Object.values(productDB).map(p => p.NOMBRE))).sort().map((name, idx) => (
                                        <option key={idx} value={name} />
                                    ))}
                                </datalist>
                                <span className="absolute right-4 top-[38px] text-[9px] text-gray-500 font-bold uppercase tracking-widest hidden md:block pointer-events-none">Auto SKU ✓</span>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div><label className={labelClass}>Referencia / Auto SKU</label><input type="text" value={newProductForm.SKU} onChange={e => setNewProductForm({ ...newProductForm, SKU: e.target.value })} onKeyDown={e => handleKeyDown(e, 'modal_submit')} className={`${inputClass} font-mono text-sm tracking-widest text-brand-blue uppercase`} placeholder="Generado Aut..." /></div>
                                <div className="flex flex-col">
                                    <label className={labelClass}>URL de Imagen</label>
                                    <div className="flex gap-2 relative items-center">
                                        {newProductForm.IMAGEN && (
                                            <div className="w-12 h-12 flex-shrink-0 bg-white rounded-lg border border-dark-border overflow-hidden flex items-center justify-center p-1 shadow-inner">
                                                <img src={newProductForm.IMAGEN} alt="Preview" className="max-w-full max-h-full object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                            </div>
                                        )}
                                        <input type="text" value={newProductForm.IMAGEN} onChange={e => setNewProductForm({ ...newProductForm, IMAGEN: e.target.value })} onKeyDown={e => handleKeyDown(e, 'modal_submit')} className={`${inputClass} flex-1`} placeholder="https://..." />

                                        <button
                                            onClick={(e) => {
                                                e.preventDefault();
                                                if (!newProductForm.NOMBRE) {
                                                    showToast("Escribe un nombre primero", "error");
                                                    return;
                                                }
                                                const query = encodeURIComponent(newProductForm.NOMBRE);
                                                window.open(`https://www.google.com/search?tbm=isch&q=${query}`, '_blank');
                                            }}
                                            className="bg-brand-blue hover:bg-brand-blue/80 text-white px-3 py-3 flex items-center justify-center rounded-xl transition-colors tooltip-trigger shrink-0"
                                            title="Buscar en Google Imágenes"
                                        >
                                            <ImageIcon size={18} />
                                        </button>

                                        <button
                                            onClick={async (e) => {
                                                e.preventDefault();
                                                try {
                                                    const text = await navigator.clipboard.readText();
                                                    if (text && text.startsWith('http')) {
                                                        setNewProductForm(prev => ({ ...prev, IMAGEN: text }));
                                                        showToast("URL pegada", "success");
                                                    } else {
                                                        showToast("No hay una URL válida en el portapapeles", "error");
                                                    }
                                                } catch (err) {
                                                    showToast("Error al leer portapapeles", "error");
                                                }
                                            }}
                                            className="bg-dark-input border border-dark-border hover:bg-white/10 text-gray-400 px-3 py-3 flex items-center justify-center rounded-xl transition-colors tooltip-trigger shrink-0"
                                            title="Pegar URL directamente"
                                        >
                                            <FileDown size={18} />
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="p-4 bg-gray-50 dark:bg-dark-input flex justify-end gap-3 border-t dark:border-dark-border"><button onClick={() => { setShowNewProductModal(false); upcRef.current?.select(); }} className="px-5 py-2 font-bold text-gray-600 dark:text-gray-400">Cancelar</button><button onClick={handleSaveNewProduct} className="flex gap-2 px-6 py-2 bg-brand-green text-white font-bold rounded-lg"><PlusCircle size={18} /> Guardar</button></div>
                    </div>
                </div>
            )}

            {/* Header Global (Dark Terminal UI) */}
            <header className="bg-dark-bg px-6 lg:px-8 py-5 mt-6 flex flex-wrap items-center justify-between z-10 transition-colors duration-300 gap-4">
                {/* Zona Izquierda: Identidad */}
                <div className="flex items-center gap-4 cursor-pointer" onClick={() => setView('SCANNER')}>
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 md:w-10 md:h-10 rounded-xl overflow-hidden shadow-[0_0_15px_rgba(37,99,235,0.4)] flex-shrink-0">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src="/logo.png" alt="INGRESADOS Logo" className="w-full h-full object-cover" />
                        </div>
                        <div className="flex flex-col">
                            <h1 className="text-xl md:text-2xl font-black tracking-[0.3em] text-white uppercase leading-none drop-shadow-md">INGRESADOS</h1>
                            <div className="flex items-center gap-4 mt-1">
                                <span className="text-[9px] md:text-[10px] font-bold tracking-[0.2em] uppercase text-brand-blue/80 hidden md:inline-block">INVENTORY & TRACKING</span>
                                <span className="text-[9px] md:text-[10px] font-bold tracking-[0.2em] uppercase text-gray-500">BODEGA ACTIVA</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Zona Central: Contexto del Lote */}
                <div className="flex items-center gap-3 flex-wrap lg:flex-nowrap justify-center">
                    {/* Batch Name Pill */}
                    <div className="flex items-center bg-dark-input px-4 py-2 rounded-xl border border-dark-border">
                        <input type="text" value={batchName} onChange={(e) => setBatchName(e.target.value)} className="bg-transparent text-xs font-bold text-gray-300 outline-none w-[120px] md:w-[150px]" placeholder="Nombre del Lote..." />
                        <ChevronDown size={14} className="text-gray-500 ml-1 shrink-0" />
                    </div>

                    {/* Provider Pill (Auto-feeding Datalist) */}
                    <div className="flex items-center bg-dark-input px-4 py-2 rounded-xl border border-dark-border">
                        <input
                            list="proveedores-list"
                            type="text"
                            value={proveedor}
                            onChange={(e) => setProveedor(e.target.value)}
                            className="bg-transparent text-xs font-bold text-gray-300 outline-none w-[130px] md:w-[160px]"
                            placeholder="Proveedor o Cliente..."
                        />
                        <datalist id="proveedores-list">
                            {listaProveedores.map((prov, i) => <option key={i} value={prov} />)}
                        </datalist>
                        <ChevronDown size={14} className="text-gray-500 ml-1 shrink-0" />
                    </div>
                </div>

                {/* Zona Derecha: Finanzas y Herramientas Secundarias */}
                <div className="flex flex-wrap items-center justify-end gap-3 z-20 relative">
                    {/* Bloque Financiero Unificado (Moneda + TRM) */}
                    <div className="flex items-center gap-1.5 bg-dark-input p-1 rounded-xl border border-dark-border">
                        <div className="flex items-center">
                            <button onClick={() => setCurrency('USD')} className={`px-3 py-1.5 text-[10px] md:text-xs font-bold rounded-lg transition-colors ${currency === 'USD' ? 'bg-[#1b5e20] text-emerald-400' : 'text-gray-500 hover:text-gray-300'}`}>USD</button>
                            <button onClick={() => setCurrency('COP')} className={`px-3 py-1.5 text-[10px] md:text-xs font-bold rounded-lg transition-colors ${currency === 'COP' ? 'bg-brand-blue text-white' : 'text-gray-500 hover:text-gray-300'}`}>COP</button>
                        </div>
                        <div className={`flex items-center transition-opacity duration-300 ${currency === 'USD' ? 'opacity-100' : 'opacity-30 pointer-events-none'}`}>
                            <input type="number" value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} onWheel={(e) => e.currentTarget.blur()} onFocus={(e) => e.target.select()} disabled={currency === 'COP'} className="bg-black/20 px-2 py-1.5 rounded-lg text-xs font-bold text-gray-300 outline-none w-[60px] text-center" placeholder="TRM" />
                        </div>
                    </div>

                    {/* Herramientas Secundarias (Iconos y Botón Principal Historial) */}
                    <div className="flex items-center gap-2">
                        {/* Google Sheets Connection Indicator */}
                        <button 
                            onClick={async () => {
                                setSheetsSyncing(true);
                                try {
                                    const res = await fetch('/api/products');
                                    const data = await res.json();
                                    if (data.success && data.data) {
                                        setProductDB(data.data);
                                        setSheetsConnected(data.sheetsConnected === true);
                                        if (data.sheetsConnected) {
                                            setSheetsProductCount(Object.keys(data.data).length);
                                            setSheetsLastSync(data.lastSheetsUpdate || new Date().toISOString());
                                        }
                                        showToast(`📊 Catálogo sincronizado: ${Object.keys(data.data).length} productos`, 'success');
                                    }
                                } catch (err) {
                                    showToast('Error sincronizando con Google Sheets', 'error');
                                    setSheetsConnected(false);
                                } finally {
                                    setSheetsSyncing(false);
                                }
                            }}
                            className={`flex items-center gap-2 px-3 py-2 rounded-xl border transition-all text-xs font-bold ${
                                sheetsConnected 
                                    ? 'bg-emerald-900/20 border-emerald-500/30 text-emerald-400 hover:bg-emerald-900/40' 
                                    : 'bg-dark-input border-dark-border text-gray-500 hover:text-gray-300'
                            }`}
                            title={sheetsConnected 
                                ? `Google Sheets conectado — ${sheetsProductCount} productos | Última sync: ${sheetsLastSync ? new Date(sheetsLastSync).toLocaleTimeString('es-CO') : 'N/A'}` 
                                : 'Google Sheets no conectado — Click para sincronizar'
                            }
                        >
                            <div className="relative">
                                <RefreshCw size={14} className={sheetsSyncing ? 'animate-spin' : ''} />
                                <div className={`absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full ${sheetsConnected ? 'bg-emerald-400' : 'bg-gray-600'}`} />
                            </div>
                            <span className="hidden md:inline">
                                {sheetsSyncing ? 'Sincronizando...' : sheetsConnected ? `${sheetsProductCount}` : 'Sync'}
                            </span>
                        </button>
                        <button onClick={migrateLocalToCloud} className="p-2.5 bg-dark-input hover:bg-emerald-900/40 text-emerald-500 rounded-xl border border-dark-border hover:border-emerald-500/50 transition-all font-bold group" title="FORZAR: Migrar Backup Local a la Nube">
                            <CloudLightning size={16} className="group-hover:animate-pulse" />
                        </button>
                        <button onClick={() => fileInputRef.current?.click()} className="p-2.5 bg-dark-input hover:bg-[#151E32] text-gray-400 hover:text-brand-blue rounded-xl border border-dark-border hover:border-brand-blue/30 transition-all font-bold" title="Importar Base de Datos">
                            <UploadCloud size={16} />
                        </button>
                        <div className="flex bg-dark-input rounded-xl border border-dark-border overflow-hidden shadow-[0_0_15px_rgba(37,99,235,0.15)]">
                            <button onClick={() => setView('SCANNER')} className={`flex items-center gap-2 px-4 py-2 font-black text-[10px] sm:text-xs uppercase tracking-wider transition-all ${view === 'SCANNER' ? 'bg-brand-blue/20 text-brand-blue' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'}`} title="Volver al Escáner">
                                <ScanLine size={14} /> Escáner
                            </button>
                            <button onClick={() => setView('PRODUCTS')} className={`flex items-center gap-2 px-4 py-2 font-black text-[10px] sm:text-xs uppercase tracking-wider transition-all border-l border-dark-border ${view === 'PRODUCTS' ? 'bg-brand-blue/20 text-brand-blue' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'}`} title="Catálogo de Productos">
                                <PackageCheck size={14} /> Productos
                            </button>
                            <button onClick={() => setView('HISTORY')} className={`flex items-center gap-2 px-4 py-2 font-black text-[10px] sm:text-xs uppercase tracking-wider transition-all border-l border-dark-border ${view === 'HISTORY' ? 'bg-brand-blue/20 text-brand-blue' : 'text-gray-500 hover:text-gray-300 hover:bg-white/5'}`} title="Ver Historial">
                                <History size={14} /> Historial
                            </button>
                        </div>
                    </div>

                    {/* Controles de Audio */}
                    <div className="flex items-center gap-2">
                        <div className="flex items-center gap-2 bg-dark-input border border-dark-border rounded-xl px-3 py-1.5">
                            <span className="text-[10px] font-bold text-brand-blue uppercase tracking-widest w-[28px] text-center">{speechRate.toFixed(1)}x</span>
                            <input
                                type="range"
                                min="0.5"
                                max="2.0"
                                step="0.1"
                                value={speechRate}
                                onChange={(e) => setSpeechRate(parseFloat(e.target.value))}
                                className="w-[80px] h-1.5 accent-blue-500 cursor-pointer"
                                title="Velocidad de Voz"
                            />
                        </div>
                        <button onClick={() => setIsAudioEnabled(!isAudioEnabled)} className={`w-[36px] h-[36px] border rounded-xl transition-colors flex items-center justify-center ${isAudioEnabled ? 'bg-[#151E32] border-brand-blue/30 text-brand-blue hover:bg-brand-blue/20' : 'bg-dark-input border-dark-border text-gray-500 hover:text-gray-400'}`} title={isAudioEnabled ? "Silenciar Asistente" : "Activar Asistente"}>
                            {isAudioEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
                        </button>
                    </div>

                    {/* Auth: User + Logout */}
                    <div className="flex items-center gap-2">
                        {currentUser && (
                            <span className="text-[9px] font-bold tracking-widest uppercase text-gray-600 hidden md:inline">{currentUser.email}</span>
                        )}
                        <button
                            onClick={async () => {
                                await fetch('/api/auth/logout', { method: 'POST' });
                                window.location.href = '/login';
                            }}
                            className="w-[36px] h-[36px] border rounded-xl transition-colors flex items-center justify-center bg-dark-input border-dark-border text-gray-500 hover:text-red-400 hover:border-red-500/30 hover:bg-red-500/10"
                            title="Cerrar sesión"
                        >
                            <LogOut size={16} />
                        </button>
                    </div>
                </div>
            </header>

            {/* Container Principal Condicionado a la Vista */}
            <main className="flex-1 flex flex-col lg:flex-row gap-6 py-6 px-4 md:px-6 2xl:px-10 w-full min-h-0 overflow-hidden">

                {view === 'HISTORY' ? (
                    <div className="flex-1 flex flex-col gap-6 w-full animate-in fade-in duration-300 overflow-y-auto pr-2 custom-scrollbar h-[800px] xl:h-[calc(100vh-140px)] min-h-0">
                        <div className="flex items-center gap-3 text-white mb-2">
                            <History size={24} className="text-brand-blue" />
                            <h2 className="text-2xl font-black tracking-widest uppercase">Historial de Ingresos</h2>
                        </div>

                        {savedSessions.length === 0 ? (
                            <div className="flex-1 flex flex-col items-center justify-center text-center opacity-40">
                                <FolderOpen size={48} className="text-gray-600 mb-4" />
                                <p className="text-gray-400 font-bold uppercase tracking-widest">No hay sesiones guardadas en el dispositivo</p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                                {savedSessions.map(session => (
                                    <div key={session.id} className="bg-dark-card border border-dark-border rounded-2xl p-6 flex flex-col gap-4 hover:border-brand-blue/50 transition-colors group">
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <h3 className="text-white font-bold text-lg mb-1">{session.lote}</h3>
                                                <div className="flex items-center gap-2">
                                                    <p className="text-gray-500 text-xs font-mono">{session.fecha}</p>
                                                    {session.proveedor && (
                                                        <span className="text-[9px] bg-dark-input border border-dark-border text-gray-400 px-2 py-0.5 rounded-md font-bold uppercase tracking-wider">
                                                            {session.proveedor}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div className="bg-[#151E32] text-brand-blue px-3 py-1 rounded-lg text-xs font-bold font-mono">
                                                {session.totalUnidades} UND
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4 my-2">
                                            <div className="flex flex-col">
                                                <span className="text-gray-600 text-[10px] uppercase font-bold tracking-widest">Escaneos</span>
                                                <span className="text-gray-300 font-mono">{session.totalRecords}</span>
                                            </div>
                                            <div className="flex flex-col">
                                                <span className="text-gray-600 text-[10px] uppercase font-bold tracking-widest">Valor ({session.monedaBase})</span>
                                                <span className="text-emerald-400 font-mono font-bold">
                                                    {formatMoney(
                                                        session.monedaBase === 'COP'
                                                            ? session.costoTotalCOP
                                                            : session.records.reduce((acc, r) => acc + (r.Moneda === 'USD' ? (r.CostoUnitario * r.Cantidad) : (r.TasaCambio > 0 ? r.CostoTotalCOP / r.TasaCambio : 0)), 0),
                                                        session.monedaBase
                                                    )}
                                                </span>
                                            </div>
                                        </div>

                                        <div className="flex gap-2 mt-auto pt-4 border-t border-dark-border">
                                            <button
                                                onClick={() => loadSessionForEditing(session)}
                                                className="flex-1 flex items-center justify-center gap-2 bg-dark-input hover:bg-white hover:text-black text-gray-400 py-2 rounded-xl transition-colors font-bold text-xs uppercase"
                                            >
                                                <ScanLine size={14} /> Reabrir
                                            </button>
                                            <button
                                                onClick={() => exportToExcel(session.records, session.lote, session.proveedor, false)}
                                                className="flex-1 flex items-center justify-center gap-2 bg-[#2E7D32]/20 hover:bg-[#2E7D32] text-[#4CAF50] hover:text-white py-2 rounded-xl border border-[#2E7D32]/50 transition-colors font-bold text-xs uppercase"
                                            >
                                                <FileDown size={14} /> Excel
                                            </button>
                                            <button
                                                onClick={() => {
                                                    if (confirm(`¿Eliminar la sesión "${session.lote}" permanentemente?`)) {
                                                        setSavedSessions(prev => prev.filter(s => s.id !== session.id));
                                                        showToast("Sesión eliminada", "success");
                                                    }
                                                }}
                                                className="px-3 flex items-center justify-center bg-dark-input hover:bg-red-900/50 text-gray-500 hover:text-red-400 py-2 rounded-xl border border-transparent transition-colors"
                                                title="Eliminar del dispositivo"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Espaciado Inferior y Créditos */}
                        <div className="mt-8 pb-12 flex flex-col items-center justify-center opacity-40 hover:opacity-100 transition-opacity flex-shrink-0">
                            <p className="text-[9px] font-black text-gray-500 tracking-[0.3em] uppercase mb-1">INGRESADOS V1.0</p>
                            <p className="text-[10px] font-bold text-gray-400 tracking-widest flex items-center gap-1.5 uppercase">
                                Creado por <span className="text-white bg-black px-2 py-0.5 rounded border border-gray-800">Hacheverso</span>
                            </p>
                        </div>
                    </div>
                ) : view === 'PRODUCTS' ? (
                    <div className="flex-1 flex flex-col gap-6 w-full animate-in fade-in duration-300 overflow-y-auto pr-2 custom-scrollbar h-[800px] xl:h-[calc(100vh-140px)] min-h-0">
                        <div className="flex items-center justify-between mb-2 gap-4 flex-wrap">
                            <div className="flex items-center gap-3 text-white">
                                <PackageCheck size={24} className="text-brand-blue" />
                                <h2 className="text-2xl font-black tracking-widest uppercase">Catálogo de Productos Maestro</h2>
                            </div>
                            <div className="flex items-center gap-3 flex-1 justify-end">
                                <div className="flex-1 max-w-md relative">
                                    <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" />
                                    <input
                                        type="text"
                                        value={productSearchTerm}
                                        onChange={(e) => setProductSearchTerm(e.target.value)}
                                        placeholder="Buscar por UPC o Nombre..."
                                        className="w-full bg-dark-input border border-dark-border rounded-xl pl-12 pr-4 py-3 outline-none focus:ring-1 focus:ring-brand-blue transition-all font-medium text-white placeholder-gray-600 shadow-inner"
                                    />
                                </div>
                                <button
                                    onClick={async () => {
                                        const totalProducts = Object.keys(productDB).length;
                                        if (totalProducts === 0) {
                                            showToast("El catálogo ya está vacío.", "info");
                                            return;
                                        }
                                        if (!confirm(`⚠️ PELIGRO: ¿Estás seguro de eliminar los ${totalProducts} productos del catálogo?\n\nEsta acción eliminará TODOS los productos de la base de datos en la nube.\n\nNo se puede deshacer.`)) return;
                                        if (!confirm(`ÚLTIMA CONFIRMACIÓN: Vas a borrar ${totalProducts} productos permanentemente. ¿Continuar?`)) return;

                                        try {
                                            const res = await fetch('/api/products?upc=ALL', { method: 'DELETE' });
                                            const data = await res.json();
                                            if (data.success) {
                                                setProductDB({});
                                                localStorage.removeItem('scanner_product_db');
                                                showToast(`🗑 Catálogo vaciado: ${data.count} productos eliminados de la nube.`, 'success');
                                            } else {
                                                showToast("Error al vaciar: " + data.error, "error");
                                            }
                                        } catch (err) {
                                            console.error("Error vaciando catálogo:", err);
                                            showToast("Error de conexión al intentar vaciar el catálogo.", "error");
                                        }
                                    }}
                                    className="flex items-center gap-2 px-5 py-3 bg-dark-input border border-dark-border hover:border-red-500/50 hover:bg-red-500/10 text-gray-500 hover:text-red-400 rounded-xl transition-all text-[10px] font-bold uppercase tracking-widest shrink-0"
                                    title="Eliminar todos los productos del catálogo"
                                >
                                    <Eraser size={16} /> Vaciar Catálogo
                                </button>
                            </div>
                        </div>

                        {Object.keys(productDB).length === 0 ? (
                            <div className="flex-1 flex flex-col items-center justify-center text-center opacity-40">
                                <Database size={48} className="text-gray-600 mb-4" />
                                <p className="text-gray-400 font-bold uppercase tracking-widest">El catálogo está vacío.</p>
                            </div>
                        ) : (
                            <div className="bg-dark-card border border-dark-border rounded-3xl overflow-hidden shadow-2xl flex-shrink-0">
                                <div className="overflow-x-auto min-w-full">
                                    <table className="w-full text-left border-collapse">
                                        <thead>
                                            <tr className="bg-[#151E32] text-gray-400 uppercase tracking-widest text-[10px] sm:text-xs">
                                                <th className="px-6 py-4 font-black w-24 text-center">Foto</th>
                                                <th className="px-6 py-4 font-black">UPC</th>
                                                <th className="px-6 py-4 font-black">Nombre</th>
                                                <th className="px-6 py-4 font-black">SKU</th>
                                                <th className="px-6 py-4 font-black text-right min-w-[120px]">Acciones</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-dark-border text-gray-300">
                                            {Object.values(productDB)
                                                .filter(p => {
                                                    if (!p.UPC) return false; // Skip products without barcode
                                                    if (!productSearchTerm) return true;
                                                    const term = productSearchTerm.toLowerCase();
                                                    return p.NOMBRE.toLowerCase().includes(term) || p.UPC.includes(term);
                                                })
                                                .map((prod, idx) => (
                                                <tr key={prod.UPC || `product-${idx}`} className="hover:bg-white/5 transition-colors group">
                                                    <td className="px-6 py-3">
                                                        <div className="w-12 h-12 bg-white rounded flex items-center justify-center border border-gray-700 overflow-hidden mx-auto">
                                                            {prod.IMAGEN && (prod.IMAGEN.startsWith('http') || prod.IMAGEN.startsWith('data:')) ? (
                                                                <img src={prod.IMAGEN} alt={prod.NOMBRE} className="max-w-full max-h-full object-contain" />
                                                            ) : (
                                                                <ImageIcon size={16} className="text-gray-400" />
                                                            )}
                                                        </div>
                                                    </td>
                                                    <td className="px-6 py-4 font-mono text-brand-blue font-bold">{prod.UPC}</td>
                                                    <td className="px-6 py-4 font-bold max-w-xs truncate" title={prod.NOMBRE}>{prod.NOMBRE}</td>
                                                    <td className="px-6 py-4 text-xs tracking-wider opacity-60 font-mono">{prod.SKU || '---'}</td>
                                                    <td className="px-6 py-4 text-right">
                                                        <div className="flex justify-end gap-2 opacity-100 sm:opacity-50 group-hover:opacity-100 transition-opacity">
                                                            <button 
                                                                onClick={() => {
                                                                    setNewProductForm({ UPC: prod.UPC, NOMBRE: prod.NOMBRE, SKU: prod.SKU || '', IMAGEN: prod.IMAGEN || '' });
                                                                    setShowNewProductModal(true);
                                                                }} 
                                                                className="p-2 bg-dark-bg hover:bg-brand-blue/20 text-gray-400 hover:text-brand-blue rounded-lg transition-colors border border-dark-border shadow-sm"
                                                                title="Editar Nombre / Foto"
                                                            >
                                                                <Settings2 size={16} />
                                                            </button>
                                                            <button 
                                                                onClick={async () => {
                                                                    if (confirm(`¿Eliminar definitivamente el producto [${prod.UPC}] de la nube?`)) {
                                                                        try {
                                                                            const res = await fetch(`/api/products?upc=${prod.UPC}`, { method: 'DELETE' });
                                                                            if (res.ok) {
                                                                                showToast("Producto eliminado de la BD", "success");
                                                                                setProductDB(prev => {
                                                                                    const updated = { ...prev };
                                                                                    delete updated[prod.UPC];
                                                                                    return updated;
                                                                                });
                                                                            }
                                                                        } catch (e) {
                                                                            showToast("Error eliminando", "error");
                                                                        }
                                                                    }
                                                                }} 
                                                                className="p-2 bg-dark-bg hover:bg-red-900/40 text-gray-400 hover:text-red-400 rounded-lg transition-colors border border-dark-border shadow-sm"
                                                                title="Eliminar de la BD"
                                                            >
                                                                <Trash2 size={16} />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {/* Espaciado Inferior y Créditos */}
                        <div className="mt-8 pb-12 flex flex-col items-center justify-center opacity-40 hover:opacity-100 transition-opacity flex-shrink-0">
                            <p className="text-[9px] font-black text-gray-500 tracking-[0.3em] uppercase mb-1">INGRESADOS V1.0</p>
                            <p className="text-[10px] font-bold text-gray-400 tracking-widest flex items-center gap-1.5 uppercase">
                                Creado por <span className="text-white bg-black px-2 py-0.5 rounded border border-gray-800">Hacheverso</span>
                            </p>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Left Panel: Inputs (Dark UI Mode) */}
                        <div className="w-full xl:w-[600px] flex flex-col gap-6 flex-shrink-0 animate-in slide-in-from-left-4 duration-300 xl:h-full">

                            {/* Top Split Section: Total (Left) vs Controls (Right) */}
                            <div className="flex gap-4 min-h-[120px] shrink-0">
                                {/* Total Ingresado Blue Card */}
                                <div className="flex-1 bg-blue-600 rounded-3xl p-6 text-white flex justify-between items-end shadow-[0_0_30px_rgba(37,99,235,0.15)] relative overflow-hidden group">
                                    <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full transform translate-x-1/3 -translate-y-1/3 group-hover:bg-white/10 transition-colors"></div>
                                    <div className="flex flex-col relative z-10">
                                        <span className="text-[10px] font-bold uppercase tracking-widest opacity-80 mb-1">Total Ingresado</span>
                                        <span className="text-7xl font-black leading-none drop-shadow-md">{totalUnits}</span>
                                    </div>
                                    <div className="flex flex-col items-end relative z-10">
                                        <span className="text-2xl font-black uppercase tracking-widest leading-none drop-shadow-md">Unidades</span>
                                        <span className="text-[9px] bg-white/20 text-white px-2 py-0.5 rounded-sm uppercase font-bold mt-2 shadow-sm tracking-wider">{currency} Mode</span>
                                    </div>
                                </div>

                                {/* Controls Vertical Stack */}
                                <div className="w-[180px] flex flex-col gap-3">
                                    <button onClick={() => { setMode('UPC_SERIAL'); upcRef.current?.focus(); }} className={`flex-1 flex gap-3 items-center justify-center rounded-2xl border transition-all duration-300 ${mode === 'UPC_SERIAL' ? 'bg-[#151E32] border-brand-blue/30 text-brand-blue shadow-[inset_0_0_20px_rgba(31,78,120,0.2)]' : 'bg-dark-input border-dark-border text-gray-500 hover:text-gray-300'}`}>
                                        <ScanLine size={18} className={mode === 'UPC_SERIAL' ? 'opacity-100' : 'opacity-40'} />
                                        <div className="flex flex-col items-start leading-none text-left">
                                            <span className={`text-xs font-black uppercase tracking-widest ${mode === 'UPC_SERIAL' ? 'text-brand-blue' : 'text-gray-400'}`}>Serializado</span>
                                            <span className="text-[8px] uppercase font-bold tracking-widest opacity-60 mt-1 text-gray-500">UNO A UNO (F1)</span>
                                        </div>
                                    </button>
                                    <button onClick={() => { setMode('MASSIVE'); upcRef.current?.focus(); }} className={`flex-1 flex gap-3 items-center justify-center rounded-2xl border transition-all duration-300 ${mode === 'MASSIVE' ? 'bg-[#151E32] border-brand-blue/30 text-brand-blue shadow-[inset_0_0_20px_rgba(31,78,120,0.2)]' : 'bg-dark-input border-dark-border text-gray-500 hover:text-gray-300'}`}>
                                        <Layers size={18} className={mode === 'MASSIVE' ? 'opacity-100' : 'opacity-40'} />
                                        <div className="flex flex-col items-start leading-none text-left">
                                            <span className={`text-xs font-black uppercase tracking-widest ${mode === 'MASSIVE' ? 'text-brand-blue' : 'text-gray-400'}`}>Masivo</span>
                                            <span className="text-[8px] uppercase font-bold tracking-widest opacity-60 mt-1 text-gray-500">CANTIDAD (F2)</span>
                                        </div>
                                    </button>
                                </div>
                            </div>

                            {/* Big Dark Canvas Box (Ghost Input) */}
                            <div className={`flex-1 bg-dark-input rounded-3xl border border-dark-border p-6 flex flex-col items-center justify-center relative min-h-[300px] transition-all duration-300 group overflow-hidden ${isFlashing && scanStatus === 'success' ? 'ring-2 ring-emerald-500/50 bg-emerald-900/10' : ''} ${isFlashing && scanStatus === 'error' ? 'ring-2 ring-red-500/50 bg-red-900/10' : ''}`}>

                                {/* Tarjeta de Producto Reconocido (Oculta el input visualmente cuando hay match) */}
                                {matchedProduct ? (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none p-6 z-30 bg-dark-input rounded-3xl overflow-y-auto custom-scrollbar">
                                        <div className="flex flex-col items-center gap-4 text-center mt-auto mb-auto animate-in slide-in-from-bottom-4 duration-300 w-full">
                                            {matchedProduct.IMAGEN && (matchedProduct.IMAGEN.startsWith('http') || matchedProduct.IMAGEN.startsWith('data:')) && (
                                                <div className="w-[140px] h-[140px] rounded-2xl overflow-hidden bg-white/5 border border-white/10 shadow-2xl p-4 flex items-center justify-center shrink-0">
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img src={matchedProduct.IMAGEN} alt={matchedProduct.NOMBRE} className="max-w-full max-h-full object-contain" />
                                                </div>
                                            )}
                                            <h2 className="text-2xl md:text-3xl font-black text-white leading-tight uppercase drop-shadow-xl">{matchedProduct.NOMBRE}</h2>
                                            <span className="text-brand-blue font-mono text-lg md:text-xl tracking-widest">{matchedProduct.UPC}</span>
                                            {matchedProduct.SKU && (
                                                <span className="text-gray-500 font-mono text-xs tracking-wider">SKU: {matchedProduct.SKU}</span>
                                            )}
                                        </div>
                                    </div>
                                ) : unknownUpc ? (
                                    <div className="absolute inset-0 flex flex-col items-center justify-center p-6 z-30 bg-dark-input rounded-3xl animate-in slide-in-from-bottom-4 duration-300">
                                        <div className="flex flex-col items-center gap-5 text-center">
                                            <div className="w-20 h-20 rounded-2xl bg-amber-500/10 border-2 border-amber-500/30 flex items-center justify-center animate-pulse">
                                                <AlertTriangle size={40} className="text-amber-500" />
                                            </div>
                                            <h2 className="text-xl md:text-2xl font-black text-amber-400 uppercase tracking-wider">Producto No Encontrado</h2>
                                            <span className="text-white font-mono text-2xl md:text-3xl tracking-widest font-black">{unknownUpc}</span>
                                            <p className="text-gray-500 text-xs font-bold uppercase tracking-widest">¿Deseas crear este producto?</p>
                                            <div className="flex gap-3 pointer-events-auto">
                                                <button
                                                    onClick={() => {
                                                        setNewProductForm({ UPC: unknownUpc, NOMBRE: '', SKU: '', IMAGEN: '' });
                                                        setShowNewProductModal(true);
                                                        setUnknownUpc(null);
                                                        setTimeout(() => modalNameRef.current?.focus(), 100);
                                                    }}
                                                    className="px-8 py-3 bg-amber-500 hover:bg-amber-400 text-black font-black text-sm uppercase tracking-widest rounded-xl transition-all shadow-lg shadow-amber-500/20 hover:shadow-amber-500/40 hover:scale-105"
                                                >
                                                    <PlusCircle size={16} className="inline mr-2" />
                                                    Crear Producto
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        setUnknownUpc(null);
                                                        setUpc("");
                                                        upcRef.current?.focus();
                                                    }}
                                                    className="px-6 py-3 bg-dark-input hover:bg-gray-800 text-gray-400 hover:text-white font-black text-sm uppercase tracking-widest rounded-xl border border-dark-border hover:border-gray-600 transition-all"
                                                >
                                                    Ignorar
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                ) : null}



                                {/* Input Real y Visible */}
                                <div className="w-full flex items-center justify-center z-20">
                                    <input
                                        ref={upcRef}
                                        type="text"
                                        value={upc}
                                        onChange={(e) => { setUpc(e.target.value); setMatchedProduct(null); setUnknownUpc(null); }}
                                        onKeyDown={(e) => handleKeyDown(e, 'upc')}

                                        className="w-full bg-transparent outline-none text-center text-4xl md:text-5xl font-black tracking-widest uppercase text-gray-200 placeholder-[#1d1f27]"
                                        placeholder="ESPERANDO UPC..."
                                        autoFocus
                                    />
                                </div>

                                {/* Bottom Label Absoluto */}
                                <span className="absolute bottom-8 text-gray-600 font-bold tracking-[0.2em] uppercase text-[10px]">Paso 1: Identificar Producto</span>

                                {/* Candado Fijo Esquina Derecha */}
                                <button
                                    onClick={(e) => { e.stopPropagation(); setKeepUpc(!keepUpc); }}
                                    className={`absolute top-6 right-6 p-3 rounded-xl transition-all flex items-center justify-center z-30 ${keepUpc ? 'bg-brand-blue text-white shadow-lg' : 'bg-black/20 text-gray-500 hover:text-gray-300'}`}
                                    title="Fijar este UPC para múltiples escaneos continuos"
                                >
                                    {keepUpc ? <Lock size={16} /> : <Unlock size={16} />}
                                </button>

                                {/* Botón Borrar (ESC) Esquina Izquierda */}
                                {upc && (
                                    <button
                                        onClick={(e) => { e.stopPropagation(); setUpc(""); setMatchedProduct(null); setKeepUpc(false); upcRef.current?.focus(); }}
                                        className="absolute top-6 left-6 p-3 rounded-xl transition-all flex items-center justify-center z-30 bg-black/20 text-gray-500 hover:text-red-400 hover:bg-black/40"
                                        title="Borrar UPC (ESC)"
                                    >
                                        <X size={16} />
                                    </button>
                                )}
                            </div>

                            {/* Inputs Flotantes/Ocultos para Serial y QTY (Aparecen si Masivo o Serializado lo requiere) */}
                            <div className="flex gap-4 shrink-0 pb-6 lg:pb-0">
                                {mode === 'UPC_SERIAL' && (
                                    <div className="flex-1">
                                        <input ref={serialRef} type="text" value={serial} onChange={(e) => setSerial(e.target.value)} onKeyDown={(e) => handleKeyDown(e, 'serial')} className="w-full bg-dark-input border border-dark-border rounded-2xl px-5 py-4 outline-none focus:ring-1 focus:ring-brand-blue focus:border-brand-blue transition-all font-mono text-xl tracking-widest text-brand-blue placeholder-gray-600 text-center uppercase" placeholder="ESCANEAR SERIAL AQUÍ" />
                                    </div>
                                )}
                                {mode === 'MASSIVE' && (
                                    <div className="flex-1 flex gap-4">
                                        <input ref={qtyRef} type="number" value={qty} onChange={(e) => setQty(e.target.value)} onWheel={(e) => e.currentTarget.blur()} onKeyDown={(e) => handleKeyDown(e, 'qty')} min="1" className="w-[120px] bg-dark-input border border-dark-border rounded-2xl px-5 py-4 outline-none focus:ring-1 focus:ring-brand-blue transition-all font-sans text-2xl font-black text-center text-white placeholder-gray-600" placeholder="1" />
                                        <button onClick={addRecord} className="flex-1 bg-brand-blue hover:bg-blue-600 text-white font-bold py-4 px-4 rounded-2xl transition-all text-sm uppercase tracking-widest shadow-lg shadow-brand-blue/20 flex items-center justify-center gap-2">
                                            <PackageCheck size={20} /> Ingresar
                                        </button>
                                    </div>
                                )}
                            </div>

                        </div>

                        {/* Right Panel: Historial Reciente (Dark Terminal Grid) */}
                        <div className="flex-1 flex flex-col bg-[#0F1014] border border-dark-border rounded-3xl relative overflow-hidden h-[600px] lg:h-full lg:max-h-[calc(100vh-120px)] min-h-0 shrink-0">

                            {/* Header (Top) */}
                            <div className="flex justify-between items-center px-8 py-6 border-b border-dark-border bg-[#0A0A0B]/50 shrink-0">
                                <h2 className="text-white font-black tracking-[0.2em] text-sm flex items-center gap-3">
                                    <History size={18} className="text-gray-500" /> HISTORIAL RECIENTE
                                </h2>
                                <div className="flex items-center gap-2">
                                    {records.length > 0 && (
                                        <button onClick={saveCurrentSessionToHistory} className="flex items-center gap-2 text-white hover:text-white transition-all px-5 py-2 bg-brand-blue hover:bg-blue-500 rounded-xl text-[10px] font-bold uppercase tracking-widest shadow-[0_0_20px_rgba(37,99,235,0.3)] hover:shadow-[0_0_30px_rgba(37,99,235,0.5)] active:scale-95">
                                            <Save size={14} /> Guardar
                                        </button>
                                    )}
                                    <button onClick={() => setDeleteConfirm({ id: 'all', type: 'session' })} className="flex items-center gap-2 text-gray-500 hover:text-red-400 transition-all px-4 py-2 bg-dark-input rounded-xl hover:bg-red-500/10 border border-dark-border hover:border-red-500/30 text-[10px] font-bold uppercase tracking-widest">
                                        <Trash2 size={14} /> Vaciar Todo
                                    </button>
                                </div>
                            </div>

                            {/* Dynamic List */}
                            <div className="flex-1 overflow-y-auto min-h-0 p-4 md:p-6 space-y-4 pb-8 custom-scrollbar">
                                {groupedRecords.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center opacity-40">
                                        <Box size={48} className="text-gray-600 mb-4" />
                                        <span className="font-bold tracking-widest uppercase text-sm text-gray-500">Sesión Vacía</span>
                                    </div>
                                ) : (
                                    groupedRecords.map((group, groupIndex) => (
                                        <div key={`${group.UPC}-${groupIndex}`} className={`bg-transparent border rounded-2xl p-5 md:p-6 flex flex-col relative overflow-hidden transition-all duration-300 ${groupIndex === 0 ? 'border-brand-blue/30 bg-brand-blue/5' : 'border-[#18181A] opacity-70 hover:opacity-100'}`}>

                                            {/* Borde luminiscente izquierdo (Solo en el producto activo/más reciente) */}
                                            {groupIndex === 0 && (
                                                <div className="absolute left-0 top-0 bottom-0 w-1 bg-brand-blue shadow-[0_0_15px_rgba(37,99,235,1)]"></div>
                                            )}

                                            {/* Titulo y Badge con Imagen */}
                                            <div className="flex gap-4 items-start mb-5 pl-2 relative">
                                                {/* Contenedor de Imagen */}
                                                <div className="w-[90px] h-[90px] flex-shrink-0 bg-white rounded-xl border-2 border-[#18181A] overflow-hidden flex items-center justify-center p-2 relative z-10 shadow-lg">
                                                    {group.Records[0]?.Imagen ? (
                                                        <img src={group.Records[0].Imagen} alt="Product" className="w-full h-full object-contain" />
                                                    ) : (
                                                        <ImageIcon className="text-gray-300 w-10 h-10 opacity-50" />
                                                    )}
                                                </div>

                                                <div className="flex flex-col pr-4 flex-1">
                                                    <h3 className="text-white font-black text-sm md:text-base uppercase tracking-widest leading-tight">{group.Nombre}</h3>
                                                    <span className="text-gray-500 font-bold text-[10px] tracking-widest uppercase mt-1 flex gap-2">
                                                        <span>{group.UPC}</span>
                                                        <span className="opacity-50">#{groupedRecords.length - groupIndex}</span>
                                                    </span>

                                                    {/* Costo Maestro Retroactivo */}
                                                    <div className="mt-3 flex flex-col gap-1.5">
                                                        <div className="flex items-center gap-2">
                                                            <div className="bg-[#0A0A0B] border border-[#18181A] px-3 py-1.5 rounded-lg flex items-center gap-2">
                                                                <DollarSign size={16} className="text-gray-500" />
                                                                <input
                                                                    type="number"
                                                                    placeholder="0"
                                                                    data-cost-index={groupIndex}
                                                                    className="bg-transparent text-emerald-500 font-mono font-black outline-none w-[120px] text-base md:text-lg [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                                    value={group.Records[0]?.CostoUnitario === 0 && !group.Records[0].CostoTotalCOP ? "" : group.Records[0]?.CostoUnitario}
                                                                    onChange={(e) => handleUpdateUpcCost(group.UPC, e.target.value)}
                                                                    onWheel={(e) => e.currentTarget.blur()}
                                                                    onKeyDown={(e) => {
                                                                        if (e.key === 'Enter') {
                                                                            e.preventDefault();
                                                                            const next = document.querySelector(`[data-cost-index="${groupIndex + 1}"]`) as HTMLInputElement;
                                                                            if (next) next.focus();
                                                                            else (e.target as HTMLInputElement).blur();
                                                                        }
                                                                    }}
                                                                />
                                                            </div>
                                                            <span className="text-[10px] uppercase font-bold tracking-widest text-gray-600 border border-gray-800 px-3 py-1.5 rounded">Costo Unit / {group.Records[0]?.Moneda || 'COP'}</span>
                                                        </div>

                                                            {/* UI Inteligencia de Precios — Último Ingreso Histórico */}
                                                        <div className="flex items-center gap-3 pl-1 flex-wrap">
                                                            {/* Equivalencia Directa a COP */}
                                                            {(group.Records[0]?.Moneda === 'USD' && group.Records[0]?.CostoUnitario > 0) && (
                                                                <span className="text-[10px] font-mono text-gray-500 font-medium">
                                                                    ≈ {formatMoney((group.Records[0].CostoUnitario * (parseFloat(exchangeRate) || 1)), 'COP')}
                                                                </span>
                                                            )}

                                                            {/* Último Costo Histórico en USD — Siempre visible */}
                                                            {(() => {
                                                                const currentInputCost = Number(group.Records[0]?.CostoUnitario) || 0;
                                                                const lastSavedCost = productDB[group.UPC]?.LastCost || 0;

                                                                // No hay historial: primer ingreso
                                                                if (lastSavedCost === 0) {
                                                                    return (
                                                                        <span className="text-[10px] font-bold tracking-widest uppercase flex items-center gap-1.5 text-gray-500 bg-gray-900/50 px-3 py-1 rounded-lg border border-gray-800">
                                                                            ✦ Primer ingreso
                                                                        </span>
                                                                    );
                                                                }

                                                                // Hay historial pero no se ha ingresado costo aún
                                                                if (currentInputCost === 0) {
                                                                    return (
                                                                        <span className="text-[10px] font-bold tracking-widest uppercase flex items-center gap-1.5 text-amber-400 bg-amber-950/30 px-3 py-1 rounded-lg border border-amber-900/50">
                                                                            Último: USD ${lastSavedCost}
                                                                        </span>
                                                                    );
                                                                }

                                                                const diff = currentInputCost - lastSavedCost;
                                                                const pctChange = (diff / lastSavedCost) * 100;

                                                                if (diff > 0) {
                                                                    return (
                                                                        <span className="text-[10px] font-bold tracking-widest uppercase flex items-center gap-1.5 text-red-400 bg-red-950/30 px-3 py-1 rounded-lg border border-red-900/50">
                                                                            Último: USD ${lastSavedCost} <ArrowUpRight size={12} strokeWidth={3} /> +{pctChange.toFixed(0)}%
                                                                        </span>
                                                                    );
                                                                } else if (diff < 0) {
                                                                    return (
                                                                        <span className="text-[10px] font-bold tracking-widest uppercase flex items-center gap-1.5 text-emerald-400 bg-emerald-950/30 px-3 py-1 rounded-lg border border-emerald-900/50">
                                                                            Último: USD ${lastSavedCost} <ArrowDownRight size={12} strokeWidth={3} /> {pctChange.toFixed(0)}%
                                                                        </span>
                                                                    );
                                                                } else {
                                                                    return (
                                                                        <span className="text-[10px] font-bold tracking-widest uppercase flex items-center gap-1.5 text-gray-400 bg-gray-900/50 px-3 py-1 rounded-lg border border-gray-800">
                                                                            Último: USD ${lastSavedCost} — Igual
                                                                        </span>
                                                                    );
                                                                }
                                                            })()}
                                                        </div>
                                                    </div>

                                                </div>

                                                {/* Total Units Badge Neon */}
                                                <div className={`rounded-2xl px-5 py-3 flex flex-col items-center justify-center flex-shrink-0 ${groupIndex === 0 ? 'bg-brand-blue shadow-[0_0_25px_rgba(37,99,235,0.4)]' : 'bg-dark-input border border-dark-border'}`}>
                                                    <span className={`font-black text-2xl leading-none ${groupIndex === 0 ? 'text-white' : 'text-gray-300'}`}>{group.TotalUnidades}</span>
                                                    <span className={`font-bold text-[9px] uppercase tracking-widest mt-1 ${groupIndex === 0 ? 'text-white/80' : 'text-gray-600'}`}>UND</span>
                                                </div>
                                            </div>

                                            <div className="flex flex-wrap gap-2 pl-2 mt-2 items-end">
                                                {group.Records.map((r, itemIndex) => {
                                                    const isMostRecentScanned = groupIndex === 0 && itemIndex === group.Records.length - 1;
                                                    return (
                                                        <div key={r.ID} className={`group/tag flex items-center rounded-xl border transition-all duration-300 max-w-full ${
                                                            isMostRecentScanned
                                                                ? 'bg-brand-blue text-white shadow-[0_0_30px_rgba(37,99,235,0.5)] border-transparent scale-[1.05] animate-pulse gap-4 px-6 py-4'
                                                                : 'bg-[#0A0A0B] border-dark-border text-gray-400 hover:border-gray-700 hover:text-gray-200 gap-3 px-4 py-2.5'
                                                        }`}>
                                                            <span className={`font-mono font-black tracking-widest uppercase break-all truncate ${
                                                                isMostRecentScanned ? 'text-xl md:text-2xl' : 'text-xs'
                                                            }`}>
                                                                {r.Serial || `MASIVO x${r.Cantidad}`}
                                                            </span>
                                                            <button onClick={(e) => handleDeleteRecord(r.ID, e)} className={`flex-shrink-0 transition-opacity ${isMostRecentScanned ? 'opacity-100 text-white/70 hover:text-white' : 'opacity-0 group-hover/tag:opacity-100 hover:text-red-400'}`}>
                                                                <X size={isMostRecentScanned ? 18 : 14} strokeWidth={3} />
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>

                        </div>
                    </>
                )}
            </main>
        </div>
    );
}
