import { ORG } from './external';
import { enrich } from './offerScore';
import { extractJsonLdJobs, decodeEntities } from './jobPosting';
import { serviceRest } from './supabaseAuth';
import { timeLeft } from './cronBudget';
import { guardedGet } from './urlGuard';

// Enriquecer la descripción: muchas ofertas entran solo con título (portales y buscadores que no devuelven el cuerpo). Sin descripción no se puede
// juzgar idioma ni condiciones, así que esas ofertas acaban en la cola humana. Aquí se hace UNA lectura gratuita y acotada del propio anuncio
// (la misma guarda que la verificación de vigencia: lista de sitios permitidos, sin IP literales, sin seguir redirecciones) y, si trae un JobPosting
// o una descripción útil, se guarda y se vuelve a puntuar. No cuesta dinero; el «tope» es el reloj del cron y un máximo de lecturas por pasada.
export const MIN_USEFUL = 120;
export const MAX_PER_PASS = 6;
const SHORT = 40;

type Row = { id: string; title: string; company: string | null; location: string | null; salary: string | null; description: string | null; posted_at: string | null; url: string; raw: Record<string, unknown> | null };

/** Descripción útil de una página: la del JobPosting si la hay y, si no, la meta descripción. `null` = nada fiable. */
export function descriptionFromPage(html: string, url: string): { text: string; source: 'jsonld' | 'meta' } | null {
  const posting = extractJsonLdJobs(html, url).map(job => (job.description ?? '').trim()).sort((a, b) => b.length - a.length)[0];
  if (posting && posting.length >= MIN_USEFUL) return { text: posting.slice(0, 4000), source: 'jsonld' };
  const meta = /<meta[^>]+(?:property=["']og:description["']|name=["']description["'])[^>]*content=["']([^"']+)["']/i.exec(html)?.[1];
  const text = meta ? decodeEntities(meta).replace(/\s+/g, ' ').trim() : '';
  return text.length >= MIN_USEFUL ? { text: text.slice(0, 4000), source: 'meta' } : null;
}

export type EnrichSummary = { checked: number; enriched: number; skipped: number; failed_writes: number; truncated?: boolean };

export async function enrichDescriptions(deps: { deadline?: number; max?: number; fetchImpl?: typeof fetch } = {}): Promise<EnrichSummary> {
  const out: EnrichSummary = { checked: 0, enriched: 0, skipped: 0, failed_writes: 0 };
  const max = Math.min(deps.max ?? MAX_PER_PASS, MAX_PER_PASS);
  const now = encodeURIComponent(new Date().toISOString());
  // Solo borradores vivos con perfil comercial y buena puntuación parcial, sin descripción útil y aún no intentados.
  const response = await serviceRest(`external_offers?org_id=eq.${ORG}&editorial_status=eq.draft&expires_at=gt.${now}&role=not.is.null&score=gte.40&or=(description.is.null,description.eq.)&select=id,title,company,location,salary,description,posted_at,url,raw&order=score.desc&limit=${max * 3}`);
  const rows = response.ok ? await response.json().catch(() => null) as Row[] | null : null;
  if (!Array.isArray(rows)) return { ...out, truncated: true };
  for (const row of rows) {
    if (out.checked >= max) break;
    if (timeLeft(deps.deadline) < 4_000) { out.truncated = true; break; }
    if ((row.description ?? '').trim().length >= SHORT || row.raw?.detail_checked_at || !/^https:\/\//i.test(row.url)) { out.skipped++; continue; }
    out.checked++;
    const got = await guardedGet(row.url, { timeoutMs: Math.min(6000, Math.max(1000, timeLeft(deps.deadline) - 1000)), maxBytes: 300_000, fetchImpl: deps.fetchImpl });
    const found = got.ok && got.status >= 200 && got.status < 300 ? descriptionFromPage(got.text, row.url) : null;
    // Se marca el intento aunque no salga nada: una página sin descripción no se vuelve a pedir en cada pasada.
    const raw = { ...(row.raw ?? {}), detail_checked_at: new Date().toISOString(), ...(found ? { detail_source: found.source } : {}) };
    const patch: Record<string, unknown> = { raw };
    if (found) {
      const e = enrich({ title: row.title, company: row.company, location: row.location, salary: row.salary, description: found.text, posted_at: row.posted_at, raw });
      Object.assign(patch, { description: found.text, score: e.score, role: e.role, spain: e.spain, market: e.market, market_basis: e.market_basis, currency: e.currency });
    }
    const saved = await serviceRest(`external_offers?org_id=eq.${ORG}&id=eq.${row.id}&editorial_status=eq.draft`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) }).catch(() => null);
    if (!saved?.ok) out.failed_writes++; else if (found) out.enriched++;
  }
  return out;
}
