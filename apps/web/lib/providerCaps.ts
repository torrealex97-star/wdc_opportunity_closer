// Topes y gasto del mes de los proveedores de pago que NO son Apify (Bright Data, SerpApi, ZenRows,
// ScrapingBee): lo que ve el propietario en «Control de inversión» y lo que consultan las rutas automáticas
// antes de gastar.
//
// El tope sale, por este orden, de `provider_budget` (SOLO las filas que el propietario guardó en el panel: la
// semilla de la migración no cuenta), de la variable de entorno y del valor por defecto. Si la tabla no se puede leer se sigue con el entorno y se declara
// (`table_ok: false`): un hueco en la lectura no se convierte en «sin tope». El gasto NO se guarda aparte: se
// suma de las notas `proveedor=… · coste_usd=…` de `external_ingest_runs`, que son la fuente de verdad. Sin
// historial legible el gasto es `null` (no 0) y las rutas automáticas no lanzan gasto nuevo.
import { ORG, runsThisMonth } from './external';
import { serviceRest } from './supabaseAuth';
import {
  PROVIDER_METERS, canSpend, capUsd, monthStart, requestsFromNotes, spentFromNotes, type MeteredProvider,
} from './providerBudget';

export const METERED: readonly MeteredProvider[] = ['brightdata', 'serpapi', 'zenrows', 'scrapingbee'];
export const PROVIDER_NAME: Record<MeteredProvider, string> = {
  brightdata: 'Bright Data', serpapi: 'SerpApi', zenrows: 'ZenRows', scrapingbee: 'ScrapingBee',
};
export const isMetered = (value: unknown): value is MeteredProvider =>
  typeof value === 'string' && (METERED as readonly string[]).includes(value);

export type CapSource = 'tabla' | 'entorno' | 'defecto';
export type ProviderCap = { usd: number; source: CapSource; updated_by: string | null; updated_at: string | null };
export type CapsRead = { caps: Record<MeteredProvider, ProviderCap>; table_ok: boolean };

const envCap = (provider: MeteredProvider, env: NodeJS.ProcessEnv): ProviderCap => {
  const raw = env[PROVIDER_METERS[provider].env];
  const valid = raw !== undefined && raw !== '' && Number.isFinite(Number(raw)) && Number(raw) >= 0 && Number(raw) <= 5000;
  return { usd: capUsd(provider, env), source: valid ? 'entorno' : 'defecto', updated_by: null, updated_at: null };
};

/** Topes efectivos. La tabla manda; si no se puede leer, entorno o defecto, y se dice. */
export async function readCaps(env: NodeJS.ProcessEnv = process.env): Promise<CapsRead> {
  const caps = Object.fromEntries(METERED.map(provider => [provider, envCap(provider, env)])) as Record<MeteredProvider, ProviderCap>;
  const response = await serviceRest(`provider_budget?org_id=eq.${ORG}&select=provider,monthly_usd,updated_by,updated_at`).catch(() => null);
  const rows = response?.ok ? await response.json().catch(() => null) : null;
  if (!Array.isArray(rows)) return { caps, table_ok: false };
  for (const row of rows as Array<{ provider?: unknown; monthly_usd?: unknown; updated_by?: string | null; updated_at?: string | null }>) {
    const usd = Number(row.monthly_usd);
    if (!isMetered(row.provider) || !Number.isFinite(usd) || usd < 0) continue;
    // Una fila sin `updated_by` es la semilla de la migración (5 USD para todos), no una decisión del propietario:
    // no pisa la variable de entorno que el operador ya tuviera. Solo manda lo que alguien guardó desde el panel.
    if (!row.updated_by) continue;
    caps[row.provider] = { usd, source: 'tabla', updated_by: row.updated_by ?? null, updated_at: row.updated_at ?? null };
  }
  return { caps, table_ok: true };
}

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
  cap_source: CapSource;
  cap_updated_by: string | null;
  cap_updated_at: string | null;
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
  const [capsRead, runs] = await Promise.all([readCaps(), runsThisMonth(now)]);
  const notes = (runs ?? []).map(run => ({ note: run.note }));
  const rows = METERED.map((provider): SpendRow => {
    const cap = capsRead.caps[provider];
    const spent = runs === null ? null : spentFromNotes(notes, provider);
    const spentUsd = spent === null ? null : (spent.usd ?? 0);
    return {
      provider, name: PROVIDER_NAME[provider],
      cap_usd: cap.usd, cap_source: cap.source, cap_updated_by: cap.updated_by, cap_updated_at: cap.updated_at,
      spent_usd: spentUsd,
      remaining_usd: spentUsd === null ? null : Math.max(0, Math.round((cap.usd - spentUsd) * 1e6) / 1e6),
      used_pct: spentUsd === null || cap.usd <= 0 ? null : Math.min(100, Math.round((spentUsd / cap.usd) * 1000) / 10),
      requests: runs === null ? null : (requestsFromNotes(notes, provider) ?? 0),
      partial: spent?.partial ?? false,
      usd_per_request: PROVIDER_METERS[provider].usdPerRequest,
      note: PROVIDER_METERS[provider].note,
    };
  });
  return { rows, table_ok: capsRead.table_ok, month_from: monthStart(now), spent_readable: runs !== null };
}

/**
 * Medidor de UNA pasada automática. Lee tope y gasto una vez y suma lo que la propia pasada va gastando, de
 * modo que varias búsquedas seguidas no se salten el tope porque aún no estén en la base. Sin gasto legible
 * no autoriza nada.
 */
export type Meter = {
  caps: Record<MeteredProvider, ProviderCap>;
  spent: Record<MeteredProvider, number | null>;
  check: (provider: MeteredProvider, requests?: number) => { ok: boolean; reason?: string };
  /** Cuántas peticiones más caben en el tope (0 si no se sabe). */
  affordable: (provider: MeteredProvider) => number;
  charge: (provider: MeteredProvider, usd: number) => void;
};

export async function loadMeter(): Promise<Meter> {
  const [{ caps }, runs] = await Promise.all([readCaps(), runsThisMonth()]);
  const notes = (runs ?? []).map(run => ({ note: run.note }));
  const spent = Object.fromEntries(METERED.map(provider => [provider, runs === null ? null : (spentFromNotes(notes, provider).usd ?? 0)])) as Record<MeteredProvider, number | null>;
  const check: Meter['check'] = (provider, requests = 1) => {
    const result = canSpend(provider, spent[provider], process.env, caps[provider].usd, requests);
    return { ok: result.ok, reason: result.reason };
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
  };
}
