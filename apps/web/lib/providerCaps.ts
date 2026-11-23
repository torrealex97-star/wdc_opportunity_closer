// Gasto del mes y medidor de los proveedores de pago que NO son Apify (Bright Data, SerpApi, ZenRows,
// ScrapingBee): lo que ve el propietario en «Control de inversión» y lo que consultan las rutas automáticas
// antes de gastar.
//
// El TOPE no se resuelve aquí: lo lee `providerBudgetStore.readCaps` (tabla `provider_budget` si el propietario
// la guardó, variable de entorno o defecto, con su origen declarado). Este módulo suma el GASTO de las notas
// `proveedor=… · coste_usd=…` de `external_ingest_runs` —la fuente de verdad— y lo compara con ese tope. Sin
// historial legible el gasto es `null` (no 0) y las rutas automáticas no lanzan gasto nuevo.
import { ORG, runsThisMonth } from './external';
import {
  PROVIDER_METERS, canSpend, monthStart, requestsFromNotes, spentFromNotes, type Cap, type MeteredProvider,
} from './providerBudget';
import { METERED_PROVIDERS, readCaps } from './providerBudgetStore';
import { serviceRest } from './supabaseAuth';
import { monthSpent } from './apify';
import { globalCapUsd, globalCheck } from './spendFloor';

export const METERED: readonly MeteredProvider[] = METERED_PROVIDERS;
export const PROVIDER_NAME: Record<MeteredProvider, string> = {
  brightdata: 'Bright Data', jsearch: 'JSearch', rapidapi: 'RapidAPI', serpapi: 'SerpApi', zenrows: 'ZenRows', scrapingbee: 'ScrapingBee',
};
export const isMetered = (value: unknown): value is MeteredProvider =>
  typeof value === 'string' && (METERED as readonly string[]).includes(value);

/** Fija el tope mensual de un proveedor (solo el propietario, desde la ruta de API). `false` si no se guardó. */
export async function setProviderCap(provider: MeteredProvider, usd: number, by: string): Promise<boolean> {
  if (!Number.isFinite(usd) || usd < 0 || usd > 5000) return false;
  const response = await serviceRest('provider_budget?on_conflict=org_id,provider', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ org_id: ORG, provider, monthly_usd: Math.round(usd * 100) / 100, updated_by: by, updated_at: new Date().toISOString() }),
  }).catch(() => null);
  return Boolean(response?.ok);
}

export type SpendRow = {
  provider: MeteredProvider;
  name: string;
  cap_usd: number;
  cap_source: Cap['source'];
  cap_updated_by: string | null;
  cap_updated_at: string | null;
  /** Motivo por el que el tope cayó al entorno (tabla ilegible o fila inválida); `null` si no hay. */
  cap_error: string | null;
  /** `null` = el historial no se pudo leer (no es 0). */
  spent_usd: number | null;
  remaining_usd: number | null;
  /** Parte del tope ya usada, 0–100; `null` si no se conoce el gasto o el tope es 0. */
  used_pct: number | null;
  requests: number | null;
  /** Alguna nota del proveedor no traía importe: el gasto es un mínimo. */
  partial: boolean;
  usd_per_request: number;
  note: string;
};
export type SpendOverview = { rows: SpendRow[]; table_ok: boolean; month_from: string; spent_readable: boolean };

