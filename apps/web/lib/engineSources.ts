import type { SourceHealth } from './sourceHealth';
import { fmtInt } from './formatInt';

// Estado real de las fuentes gratuitas del MOTOR (Worker `closer-engine`, su propia base D1): `GET /api/funnel` dice, por fuente, cuánto hay en su
// catálogo, cuántas ofertas revisó, cuántas son elegibles (cumplen perfil, mercado, idioma y enlace) y cuántas seleccionó hoy, y cómo terminó su último
// intento. Esas ofertas NO pasan por `external_offers` de Supabase (solo Jooble y las vías de pago lo hacen), así que contarlas allí daba 0 aunque el
// motor las recogiera cada día. Módulo puro: traduce ese informe a lo que enseña el panel. Un dato que falta es `null`, nunca 0.
export type EngineSource = { code?: unknown; name?: unknown; catalogo?: unknown; revisadas?: unknown; elegible?: unknown; seleccionada?: unknown; run_status?: unknown; fuente?: unknown };
export type EngineView = { catalog: number | null; reviewed: number | null; eligible: number | null; selected: number | null; run_status: 'completed' | 'failed' | 'unknown'; cause: string | null };
export type EngineFunnel = { last_run?: { day?: unknown; status?: unknown } | null; sources?: EngineSource[] | null; generated_at?: unknown };

const count = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);

export function engineView(source: EngineSource): EngineView {
  const status = source.run_status === 'completed' || source.run_status === 'failed' ? source.run_status : 'unknown';
  return { catalog: count(source.catalogo), reviewed: count(source.revisadas), eligible: count(source.elegible), selected: count(source.seleccionada), run_status: status, cause: typeof source.fuente === 'string' && source.fuente.trim() ? source.fuente.trim().slice(0, 200) : null };
}

/** Por código de fuente. Las entradas sin código no se pueden asociar a ninguna fila y se ignoran. */
export function engineBySource(funnel: EngineFunnel | null | undefined): Map<string, EngineView> {
  const out = new Map<string, EngineView>();
  for (const source of Array.isArray(funnel?.sources) ? funnel!.sources! : []) if (typeof source.code === 'string' && source.code) out.set(source.code, engineView(source));
  return out;
}

const n = (value: number | null) => (value === null ? '—' : fmtInt(value));

/** Conexión de una fuente del motor según su último intento: fallo declarado, respuesta sin ofertas en catálogo, o recogiendo. */
export function engineHealth(source: string, view: EngineView): SourceHealth {
  if (view.run_status === 'failed') {
    return { source, state: 'mal_conectada', cause: `El motor la intentó y falló${view.cause ? `: ${view.cause}` : ''}.`, next: 'Comprobar que la dirección sigue viva o retirarla del catálogo con su motivo; no se oculta.' };
  }
  if (view.run_status === 'completed' && (view.catalog ?? 0) === 0) {
    return { source, state: 'mal_conectada', cause: 'El motor la leyó pero no hay ninguna oferta suya en el catálogo.', next: 'Revisar su búsqueda o su dirección: respondió sin traer nada.' };
  }
  if (view.run_status === 'unknown') {
    return { source, state: 'conectada', cause: 'El motor no informa del resultado de su último intento.', next: 'Mirar el último run del motor.' };
  }
  return { source, state: 'conectada', cause: `Recoge cada día: ${n(view.reviewed)} revisadas, ${n(view.eligible)} elegibles y ${n(view.selected)} seleccionadas hoy.`, next: 'Nada que hacer.' };
}
