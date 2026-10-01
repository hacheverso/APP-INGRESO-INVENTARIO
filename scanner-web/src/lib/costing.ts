// Costo ponderado por lotes: las unidades en stock se asumen de los lotes MÁS
// RECIENTES (lo viejo se vendió primero). Si el stock cabe en el último lote,
// el costo es el de ese lote; si abarca varios, se pondera por unidades.

export interface Lote {
    lote: string;        // nombre del ingreso (ej. 20260811-001)
    fecha: string;       // ISO de creación de la sesión
    unidades: number;    // unidades ingresadas de este producto en ese lote
    costoUsd: number;    // costo unitario USD (ponderado dentro del lote)
    trm: number;         // tasa usada; 1 si el lote fue en USD puro
}

export interface LoteUsado extends Lote {
    tomadas: number;     // unidades de este lote que componen el stock actual
}

export interface CostoPonderado {
    costoUsd: number | null;   // ponderado en USD (null si no hay historial)
    costoCop: number | null;   // ponderado en COP (null si algún lote usado no tiene TRM)
    cubiertas: number;         // unidades del stock que sí tienen costo conocido
    lotesUsados: LoteUsado[];
}

/** lotes debe venir ordenado del más reciente al más antiguo. */
export function calcularCostoPonderado(lotes: Lote[], stock: number): CostoPonderado {
    const lotesUsados: LoteUsado[] = [];
    let restante = Math.max(0, Math.floor(stock));
    let sumUsd = 0;
    let sumCop = 0;
    let copCompleto = true;

    for (const l of lotes) {
        if (restante <= 0) break;
        if (!(l.unidades > 0)) continue;
        const tomadas = Math.min(l.unidades, restante);
        lotesUsados.push({ ...l, tomadas });
        sumUsd += tomadas * (l.costoUsd || 0);
        if (l.trm > 1) sumCop += tomadas * (l.costoUsd || 0) * l.trm;
        else copCompleto = false;
        restante -= tomadas;
    }

    const cubiertas = Math.max(0, Math.floor(stock)) - restante;
    if (cubiertas === 0) return { costoUsd: null, costoCop: null, cubiertas: 0, lotesUsados: [] };

    return {
        costoUsd: Math.round((sumUsd / cubiertas) * 100) / 100,
        costoCop: copCompleto ? Math.round(sumCop / cubiertas) : null,
        cubiertas,
        lotesUsados,
    };
}
