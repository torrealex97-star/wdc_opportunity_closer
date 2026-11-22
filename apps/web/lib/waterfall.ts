// Waterfall de recogida: el sistema recorre las vías por coste y PARA cuando se cumple el objetivo diario de
// ofertas cualificadas o se agotan los topes de gasto. Este módulo es puro (sin red ni base): define el objetivo
// efectivo, el hueco del día y el plan por etapas. La lectura y escritura están en `waterfallStore.ts`.
//
// Una oferta CUALIFICADA es la que ya está aprobada o publicada (la que la alumna puede ver). Las recogidas
// recién ingeridas todavía no lo son: la aprobación (reglas, IA o una persona) llega después. Por eso el hueco
// descuenta lo que se espera que se apruebe de lo pendiente de hoy, pero SOLO con una tasa de aprobación medida
// (≥ MIN_SAMPLE ofertas en 7 días). Sin tasa medida no se supone ninguna: lo pendiente cuenta 0 y se declara.
// Un hueco no es un cero: si no se pudo contar lo cualificado de hoy, no se gasta.

export const DEFAULT_TARGET = 60;
export const MAX_TARGET = 10_000;
/** Ofertas vistas en 7 días por debajo de las cuales la tasa de aprobación no se considera medida. */
export const MIN_SAMPLE = 30;

export type TargetSource = 'tabla' | 'entorno' | 'defecto';
export type WaterfallTarget = { target: number; source: TargetSource; updated_by: string | null; updated_at: string | null; error: string | null };

/** Importe válido de objetivo: entero 0–10.000 (0 = «no se gasta en vías de pago»). */
export function parseTarget(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  const n = typeof value === 'number' ? value : typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : Number.NaN;
  return Number.isInteger(n) && n >= 0 && n <= MAX_TARGET ? n : null;
}

/** Objetivo efectivo: la fila guardada por el propietario, o `DAILY_TARGET_OFFERS`, o el valor por defecto (60). */
export function targetFromRow(
  row: { qualified_per_day?: unknown; updated_by?: string | null; updated_at?: string | null } | null | undefined,
  env: NodeJS.ProcessEnv = process.env, readError: string | null = null,
): WaterfallTarget {
  const fromRow = row ? parseTarget(row.qualified_per_day) : null;
  if (row && fromRow !== null) return { target: fromRow, source: 'tabla', updated_by: row.updated_by ?? null, updated_at: row.updated_at ?? null, error: readError };
  const fromEnv = parseTarget(env.DAILY_TARGET_OFFERS);
  const base = fromEnv === null ? { target: DEFAULT_TARGET, source: 'defecto' as const } : { target: fromEnv, source: 'entorno' as const };
  const rowError = row ? 'El objetivo guardado no es un número válido; se usa el del entorno.' : null;
  return { ...base, updated_by: null, updated_at: null, error: readError ?? rowError };
}

export type DayCounts = {
  /** Ofertas aprobadas o publicadas vistas hoy (UTC); `null` = no se pudo contar. */
  qualified: number | null;
  /** Ofertas vistas hoy que aún esperan revisión; `null` = no se pudo contar. */
  pending: number | null;
  /** Ofertas vistas en los últimos 7 días y cuántas de ellas están cualificadas (para la tasa). */
  week_total: number | null;
  week_qualified: number | null;
};

/** Tasa de aprobación medida, o `null` si no hay muestra suficiente. */
export const approvalRate = (weekQualified: number | null, weekTotal: number | null): number | null =>
  weekQualified === null || weekTotal === null || weekTotal < MIN_SAMPLE ? null : Math.min(1, weekQualified / weekTotal);

/** Cualificadas que se esperan de `accepted` ofertas recién recogidas. Sin tasa medida: 0 (no se supone). */
export const expectedQualified = (accepted: number, rate: number | null): number => rate === null ? 0 : Math.floor(Math.max(0, accepted) * rate);

