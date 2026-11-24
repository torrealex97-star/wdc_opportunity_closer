import type { SourceHealth } from './sourceHealth';
import type { EngineView } from './engineSources';
import type { SourceKind } from './sourceKinds';

// Control total de fuentes (criterio del propietario, 2026-11-24): una fuente solo está «hecha» si en los últimos 7 días dio al menos una oferta
// CUALIFICADA, o si está bloqueada con una causa escrita y un dueño. Todo lo demás se marca «a trabajar» con su causa y su siguiente paso.
// Módulo puro: clasifica con los datos que le dan; un dato que falta no se convierte en 0.
export type ControlState = 'cualificadas' | 'recoge_sin_cualificar' | 'sin_recoger' | 'rota' | 'necesita_dato' | 'sin_via';
export type Owner = 'claude' | 'propietario';
export type ControlInput = {
  source: string; name: string; kind: SourceKind;
  health: SourceHealth | null;
  /** Ofertas vistas por primera vez en la ventana y aprobadas/publicadas entre ellas (`null` = no se pudo leer). */
  seen7: number | null; approved7: number | null;
  /** Fuentes del motor: lo que informa el motor (catálogo y elegibles). */
  engine: EngineView | null;
  /** Motivos de descarte de lo revisado en la ventana (`auto_review.why`) y borradores que siguen sin juzgar (`null` = no se pudo leer). */
  reasons?: Array<{ why: string; n: number }> | null; drafts7?: number | null;
};
export type ControlItem = {
  source: string; name: string; kind: SourceKind; state: ControlState; owner: Owner | null;
  collected: number | null; qualified: number | null; cause: string; next: string; done: boolean;
  reasons: Array<{ why: string; label: string; n: number }>; drafts: number | null;
};
export type ControlSummary = {
  total: number; qualified: number; counts: Record<ControlState, number>; todo: ControlItem[]; items: ControlItem[];
  headline: string;
};

/** Fuentes que NO pueden dar ofertas por causas conocidas, con su motivo y de quién es el siguiente paso (así dejan de parecer fallos sin dueño). */
export const BLOCKED: Record<string, { state: 'necesita_dato' | 'sin_via'; owner: Owner; why: string; next: string }> = {
  'apify-facebook': { state: 'necesita_dato', owner: 'propietario', why: 'El actor exige las direcciones de los grupos de Facebook que hay que mirar.', next: 'Pasar las URLs de los grupos y las añado a su búsqueda.' },
  'apify-skool': { state: 'necesita_dato', owner: 'propietario', why: 'El actor exige las direcciones de las comunidades de Skool.', next: 'Pasar las URLs de las comunidades.' },
  'apify-telegram': { state: 'necesita_dato', owner: 'propietario', why: 'El actor exige los canales de Telegram que hay que leer.', next: 'Pasar los canales (nombre o enlace).' },
  'apify-reddit': { state: 'sin_via', owner: 'claude', why: 'Devuelve publicaciones, no ofertas de empleo.', next: 'Decidir si se retira del catálogo con su motivo o se filtra por subreddit de empleo.' },
};

/** Cómo se llama cada motivo de descarte y qué hacer con él: es lo que convierte «no cualifica» en un arreglo concreto. */
export const REASONS: Record<string, { label: string; next: string }> = {
  sin_perfil: { label: 'no es de closer, setter ni cold calling', next: 'Afinar su búsqueda: sus términos traen puestos de otro perfil (banco de términos y negativos).' },
  sin_mercado: { label: 'fuera de España, LatAm y EE. UU. en español', next: 'Fijar el país en su búsqueda (o el filtro de idioma del actor): trae ofertas de otros mercados.' },
  mercado_dudoso: { label: 'mercado dudoso', next: 'Pedirle la ubicación completa o leer la ficha de detalle: sin ubicación clara no se puede aprobar.' },
  idioma_dudoso: { label: 'idioma dudoso', next: 'Filtrar por idioma en origen (español) o leer la descripción completa.' },
  score_bajo: { label: 'puntuación baja', next: 'Enriquecer la oferta (descripción, sueldo, comisión): puntúa bajo por falta de datos.' },
  sin_descripcion: { label: 'sin descripción', next: 'Leer la ficha de detalle de las candidatas: llegan sin cuerpo.' },
  enlace_cerrado: { label: 'enlace caído o cerrada', next: 'Acortar la ventana de fechas: está trayendo anuncios ya cerrados.' },
  no_es_oferta: { label: 'no es una oferta', next: 'Afinar el extractor: está guardando páginas que no son anuncios.' },
  banderas_rojas: { label: 'banderas rojas', next: 'Revisar a mano las marcadas: pueden ser reales.' },
  oferta_peligrosa: { label: 'oferta sospechosa', next: 'Revisar a mano las marcadas antes de decidir.' },
  tope_diario: { label: 'tope diario de aprobación', next: 'Subir el cupo diario si la calidad lo permite.' },
};
const reasonLabel = (why: string) => REASONS[why]?.label ?? why;
const n = (v: number | null) => (v === null ? '—' : new Intl.NumberFormat('es').format(v));