export async function spendOverview(now = new Date()): Promise<SpendOverview> {
  const [caps, runs] = await Promise.all([readCaps(), runsThisMonth(now)]);
  const notes = (runs ?? []).map(run => ({ note: run.note }));
  const rows = METERED.map((provider): SpendRow => {
    const cap = caps[provider];
    const spent = runs === null ? null : spentFromNotes(notes, provider);
    const spentUsd = spent === null ? null : (spent.usd ?? 0);
    return {
      provider, name: PROVIDER_NAME[provider],
      cap_usd: cap.usd, cap_source: cap.source, cap_updated_by: cap.updated_by ?? null, cap_updated_at: cap.updated_at ?? null, cap_error: cap.error,
      spent_usd: spentUsd,
      remaining_usd: spentUsd === null ? null : Math.max(0, Math.round((cap.usd - spentUsd) * 1e6) / 1e6),
      used_pct: spentUsd === null || cap.usd <= 0 ? null : Math.min(100, Math.round((spentUsd / cap.usd) * 1000) / 10),
      requests: runs === null ? null : (requestsFromNotes(notes, provider) ?? 0),
      partial: spent?.partial ?? false,
      usd_per_request: PROVIDER_METERS[provider].usdPerRequest,
      note: PROVIDER_METERS[provider].note,
    };
  });
  // La tabla «no está disponible» si algún proveedor cayó al entorno por un fallo de lectura (no por no tener fila).
  const tableOk = !rows.some(row => row.cap_error !== null && row.cap_source !== 'tabla' && /No se pudo|no devolvió/.test(row.cap_error));
  return { rows, table_ok: tableOk, month_from: monthStart(now), spent_readable: runs !== null };
}

/**
 * Medidor de UNA pasada automática. Lee tope y gasto una vez y suma lo que la propia pasada va gastando, de
 * modo que varias búsquedas seguidas no se salten el tope porque aún no estén en la base. Sin gasto legible
 * no autoriza nada. `requests` es el peor caso de peticiones de la llamada (un reintento cuenta aparte).
 */
export type Meter = {
  caps: Record<MeteredProvider, Cap>;
  spent: Record<MeteredProvider, number | null>;
  check: (provider: MeteredProvider, requests?: number) => { ok: boolean; reason?: string };
  /** Cuántas peticiones más caben en el tope (0 si no se sabe). */
  affordable: (provider: MeteredProvider) => number;
  charge: (provider: MeteredProvider, usd: number) => void;
  /** Tope global del mes entre TODOS los proveedores (los medidos y Apify). `spent` es el total, `null` si alguna parte no se pudo leer. */
  global: { cap: number; spent: () => number | null; check: (nextUsd?: number) => { ok: boolean; reason?: string } };
};

export async function loadMeter(): Promise<Meter> {
  const [caps, runs, apifySpent] = await Promise.all([readCaps(), runsThisMonth(), monthSpent().catch(() => null)]);
  let apify = apifySpent;
  const notes = (runs ?? []).map(run => ({ note: run.note }));
  const spent = Object.fromEntries(METERED.map(provider => [provider, runs === null ? null : (spentFromNotes(notes, provider).usd ?? 0)])) as Record<MeteredProvider, number | null>;
  const globalCap = globalCapUsd();
  const parts = () => [...METERED.map(provider => spent[provider]), apify];
  const globalNow = (nextUsd = 0) => globalCheck(parts(), globalCap, nextUsd);
  const check: Meter['check'] = (provider, requests = 1) => {
    const result = canSpend(provider, spent[provider], process.env, requests, caps[provider].usd);
    if (!result.ok) return { ok: false, reason: result.reason };
    // Además del tope del proveedor, el tope global del mes (peor caso de esta llamada).
    const overall = globalNow(PROVIDER_METERS[provider].usdPerRequest * Math.max(1, requests));
    return { ok: overall.ok, reason: overall.reason };
  };
  return {
    caps, spent, check,
    affordable: provider => {
      const used = spent[provider];
      if (used === null) return 0;
      const room = caps[provider].usd - used;
      return room <= 0 ? 0 : Math.floor((room + 1e-9) / PROVIDER_METERS[provider].usdPerRequest);
    },
    charge: (provider, usd) => { spent[provider] = (spent[provider] ?? 0) + usd; },
    global: { cap: globalCap, spent: () => globalNow().spent, check: nextUsd => { const r = globalNow(nextUsd); return { ok: r.ok, reason: r.reason }; } },
  };
}
