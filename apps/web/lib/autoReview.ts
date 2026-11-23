import { ORG, approvalsToday, approveByRule, markForReview, withdrawByRule, type ExternalOffer } from './external';
import { isSpanishOrEnglish, marketFor, type Market } from './market';
import { assessOffer } from './offerRisk';
import { serviceRest } from './supabaseAuth';
import { timeLeft } from './cronBudget';
import { config as aiConfig, runAiReview, type ReviewSummary } from './aiReview';

// Cualificación automática: las REGLAS deciden lo claro y la IA solo desempata lo dudoso.
// Antes, cada oferta esperaba a una persona; con el volumen actual eso dejaba la cola sin vaciar y
// las alumnas veían poco. Ahora entra sola la que cumple hechos comprobables (perfil, mercado,
// idioma español, puntuación suficiente, sin banderas rojas y enlace no cerrado). Lo que no cumple
// todo eso NO se aprueba «por si acaso»: queda en la cola de excepciones, que es lo que el
// propietario quiere revisar a mano.
// Tope diario: una regla mal ajustada no puede publicar miles de ofertas de golpe.
export const DAILY_CAP = 100;
export const MIN_SCORE = 55;
/** Caracteres de descripción por debajo de los cuales no se puede juzgar el idioma. */
export const MIN_DESCRIPTION = 40;
/** Parte de la ventana de revisión que se reserva a los borradores MÁS ANTIGUOS, para que ninguna fuente quede sin juzgar por puntuar menos. */
export const OLDEST_SHARE = 1 / 3;

// `flags`: avisos que la oferta lleva y que la alumna verá en un banner. Solo viajan cuando la regla aprueba
// CON aviso (`cumple_reglas_con_aviso`): lo crítico nunca se publica sola.
export type RuleVerdict = { decision: 'approve' | 'human' | 'withdraw'; why: string; market: Market | null; basis: string; flags?: string[] };
type Row = Pick<ExternalOffer, 'title' | 'company' | 'description' | 'location' | 'salary' | 'role' | 'score' | 'spain' | 'verified_result' | 'market' | 'market_basis' | 'url'> & { red_flags?: string[] | null };

// Páginas de resultados de un portal, no anuncios: «Ofertas de trabajo de Closer de ventas» con 737
// resultados, sin empresa y con la URL del listado. Aprobarlas mandaría a la alumna a un buscador, y
// dejarlas en la cola humana le pediría a una persona que cierre lo que ni siquiera es una oferta.
const INDEX_TITLE = /^\s*(?:ofertas? de (?:trabajo|empleo)|empleos? (?:de|en)|trabajos? (?:de|en)|bolsa de empleo|vacantes? (?:de|en)|job (?:openings|listings)|jobs? in|search results)\b/i;
// Solo el PLURAL: los portales usan el plural para el listado y el singular para la ficha de una oferta
// concreta. En producción, `/oferta-empleo/69/<hash>` es una oferta de Jobijoba y `/empleo/23-14660_…` una de
// Univision: con `s?` la regla las retiraba como si fueran listados (y una de ellas la había aprobado una
// persona a mano).
const INDEX_URL = /\/(?:ofertas-trabajo|ofertas-empleo|empleos|jobs?\/search|jobsearch|search\/jobs|vacantes)\b/i;
const isIndexPage = (row: Retirable) => (!row.company && INDEX_TITLE.test(row.title ?? '')) || INDEX_URL.test(row.url ?? '');

// Campos que bastan para decidir una retirada (sin leer la descripción). La auditoría del catálogo usa
// exactamente este tipo, así que no puede quedarse corta de datos sin que el compilador lo diga.
type Retirable = Pick<Row, 'title' | 'company' | 'url' | 'verified_result'>;

/**
 * Lo que las reglas retiran sin mirar nada más: una página de resultados de un portal o un enlace ya cerrado.
 * Se aísla para que la auditoría del catálogo (ofertas YA aprobadas) use el mismo criterio y no una copia que
 * se desincronice: una regla equivocada se vería en la auditoría antes de borrar nada.
 */
export function withdrawalReason(row: Retirable): string | null {
  if (isIndexPage(row)) return 'no_es_oferta';
  if (row.verified_result === 'closed') return 'enlace_cerrado';
  return null;
}

