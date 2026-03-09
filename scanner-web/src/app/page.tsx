"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Trash2, Download, AlertTriangle, CheckCircle, ScanLine, Settings2, PackageCheck, Eraser, Database, UploadCloud, Image as ImageIcon, PlusCircle, X, DollarSign, Calculator, Layers, ChevronDown, ChevronRight, Hash, AlignLeft, Tags, History, FolderOpen, Lock, Unlock, ArrowLeft, Box, Volume2, VolumeX, Save, ArrowUpRight, ArrowDownRight, FileDown } from 'lucide-react';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { v4 as uuidv4 } from 'uuid';

type ScanMode = 'UPC_SERIAL' | 'MASSIVE';
type Currency = 'COP' | 'USD';
type AppView = 'SCANNER' | 'HISTORY'; // Nueva capa de navegación

interface HistorySession {
    id: string; // Timestamp
    fecha: string;
    lote: string;
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

    // Finanzas Globales de Sesión
    const [currency, setCurrency] = useState<Currency>('COP');
    const [exchangeRate, setExchangeRate] = useState<string>("4000"); // TRM base

    // History and Navigation State
    const [savedSessions, setSavedSessions] = useState<HistorySession[]>([]);

    // Product Database State
    const [productDB, setProductDB] = useState<Record<string, Product>>({});
    const [matchedProduct, setMatchedProduct] = useState<Product | null>(null);
    const [showNewProductModal, setShowNewProductModal] = useState(false);
    const [newProductForm, setNewProductForm] = useState({ UPC: '', NOMBRE: '', SKU: '', IMAGEN: '' });

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

        // Cargar Base de Datos de Productos
        const savedDB = localStorage.getItem('scanner_product_db');
        if (savedDB) {
            try {
                const parsedDB = JSON.parse(savedDB);
                if (parsedDB && Object.keys(parsedDB).length > 0) {
                    setProductDB(parsedDB);
                }
            } catch (e) {
                console.error("Error cargando DB de productos", e);
            }
        }

        // Cargar Historial de Sesiones Pasadas
        const savedHistory = localStorage.getItem('scanner_history_sessions');
        if (savedHistory) {
            try {
                const parsedHistory = JSON.parse(savedHistory);
                if (Array.isArray(parsedHistory)) setSavedSessions(parsedHistory);
            } catch (e) {
                console.error("Error cargando el historial de sesiones", e);
            }
        }

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

