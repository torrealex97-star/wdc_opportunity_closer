import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { authenticate, originBlocked, withCookies } from '../../../../lib/adminAuth';
import { COMPANY_WATCHLIST, companySourceCodes } from '../../../../lib/companyWatchlist';
import { companyReviewHistory, ingest, listOffers, statsBySource } from '../../../../lib/external';
import { diffDetected, extractJobPostings } from '../../../../lib/jobPosting';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 45;

// Empresas: estado real del feed ATS y revisión puntual de una página propia. Solo URLs de la lista
// verificada del repo (nada que escriba el navegador), solo HTTPS, con timeout y sin reintentos en bucle.
async function gate(request: NextRequest, ownerOnly = false) {
  if (originBlocked(request)) return { error: Response.json({ detail: 'Origen no permitido' }, { status: 403 }) };
  const auth = await authenticate(request);
  if (!auth.ok) return { error: Response.json({ detail: auth.detail }, { status: auth.status }) };
  if (ownerOnly && auth.admin.role !== 'owner') return { error: Response.json({ detail: 'Solo el propietario puede revisar una empresa.' }, { status: 403 }) };
  return { auth };
}
const reply = (auth: { setCookies: string[] }, body: unknown, status = 200) => withCookies(Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);

const publicHttps = (value: string) => {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname;
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0)/i.test(host)) return false;
    return host.includes('.');
  } catch { return false; }
};

export async function GET(request: NextRequest) {
  const { auth, error } = await gate(request);
  if (error) return error;
  const [stats, history] = await Promise.all([statsBySource(), companyReviewHistory(companySourceCodes())]);
  const hostOf = (value: string) => { try { return new URL(value).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
  const companies = COMPANY_WATCHLIST.map(company => {
    const row = stats?.find(item => item.source === company.source);
    // Un ATS se revisa solo en cada pasada: su fuente es única. La ejecución de ingesta es la fecha
    // real aunque la bolsa esté vacía; `last_seen` solo existe si además quedó una oferta viva.
    const atsReview = company.kind === 'ats' ? history.bySource[company.source] ?? row?.last_seen ?? null : null;
    const last_review = history.byCode[company.code] ?? (company.url ? history.byHost[hostOf(company.url)] : undefined) ?? atsReview;
    return { ...company, live: row?.live ?? null, approved: row?.approved ?? null, last_review, review_unknown: !last_review && history.unknown };
  });
  const detail = [
    stats ? '' : 'No se pudo leer el motor: los anuncios vivos de las empresas ATS salen en «—».',
    history.unknown ? 'No se pudo leer todo el historial de revisión: «—» puede significar que falta el dato, no que nunca se revisó.' : '',
  ].filter(Boolean).join(' ') || undefined;
  return reply(auth!, { companies, detail });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { action?: unknown; code?: unknown };
  const { auth, error } = await gate(request, true);
  if (error) return error;
  if (body.action !== 'review' || typeof body.code !== 'string') return Response.json({ detail: 'Acción no válida.' }, { status: 422 });
  const company = COMPANY_WATCHLIST.find(item => item.code === body.code);
  if (!company) return Response.json({ detail: 'Esa empresa no está en la lista verificada.' }, { status: 404 });
  if (company.kind !== 'careers' || !company.url) return Response.json({ detail: company.kind === 'ats' ? 'Esta empresa entra por su feed ATS: se revisa sola en cada pasada del motor.' : 'Solo publica en LinkedIn: no se rastrea la red; usa la búsqueda de Google Jobs.' }, { status: 422 });
  if (!publicHttps(company.url)) return Response.json({ detail: 'La URL guardada no es HTTPS pública.' }, { status: 422 });

  let html = '';
  // Fixture local SOLO para pruebas de interfaz (se activa con COMPANY_REVIEW_FIXTURE); en producción
  // la variable no existe y se lee la página real. No cambia la URL verificada ni el contrato del extractor.
  const fixture = process.env.COMPANY_REVIEW_FIXTURE;
  if (fixture) {
    try { html = await readFile(path.resolve(process.cwd(), fixture), 'utf8'); }
    catch (err) { return Response.json({ detail: `No se pudo leer el fixture local: ${(err as Error).message}` }, { status: 500 }); }
  } else {
    try {
      const response = await fetch(company.url, { cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(20_000), headers: { 'User-Agent': 'WDC-jobs/1.0 (+source review)' } });
      if (!response.ok) return Response.json({ detail: `${company.name} respondió HTTP ${response.status}; no se inventa ninguna oferta.` }, { status: 502 });
      html = await response.text();
    } catch (err) {
      return Response.json({ detail: `No se pudo leer ${company.name}: ${(err as Error).message}` }, { status: 502 });
    }
  }
  const detected = extractJobPostings(html, company.url);
  const reviewBase = `revisión manual · company:${company.code}${fixture ? ' (fixture local)' : ''}`;
  if (!detected.length) {
    // Una revisión sin ofertas también es una revisión: deja su fecha sin inventar ninguna ficha.
    await ingest('company', 'company-page', [], `${reviewBase} · 0 detectada(s) · sin JobPosting ni RSS`);
    return reply(auth!, { detected: 0, fresh: 0, accepted: 0, sample: [], note: 'La página no publica JobPosting ni RSS: 0 detectadas (no es un fallo de red).' });
  }
  const existing = await listOffers({ source: 'company', limit: 300 });
  const diff = diffDetected((existing ?? []).map(offer => offer.external_id), detected);
  const saved = await ingest('company', 'company-page', diff.fresh, `${reviewBase} · ${detected.length} detectada(s) · ${diff.fresh.length} nueva(s) · ${diff.known.length} ya guardada(s)`);
  return reply(auth!, {
    detected: detected.length, fresh: diff.fresh.length, accepted: saved.accepted,
    sample: detected.slice(0, 5).map(job => ({ title: job.title, company: job.company ?? null, url: job.url })),
    note: `${detected.length} en la página · ${diff.fresh.length} nueva(s) · ${saved.accepted} guardada(s)${fixture ? ' · fixture local' : ''}.`,
  });
}