// Código de estado de EE. UU. al final de la ubicación («Miramar, FL», «El Paso, TX 79901»). El gazetteer
// español contiene Miramar y El Paso (municipios reales), así que una oferta de Florida se colaba como
// española y acababa delante de alumnas de España. En la revisión manda el dato literal del anuncio.
const US_STATE = /,\s*(?:AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|DC)\s*(?:\d{5}(?:-\d{4})?)?\s*$/i;

/** La decisión determinista, sin red. Se exporta para poder probarla caso por caso. */
export function judgeOffer(row: Row): RuleVerdict {
  const computed = marketFor(row);
  const us = US_STATE.test(row.location ?? '');
  const market: Market | null = us ? 'US_LATINO' : (row.market as Market | null | undefined) ?? computed.market;
  const basis = us ? 'ubicacion_estados_unidos' : row.market_basis ?? computed.basis;
  const verdict = (decision: RuleVerdict['decision'], why: string, flags?: string[]): RuleVerdict => ({ decision, why, market, basis, ...(flags?.length ? { flags } : {}) });
  const retire = withdrawalReason(row);
  if (retire) return verdict('withdraw', retire);
  // Lo que la máquina no puede arreglar NO se manda a una persona (decisión del propietario,
  // 2026-11-18): sin perfil, sin mercado o sin idioma reconocible se retira con su motivo. La cola
  // humana queda para el riesgo real (banderas rojas, oferta peligrosa) y la duda de mercado.
  if (!row.role) return verdict('withdraw', 'sin_perfil');
  if (!market) return verdict('withdraw', 'sin_mercado');
  if (row.spain === false && market === 'ES') return verdict('human', 'mercado_dudoso');
  if ((row.red_flags ?? []).length) return verdict('human', 'banderas_rojas');
  // Texto del anuncio con señales de condiciones dudosas. Lo CRÍTICO (pago previo, multinivel, ingresos
  // irreales) sigue sin publicarse solo. Lo que solo AVISA (solo comisión, publicidad a su cargo, sin
  // entrevista, contacto por WhatsApp, cifras altas) sí entra, pero marcado: la alumna ve el banner y decide.
  const risk = assessOffer(row);
  const flags = risk.detected_flags.map(flag => flag.code);
  if (risk.risk_level === 'BLOCKED') return verdict('human', 'oferta_peligrosa');
  if ((row.score ?? 0) < MIN_SCORE) return verdict('withdraw', 'score_bajo');
  // Español o inglés (2026-11-18). El inglés se publica igual que el castellano; la alumna lo
  // separa con su filtro de idioma. Cualquier otro idioma no se puede ofrecer y se retira.
  if (!isSpanishOrEnglish(`${row.title ?? ''} ${row.description ?? ''}`)) {
    // Sin descripción (o casi) el idioma no se puede juzgar con solo el título: no es «otro idioma», es falta de datos. Una persona la mira
    // (cola humana) en vez de perderla; nunca se aprueba sin datos. Con descripción real en otro idioma sigue retirándose.
    return (row.description ?? '').trim().length < MIN_DESCRIPTION ? verdict('human', 'sin_descripcion') : verdict('withdraw', 'idioma_dudoso');
  }
  if (flags.length) return verdict('approve', 'cumple_reglas_con_aviso', flags);
  return verdict('approve', 'cumple_reglas');
}

/**
 * Ventana de borradores a juzgar: casi todo por puntuación (las mejores primero, como siempre) y una parte reservada a los más
 * antiguos. Solo por puntuación, los borradores que cumplen las reglas pero no caben en el tope de hoy se quedan para siempre
 * al frente y los de otras fuentes que puntúan menos nunca llegan a juzgarse (medido: LinkedIn, 46 borradores sin juzgar).
 */
export function reviewWindow<T extends { id: string }>(byScore: T[], oldest: T[], limit: number): T[] {
  const reserved = Math.min(oldest.length, Math.floor(limit * OLDEST_SHARE));
  const out = new Map<string, T>();
  for (const row of byScore.slice(0, Math.max(0, limit - reserved))) out.set(row.id, row);
  for (const row of oldest) { if (out.size >= limit) break; out.set(row.id, row); }
  for (const row of byScore) { if (out.size >= limit) break; if (!out.has(row.id)) out.set(row.id, row); }
  return [...out.values()];
}

