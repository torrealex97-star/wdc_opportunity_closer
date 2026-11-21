// Buscadores de repuesto desde la tienda de Apify: la app propone sustitutos y solo da por BUENO un actor
// cuando sus metadatos públicos lo demuestran.
//
// Regla del repositorio (AGENTS.md): un portal solo gana un buscador cuando el actor está validado con metadatos
// públicos —existe, no está obsoleto, su build por defecto terminó en `SUCCEEDED` y se leyó su esquema de
// entrada—. Nunca se inventa uno. Lo que la tienda no dice (campo ausente, endpoint que no responde) es
// «sin verificar», no «bueno»: un hueco no es un sí.
//
// Contrato (docs.apify.com): `GET /v2/store?search=&limit=` (público, sin token), `GET /v2/acts/{user~nombre}`
// (público para actores públicos) y `GET /v2/acts/{user~nombre}/builds/default` (sin token). Ninguna de estas
// llamadas gasta crédito. Nada se lanza aquí: lanzar un actor sigue siendo `startRun`, con su tope.
import type { Portal } from './apifyCatalog';
import { ACTOR_RE } from './apify';

type FetchLike = typeof fetch;
const base = () => process.env.APIFY_API_BASE ?? 'https://api.apify.com';
const actorPath = (actor: string) => actor.replace('/', '~');

export type StoreItem = { actor: string; title: string; description: string | null; users: number | null; runs: number | null };

const text = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, max) : null;
};
const count = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null);

/** `{data: {items: [...]}}` de la tienda → lista normalizada. Un item sin `username` y `name` se descarta. */
export function storeItemsFrom(payload: unknown): StoreItem[] {
  const data = payload && typeof payload === 'object' ? (payload as Record<string, unknown>).data : null;
  const items = data && typeof data === 'object' ? (data as Record<string, unknown>).items : null;
  if (!Array.isArray(items)) return [];
  const out: StoreItem[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const username = text(item.username, 80), name = text(item.name, 120);
    if (!username || !name) continue;
    const actor = `${username}/${name}`;
    if (!ACTOR_RE.test(actor)) continue;
    const stats = item.stats && typeof item.stats === 'object' ? item.stats as Record<string, unknown> : {};
    out.push({ actor, title: text(item.title, 160) ?? actor, description: text(item.description, 240), users: count(stats.totalUsers), runs: count(stats.totalRuns) });
  }
  return out;
}

export type ActorCheck = {
  actor: string;
  /** `null` = no se pudo comprobar (el endpoint no respondió o el campo no vino). */
  exists: boolean | null;
  deprecated: boolean | null;
  buildStatus: string | null;
  schemaRead: boolean | null;
  reasons: string[];
};
export type Verdict = 'valid' | 'invalid' | 'unverified';

/** `valid` solo si TODO consta; un fallo comprobado es `invalid`; lo que falta por saber es `unverified`. */
export function verdictOf(check: ActorCheck): Verdict {
  if (check.exists === false || check.deprecated === true || (check.buildStatus !== null && check.buildStatus !== 'SUCCEEDED') || check.schemaRead === false) return 'invalid';
  if (check.exists === true && check.deprecated === false && check.buildStatus === 'SUCCEEDED' && check.schemaRead === true) return 'valid';
  return 'unverified';
}