export type WaterfallState = {
  target: WaterfallTarget;
  qualified_today: number | null;
  pending_today: number | null;
  approval_rate: number | null;
  /** Lo que se espera que se apruebe de lo pendiente de hoy (0 sin tasa medida). */
  expected_from_pending: number;
  /** Cualificadas que faltan hoy; `null` si no se pudo contar (entonces no se gasta). */
  gap: number | null;
  /** Una frase que dice de dónde sale el hueco, para el panel y para el registro del cron. */
  basis: string;
};

export function stateOf(target: WaterfallTarget, counts: DayCounts): WaterfallState {
  const rate = approvalRate(counts.week_qualified, counts.week_total);
  const expected = counts.pending === null ? 0 : expectedQualified(counts.pending, rate);
  if (counts.qualified === null) {
    return { target, qualified_today: null, pending_today: counts.pending, approval_rate: rate, expected_from_pending: 0, gap: null, basis: 'No se pudieron contar las cualificadas de hoy: no se lanza gasto de pago.' };
  }
  const gap = Math.max(0, target.target - counts.qualified - expected);
  const basis = rate === null
    ? 'Sin tasa de aprobación medida (muestra pequeña): lo pendiente no se cuenta hasta que se apruebe.'
    : `Tasa de aprobación medida ${Math.round(rate * 100)} %: lo pendiente de hoy aporta ${expected}.`;
  return { target, qualified_today: counts.qualified, pending_today: counts.pending, approval_rate: rate, expected_from_pending: expected, gap, basis };
}

export type StageInput = {
  id: string;
  label: string;
  /** Coste orientativo por unidad, para ordenar y para que el panel lo enseñe. */
  unit: string;
  /** ¿Se puede lanzar ahora (clave, tope, configuración)? */
  available: boolean;
  /** Si no está disponible o es manual: el motivo, en una frase. */
  reason: string | null;
  /** `false` = no la lanza el cron (p. ej. leer HTML de una empresa con Unlocker). */
  automatic: boolean;
};
export type StageDecision = StageInput & { decision: 'run' | 'if-gap' | 'skip'; why: string };

/**
 * El plan en el orden dado (el orden ES el waterfall: de más barato a más caro). Con hueco, la primera etapa
 * disponible se lanza y las siguientes solo «si aún falta» después de contar lo que aportó la anterior; sin
 * hueco (objetivo cumplido) o sin poder contarlo, ninguna de pago se lanza y se dice por qué.
 */
export function planStages(gap: number | null, stages: StageInput[]): StageDecision[] {
  let first = true;
  return stages.map((stage): StageDecision => {
    if (!stage.automatic) return { ...stage, decision: 'skip', why: stage.reason ?? 'Se lanza a mano desde su pestaña.' };
    if (gap === null) return { ...stage, decision: 'skip', why: 'No se pudo contar lo cualificado de hoy: no se gasta.' };
    if (gap <= 0) return { ...stage, decision: 'skip', why: 'Objetivo del día cumplido: no se gasta más.' };
    if (!stage.available) return { ...stage, decision: 'skip', why: stage.reason ?? 'No disponible.' };
    const decision = first ? 'run' : 'if-gap';
    first = false;
    return { ...stage, decision, why: decision === 'run' ? 'Falta objetivo: se lanza.' : 'Se lanza solo si, tras la etapa anterior, aún falta.' };
  });
}

/** Inicio del día en UTC (como el resto de recuentos del día). */
export const dayStart = (now = new Date()): string => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
/** Ventana móvil de 24 h: el cron corre a las 06:00 UTC y un «día natural» siempre le saldría casi vacío. */
export const windowStart = (now = new Date()): string => new Date(now.getTime() - 86_400_000).toISOString();
export const weekStart = (now = new Date()): string => new Date(Date.parse(dayStart(now)) - 6 * 86_400_000).toISOString();