export type AutoSummary = {
  checked: number;
  approved: number;
  /** Retiradas por no ser un anuncio (listado de portal) o porque el enlace está cerrado. */
  withdrawn: number;
  exceptions: number;
  /** Filas que la base confirma movidas a la cola humana (no lo que se intentó). */
  moved?: number;
  used_before: number | null;
  cap: number;
  by_reason: Record<string, number>;
  ai: ReviewSummary | null;
  truncated?: boolean;
  failed_writes?: number;
};

type AutoDeps = { deadline?: number; cap?: number; ai?: typeof runAiReview };

export async function runAutoReview(deps: AutoDeps = {}): Promise<AutoSummary> {
  const cap = Math.max(0, Math.min(deps.cap ?? DAILY_CAP, DAILY_CAP));
  const used = await approvalsToday();
  const summary: AutoSummary = { checked: 0, approved: 0, withdrawn: 0, exceptions: 0, used_before: used, cap, by_reason: {}, ai: null };
  // Sin saber cuántas se aprobaron hoy no se aprueba ninguna: el tope es una garantía, no una estimación.
  if (used === null) return { ...summary, truncated: true };
  const remaining = cap - used;
  if (remaining <= 0) return summary;

  const now = new Date().toISOString();
  // Solo borradores vivos, por puntuación: si hay más que tope, entran las mejores y el resto espera a mañana.
  const limit = Math.min(remaining + 20, 120);
  const base = `external_offers?org_id=eq.${ORG}&editorial_status=eq.draft&expires_at=gt.${encodeURIComponent(now)}&select=id,title,company,description,location,salary,role,score,spain,verified_result,market,market_basis,red_flags,url`;
  const [response, oldestResponse] = await Promise.all([
    serviceRest(`${base}&order=score.desc&limit=${limit}`),
    serviceRest(`${base}&order=first_seen_at.asc&limit=${Math.ceil(limit * OLDEST_SHARE)}`).catch(() => null),
  ]);
  const scored = response.ok ? await response.json().catch(() => null) : null;
  const oldest = oldestResponse?.ok ? await oldestResponse.json().catch(() => null) : null;
  // Si la lectura de los antiguos falla, se sigue con la de siempre (por puntuación): el reparto es una mejora, no una condición.
  const rows = Array.isArray(scored) ? reviewWindow(scored as Array<{ id: string }>, Array.isArray(oldest) ? oldest as Array<{ id: string }> : [], limit) : null;
  if (!Array.isArray(rows)) return { ...summary, truncated: true };

  // Aprobadas separadas por cómo se aprueban: las limpias y las que llevan aviso (con sus banderas).
  const clear: string[] = [];
  const caution = new Map<string, { ids: string[]; flags: string[] }>();
  // Lo que las reglas no cierran se agrupa por motivo: una escritura por motivo, no una por oferta.
  const human = new Map<string, string[]>();
  const retired = new Map<string, string[]>();
  for (const row of rows as Array<Row & { id: string }>) {
    if (timeLeft(deps.deadline) < 1_500) { summary.truncated = true; break; }
    summary.checked++;
    const verdict = judgeOffer(row);
    if (verdict.decision === 'approve') {
      const room = clear.length + [...caution.values()].reduce((n, g) => n + g.ids.length, 0) + summary.approved < remaining;
      if (room && verdict.flags?.length) {
        const key = verdict.flags.join(',');
        const group = caution.get(key) ?? { ids: [], flags: verdict.flags };
        group.ids.push(row.id); caution.set(key, group);
        continue;
      }
      if (room) { clear.push(row.id); continue; }
      // Cumple las reglas pero no cabe en el tope de hoy: se queda en borrador para mañana;
      // mandarla a la cola humana sería pedirle a una persona trabajo que la máquina ya sabe hacer.
      summary.exceptions++;
      summary.by_reason.tope_diario = (summary.by_reason.tope_diario ?? 0) + 1;
      continue;
    }
    summary.by_reason[verdict.why] = (summary.by_reason[verdict.why] ?? 0) + 1;
    // Ni es un anuncio ni se puede mostrar: se retira. No gasta cupo de aprobaciones y no ocupa la cola
    // humana con algo que una persona no puede arreglar.
    if (verdict.decision === 'withdraw') {
      const out = retired.get(verdict.why) ?? [];
      out.push(row.id); retired.set(verdict.why, out);
      continue;
    }
    summary.exceptions++;
    const bucket = human.get(verdict.why) ?? [];
    bucket.push(row.id); human.set(verdict.why, bucket);
  }

  // Una sola escritura con guarda de estado; se cuenta lo que la base confirma.
  for (let i = 0; i < clear.length; i += 100) {
    const n = await approveByRule(clear.slice(i, i + 100), { decision: 'approve', why: 'cumple_reglas', rule: 'reglas_v1', at: now });
    if (n === null) summary.failed_writes = (summary.failed_writes ?? 0) + Math.min(100, clear.length - i);
    else summary.approved += n;
  }

  // Aprobadas CON aviso: misma guarda y mismo cupo, pero el motivo y las banderas quedan guardados para
  // que la vista de alumna enseñe el banner y el panel pueda auditar qué se publicó con reservas.
  for (const group of caution.values()) {
    for (let i = 0; i < group.ids.length; i += 100) {
      const batch = group.ids.slice(i, i + 100);
      const n = await approveByRule(batch, { decision: 'approve', why: 'cumple_reglas_con_aviso', rule: 'reglas_v1', at: now, flags: group.flags });
      if (n === null) summary.failed_writes = (summary.failed_writes ?? 0) + batch.length;
      else {
        summary.approved += n;
        // Como el resto de motivos, se cuenta lo que la base confirma: si una persona movió la oferta
        // entre la lectura y la escritura, la guarda la descarta y no debe aparecer en el recuento.
        if (n) summary.by_reason.cumple_reglas_con_aviso = (summary.by_reason.cumple_reglas_con_aviso ?? 0) + n;
      }
    }
  }

  // Retiradas: misma guarda de estado (solo borradores) y se cuenta lo que confirma la base.
  for (const [reason, ids] of retired) {
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      const n = await withdrawByRule(batch, { decision: 'withdraw', why: reason, rule: 'reglas_v1', at: now });
      if (n === null) summary.failed_writes = (summary.failed_writes ?? 0) + batch.length;
      else summary.withdrawn += n;
    }
  }

  // La cola de excepciones se llena de verdad: hasta ahora solo se contaba y cada pasada dejaba todo
  // en borradores, así que el panel mostraba «0 a revisar» con miles esperando a una persona.
  for (const [reason, ids] of human) {
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      const n = await markForReview(batch, { decision: 'human', why: reason, rule: 'reglas_v1', at: now });
      if (n === null) summary.failed_writes = (summary.failed_writes ?? 0) + batch.length;
      else summary.moved = (summary.moved ?? 0) + n;
    }
  }

  // Desempate: solo si hay hueco, la IA está en vivo y queda presupuesto. Su cupo es lo que queda del tope
  // diario —`remaining` ya cuenta sus aprobaciones de hoy, no solo las de las reglas— y viaja como ENTORNO
  // EXPLÍCITO de esta llamada: antes se escribía en `process.env` y se restauraba, así que dos pasadas
  // simultáneas se pisaban el límite entre sí (y el proceso quedaba con el valor de la otra).
  const cfg = aiConfig();
  const left = remaining - summary.approved;
  if (cfg.mode === 'live' && left > 0 && timeLeft(deps.deadline) > 25_000) {
    const env = { ...process.env, AI_REVIEW_MAX_APPROVALS: String(Math.min(left, cfg.maxApprovals)) };
    summary.ai = await (deps.ai ?? runAiReview)({ deadline: deps.deadline, env }).catch(() => null);
  } else if (cfg.mode === 'shadow') {
    summary.ai = { mode: 'shadow', reviewed: 0, would_approve: 0, would_withdraw: 0, human: summary.exceptions, applied: 0, skipped: 'reglas en vivo; la IA solo anota (AI_REVIEW_MODE=shadow)' };
  }
  return summary;
}
