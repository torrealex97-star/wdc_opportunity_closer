// Centro de mando: cálculos puros sobre lo que ya miden el embudo y la muestra por fuente. Un hueco no es un cero: sin dato es `null`
// con su causa, y una cifra que depende de otra no se calcula si falta alguna.

export type PaidRow = { source: string; seen: number | null; approved: number | null; cost_usd: number | null };

/** Coste por oferta aprobada. `null` = no se puede calcular (sin coste, sin aprobadas o sin dato), nunca 0. */
export const costPerApproved = (row: Pick<PaidRow, 'approved' | 'cost_usd'>): number | null =>
  row.cost_usd === null || row.cost_usd <= 0 || row.approved === null || row.approved <= 0 ? null : Math.round((row.cost_usd / row.approved) * 100) / 100;

export type Split = { paid_approved: number; free_approved: number; paid_share: number | null; unknown: number };

/**
 * Reparto de ofertas aprobadas entre fuentes de pago (con coste registrado > 0) y gratuitas. `costReadable = false` = el coste no se pudo leer:
 * entonces una fuente sin coste puede ser de pago o gratuita y NO se reparte (`unknown`); no se inventa un porcentaje.
 */
export function paidFreeSplit(rows: PaidRow[], costReadable: boolean): Split {
  let paid = 0, free = 0, unknown = 0;
  for (const row of rows) {
    const approved = row.approved ?? 0;
    if (row.approved === null) { unknown += 1; continue; }
    if (row.cost_usd !== null && row.cost_usd > 0) paid += approved;
    else if (costReadable) free += approved;
    else unknown += approved;
  }
  const total = paid + free;
  return { paid_approved: paid, free_approved: free, paid_share: costReadable && total > 0 ? Math.round((paid / total) * 1000) / 10 : null, unknown };
}