    const triggerFeedback = (status: 'success' | 'error') => {
        setScanStatus(status);
        setIsFlashing(true);
        setTimeout(() => {
            setIsFlashing(false);
            setScanStatus('idle');
        }, 200);
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
                        newDB[_upc] = { UPC: _upc, NOMBRE: _nombre, SKU: _sku, IMAGEN: _imagen };
                        addedCount++;
                    }
                });

                if (addedCount > 0) {
                    setProductDB(newDB);
                    if (matchedProduct && newDB[matchedProduct.UPC]) {
                        setMatchedProduct(newDB[matchedProduct.UPC]);
                    }

                    const imagesCount = Object.values(newDB).filter(p => p.IMAGEN && p.IMAGEN.trim() !== '').length;
                    if (imagesCount === 0) {
                        const headers = results.data[0] ? Object.keys(results.data[0]).join(', ') : 'Ninguna';
                        showToast(`⚠️ Productos cargados pero SIN FOTOS. Excel exportó las columnas: [ ${headers} ]. ¿Pusiste imágenes reales en vez de texto URL?`, 'error');
                    } else {
                        showToast(`📦 Base de Datos actualizada: ${addedCount} productos cargados (${imagesCount} con foto).`, 'success');
                    }
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
            speakProduct(productDB[upcVal].NOMBRE);

            // Expand latest group automatically and close others briefly for focus
            setExpandedGroups((prev) => ({ ...prev, [upcVal]: true }));

            if (mode === 'UPC_SERIAL') serialRef.current?.focus();
            else qtyRef.current?.focus();
        } else {
            setNewProductForm({ UPC: upcVal, NOMBRE: '', SKU: '', IMAGEN: '' });
            setShowNewProductModal(true);
            setTimeout(() => modalNameRef.current?.focus(), 100);
        }
    };

    const handleSaveNewProduct = () => {
        const { UPC, NOMBRE, SKU, IMAGEN } = newProductForm;
        if (!NOMBRE.trim()) {
            showToast("El nombre del producto es obligatorio.", 'error');
            return;
        }

        const newProd: Product = { UPC, NOMBRE, SKU, IMAGEN, LastCost: 0 };
        setProductDB(prev => ({ ...prev, [UPC]: newProd }));
        setMatchedProduct(newProd);
        speakProduct(newProd.NOMBRE);
        setShowNewProductModal(false);
        showToast("Producto creado al instante.", 'success');

        // Auto-expand the newly created group
        setExpandedGroups((prev) => ({ ...prev, [newProd.UPC]: true }));

        if (mode === 'UPC_SERIAL') serialRef.current?.focus();
        else qtyRef.current?.focus();
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
            if (records.some(r => r.Serial === serialVal)) {
                showToast(`Error: El serial ya fue ingresado: ${serialVal}`, 'error');
                triggerFeedback('error');
                // Optional: play an error sound via JS audio if requested
                const audio = new Audio('data:audio/mp3;base64,//OwgxAAAAAAAAAAAAAABJbmZvAAAADwAAAAEAAABaABgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBgYGBg');
                audio.volume = 0.5;
                audio.play().catch(() => { });

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

        const newRecord: InventoryRecord = {
            FechaHora: formattedDate,
            Lote: currentBatch,
            Proveedor: activeProvider,
            Tipo: finalTipo,
            UPC: upcVal,
            Nombre: matchedProduct?.NOMBRE || 'N/A',
            SKU: matchedProduct?.SKU || 'N/A',
            Serial: mode === 'UPC_SERIAL' ? serialVal : "",
            Cantidad: parsedQty,
            Nota: note.trim(),
            ID: uuidv4().substring(0, 8),
            Moneda: currency,
            CostoUnitario: parsedCost,
            TasaCambio: currency === 'USD' ? parsedExRate : 1,
            CostoTotalCOP: finalCostoTotalCOP
        };

        if (proveedor.trim() && !listaProveedores.includes(proveedor.trim())) {
            setListaProveedores(prev => [...prev, proveedor.trim()]);
        }

        setRecords((prev) => [newRecord, ...prev]);
        showToast(`Agregado: UPC ${upcVal} (${parsedQty} uds)`, 'success');
        triggerFeedback('success');
        clearFields();
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, field: string) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            if (field === 'upc') processUpcScan();
            // Automatización Fase 8: Si escanea el serial, guarda inmediatamente y vuelve al UPC sin preguntar.
            else if (field === 'serial' && serial.trim()) addRecord();
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
            clearFields();
            showToast("Sesión vaciada", 'success');
        }
        setDeleteConfirm({ id: null, type: 'record' });
    };

    const exportToExcel = (recordsToExport: InventoryRecord[], loteName: string, showEmptySessionPrompt: boolean = true) => {
        if (recordsToExport.length === 0) return alert("No hay registros para exportar.");

        const dataToExport = recordsToExport.map(r => ({
            FechaHora: r.FechaHora,
            Lote: r.Lote,
            Proveedor: r.Proveedor,
            Tipo: r.Tipo,
            UPC: r.UPC,
            Nombre: r.Nombre,
            SKU: r.SKU,
            Serial: r.Serial,
            Cantidad: r.Cantidad,
            MonedaBase: r.Moneda,
            CostoUnitario: r.CostoUnitario,
            TasaCambioTRM: r.Moneda === 'USD' ? r.TasaCambio : '',
            Costo_Total_COP: r.CostoTotalCOP,
            Nota: r.Nota,
            ID: r.ID
        })).sort((a, b) => {
            // Ordenar alfabéticamente por Nombre del Producto
            if (a.Nombre < b.Nombre) return -1;
            if (a.Nombre > b.Nombre) return 1;

            // Si el nombre es igual, asegurar que los antiguos/nuevos escaneos caigan en orden
            return a.FechaHora.localeCompare(b.FechaHora);
        });

        const worksheet = XLSX.utils.json_to_sheet(dataToExport);

        const colWidths = [
            { wch: 20 }, // FechaHora
            { wch: 25 }, // Lote
            { wch: 25 }, // Proveedor
            { wch: 10 }, // Tipo
            { wch: 20 }, // UPC
            { wch: 40 }, // Nombre
            { wch: 15 }, // SKU
            { wch: 30 }, // Serial
            { wch: 10 }, // Cantidad
            { wch: 12 }, // Moneda
            { wch: 15 }, // Costo Unitario
            { wch: 15 }, // TRM
            { wch: 20 }, // Costo Total COP
            { wch: 30 }, // Nota
            { wch: 15 }, // ID
        ];
        worksheet['!cols'] = colWidths;

        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Ingresos");

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

    const saveCurrentSessionToHistory = () => {
        if (records.length === 0) return;

        // Calcular los totales de la sesión actual
        const currentTotalUnidades = records.reduce((acc, curr) => acc + curr.Cantidad, 0);
        const currentCostoTotalCOP = records.reduce((acc, curr) => acc + curr.CostoTotalCOP, 0);

        const newSession: HistorySession = {
            id: Date.now().toString(),
            fecha: new Date().toLocaleString('es-CO'),
            lote: batchName || `Ingreso ${new Date().toISOString().split('T')[0]}`,
            totalRecords: records.length,
            totalUnidades: currentTotalUnidades,
            costoTotalCOP: currentCostoTotalCOP,
            monedaBase: currency,
            records: [...records]
        };

        setSavedSessions([newSession, ...savedSessions]);
        setRecords([]); // Vaciamos la sesión activa
        showToast("Sesión Guardada en el Historial", "success");
    };

    const loadSessionForEditing = (session: HistorySession) => {
        if (records.length > 0) {
            if (!confirm("Tienes una sesión activa en progreso. Si abres otra, esta sesión será reemplazada temporalmente y pausada. ¿Continuar?")) return;
        }

        setRecords(session.records);
        setBatchName(session.lote);
        setCurrency(session.monedaBase);
        setView('SCANNER');

        // Remove the session from history since we are actively editing it again (it will be saved as new when finished)
        setSavedSessions(prev => prev.filter(s => s.id !== session.id));
        showToast(`Sesión reabierta: ${session.lote}`, "info");
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

        // Iteramos los records de manera inversa para mantener el orden cronológico descendente general
        [...records].forEach(record => {
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
                    IsExpanded: !!expandedGroups[groupKey]
                };
            }
            groupsMap[groupKey].Records.unshift(record); // Ponemos el último escaneado de ese grupo de primero
            groupsMap[groupKey].TotalUnidades += Number(record.Cantidad) || 0;
            groupsMap[groupKey].CostoAcumuladoCOP += Number(record.CostoTotalCOP) || 0;
        });

        // Convertimos el map a un Array y lo ordenamos basado en el último registro agregado (Last in First Out)
        return Object.values(groupsMap).sort((a, b) => {
            const timeA = new Date(a.Records[0].FechaHora.replace(' ', 'T')).getTime();
            const timeB = new Date(b.Records[0].FechaHora.replace(' ', 'T')).getTime();
            return timeB - timeA;
        });
    }, [records, expandedGroups, productDB]);


    const inputClass = "w-full bg-gray-50/50 dark:bg-dark-input border border-gray-200 dark:border-dark-border rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-brand-blue focus:bg-white dark:focus:bg-dark-bg transition-all dark:text-gray-100 placeholder-gray-400 font-medium";
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
                    <div className="bg-white dark:bg-dark-card border border-gray-200 dark:border-dark-border rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
                        <div className="px-6 py-4 border-b border-gray-100 dark:border-dark-border flex justify-between items-center bg-brand-blue text-white">
                            <div className="flex items-center gap-2"><AlertTriangle size={20} className="text-yellow-400" /><h3 className="font-bold text-lg tracking-wide">UPC No Registrado</h3></div>
                            <button onClick={() => { setShowNewProductModal(false); upcRef.current?.select(); }} className="text-white/60 hover:text-white transition-colors"><X size={24} /></button>
                        </div>
                        <div className="p-6 flex flex-col gap-4">
                            <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">Ingresa los datos para que el sistema aprenda este código.</p>
                            <div><label className={labelClass}>UPC</label><input type="text" value={newProductForm.UPC} disabled className={`${inputClass} bg-gray-100 dark:bg-dark-bg cursor-not-allowed`} /></div>
                            <div><label className={labelClass}>Nombre del Producto *</label><input ref={modalNameRef} type="text" value={newProductForm.NOMBRE} onChange={e => setNewProductForm({ ...newProductForm, NOMBRE: e.target.value })} onKeyDown={e => handleKeyDown(e, 'modal_submit')} className={inputClass} placeholder="Descripción exacta..." /></div>
                            <div className="grid grid-cols-2 gap-4">
                                <div><label className={labelClass}>Referencia / SKU</label><input type="text" value={newProductForm.SKU} onChange={e => setNewProductForm({ ...newProductForm, SKU: e.target.value })} onKeyDown={e => handleKeyDown(e, 'modal_submit')} className={inputClass} placeholder="Opcional..." /></div>
                                <div><label className={labelClass}>URL de Imagen</label><input type="text" value={newProductForm.IMAGEN} onChange={e => setNewProductForm({ ...newProductForm, IMAGEN: e.target.value })} onKeyDown={e => handleKeyDown(e, 'modal_submit')} className={inputClass} placeholder="https://..." /></div>
                            </div>
                        </div>
                        <div className="p-4 bg-gray-50 dark:bg-dark-input flex justify-end gap-3 border-t dark:border-dark-border"><button onClick={() => { setShowNewProductModal(false); upcRef.current?.select(); }} className="px-5 py-2 font-bold text-gray-600 dark:text-gray-400">Cancelar</button><button onClick={handleSaveNewProduct} className="flex gap-2 px-6 py-2 bg-brand-green text-white font-bold rounded-lg"><PlusCircle size={18} /> Guardar</button></div>
                    </div>
                </div>
            )}

            {/* Header Global (Dark Terminal UI) - Single Row Layout */}
            <header className="bg-dark-bg px-6 lg:px-8 py-5 mt-6 flex items-center justify-between z-10 transition-colors duration-300 gap-6 overflow-x-auto custom-scrollbar">
                {/* Zona Izquierda: Identidad */}
                <div className="flex items-center gap-4 cursor-pointer min-w-max" onClick={() => setView('SCANNER')}>
                    <div className="flex items-center gap-3">
                        <Box size={28} className="text-brand-blue" />
                        <div className="flex flex-col">
                            <h1 className="text-xl font-black tracking-widest text-white uppercase leading-none">INGRESO DE MERCANCÍA INTELIGENTE</h1>
                            <div className="flex items-center gap-4 mt-1">
                                <span className="text-[10px] font-bold tracking-widest uppercase text-gray-400">CREADO POR HACHEVERSO</span>
                                <span className="text-[10px] font-bold tracking-widest uppercase text-gray-500">Bodega Activa</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Zona Central: Contexto del Lote */}
                <div className="flex items-center gap-3 flex-1 justify-center min-w-max">
                    {/* Batch Name Pill */}
                    <div className="flex items-center bg-dark-input px-4 py-2 rounded-xl border border-dark-border">
                        <input type="text" value={batchName} onChange={(e) => setBatchName(e.target.value)} className="bg-transparent text-xs font-bold text-gray-300 outline-none w-[140px] md:w-[150px]" placeholder="Nombre del Lote..." />
                        <ChevronDown size={14} className="text-gray-500 ml-1" />
                    </div>

                    {/* Provider Pill (Auto-feeding Datalist) */}
                    <div className="flex items-center bg-dark-input px-4 py-2 rounded-xl border border-dark-border">
                        <input
                            list="proveedores-list"
                            type="text"
                            value={proveedor}
                            onChange={(e) => setProveedor(e.target.value)}
                            className="bg-transparent text-xs font-bold text-gray-300 outline-none w-[150px] md:w-[160px]"
                            placeholder="Proveedor o Cliente..."
                        />
                        <datalist id="proveedores-list">
                            {listaProveedores.map((prov, i) => <option key={i} value={prov} />)}
                        </datalist>
                        <ChevronDown size={14} className="text-gray-500 ml-1" />
                    </div>
                </div>

                {/* Zona Derecha: Finanzas y Herramientas Secundarias */}
                <div className="flex items-center justify-end gap-3 min-w-max z-20 relative">
                    {/* Bloque Financiero Unificado (Moneda + TRM) */}
                    <div className="flex items-center gap-1.5 bg-dark-input p-1 rounded-xl border border-dark-border">
                        <div className="flex items-center">
                            <button onClick={() => setCurrency('USD')} className={`px-3 py-1.5 text-[10px] md:text-xs font-bold rounded-lg transition-colors ${currency === 'USD' ? 'bg-[#1b5e20] text-emerald-400' : 'text-gray-500 hover:text-gray-300'}`}>USD</button>
                            <button onClick={() => setCurrency('COP')} className={`px-3 py-1.5 text-[10px] md:text-xs font-bold rounded-lg transition-colors ${currency === 'COP' ? 'bg-brand-blue text-white' : 'text-gray-500 hover:text-gray-300'}`}>COP</button>
                        </div>
                        <div className={`flex items-center transition-opacity duration-300 ${currency === 'USD' ? 'opacity-100' : 'opacity-30 pointer-events-none'}`}>
                            <input type="number" value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)} onFocus={(e) => e.target.select()} disabled={currency === 'COP'} className="bg-black/20 px-2 py-1.5 rounded-lg text-xs font-bold text-gray-300 outline-none w-[60px] text-center" placeholder="TRM" />
                        </div>
                    </div>

                    {/* Herramientas Secundarias (Iconos) */}
                    <div className="flex items-center gap-2">
                        <button onClick={() => fileInputRef.current?.click()} className="p-2.5 bg-dark-input hover:bg-[#151E32] text-gray-400 hover:text-brand-blue rounded-xl border border-dark-border hover:border-brand-blue/30 transition-all font-bold" title="Importar Base de Datos">
                            <UploadCloud size={16} />
                        </button>
                        <button onClick={() => setView(view === 'SCANNER' ? 'HISTORY' : 'SCANNER')} className="p-2.5 bg-dark-input hover:bg-[#151E32] text-brand-blue rounded-xl border border-brand-blue/30 transition-all font-bold" title={view === 'SCANNER' ? 'Ver Historial' : 'Volver al Escáner'}>
                            {view === 'SCANNER' ? <History size={16} /> : <ScanLine size={16} />}
                        </button>
                    </div>

                    {/* Controles de Audio */}
                    <div className="flex items-center gap-2">
                        <button onClick={() => setSpeechRate(prev => prev === 1.0 ? 1.5 : prev === 1.5 ? 2.0 : 1.0)} className={`w-[36px] h-[36px] border rounded-xl transition-colors bg-[#151E32] border-brand-blue/30 text-brand-blue hover:bg-brand-blue/20 flex items-center justify-center font-bold text-xs`} title="Velocidad de Voz">
                            {speechRate}x
                        </button>
                        <button onClick={() => setIsAudioEnabled(!isAudioEnabled)} className={`w-[36px] h-[36px] border rounded-xl transition-colors flex items-center justify-center ${isAudioEnabled ? 'bg-[#151E32] border-brand-blue/30 text-brand-blue hover:bg-brand-blue/20' : 'bg-dark-input border-dark-border text-gray-500 hover:text-gray-400'}`} title={isAudioEnabled ? "Silenciar Asistente" : "Activar Asistente"}>
                            {isAudioEnabled ? <Volume2 size={16} /> : <VolumeX size={16} />}
                        </button>
                    </div>
                </div>
            </header>

            {/* Container Principal Condicionado a la Vista */}
            <main className="flex-1 flex flex-col lg:flex-row gap-6 p-6 lg:p-8 min-h-0 container mx-auto max-w-[1600px] overflow-hidden">

                {view === 'HISTORY' ? (
                    <div className="flex-1 flex flex-col gap-6 w-full animate-in fade-in duration-300 overflow-y-auto pr-2 custom-scrollbar">
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
                                                <p className="text-gray-500 text-xs font-mono">{session.fecha}</p>
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
                                                    {formatMoney(session.monedaBase === 'COP' ? session.costoTotalCOP : (session.costoTotalCOP / parseFloat(exchangeRate)), session.monedaBase)}
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
                                                onClick={() => exportToExcel(session.records, session.lote, false)}
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
                    </div>
                ) : (
                    <>
                        {/* Left Panel: Inputs (Dark UI Mode) */}
                        <div className="w-full xl:w-[600px] flex flex-col gap-6 flex-shrink-0 animate-in slide-in-from-left-4 duration-300">

                            {/* Top Split Section: Total (Left) vs Controls (Right) */}
                            <div className="flex gap-4 h-[120px]">
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
                            <div className={`flex-1 bg-dark-input rounded-3xl border border-dark-border p-6 flex flex-col items-center justify-center relative min-h-[450px] transition-all duration-300 group overflow-hidden ${isFlashing && scanStatus === 'success' ? 'ring-2 ring-emerald-500/50 bg-emerald-900/10' : ''} ${isFlashing && scanStatus === 'error' ? 'ring-2 ring-red-500/50 bg-red-900/10' : ''}`}>

                                {/* Tarjeta de Producto Reconocido (Oculta el input visualmente cuando hay match) */}
                                {matchedProduct ? (
                                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none p-6 z-30 bg-dark-input rounded-3xl">
                                        <div className="flex flex-col items-center gap-4 text-center translate-y-[-10px] animate-in slide-in-from-bottom-4 duration-300">
                                            {matchedProduct.IMAGEN && (
                                                <div className="w-[180px] h-[180px] rounded-2xl overflow-hidden bg-white/5 border border-white/10 shadow-2xl p-4 flex items-center justify-center">
                                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                                    <img src={matchedProduct.IMAGEN} alt={matchedProduct.NOMBRE} className="max-w-full max-h-full object-contain" />
                                                </div>
                                            )}
                                            <h2 className="text-3xl md:text-4xl font-black text-white leading-tight uppercase drop-shadow-xl">{matchedProduct.NOMBRE}</h2>
                                            <span className="text-brand-blue font-mono text-xl tracking-widest">{matchedProduct.UPC}</span>
                                        </div>
                                    </div>
                                ) : null}

                                {/* Input Real y Visible */}
                                <div className="w-full flex items-center justify-center z-20">
                                    <input
                                        ref={upcRef}
                                        type="text"
                                        value={upc}
                                        onChange={(e) => { setUpc(e.target.value); setMatchedProduct(null); }}
                                        onKeyDown={(e) => handleKeyDown(e, 'upc')}
                                        className="w-full bg-transparent outline-none text-center text-4xl md:text-5xl font-black tracking-widest uppercase text-gray-200 placeholder-[#1d1f27]"
                                        placeholder="ESPERANDO UPC..."
                                        autoFocus
                                    />
                                </div>

                                {/* Bottom Label Absoluto */}
                                <span className="absolute bottom-8 text-gray-600 font-bold tracking-[0.2em] uppercase text-[10px]">Paso 1: Identificar Producto</span>

                                {/* Candado Fijo Esquina */}
                                <button
                                    onClick={(e) => { e.stopPropagation(); setKeepUpc(!keepUpc); }}
                                    className={`absolute top-6 right-6 p-3 rounded-xl transition-all flex items-center justify-center z-30 ${keepUpc ? 'bg-brand-blue text-white shadow-lg' : 'bg-black/20 text-gray-500 hover:text-gray-300'}`}
                                    title="Fijar este UPC para múltiples escaneos continuos"
                                >
                                    {keepUpc ? <Lock size={16} /> : <Unlock size={16} />}
                                </button>
                            </div>

                            {/* Inputs Flotantes/Ocultos para Serial y QTY (Aparecen si Masivo o Serializado lo requiere) */}
                            <div className="flex gap-4">
                                {mode === 'UPC_SERIAL' && (
                                    <div className="flex-1">
                                        <input ref={serialRef} type="text" value={serial} onChange={(e) => setSerial(e.target.value)} onKeyDown={(e) => handleKeyDown(e, 'serial')} className="w-full bg-dark-input border border-dark-border rounded-2xl px-5 py-4 outline-none focus:ring-1 focus:ring-brand-blue focus:border-brand-blue transition-all font-mono text-xl tracking-widest text-brand-blue placeholder-gray-600 text-center uppercase" placeholder="ESCANEAR SERIAL AQUÍ" />
                                    </div>
                                )}
                                {mode === 'MASSIVE' && (
                                    <div className="flex-1 flex gap-4">
                                        <input ref={qtyRef} type="number" value={qty} onChange={(e) => setQty(e.target.value)} onKeyDown={(e) => handleKeyDown(e, 'qty')} min="1" className="w-[120px] bg-dark-input border border-dark-border rounded-2xl px-5 py-4 outline-none focus:ring-1 focus:ring-brand-blue transition-all font-sans text-2xl font-black text-center text-white placeholder-gray-600" placeholder="1" />
                                        <button onClick={addRecord} className="flex-1 bg-brand-blue hover:bg-blue-600 text-white font-bold py-4 px-4 rounded-2xl transition-all text-sm uppercase tracking-widest shadow-lg shadow-brand-blue/20 flex items-center justify-center gap-2">
                                            <PackageCheck size={20} /> Ingresar
                                        </button>
                                    </div>
                                )}
                            </div>

                        </div>

                        {/* Right Panel: Historial Reciente (Dark Terminal Grid) */}
                        <div className="flex-1 flex flex-col bg-[#0F1014] border border-dark-border rounded-3xl relative overflow-hidden min-h-[500px]">

                            {/* Header (Top) */}
                            <div className="flex justify-between items-center px-8 py-6 border-b border-dark-border bg-[#0A0A0B]/50">
                                <h2 className="text-white font-black tracking-[0.2em] text-sm flex items-center gap-3">
                                    <History size={18} className="text-gray-500" /> HISTORIAL RECIENTE
                                </h2>
                                <button onClick={() => setDeleteConfirm({ id: 'all', type: 'session' })} className="text-gray-600 hover:text-red-500 transition-colors p-2 bg-dark-input rounded-xl hover:bg-red-500/10">
                                    <Trash2 size={16} />
                                </button>
                            </div>

                            {/* Dynamic List */}
                            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 pb-32">
                                {groupedRecords.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center opacity-40">
                                        <Box size={48} className="text-gray-600 mb-4" />
                                        <span className="font-bold tracking-widest uppercase text-sm text-gray-500">Sesión Vacía</span>
                                    </div>
                                ) : (
                                    groupedRecords.map((group, groupIndex) => (
                                        <div key={group.UPC} className={`bg-transparent border rounded-2xl p-5 md:p-6 flex flex-col relative overflow-hidden transition-all duration-300 ${groupIndex === 0 ? 'border-brand-blue/30 bg-brand-blue/5' : 'border-[#18181A] opacity-70 hover:opacity-100'}`}>

                                            {/* Borde luminiscente izquierdo (Solo en el producto activo/más reciente) */}
                                            {groupIndex === 0 && (
                                                <div className="absolute left-0 top-0 bottom-0 w-1 bg-brand-blue shadow-[0_0_15px_rgba(37,99,235,1)]"></div>
                                            )}

                                            {/* Titulo y Badge */}
                                            <div className="flex justify-between items-start mb-5 pl-2">
                                                <div className="flex flex-col pr-4">
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
                                                                    className="bg-transparent text-emerald-500 font-mono font-black outline-none w-[120px] text-base md:text-lg [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                                                    value={group.Records[0]?.CostoUnitario === 0 && !group.Records[0].CostoTotalCOP ? "" : group.Records[0]?.CostoUnitario}
                                                                    onChange={(e) => handleUpdateUpcCost(group.UPC, e.target.value)}
                                                                />
                                                            </div>
                                                            <span className="text-[10px] uppercase font-bold tracking-widest text-gray-600 border border-gray-800 px-3 py-1.5 rounded">Costo Unit / {group.Records[0]?.Moneda || 'COP'}</span>
                                                        </div>

                                                        {/* UI Inteligencia de Precios (Fase 14) */}
                                                        <div className="flex items-center gap-3 pl-1">
                                                            {/* Equivalencia Directa a COP Oculta si ya es COP */}
                                                            {(group.Records[0]?.Moneda === 'USD' && group.Records[0]?.CostoUnitario > 0) && (
                                                                <span className="text-[10px] font-mono text-gray-500 font-medium">
                                                                    ≈ {formatMoney((group.Records[0].CostoUnitario * (parseFloat(exchangeRate) || 1)), 'COP')}
                                                                </span>
                                                            )}

                                                            {/* Fluctuación Histórica */}
                                                            {(() => {
                                                                const currentInputCost = Number(group.Records[0]?.CostoUnitario) || 0;
                                                                const lastSavedCost = productDB[group.UPC]?.LastCost || 0;

                                                                if (lastSavedCost === 0 || currentInputCost === 0) return null;

                                                                const diff = currentInputCost - lastSavedCost;
                                                                const pctChange = (diff / lastSavedCost) * 100;

                                                                if (diff > 0) {
                                                                    // Subió de precio (Alerta)
                                                                    return (
                                                                        <span className="text-[9px] font-bold tracking-widest uppercase flex items-center gap-1 text-red-400 bg-red-950/30 px-2 py-0.5 rounded">
                                                                            Último: ${lastSavedCost} <ArrowUpRight size={10} strokeWidth={3} /> {pctChange.toFixed(0)}%
                                                                        </span>
                                                                    );
                                                                } else if (diff < 0) {
                                                                    // Bajó de precio (Ahorro)
                                                                    return (
                                                                        <span className="text-[9px] font-bold tracking-widest uppercase flex items-center gap-1 text-emerald-400 bg-emerald-950/30 px-2 py-0.5 rounded">
                                                                            Último: ${lastSavedCost} <ArrowDownRight size={10} strokeWidth={3} /> {Math.abs(pctChange).toFixed(0)}%
                                                                        </span>
                                                                    );
                                                                } else {
                                                                    // Sin cambio
                                                                    return (
                                                                        <span className="text-[9px] font-bold tracking-widest uppercase flex items-center gap-1 text-gray-500 bg-gray-900 px-2 py-0.5 rounded">
                                                                            Último: ${lastSavedCost} (-)
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

                                            {/* Seriales Grid (The Core Clone Feature) */}
                                            <div className="flex flex-wrap gap-2 pl-2 mt-2">
                                                {group.Records.map((r, itemIndex) => {
                                                    const isMostRecentScanned = groupIndex === 0 && itemIndex === 0;
                                                    return (
                                                        <div key={r.ID} className={`group/tag flex items-center gap-3 px-4 py-2.5 rounded-xl border transition-all duration-300 ${isMostRecentScanned ? 'bg-brand-blue text-white shadow-[0_0_20px_rgba(37,99,235,0.4)] border-transparent scale-[1.02]' : 'bg-[#0A0A0B] border-dark-border text-gray-400 hover:border-gray-700 hover:text-gray-200'}`}>
                                                            <span className="font-mono text-xs font-bold tracking-widest uppercase">
                                                                {r.Tipo === 'SERIAL' ? r.Serial : `MASIVO x${r.Cantidad}`}
                                                            </span>
                                                            <button onClick={(e) => handleDeleteRecord(r.ID, e)} className={`transition-opacity ${isMostRecentScanned ? 'opacity-100 text-white/70 hover:text-white' : 'opacity-0 group-hover/tag:opacity-100 hover:text-red-400'}`}>
                                                                <X size={14} strokeWidth={3} />
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>

                            {/* BOTÓN MÁGICO 'GUARDAR' */}
                            {records.length > 0 && (
                                <div className="absolute bottom-6 right-6 md:bottom-8 md:right-8 z-30 animate-in slide-in-from-bottom-4 zoom-in-95 duration-300">
                                    <button onClick={saveCurrentSessionToHistory} className="bg-black hover:bg-white hover:text-black text-white px-8 py-5 rounded-3xl font-black uppercase tracking-[0.2em] text-xs flex items-center gap-3 shadow-[0_20px_40px_rgba(0,0,0,0.8)] border border-gray-800 transition-all active:scale-95 group">
                                        <Save size={18} className="group-hover:text-black transition-colors" /> GUARDAR
                                    </button>
                                </div>
                            )}
                        </div>
                    </>
                )}
            </main>
        </div>
    );
}
