import { countExact, ORG, statsBySource } from './external';
import { pagedRest, serviceRest } from './supabaseAuth';
import { fmtInt } from './formatInt';
import { recordedCosts, type ActorLite, type NoteLite, type RunLite } from './sourceCost';

// Muestra por fuente: cuántas ofertas ÚNICAS (sin repetir) ha recogido cada fuente y cuántas se aprobaron, para saber
// cuándo hay datos suficientes para juzgarla. Decisión del dueño (2026-11-22): ninguna fuente de pago se recorta por
// rendimiento hasta tener al menos 1.000 ofertas recogidas con las búsquedas de closer bien hechas. Mientras tanto la
// lectura es «sin conclusión», no «rinde mal». Aquí no se pausa ni se recorta nada: solo se mide y se dice.

export const SAMPLE_TARGET = 1000;
/**
 * Desde cuándo cuenta la muestra de cada fuente: la fecha en que se corrigió su búsqueda (paquete A1 del plan). Sin
 * entrada, cuenta todo lo recogido. Se actualiza en la misma PR que cambia la búsqueda, para no mezclar la muestra
 * de la búsqueda antigua con la de la nueva.
 */
export const SAMPLE_SINCE: Record<string, string | null> = {};

export type SampleInput = { source: string; seen: number | null; approved: number | null; cost_usd: number | null };
export type SampleRow = SampleInput & {
  state: 'sin_dato' | 'sin_conclusion' | 'medida';
  missing: number | null;
  approved_pct: number | null;
  approved_per_usd: number | null;
  since: string | null;
  note: string;
};

/** El coste registrado es acumulado de siempre: con fecha de corte no se mezcla con recogidas y aprobadas desde esa fecha (hueco, no un cociente de ventanas distintas). */
export const windowedCost = (since: string | null, allTimeUsd: number | null): number | null => since ? null : allTimeUsd;

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Pura: un hueco es «—» con su causa, nunca un cero; con menos de `target` no hay conclusión. */
export function sampleRow(input: SampleInput, since: string | null = null, target = SAMPLE_TARGET): SampleRow {
  const { seen, approved, cost_usd } = input;
  const base = { ...input, since };
  if (seen === null) return { ...base, state: 'sin_dato', missing: null, approved_pct: null, approved_per_usd: null, note: 'No se pudo contar lo recogido: no es cero.' };
  const approved_pct = approved === null || seen === 0 ? null : round((approved / seen) * 100, 1);
  const approved_per_usd = approved === null || cost_usd === null || cost_usd <= 0 ? null : round(approved / cost_usd, 2);
  if (seen < target) {
    return { ...base, state: 'sin_conclusion', missing: target - seen, approved_pct, approved_per_usd, note: `Faltan ${fmtInt(target - seen)} para poder concluir; hasta entonces no se recorta.` };
  }
  return { ...base, state: 'medida', missing: 0, approved_pct, approved_per_usd, note: 'Muestra suficiente: ya se puede comparar con otras fuentes.' };
}

export type SamplePayload = { target: number; rows: SampleRow[]; basis: string; cost_note: string | null };

/** Lee la base: recogidas y aprobadas por fuente (desde su fecha de corte) y el coste registrado. `null` = no se pudo leer la lista de fuentes. */
export async function readSamples(since: Record<string, string | null> = SAMPLE_SINCE): Promise<SamplePayload | null> {
  const stats = await statsBySource().catch(() => null);
  if (!stats) return null;
  const [actorsResponse, runs, notes] = await Promise.all([
    serviceRest(`apify_actors?org_id=eq.${ORG}&select=id,source`).catch(() => null),
    pagedRest<RunLite>(`apify_runs?org_id=eq.${ORG}&select=actor_id,cost_usd,status`, 'id.asc').catch(() => null),
    pagedRest<NoteLite>(`external_ingest_runs?org_id=eq.${ORG}&select=source,note&note=like.${encodeURIComponent('*respaldo SerpApi*')}`, 'id.asc').catch(() => null),
  ]);
  const actors = actorsResponse?.ok ? await actorsResponse.json().catch(() => null) : null;
  // Un tope de paginación alcanzado deja el coste incompleto: se declara como hueco en vez de sumar de menos.
  const cost = runs?.truncated || notes?.truncated || !Array.isArray(actors) || !runs || !notes ? null : recordedCosts(actors as ActorLite[], runs.rows, notes.rows);
  const rows = await Promise.all(stats.map(async ({ source }) => {
    const from = since[source] ?? null;
    const filters = [`org_id=eq.${ORG}`, `source=eq.${encodeURIComponent(source)}`, ...(from ? [`first_seen_at=gte.${encodeURIComponent(from)}`] : [])];
    const [seen, approved] = await Promise.all([countExact(filters), countExact([...filters, 'editorial_status=in.(approved,published)'])]);
    const usd = cost?.usdBySource.get(source);
    return sampleRow({ source, seen, approved, cost_usd: windowedCost(from, cost === null ? null : usd === undefined ? null : usd) }, from);
  }));
  rows.sort((a, b) => (b.seen ?? -1) - (a.seen ?? -1) || a.source.localeCompare(b.source));
  return {
    target: SAMPLE_TARGET, rows,
    basis: 'ofertas únicas recogidas por fuente (una oferta vista varias veces cuenta una)',
    cost_note: cost === null
      ? 'No se pudo leer el coste registrado: la columna de coste y de aprobadas por dólar sale en «—».'
      : Object.values(since).some(Boolean) ? 'Las fuentes con fecha de corte muestran el coste en «—»: el coste registrado es acumulado y no se mezcla con lo recogido desde esa fecha.' : null,
  };
}

export { fmtInt };
