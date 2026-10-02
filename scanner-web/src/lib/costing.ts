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
    costoUsd: number | null;   // ponderado en USD sobre los lotes que sí tienen costo (null si ninguno lo tiene)
    costoCop: number | null;   // ponderado en COP sobre los lotes que sí tienen TRM (null si ninguno la tiene)
    cubiertas: number;         // unidades del stock que provienen de lotes conocidos
    lotesUsados: LoteUsado[];
    // Señales de revisión: el cálculo se hizo con los lotes disponibles, pero hay lotes incompletos
    unidadesSinCosto: number;  // unidades (del stock) cuyo lote entró sin costo en USD
    unidadesSinTrm: number;    // unidades (del stock) cuyo lote entró sin TRM (no se puede pasar a COP)
    usdParcial: boolean;       // costoUsd calculado sin contar todas las unidades
    copParcial: boolean;       // costoCop calculado sin contar todas las unidades
}

/** lotes debe venir ordenado del más reciente al más antiguo. */
export function calcularCostoPonderado(lotes: Lote[], stock: number): CostoPonderado {
    const lotesUsados: LoteUsado[] = [];
    let restante = Math.max(0, Math.floor(stock));
    let sumUsd = 0, undUsd = 0;      // solo lotes con costo > 0
    let sumCop = 0, undCop = 0;      // solo lotes con costo > 0 y TRM > 1
    let unidadesSinCosto = 0, unidadesSinTrm = 0;

    for (const l of lotes) {
        if (restante <= 0) break;
        if (!(l.unidades > 0)) continue;
        const tomadas = Math.min(l.unidades, restante);
        lotesUsados.push({ ...l, tomadas });
        const tieneCosto = (l.costoUsd || 0) > 0;
        const tieneTrm = l.trm > 1;
        if (tieneCosto) { sumUsd += tomadas * l.costoUsd; undUsd += tomadas; }
        else unidadesSinCosto += tomadas;
        if (tieneCosto && tieneTrm) { sumCop += tomadas * l.costoUsd * l.trm; undCop += tomadas; }
        else if (tieneCosto && !tieneTrm) unidadesSinTrm += tomadas;
        restante -= tomadas;
    }

    const cubiertas = Math.max(0, Math.floor(stock)) - restante;
    if (cubiertas === 0) {
        return { costoUsd: null, costoCop: null, cubiertas: 0, lotesUsados: [], unidadesSinCosto: 0, unidadesSinTrm: 0, usdParcial: false, copParcial: false };
    }

    return {
        costoUsd: undUsd > 0 ? Math.round((sumUsd / undUsd) * 100) / 100 : null,
        costoCop: undCop > 0 ? Math.round(sumCop / undCop) : null,
        cubiertas,
        lotesUsados,
        unidadesSinCosto,
        unidadesSinTrm,
        usdParcial: undUsd > 0 && undUsd < cubiertas,
        copParcial: undCop > 0 && undCop < cubiertas,
    };
}
