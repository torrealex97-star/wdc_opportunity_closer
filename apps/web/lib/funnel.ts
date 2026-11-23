import { CRON_LOG_SOURCE, ORG } from './external';
import { pagedRest } from './supabaseAuth';

// Embudo por fuente y mercado (ofertas externas). Todo sale de columnas que ya existen en `external_offers` y
// `external_ingest_runs`; nada se estima. Lo que NO deja marca (descartado antes de guardar, duplicado entre
// fuentes, «visible el día D» de ayer) no se puede reconstruir y el panel lo declara en vez de rellenarlo.
export type FunnelOffer = {
  source: string; role?: string | null; market: string | null; market_basis: string | null; first_seen_at: string | null;
  editorial_status: string; reviewed_by: string | null; reviewed_at: string | null; expires_at: string | null;
  auto_review: { why?: string } | null;
};
export type FunnelRun = { source: string; received: number | null; accepted: number | null; created_at: string };
// LATAM asignado POR DEFECTO (español sin ubicación ni importe, base `sin_senal`) va aparte del LATAM con dato de ubicación.
export type FunnelMarket = 'ES' | 'LATAM' | 'LATAM_DEFECTO' | 'US_LATINO' | 'SIN_MERCADO';
export type FunnelRow = {
  source: string; market: FunnelMarket;
  new24: number; new7: number; approved24: number; approved7: number; human24: number; human7: number;
  withdrawn24: number; withdrawn7: number; visible: number; reasons: Record<string, number>;
};
/** Rango del Centro de mando: días de la ventana y filtros opcionales de categoría (perfil) y mercado. */
export type RangeFilter = { days: number; role?: string | null; market?: FunnelMarket | null };
export const RANGE_DAYS = [1, 7, 30, 365] as const;
export type RangeBlock = {
  days: number; role: string | null; market: FunnelMarket | null;
  new: number; withdrawn: number; approved: number; human: number; visible: number;
  /** Serie para el gráfico: por día hasta 30 días y por semana en un año. `start` = primer día del tramo (AAAA-MM-DD, UTC). */
  bucket: 'dia' | 'semana'; series: Array<{ start: string; new: number; approved: number }>;
  visible_by_market: Partial<Record<FunnelMarket, number>>;
};
export type Funnel = {
  generated_at: string; truncated: boolean;
  range: RangeBlock;
  totals: Omit<FunnelRow, 'source' | 'market' | 'reasons'> & { reasons: Record<string, number> };
  rows: FunnelRow[];
  // null = no se pudo leer (distinto de 0).
  ingest: Array<{ source: string; received24: number; accepted24: number; received7: number; accepted7: number }> | null;
};

const H24 = 864e5, D7 = 7 * 864e5;
const marketOf = (o: Pick<FunnelOffer, 'market' | 'market_basis'>): FunnelMarket =>
  o.market === 'ES' || o.market === 'US_LATINO' ? o.market : o.market === 'LATAM' ? (o.market_basis === 'sin_senal' ? 'LATAM_DEFECTO' : 'LATAM') : 'SIN_MERCADO';
const approvedStatus = (s: string) => s === 'approved' || s === 'published';
const empty = (): Omit<FunnelRow, 'source' | 'market'> => ({ new24: 0, new7: 0, approved24: 0, approved7: 0, human24: 0, human7: 0, withdrawn24: 0, withdrawn7: 0, visible: 0, reasons: {} });

/** Puro: `offers` = ofertas nuevas o decididas en 7 días; `live` = ofertas aprobadas y vigentes (para «visibles»). */
const roleMatches = (filter: string | null | undefined, role: string | null | undefined) => !filter || (filter === 'none' ? !role : role === filter);

/** Puro: lo que pasó en la ventana pedida, con los filtros de categoría y mercado. Un tramo sin movimiento vale 0 SOLO porque se leyó; si se truncó, el aviso va aparte. */
export function computeRange(offers: FunnelOffer[], live: Array<Pick<FunnelOffer, 'source' | 'market' | 'market_basis' | 'role'>>, now: Date, filter: RangeFilter): RangeBlock {
  const t = now.getTime(), span = filter.days * 864e5, weekly = filter.days > 30;
  const inWin = (iso: string | null) => Boolean(iso) && t - Date.parse(iso as string) <= span && t >= Date.parse(iso as string);
  const ok = (o: Pick<FunnelOffer, 'market' | 'market_basis' | 'role'>) => roleMatches(filter.role, o.role) && (!filter.market || marketOf(o) === filter.market);
  const dayKey = (iso: string) => iso.slice(0, 10);
  const startOf = (iso: string) => {
    if (!weekly) return dayKey(iso);
    const ago = Math.floor((t - Date.parse(iso)) / (7 * 864e5)); // semanas completas hacia atrás desde ahora
    return dayKey(new Date(t - (ago + 1) * 7 * 864e5 + 864e5).toISOString());
  };
  const buckets = weekly ? Math.ceil(filter.days / 7) : filter.days;
  const series = new Map<string, { start: string; new: number; approved: number }>();
  for (let i = buckets - 1; i >= 0; i--) {
    const at = new Date(t - (weekly ? (i + 1) * 7 * 864e5 - 864e5 : i * 864e5)).toISOString();
    const start = dayKey(at); series.set(start, { start, new: 0, approved: 0 });
  }
  const block: RangeBlock = { days: filter.days, role: filter.role ?? null, market: filter.market ?? null, new: 0, withdrawn: 0, approved: 0, human: 0, visible: 0, bucket: weekly ? 'semana' : 'dia', series: [], visible_by_market: {} };
  for (const o of offers) {
    if (!ok(o)) continue;
    if (inWin(o.first_seen_at)) { block.new++; const b = series.get(startOf(o.first_seen_at as string)); if (b) b.new++; }
    if (!inWin(o.reviewed_at)) continue;
    if (approvedStatus(o.editorial_status)) { block.approved++; const b = series.get(startOf(o.reviewed_at as string)); if (b) b.approved++; }
    else if (o.editorial_status === 'needs_review') block.human++;
    else if (o.editorial_status === 'withdrawn' && o.reviewed_by === 'auto-retira') block.withdrawn++;
  }
  for (const o of live) { if (!roleMatches(filter.role, o.role)) continue; const m = marketOf(o); if (filter.market && m !== filter.market) continue; block.visible++; block.visible_by_market[m] = (block.visible_by_market[m] ?? 0) + 1; }
  block.series = [...series.values()];
  return block;
}

