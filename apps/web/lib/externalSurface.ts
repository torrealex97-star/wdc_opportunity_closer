import { spanishWords } from './offerScore';
import { listOffers, pausedSourcesStrict, type ExternalOffer } from './external';
import { englishWords, marketFor, type Market } from './market';
import { assessOffer, FLAG_TEXT } from './offerRisk';
import { spainSignal } from './esPlaces';
import { fold, roleFromTitle, ROLE_LABELS, type RoleFamily } from './vocabulary';

// Ofertas externas aprobadas, con el contrato Opportunity de la vista de alumna. Nada se inventa: lo que la
// fuente no dice sale como «no indicado». Mismas puertas básicas que el motor: perfil por título, España por
// señal explícita, antigüedad y español (salvo que la alumna pida bilingüe).
type Query = {
  role: string | null; market: string; days: number; include_bilingual: boolean; starred_only: boolean;
  // Filtros separados (mismos nombres que el contrato). Opcionales aquí para no romper a quien ya
  // llamaba con la consulta de antes: sin ellos, no filtran.
  modality?: 'any' | 'remote' | 'hybrid' | 'onsite';
  sales_motion?: 'any' | 'outbound' | 'inbound';
};

// Modalidad y prospección declaradas por el anuncio. Mismo criterio que el motor
// (`modalityOf` / `salesMotionOf`): lo que la fuente marca como remoto y, si no, las palabras del
// propio anuncio. Nada se supone, y «no indicada» no entra en ningún filtro concreto.
const HYBRID_WORDS = /\b(?:hybrid|hibrid[oa]s?|semi[ -]?presencial|mixt[oa])\b/;
const REMOTE_WORDS = /\b(?:remote|remot[oa]s?|teletrabajo|home[ -]?office|work from home|en remoto|100[ %]*remoto)\b/;
const ONSITE_WORDS = /\b(?:presencial(?:es)?|on[ -]?site|in[ -]?office|en oficina|acude a la oficina)\b/;
const OUTBOUND_WORDS = /\b(?:outbound|cold ?call(?:s|ing)?|llamada fria|llamadas frias|prospeccion en frio|prospeccion telefonica|puerta fria)\b/g;
const INBOUND_WORDS = /\b(?:inbound|leads? entrantes?|incoming leads|leads? inbound|leads? proporcionados)\b/g;
// La negación vale dentro de la misma cláusula (la coma corta): «sin llamadas en frío, leads
// entrantes» niega la prospección en frío, no los leads entrantes.
const NEGATED_BEFORE = /\b(?:sin|no|nunca|ni|without|not)\b[^,.;:\n]{0,25}$/;
const MODALITY_FILTER_KEYS: Record<string, string> = { Remoto: 'remote', 'Híbrido': 'hybrid', Presencial: 'onsite' };

export function salesMotionOf(text: string): 'outbound' | 'inbound' | null {
  const folded = fold(text);
  const mentioned = (pattern: RegExp) => {
    for (const match of folded.matchAll(pattern)) {
      const before = folded.slice(Math.max(0, (match.index ?? 0) - 40), match.index ?? 0);
      if (!NEGATED_BEFORE.test(before)) return true;
    }
    return false;
  };
  if (mentioned(OUTBOUND_WORDS)) return 'outbound';
  if (mentioned(INBOUND_WORDS)) return 'inbound';
  return null;
}

export function declaredModality(o: ExternalOffer) {
  const flagged = o.raw?.is_remote === true ? ' remote ' : '';
  const hay = fold(`${o.title ?? ''} ${o.location ?? ''} ${flagged} ${o.description ?? ''}`);
  if (HYBRID_WORDS.test(hay)) return 'Híbrido';
  if (flagged || REMOTE_WORDS.test(hay)) return 'Remoto';
  if (ONSITE_WORDS.test(hay)) return 'Presencial';
  return 'Modalidad no indicada';
}

const PORTUGUESE = /\b(?:vendas|voce|comissoes|portugues|brasil)\b/;
const isGoogleUrl = (u: string) => /^https?:\/\/(www\.)?google\./i.test(u);

