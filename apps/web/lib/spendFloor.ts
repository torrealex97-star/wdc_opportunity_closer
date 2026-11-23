// Mínimo diario por fuente de pago y tope global de gasto (decisión del dueño, 2026-11-23).
//
// El waterfall solo lanza vías de pago mientras falte objetivo de ofertas cualificadas del día. Resultado medido: una fuente
// de pago puede pasar días sin correr aunque esté bien conectada, y entonces nunca acumula muestra (1.000 ofertas) para
// poder juzgarla. El mínimo diario hace que cada etapa conectada corra un poco CADA DÍA, con un tope propio pequeño: no es
// una cuota de resultados, es muestra. Módulo puro: sin red, sin Supabase, sin entorno propio (el entorno entra por parámetro).

/** Horas sin una ejecución buena de la etapa a partir de las cuales toca su mínimo. */
export const FLOOR_HOURS = 20;

/** Lo que una etapa puede gastar cuando corre solo por su mínimo (no por falta de objetivo). */
export const FLOOR_LIMITS = { googleDorks: 3, rapidapiRequests: 1, tavilySearches: 1, fallbackSearches: 1 } as const;

/** Etapas del cron con vía de pago a las que se aplica el mínimo (los ids son los de `stages` del cron). */
export const FLOOR_STAGES = ['google-jobs', 'rapidapi', 'respaldo', 'apify'] as const;
export type FloorStage = (typeof FLOOR_STAGES)[number];

/** Tope global por ahora (decisión del dueño, 2026-11-23: «por ahora 30 US$»); `GLOBAL_PAID_CAP_USD` lo cambia. */
export const DEFAULT_GLOBAL_CAP_USD = 30;

/** `GLOBAL_PAID_CAP_USD` del entorno; un valor ausente, no numérico o ≤ 0 cae al defecto (nunca «sin tope»). */
export function globalCapUsd(env: Record<string, string | undefined> = process.env): number {
  const raw = Number(env.GLOBAL_PAID_CAP_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_GLOBAL_CAP_USD;
}

export type GlobalCheck = { ok: boolean; reason?: string; spent: number | null; cap: number };

/**
 * ¿Cabe `nextUsd` más sin pasar del tope global? Suma el gasto de TODOS los proveedores (los medidos y Apify). Si alguna
 * parte no se pudo leer (`null`) el total es desconocido y NO se gasta: un hueco no es un cero.
 */
export function globalCheck(parts: Array<number | null>, cap: number, nextUsd = 0): GlobalCheck {
  if (parts.some(part => part === null)) {
    return { ok: false, reason: 'No se pudo leer todo el gasto del mes; por seguridad no se lanza gasto nuevo.', spent: null, cap };
  }
  const spent = (parts as number[]).reduce((sum, part) => sum + part, 0);
  if (spent + nextUsd > cap + 1e-9) {
    return { ok: false, reason: `Tope global del mes: quedan ${Math.max(0, cap - spent).toFixed(2)} USD de ${cap} USD entre todos los proveedores.`, spent, cap };
  }
  return { ok: true, spent, cap };
}

/** Línea que el cron anota por etapa: `etapa=<id> · corrió|saltada · motivo`. */
export const stageNote = (id: string, ran: boolean, why: string) => `etapa=${id} · ${ran ? 'corrió' : 'saltada'} · ${why}`.slice(0, 300);

export function parseStageNote(note: string | null | undefined): { id: string; ran: boolean } | null {
  const match = /^etapa=([a-z0-9-]+) · (corrió|saltada)(?: |$)/.exec(note ?? '');
  return match ? { id: match[1], ran: match[2] === 'corrió' } : null;
}

export type StageRow = { note: string | null; created_at: string };

/** Última vez (ISO) que cada etapa CORRIÓ según el registro del cron. Una etapa nunca vista no aparece. */
export function lastRanByStage(rows: StageRow[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of rows) {
    const parsed = parseStageNote(row.note);
    if (!parsed?.ran) continue;
    const seen = out.get(parsed.id);
    if (!seen || row.created_at > seen) out.set(parsed.id, row.created_at);
  }
  return out;
}

/**
 * ¿Toca el mínimo diario de esta etapa? `history === null` es «no se pudo leer el registro»: no toca (sin saber si ya corrió hoy,
 * no se gasta). Sin ninguna ejecución anterior sí toca. Si corrió hace menos de `FLOOR_HOURS`, no.
 */
export function floorDue(stage: string, history: Map<string, string> | null, now = Date.now(), hours = FLOOR_HOURS): boolean {
  if (history === null) return false;
  const last = history.get(stage);
  return !last || now - Date.parse(last) >= hours * 3600_000;
}
