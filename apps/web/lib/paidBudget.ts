import { ORG } from './external';
import { DEFAULT_MONTHLY_USD, MAX_MONTHLY_USD, MIN_MONTHLY_USD, parseMonthlyUsd } from './spendPlan';
import { serviceRest } from './supabaseAuth';

// Control del gasto en medios de pago. UN límite mensual por organización, que el propietario cambia desde el
// panel, y el reparto que sale de él (reglas en `spendPlan.ts`): no se gasta más de lo que dice el límite y,
// cuando no queda, cada búsqueda se aplaza con su motivo en vez de lanzarse a ciegas.
export { DEFAULT_MONTHLY_USD, MAX_MONTHLY_USD, MIN_MONTHLY_USD, MIN_RUN_USD, measuredYield, parseMonthlyUsd, spendPlan } from './spendPlan';
export type { Plan, Route } from './spendPlan';

export type BudgetSource = 'propietario' | 'entorno' | 'defecto';
export type Budget = { usd: number; source: BudgetSource; updated_by: string | null; updated_at: string | null; error: string | null };
const envUsd = () => parseMonthlyUsd(process.env.APIFY_MONTHLY_BUDGET_USD);
const fallback = (error: string | null): Budget => {
  const env = envUsd();
  return { usd: env ?? DEFAULT_MONTHLY_USD, source: env === null ? 'defecto' : 'entorno', updated_by: null, updated_at: null, error };
};

// Una tabla ausente (migración sin aplicar) NO rompe la app: usa el valor del entorno y lo declara con su
// motivo, para que el panel no enseñe un control que en realidad no manda.
export async function readBudget(): Promise<Budget> {
  const response = await serviceRest(`paid_budget?org_id=eq.${ORG}&select=monthly_usd,updated_by,updated_at&limit=1`).catch(() => null);
  if (!response) return fallback('No se pudo consultar el límite guardado; se usa el del entorno.');
  const rows = response.ok ? await response.json().catch(() => null) : null;
  if (!Array.isArray(rows)) return fallback(`No se pudo leer el límite guardado (HTTP ${response.status}); se usa el del entorno.`);
  const row = rows[0] as { monthly_usd?: unknown; updated_by?: string; updated_at?: string } | undefined;
  const usd = parseMonthlyUsd(row?.monthly_usd);
  if (!row || usd === null) return fallback(null); // sin fila todavía: valor por defecto, declarado como tal
  return { usd, source: 'propietario', updated_by: row.updated_by ?? null, updated_at: row.updated_at ?? null, error: null };
}

export const budgetLimitUsd = async () => (await readBudget()).usd;

export async function writeBudget(usd: unknown, by: string): Promise<{ ok: true; usd: number } | { ok: false; error: string }> {
  const value = parseMonthlyUsd(usd);
  if (value === null) return { ok: false, error: `El límite mensual debe ser un importe en USD entre ${MIN_MONTHLY_USD} y ${MAX_MONTHLY_USD}.` };
  const response = await serviceRest('paid_budget?on_conflict=org_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ org_id: ORG, monthly_usd: value, updated_by: by, updated_at: new Date().toISOString() }),
  }).catch(() => null);
  if (!response?.ok) return { ok: false, error: response ? `No se pudo guardar el límite (HTTP ${response.status}).` : 'No se pudo guardar el límite.' };
  return { ok: true, usd: value };
}