export function classify(input: ControlInput): ControlItem {
  const { source, name, kind, health, engine } = input;
  const reasons = (input.reasons ?? []).slice().sort((a, b) => b.n - a.n).slice(0, 3).map(r => ({ why: r.why, label: reasonLabel(r.why), n: r.n }));
  const drafts = input.drafts7 ?? null;
  const base = { source, name, kind, reasons, drafts };
  const collected = engine ? engine.catalog : input.seen7;
  const qualified = engine ? engine.eligible : input.approved7;
  const blocked = BLOCKED[source];
  if (blocked && (qualified ?? 0) === 0) return { ...base, state: blocked.state, owner: blocked.owner, collected, qualified, cause: blocked.why, next: blocked.next, done: false };
  if (health?.state === 'sin_via') return { ...base, state: 'sin_via', owner: 'claude', collected, qualified, cause: health.cause, next: health.next, done: false };
  if (health?.state === 'sin_clave') return { ...base, state: 'necesita_dato', owner: 'propietario', collected, qualified, cause: health.cause, next: health.next, done: false };
  if (health?.state === 'mal_conectada') return { ...base, state: 'rota', owner: 'claude', collected, qualified, cause: health.cause, next: health.next, done: false };
  if (qualified === null || collected === null) {
    return { ...base, state: 'sin_recoger', owner: 'claude', collected, qualified, cause: 'No se pudo leer lo que recoge: no se sabe si funciona.', next: 'Mirar si el motor o la base responden y reintentar.', done: false };
  }
  if (qualified > 0) return { ...base, state: 'cualificadas', owner: null, collected, qualified, cause: `${n(qualified)} cualificadas de ${n(collected)} recogidas.`, next: 'Nada que hacer: seguir midiendo.', done: true };
  if (collected > 0) {
    const parts = [`Recoge ${n(collected)} y ninguna es cualificada`];
    if (drafts) parts.push(`${n(drafts)} siguen en borrador sin juzgar`);
    if (reasons.length) parts.push(`lo juzgado se descarta sobre todo por: ${reasons.map(r => `${r.label} (${n(r.n)})`).join(', ')}`);
    else if (engine?.reviewed !== null && engine?.reviewed !== undefined) parts.push(`el motor revisó ${n(engine.reviewed)} y ninguna cumple las reglas de closer, setter o cold calling`);
    const next = reasons[0] ? (REASONS[reasons[0].why]?.next ?? 'Ver por qué la descarta esa regla y corregir su búsqueda, su filtro o su extracción.')
      : drafts ? 'Juzgarlas: pasar la IA a «live» en la bandeja o revisarlas a mano; mientras sigan en borrador no cuentan.'
      : 'Ver qué regla la descarta (rol, mercado, idioma, enlace o puntuación) y corregir su búsqueda, su filtro o su extracción.';
    return { ...base, state: 'recoge_sin_cualificar', owner: 'claude', collected, qualified, cause: `${parts.join('; ')}.`, next, done: false };
  }
  return { ...base, state: 'sin_recoger', owner: 'claude', collected, qualified, cause: health?.state === 'sin_programar' ? health.cause : 'Está conectada pero no ha recogido nada en la ventana.', next: health?.state === 'sin_programar' ? health.next : 'Programarla o probarla y revisar su entrada: una fuente conectada que no recoge está mal ajustada.', done: false };
}

const ORDER: ControlState[] = ['rota', 'recoge_sin_cualificar', 'sin_recoger', 'necesita_dato', 'sin_via', 'cualificadas'];
const empty = (): Record<ControlState, number> => ({ cualificadas: 0, recoge_sin_cualificar: 0, sin_recoger: 0, rota: 0, necesita_dato: 0, sin_via: 0 });

export function summarize(inputs: ControlInput[]): ControlSummary {
  const items = inputs.map(classify);
  const counts = empty(); for (const item of items) counts[item.state] += 1;
  const rank = (item: ControlItem) => ORDER.indexOf(item.state);
  items.sort((a, b) => rank(a) - rank(b) || (b.collected ?? -1) - (a.collected ?? -1) || a.name.localeCompare(b.name));
  const todo = items.filter(item => !item.done);
  const total = items.length;
  return { total, qualified: counts.cualificadas, counts, todo, items, headline: total === 0 ? 'No hay fuentes que medir.' : `${counts.cualificadas} de ${total} fuentes dan ofertas cualificadas.` };
}
