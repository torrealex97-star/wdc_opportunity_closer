import type { Candidate } from '../external';
import { organicJobCandidates, FALLBACK_PORTALS } from '../jobPortals';
import { hitsNegative } from '../searchBank';

// Tavily (api.tavily.com): buscador con IA. Aquí solo se usa como CONECTOR de candidatos en bruto: pide una búsqueda,
// recibe título, enlace y extracto, y devuelve candidatos; nunca escribe ofertas (eso lo hace `ingest`).
// Contrato leído en la documentación pública de Tavily (2026-11-23): POST /search con `Authorization: Bearer`,
// cuerpo { query, search_depth, max_results, include_domains, time_range, country }, respuesta { results: [{ title, url,
// content, score }] }. Una búsqueda básica cuesta 1 crédito; `GET /usage` no gasta crédito (se usa para probar la clave).

export const TAVILY_USD_PER_CREDIT = 0.008;
export const tavilyBase = (env: NodeJS.ProcessEnv = process.env) => (env.TAVILY_API_BASE ?? 'https://api.tavily.com').replace(/\/+$/, '');

export class TavilyError extends Error {
  readonly status: number | null;
  /** Tavily respondió: la petición pudo contarse. */
  readonly billed: boolean;
  constructor(message: string, status: number | null, billed = false) { super(message); this.name = 'TavilyError'; this.status = status; this.billed = billed; }
}

export type TavilyResult = { title: string; url: string; content: string };

/** Dominios de los portales con patrón de oferta conocido: acotan la búsqueda a sitios donde un enlace ES una oferta. */
export const tavilyDomains = (): string[] => [...new Set(FALLBACK_PORTALS.map(p => p.site.split('/')[0]))];

export async function tavilySearch(key: string, query: string, options: { maxResults?: number; timeRange?: 'day' | 'week' | 'month'; country?: string; domains?: string[]; timeoutMs?: number } = {}): Promise<{ results: TavilyResult[]; credits: number }> {
  const body: Record<string, unknown> = { query, search_depth: 'basic', max_results: Math.min(Math.max(options.maxResults ?? 10, 1), 20), include_answer: false, include_raw_content: false };
  if (options.domains?.length) body.include_domains = options.domains;
  if (options.timeRange) body.time_range = options.timeRange;
  if (options.country) body.country = options.country;
  let response: Response;
  try {
    response = await fetch(`${tavilyBase()}/search`, { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(options.timeoutMs ?? 15_000), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
  } catch (err) {
    throw new TavilyError(`Tavily no respondió: ${(err as Error).message}`, null);
  }
  if (!response.ok) {
    const detail = await response.text().then(t => t.replace(/\s+/g, ' ').slice(0, 160)).catch(() => '');
    const reason = response.status === 401 ? 'clave rechazada' : response.status === 429 || response.status === 432 || response.status === 433 ? 'límite o crédito agotado' : `HTTP ${response.status}`;
    throw new TavilyError(`Tavily: ${reason}${detail ? ` (${detail})` : ''}`, response.status, false);
  }
  const data = await response.json().catch(() => null) as { results?: unknown } | null;
  if (!data || !Array.isArray(data.results)) throw new TavilyError('Tavily respondió sin lista `results`: no se interpreta como 0 ofertas.', response.status, true);
  const results = data.results.flatMap((r): TavilyResult[] => {
    if (!r || typeof r !== 'object') return [];
    const row = r as Record<string, unknown>;
    return typeof row.url === 'string' && typeof row.title === 'string' ? [{ title: row.title, url: row.url, content: typeof row.content === 'string' ? row.content : '' }] : [];
  });
  return { results, credits: 1 };
}

/**
 * Resultados → candidatos: solo enlaces a una oferta concreta de un portal conocido (mismo patrón que el respaldo de
 * Google) y sin títulos que deje fuera el banco de negativos («cerrajero»…).
 */
export function tavilyCandidates(results: TavilyResult[]): Candidate[] {
  const items = results.filter(r => !hitsNegative(r.title)).map(r => ({ link: r.url, title: r.title, snippet: r.content }));
  return organicJobCandidates(items, 'tavily');
}