// El mismo anuncio se republica en varios portales (Google Jobs indexa Trabajo.org, JobLeads,
// BeBee…). Sin agrupar, la alumna ve tres veces el puesto de Fastrack con el mismo texto.
// Se agrupa por empresa y **texto casi idéntico**, no por título: los portales lo retocan
// («High-Ticket Sales Closer» / «… (Hospitality Sector)»). Medido sobre el lote real, el mismo
// anuncio da 0,95–0,995 de solapamiento y dos anuncios distintos de la misma empresa, 0,13.
const SAME_POSTING = 0.8;
const wordsOf = (text?: string | null) => new Set(fold(text ?? '').split(/[^a-z0-9]+/).filter(w => w.length > 3));
const overlap = (a: Set<string>, b: Set<string>) => {
  if (!a.size || !b.size) return 0;
  let shared = 0; for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared);
};
const companyKey = (c?: string | null) => fold(c ?? '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Quita republicaciones del mismo anuncio conservando el orden recibido (ya viene por puntuación). */
export function dedupeReposted<T extends { company?: string | null; description?: string | null; url: string }>(rows: T[]): T[] {
  const out: T[] = [];
  const byCompany = new Map<string, Array<{ tokens: Set<string>; at: number }>>();
  for (const row of rows) {
    const company = companyKey(row.company);
    const tokens = wordsOf(row.description);
    const bucket = company ? byCompany.get(company) ?? [] : [];
    if (company) byCompany.set(company, bucket);
    const twin = bucket.find(g => overlap(g.tokens, tokens) >= SAME_POSTING);
    if (twin) {
      // Si el duplicado trae el enlace del portal y el conservado solo la ficha de Google, se cambia.
      if (isGoogleUrl(out[twin.at].url) && !isGoogleUrl(row.url)) out[twin.at] = row;
      continue;
    }
    bucket.push({ tokens, at: out.length });
    out.push(row);
  }
  return out;
}

// Lo que la fuente declara (JobSpy: is_remote, job_type). Si no lo dice, se queda «no indicado».
const JOB_TYPES: Record<string, ['schedule' | 'contract', string]> = {
  fulltime: ['schedule', 'Jornada completa'], parttime: ['schedule', 'Media jornada'],
  permanent: ['contract', 'Indefinido'], contract: ['contract', 'Por contrato'], temporary: ['contract', 'Temporal'], internship: ['contract', 'Prácticas'],
};
function declared(raw: Record<string, unknown> | undefined) {
  const out: { schedule?: string; contract?: string } = {};
  for (const part of String(raw?.job_type ?? '').toLowerCase().split(/[,\s]+/)) { const hit = JOB_TYPES[part]; if (hit && !out[hit[0]]) out[hit[0]] = hit[1]; }
  return out;
}

// Aviso que ve la alumna. Las reglas aprueban sola la oferta que lleva avisos (solo comisión, publicidad a su
// cargo, sin entrevista, cifras altas…) porque el resto encaja; el banner es la contrapartida: se publica, pero
// se dice qué mirar. Lo CRÍTICO sigue sin publicarse (ni aquí ni en la regla), así que nunca llega a este punto.
export function cautionOf(o: ExternalOffer) {
  const stored = Array.isArray(o.auto_review?.flags)
    ? (o.auto_review.flags as unknown[]).filter((f): f is string => typeof f === 'string')
    : [];
  const risk = assessOffer(o);
  if (risk.risk_level === 'BLOCKED') return null;
  const codes = stored.length ? stored : risk.risk_level === 'WARNING' ? risk.detected_flags.map(flag => flag.code) : [];
  const flags = [...new Set(codes.map(code => FLAG_TEXT[code]).filter((text): text is string => typeof text === 'string'))].slice(0, 3);
  if (!flags.length) return null;
  return {
    title: 'Publicada con avisos',
    flags,
    note: 'La publicación automática la aceptó porque el resto encaja (perfil, mercado y español), pero el anuncio tiene señales que conviene comprobar. Pide las condiciones por escrito y confirma el fijo y las comisiones antes de avanzar.',
  };
}

export function toOpportunity(o: ExternalOffer, role: RoleFamily) {
  let host = 'fuente externa';
  try { host = new URL(o.url).hostname.replace(/^www\./, ''); } catch { /* url ya validada al guardar */ }
  // Google Jobs entrega su propia ficha y no el portal cuando el anuncio no publica
  // enlace de candidatura. Decir «publicado en google.com» sería falso: se nombra el
  // portal que Google atribuye (`via`, guardado en raw.site) y se declara el salto.
  const via = typeof o.raw?.site === 'string' ? o.raw.site.trim() : '';
  const sourceName = via && /(^|\.)google\./i.test(host) ? `${via} · vía Google Jobs` : host;
  // Atribución honesta: `also_seen` guarda las OTRAS fuentes que publicaron el mismo anuncio
  // (lo escribe `external_upsert` al encontrar la misma huella en otra fuente). La oferta se
  // atribuye a la primera que la vio, y se dice dónde más estaba. Sin duplicados ni la propia fuente.
  const alsoSeen = Array.isArray(o.also_seen)
    ? [...new Set(o.also_seen.filter((s): s is string => typeof s === 'string' && s.trim() !== '' && s !== o.source))].slice(0, 8)
    : [];
  return {
    id: `ext-${o.id}`, role, role_label: ROLE_LABELS[role], original_title: o.title, company: o.company || 'Empresa no indicada',
    // Aplicar sin rodeos: primero el enlace de candidatura que publica la fuente, después el anuncio.
    // `company_url` solo existe si el anuncio publica una web que no es un portal de empleo.
    apply_url: o.apply_url || o.url, company_url: o.company_url ?? null, contact: o.contact ?? null,
    market: (o.market as Market | null | undefined) ?? marketFor(o).market,
    compensation: o.salary || 'Importe no publicado', compensation_note: o.salary ? 'Tal como figura en el anuncio original.' : 'Pregunta por el fijo y las comisiones antes de avanzar.',
    modality: declaredModality(o), sales_motion: salesMotionOf(`${o.title ?? ''} ${o.description ?? ''}`),
    location: o.location || 'Ubicación no indicada', language: 'Anuncio en español', experience: 'Experiencia no indicada', schedule: declared(o.raw).schedule ?? 'Jornada no indicada', contract: declared(o.raw).contract ?? 'Contrato no indicado',
    description: o.description || 'Consulta el anuncio original para ver las condiciones completas.',
    published_at: o.posted_at, expires_at: o.expires_at, source_name: sourceName, source_url: o.url, also_seen: alsoSeen, starred: false, excellence_rank: null, is_selected: false,
    caution: cautionOf(o),
  };
}

export type StudentSearchItem = { source_url: string; company?: string; original_title?: string };

/**
 * Fusiona las ofertas externas aprobadas con las del motor sin duplicar el mismo anuncio (mismo enlace o
 * misma empresa + título). Las externas entran TAL CUAL: ahí viaja `caution`, el aviso que ve la alumna, y
 * reconstruir el objeto campo a campo es como se perdió antes este dato por el camino.
 */
export function mergeStudentSearch<T extends StudentSearchItem>(engineItems: T[], extra: T[]): T[] {
  const key = (item: StudentSearchItem) => `${fold(item.company)}|${fold(item.original_title)}`;
  const seen = new Set(engineItems.map(item => item.source_url));
  const seenKeys = new Set(engineItems.map(key));
  return [...engineItems, ...extra.filter(item => !seen.has(item.source_url) && !seenKeys.has(key(item)) && (seenKeys.add(key(item)), seen.add(item.source_url), true))];
}

const MARKET_OK = new Set(['any', 'ES', 'EU', 'LATAM', 'US']);

// Mercado de una oferta externa: usa el guardado al entrar (con su motivo) y, si falta, lo calcula.
const marketOf = (o: ExternalOffer) => (o.market as Market | null | undefined) ?? marketFor(o).market;

/** ¿Esta oferta entra en el mercado que pide la alumna? Ubicación cuando la hay; importe cuando no. */
export function inMarket(o: ExternalOffer, wanted: string): boolean {
  if (wanted === 'any') return true;
  const market = marketOf(o);
  if (wanted === 'ES' || wanted === 'EU') return spainSignal(o.title, o.location) === true;
  if (wanted === 'LATAM') return market === 'LATAM' || market === 'US_LATINO';
  if (wanted === 'US') return market === 'US_LATINO';
  return false;
}

export async function externalForStudent(q: Query) {
  if (q.starred_only || !MARKET_OK.has(q.market)) return [];
  // Solo aprobadas, ya ordenadas por puntuación en el servidor (con miles de borradores no se pierde ninguna aprobada).
  // El tope es el máximo que admite una lectura (1.000 filas): con más aprobadas vivas que eso, las de menor
  // puntuación no llegan a la alumna y hay que paginar la lectura (siguiente incremento); hoy hay 285.
  const [all, paused] = await Promise.all([listOffers({ statuses: ['approved', 'published'], byScore: true, limit: 1000, onlyLive: true }), pausedSourcesStrict()]);
  if (!paused) return []; // no se sabe qué fuentes están pausadas: ante la duda no se muestra nada
  const rows = dedupeReposted((all ?? []).filter(o => !paused.has(o.source)));
  const cutoff = Date.now() - q.days * 86400000;
  const out = [];
  for (const o of rows) {
    if (o.editorial_status !== 'approved' && o.editorial_status !== 'published') continue;
    const role = roleFromTitle(o.title);
    if (!role || (q.role && role !== q.role)) continue;
    if (!inMarket(o, q.market)) continue;
    if (o.posted_at && Date.parse(o.posted_at) < cutoff) continue;
    const text = fold(`${o.title} ${o.description ?? ''}`);
    if (PORTUGUESE.test(text)) continue;
    // Con descripción, hacen falta 3 palabras españolas; sin ella (p. ej. LinkedIn sin detalle), basta una en el
    // título más ubicación en España explícita: el idioma se asume solo cuando el resto de señales cuadra.
    const words = spanishWords(text);
    const spanish = o.description ? words >= 3 : words >= 1 && spainSignal(o.title, o.location) === true;
    // El opt-in bilingüe añade inglés, no cualquier idioma (decisión del propietario, 2026-11-18):
    // un anuncio alemán no entra aunque la alumna marque «también bilingües».
    const english = o.description ? englishWords(text) >= 5 : englishWords(text) >= 2;
    if (!spanish && !(q.include_bilingual && english)) continue;
    const offer = toOpportunity(o, role);
    // Los mismos filtros separados del motor, aplicados a la oferta ya construida: la alumna no
    // recibe una presencial cuando pidió remoto, ni una sin prospección declarada cuando pidió outbound.
    if ((q.modality ?? 'any') !== 'any' && MODALITY_FILTER_KEYS[offer.modality] !== q.modality) continue;
    if ((q.sales_motion ?? 'any') !== 'any' && offer.sales_motion !== q.sales_motion) continue;
    out.push(offer);
  }
  return out;
}
