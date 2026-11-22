import { countExact, ORG } from './external';
import { serviceRest } from './supabaseAuth';
import { parseTarget, stateOf, targetFromRow, weekStart, windowStart, type DayCounts, type WaterfallState, type WaterfallTarget } from './waterfall';

// Lectura y escritura del objetivo del waterfall y los recuentos del día. La lógica (hueco, plan) vive en
// `waterfall.ts`; aquí solo hay acceso a datos. Un recuento que falla es `null` (hueco), nunca 0.

/** Objetivo efectivo: tabla → entorno → defecto, con el motivo si la tabla no se pudo leer. */
export async function readTarget(): Promise<WaterfallTarget> {
  const response = await serviceRest(`waterfall_settings?org_id=eq.${ORG}&select=qualified_per_day,updated_by,updated_at&limit=1`).catch(() => null);
  if (!response) return targetFromRow(null, process.env, 'No se pudo consultar waterfall_settings; se usa el objetivo del entorno.');
  const rows = response.ok ? await response.json().catch(() => null) : null;
  if (!Array.isArray(rows)) return targetFromRow(null, process.env, `No se pudo leer waterfall_settings (HTTP ${response.status}); se usa el objetivo del entorno.`);
  return targetFromRow(rows[0] as { qualified_per_day?: unknown } | undefined, process.env, null);
}

/** Guarda el objetivo (solo el propietario, desde la ruta de API). `false` si no se guardó. */
export async function writeTarget(value: unknown, by: string): Promise<{ ok: true; target: number } | { ok: false; error: string; kind: 'invalid' | 'store' }> {
  const target = parseTarget(value);
  if (target === null) return { ok: false, kind: 'invalid', error: 'El objetivo debe ser un número entero de ofertas cualificadas al día entre 0 y 10.000 (0 = no se gasta en vías de pago).' };
  const response = await serviceRest('waterfall_settings?on_conflict=org_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ org_id: ORG, qualified_per_day: target, updated_by: by, updated_at: new Date().toISOString() }),
  }).catch(() => null);
  return response?.ok ? { ok: true, target } : { ok: false, kind: 'store', error: `No se pudo guardar el objetivo${response ? ` (HTTP ${response.status})` : ''}.` };
}

const QUALIFIED = 'editorial_status=in.(approved,published)';
const PENDING = 'editorial_status=in.(draft,needs_review)';
const since = (iso: string, column = 'first_seen_at') => `${column}=gte.${encodeURIComponent(iso)}`;

/**
 * Recuentos de las últimas 24 h y de la última semana, para el hueco y la tasa de aprobación. «Cualificada» se
 * cuenta por CUÁNDO se aprobó (`reviewed_at`), no por cuándo se vio; «pendiente», por cuándo se vio.
 */
export async function dayCounts(now = new Date()): Promise<DayCounts> {
  const day = windowStart(now), week = weekStart(now), org = `org_id=eq.${ORG}`;
  const [qualified, pending, weekTotal, weekQualified] = await Promise.all([
    countExact([org, since(day, 'reviewed_at'), QUALIFIED]),
    countExact([org, since(day), PENDING]),
    countExact([org, since(week)]),
    countExact([org, since(week), QUALIFIED]),
  ]);
  return { qualified, pending, week_total: weekTotal, week_qualified: weekQualified };
}

export async function waterfallState(now = new Date()): Promise<WaterfallState> {
  const [target, counts] = await Promise.all([readTarget(), dayCounts(now)]);
  return stateOf(target, counts);
}
