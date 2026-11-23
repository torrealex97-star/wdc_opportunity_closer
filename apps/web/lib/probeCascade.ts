import type { SourceRoute } from './sourceRoutes';

// «Probar ruta» recoge de verdad: prueba las vías listas por orden de coste y se detiene en la primera que recoge. Una
// respuesta correcta sin ofertas NO cuenta como recogida (era lo que dejaba a muchas fuentes en «0 guardadas» sin intentar
// nada más). Lógica pura, sin red: el panel solo la ejecuta y la prueba la comprueba.

/** Vías que se intentan como máximo en una pulsación: acota el gasto de una prueba (≈ 0,03 US$ en el peor caso de pago por búsqueda; Apify, con tope de 0,50 US$, solo entra si es la vía elegida). */
export const MAX_PROBE_ATTEMPTS = 3;

export type ProbeBody = { detail?: string; note?: string; accepted?: number; cost_usd?: number; engine?: unknown; async?: boolean };

/** ¿Recogió o dejó en marcha algo real? Ofertas guardadas, estado real del motor con catálogo o una búsqueda de Apify lanzada. */
export const isCollected = (ok: boolean, body: ProbeBody): boolean =>
  ok && (body.engine !== undefined || body.async === true || (body.accepted ?? 0) > 0);

/** Vías que solo se prueban si son la elegida (primera): el Unlocker necesita una URL concreta y Apify gasta hasta 0,50 US$ por prueba. */
const ONLY_IF_FIRST = new Set(['unlocker', 'apify']);

/**
 * Vías que recogen DE ESTA FUENTE (su motor, su API oficial, su actor de Apify, su página). Las demás (Google Jobs por Bright
 * Data, JSearch o SerpApi con `site:`) son una búsqueda en Google y guardan sus ofertas bajo «google-jobs»: no prueban la fuente.
 * Por eso van detrás: pulsar «Probar ruta» en Upwork o Indeed prueba primero su propio actor, no Google.
 */
const OWN_ROUTES = new Set(['engine', 'backend', 'official', 'apify']);

/** Vías a intentar: primero las propias de la fuente y después, como respaldo, las de Google; como máximo `MAX_PROBE_ATTEMPTS`. Las de `ONLY_IF_FIRST` no entran como respaldo. */
export function planAttempts(ready: SourceRoute[]): SourceRoute[] {
  const ordered = [...ready.filter(route => OWN_ROUTES.has(route.provider)), ...ready.filter(route => !OWN_ROUTES.has(route.provider))];
  return ordered.filter((route, index) => !(ONLY_IF_FIRST.has(route.provider) && index > 0)).slice(0, MAX_PROBE_ATTEMPTS);
}

/** Texto de una vía probada: la causa o la nota, y «Sin ofertas nuevas» si respondió bien pero no recogió nada. */
export function attemptMessage(ok: boolean, body: ProbeBody): string {
  if (!ok) return body.detail ?? 'La prueba falló.';
  const text = body.note ?? (body.accepted !== undefined ? `${body.accepted} oferta(s) guardadas.` : 'Prueba completada.');
  return isCollected(ok, body) ? text : `${text} Sin ofertas nuevas.`;
}

/** Resumen final de la pulsación: cada intento con su vía, el motivo de pasar a la siguiente y el coste. */
export function summarize(log: string[], collected: boolean, attempted: number, available: number, spentUsd: number, formatUsd: (value: number) => string): string {
  const tail = collected ? '' : available > attempted ? ' Ninguna de las primeras vías recogió; quedan más en la lista.' : ' Ninguna vía lista recogió ofertas ahora.';
  return log.join(' → ') + tail + (spentUsd ? ` Coste: ${formatUsd(spentUsd)}.` : '');
}
