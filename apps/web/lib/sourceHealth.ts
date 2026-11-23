// Salud por fuente: ¿está bien CONECTADA para poder dar ofertas? (decisión del dueño, 2026-11-23).
//
// No mide rendimiento ni recorta nada: una fuente se juzga con ≥1.000 ofertas (`sourceSample.ts`). Esto dice solo si
// la conexión es correcta y, si no, por qué. Módulo puro: sin red, sin Supabase, sin variables de entorno.

import type { SourceRoute } from './sourceRoutes';

export type HealthState =
  | 'conectada'           // tiene vía lista y no se ve ningún fallo de conexión
  | 'sin_via'             // ninguna vía verificada: no puede dar ofertas todavía
  | 'sin_clave'           // existe una vía, pero falta la clave (o saldo/tope)
  | 'mal_conectada'       // corre y falla, o corre «bien» y devuelve siempre 0
  | 'sin_programar'       // vía de pago lista, pero ningún actor programado a diario y no ha recogido nunca
  | 'sin_juzgar';         // recoge, pero la mayoría queda en borrador sin revisar

export type ApifyRunLite = { actor_id: string; status: string; items: number | null; error: string | null; started_at: string };
export type ApifyActorLite = { id: string; status?: string | null; schedule_daily?: boolean | null };

export type HealthInput = {
  source: string;
  routes: SourceRoute[];
  /** ¿alguna vía está lista con las claves guardadas? `reason` es el motivo de la primera que no lo está. */
  ready: boolean;
  notReadyReason: string;
  actors: ApifyActorLite[];
  /** Ejecuciones de Apify de esta fuente en la ventana (ya filtradas), de más reciente a más antigua. */
  runs: ApifyRunLite[];
  seen: number | null;
  drafts: number | null;
};

export type SourceHealth = { source: string; state: HealthState; cause: string; next: string };

/** Fallos seguidos que se tratan como «mal conectada» (no es pausa por rendimiento: es la entrada o la clave). */
export const BROKEN_AFTER = 3;
/** Con al menos este número de borradores y esta proporción, se declara «sin juzgar». */
export const UNJUDGED_MIN = 20;
export const UNJUDGED_SHARE = 0.5;

const isFail = (status: string) => /^(FAILED|TIMED[-_]OUT|ABORTED)$/.test(status);

/** Resumen de las ejecuciones: cuenta de las más recientes seguidas del mismo tipo de problema. */
export function runSummary(runs: ApifyRunLite[]): { ok: number; failed: number; okZero: number; lastError: string | null } {
  let ok = 0, failed = 0, okZero = 0, lastError: string | null = null;
  for (const run of runs) {
    if (isFail(run.status)) { failed += 1; lastError ??= run.error; }
    else if (run.status === 'SUCCEEDED') { ok += 1; if ((run.items ?? 0) === 0) okZero += 1; }
  }
  return { ok, failed, okZero, lastError };
}

const clip = (value: string, max = 160) => value.replace(/\s+/g, ' ').trim().slice(0, max);

export function classifySource(input: HealthInput): SourceHealth {
  const { source, routes, ready, notReadyReason, actors, runs, seen, drafts } = input;
  const usable = routes.filter(route => route.evidence !== 'bloqueado' && route.provider !== 'agent');
  const out = (state: HealthState, cause: string, next: string): SourceHealth => ({ source, state, cause, next });

  // Lo que ya está dando ofertas manda sobre lo demás: una fuente que recoge no está «sin vía».
  const summary = runSummary(runs);
  const activeActors = actors.filter(actor => actor.status !== 'inactive');
  const retired = actors.length > 0 && activeActors.length === 0;

  // Fallo de conexión demostrado (no de rendimiento): mismas ejecuciones, todas mal o todas vacías.
  if (summary.failed >= BROKEN_AFTER && summary.ok === 0) {
    return out('mal_conectada', summary.lastError ? `Falla siempre: ${clip(summary.lastError)}` : `${summary.failed} ejecuciones fallidas seguidas, sin motivo registrado.`, 'Revisar la plantilla de entrada del actor (esquema real) o retirarlo con motivo.');
  }
  if (summary.okZero >= BROKEN_AFTER && summary.okZero === summary.ok && summary.failed === 0) {
    return out('mal_conectada', `${summary.okZero} ejecuciones correctas con 0 ofertas: la búsqueda o la entrada no devuelve nada.`, 'Probar con 10 resultados y leer la salida; corregir términos o campos de la entrada.');
  }
  if (retired && !usable.some(route => route.provider !== 'apify')) {
    return out('sin_via', 'El actor de Apify de esta fuente está retirado y no hay otra vía.', 'Auditar otro actor con metadatos públicos o dejarla «sin proveedor verificado».');
  }

  if (!usable.length) return out('sin_via', 'Sin proveedor verificado: no hay una vía que se pueda lanzar.', 'Auditar un actor o API (existe, no obsoleto, esquema leído) antes de conectarla.');
  if (!ready) return out('sin_clave', notReadyReason || 'Ninguna vía está lista con las claves guardadas.', 'Guardar la clave o esperar al nuevo mes/tope.');

  const apifyOnly = usable.every(route => route.provider === 'apify');
  if (apifyOnly && actors.length > 0 && !activeActors.some(actor => actor.schedule_daily) && (seen ?? 0) === 0 && runs.length === 0) {
    return out('sin_programar', 'La vía existe y está lista, pero ningún actor está programado a diario y no ha recogido nunca.', 'Hacer una prueba de 10 resultados y, si devuelve ofertas, activar la programación diaria.');
  }

  if (seen !== null && drafts !== null && drafts >= UNJUDGED_MIN && drafts / Math.max(seen, 1) >= UNJUDGED_SHARE) {
    return out('sin_juzgar', `${drafts} de ${seen} ofertas siguen en borrador: se recogen pero no llegan a juzgarse.`, 'Revisar por qué la revisión automática no las alcanza (cupo, puntuación o reglas).');
  }

  return out('conectada', 'Vía lista y sin fallos de conexión a la vista.', 'Sigue acumulando hasta las 1.000 ofertas para poder juzgarla.');
}

export const HEALTH_LABEL: Record<HealthState, string> = {
  conectada: 'Conectada',
  sin_via: 'Sin vía verificada',
  sin_clave: 'Falta clave o saldo',
  mal_conectada: 'Mal conectada',
  sin_programar: 'Sin programar',
  sin_juzgar: 'Ofertas sin juzgar',
};