async function getJson(url: string, fetchImpl: FetchLike, timeoutMs: number): Promise<{ status: number | null; body: unknown }> {
  try {
    const response = await fetchImpl(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
    return { status: response.status, body: await response.json().catch(() => null) };
  } catch {
    return { status: null, body: null };
  }
}

/** Metadatos públicos de un actor: existencia, obsolescencia, build por defecto y esquema de entrada. */
export async function checkActor(actor: string, options: { fetchImpl?: FetchLike; timeoutMs?: number } = {}): Promise<ActorCheck> {
  const { fetchImpl = fetch, timeoutMs = 8_000 } = options;
  const check: ActorCheck = { actor, exists: null, deprecated: null, buildStatus: null, schemaRead: null, reasons: [] };
  if (!ACTOR_RE.test(actor)) return { ...check, exists: false, reasons: ['Nombre de actor no válido.'] };
  const info = await getJson(`${base()}/v2/acts/${actorPath(actor)}`, fetchImpl, timeoutMs);
  if (info.status === 404) { check.exists = false; check.reasons.push('No existe en la tienda.'); return check; }
  const data = info.body && typeof info.body === 'object' ? (info.body as Record<string, unknown>).data : null;
  if (info.status === 200 && data && typeof data === 'object') {
    check.exists = true;
    const record = data as Record<string, unknown>;
    if (typeof record.isDeprecated === 'boolean') check.deprecated = record.isDeprecated;
    else check.reasons.push('La tienda no dice si está obsoleto.');
    if (record.isDeprecated === true) check.reasons.push('Está marcado como obsoleto.');
  } else {
    check.reasons.push(info.status === null ? 'No se pudo contactar con Apify.' : `Apify respondió HTTP ${info.status} al leer el actor.`);
  }
  const build = await getJson(`${base()}/v2/acts/${actorPath(actor)}/builds/default`, fetchImpl, timeoutMs);
  const built = build.body && typeof build.body === 'object' ? (build.body as Record<string, unknown>).data : null;
  if (build.status === 200 && built && typeof built === 'object') {
    const record = built as Record<string, unknown>;
    check.buildStatus = typeof record.status === 'string' ? record.status : null;
    if (check.buildStatus === null) check.reasons.push('El build por defecto no declara su estado.');
    else if (check.buildStatus !== 'SUCCEEDED') check.reasons.push(`El build por defecto está en ${check.buildStatus}.`);
    let schema: unknown = record.inputSchema;
    if (typeof schema === 'string') { try { schema = JSON.parse(schema); } catch { schema = null; } }
    const definition = record.actorDefinition && typeof record.actorDefinition === 'object' ? (record.actorDefinition as Record<string, unknown>).input : null;
    const properties = (schema && typeof schema === 'object' ? (schema as Record<string, unknown>).properties : null)
      ?? (definition && typeof definition === 'object' ? (definition as Record<string, unknown>).properties : null);
    check.schemaRead = Boolean(properties && typeof properties === 'object' && Object.keys(properties as object).length);
    if (!check.schemaRead) check.reasons.push('No se pudo leer su esquema de entrada.');
  } else if (build.status === 404) {
    check.buildStatus = 'SIN BUILD'; check.reasons.push('No tiene build por defecto.');
  } else {
    check.reasons.push(build.status === null ? 'No se pudo contactar con Apify para leer el build.' : `Apify respondió HTTP ${build.status} al leer el build.`);
  }
  return check;
}

/** Búsquedas que se hacen en la tienda para un portal: su nombre, con y sin «jobs scraper». */
export const queriesFor = (portal: Pick<Portal, 'name'>): string[] => {
  const name = portal.name.replace(/\s*[(·–-].*$/, '').trim();
  return [...new Set([`${name} jobs scraper`, name])].filter(Boolean);
};

export type Replacement = StoreItem & { verdict: Verdict; reasons: string[]; check: ActorCheck };
export type ReplacementSearch = { candidates: Replacement[]; searched: string[]; error: string | null; truncated: boolean };

/**
 * Candidatos de repuesto para un portal: se busca en la tienda, se descartan los que ya están (activos o
 * retirados) y se valida cada uno con sus metadatos públicos. Acotado: como mucho `maxChecks` validaciones
 * (dos peticiones cada una) y se declara si quedaron candidatos sin comprobar.
 */
export async function findReplacements(
  portal: Pick<Portal, 'name'>, known: Set<string>,
  options: { fetchImpl?: FetchLike; maxChecks?: number; limit?: number } = {},
): Promise<ReplacementSearch> {
  const { fetchImpl = fetch, maxChecks = 6, limit = 12 } = options;
  const searched = queriesFor(portal);
  const seen = new Map<string, StoreItem>();
  let error: string | null = null;
  for (const query of searched) {
    const result = await getJson(`${base()}/v2/store?search=${encodeURIComponent(query)}&limit=${limit}&sortBy=popularity`, fetchImpl, 10_000);
    if (result.status !== 200) { error = result.status === null ? 'No se pudo contactar con la tienda de Apify.' : `La tienda de Apify respondió HTTP ${result.status}.`; continue; }
    for (const item of storeItemsFrom(result.body)) if (!known.has(item.actor.toLowerCase()) && !seen.has(item.actor)) seen.set(item.actor, item);
  }
  const pool = [...seen.values()];
  const candidates: Replacement[] = [];
  for (const item of pool.slice(0, maxChecks)) {
    const check = await checkActor(item.actor, { fetchImpl });
    candidates.push({ ...item, verdict: verdictOf(check), reasons: check.reasons, check });
  }
  // Primero los validados y, dentro, los más usados: no hay otra señal de calidad que el uso declarado.
  const rank = { valid: 0, unverified: 1, invalid: 2 } as const;
  candidates.sort((a, b) => rank[a.verdict] - rank[b.verdict] || (b.users ?? 0) - (a.users ?? 0));
  return { candidates, searched, error, truncated: pool.length > maxChecks };
}