export function computeFunnel(offers: FunnelOffer[], live: Array<Pick<FunnelOffer, 'source' | 'market' | 'market_basis' | 'role'>>, runs: FunnelRun[] | null, now: Date, truncated = false, filter: RangeFilter = { days: 7 }): Funnel {
  const t = now.getTime(), in24 = (iso: string | null) => Boolean(iso) && t - Date.parse(iso as string) <= H24 && t >= Date.parse(iso as string);
  const in7 = (iso: string | null) => Boolean(iso) && t - Date.parse(iso as string) <= D7 && t >= Date.parse(iso as string);
  const by = new Map<string, FunnelRow>();
  const row = (source: string, market: FunnelMarket) => { const k = `${source}|${market}`; let r = by.get(k); if (!r) { r = { source, market, ...empty() }; by.set(k, r); } return r; };
  for (const o of offers) {
    const r = row(o.source, marketOf(o));
    if (in24(o.first_seen_at)) r.new24++;
    if (in7(o.first_seen_at)) r.new7++;
    const decided = in7(o.reviewed_at);
    if (!decided) continue;
    const day = in24(o.reviewed_at), why = o.auto_review?.why;
    if (approvedStatus(o.editorial_status)) { r.approved7++; if (day) r.approved24++; }
    else if (o.editorial_status === 'needs_review') { r.human7++; if (day) r.human24++; if (why) r.reasons[why] = (r.reasons[why] ?? 0) + 1; }
    else if (o.editorial_status === 'withdrawn' && o.reviewed_by === 'auto-retira') { r.withdrawn7++; if (day) r.withdrawn24++; if (why) r.reasons[why] = (r.reasons[why] ?? 0) + 1; }
  }
  for (const o of live) row(o.source, marketOf(o)).visible++;
  const rows = [...by.values()].sort((a, b) => b.new7 - a.new7 || b.visible - a.visible || a.source.localeCompare(b.source) || a.market.localeCompare(b.market));
  const totals = { ...empty() };
  for (const r of rows) {
    for (const k of ['new24', 'new7', 'approved24', 'approved7', 'human24', 'human7', 'withdrawn24', 'withdrawn7', 'visible'] as const) totals[k] += r[k];
    for (const [why, n] of Object.entries(r.reasons)) totals.reasons[why] = (totals.reasons[why] ?? 0) + n;
  }
  const ing = new Map<string, { source: string; received24: number; accepted24: number; received7: number; accepted7: number }>();
  for (const x of runs ?? []) {
    if (!in7(x.created_at) || x.source === CRON_LOG_SOURCE) continue;
    const e = ing.get(x.source) ?? { source: x.source, received24: 0, accepted24: 0, received7: 0, accepted7: 0 };
    e.received7 += x.received ?? 0; e.accepted7 += x.accepted ?? 0;
    if (in24(x.created_at)) { e.received24 += x.received ?? 0; e.accepted24 += x.accepted ?? 0; }
    ing.set(x.source, e);
  }
  return { generated_at: now.toISOString(), truncated, range: computeRange(offers, live, now, filter), totals, rows, ingest: runs === null ? null : [...ing.values()].sort((a, b) => b.received7 - a.received7 || a.source.localeCompare(b.source)) };
}

export async function loadFunnel(now = new Date(), filter: RangeFilter = { days: 7 }): Promise<Funnel | null> {
  const since = encodeURIComponent(new Date(now.getTime() - Math.max(D7, filter.days * 864e5)).toISOString());
  const nowIso = encodeURIComponent(now.toISOString());
  const [o, live, runs] = await Promise.all([
    pagedRest<FunnelOffer>(`external_offers?org_id=eq.${ORG}&or=(first_seen_at.gte.${since},reviewed_at.gte.${since})&select=source,role,market,market_basis,first_seen_at,editorial_status,reviewed_by,reviewed_at,expires_at,auto_review`, 'id.asc'),
    pagedRest<Pick<FunnelOffer, 'source' | 'market' | 'market_basis'>>(`external_offers?org_id=eq.${ORG}&editorial_status=in.(approved,published)&expires_at=gt.${nowIso}&select=source,role,market,market_basis`, 'id.asc'),
    pagedRest<FunnelRun>(`external_ingest_runs?org_id=eq.${ORG}&created_at=gte.${since}&select=source,received,accepted,created_at`, 'created_at.desc'),
  ]);
  if (!o || !live) return null;
  return computeFunnel(o.rows, live.rows, runs ? runs.rows : null, now, o.truncated || live.truncated || Boolean(runs?.truncated), filter);
}
