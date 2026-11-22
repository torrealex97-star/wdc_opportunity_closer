import { COMPANY_WATCHLIST, type CompanyWatch } from './companyWatchlist';
import { engineFetch } from './engineTransport';
import { callTimeout, timeLeft } from './cronBudget';
import { ingest, recordSpend } from './external';
import { getSecret, listConnections } from './integrations';
import { extractJobPostings } from './jobPosting';
import type { Meter } from './providerCaps';
import { PROVIDER_METERS, spendNote } from './providerBudget';
import { browserlessConfigured, fetchHtml, renderHtml, type UnlockerProvider } from './providers/unlocker';
import { BrightDataError } from './providers/brightdata';

// Páginas de empleo propias de las empresas vigiladas, leídas por el cron. Cada página sigue esta cascada y para en
// cuanto una vía saca ofertas:
//   1. Lectura directa, gratis.
//   2. Navegador propio de código abierto (Browserless, BROWSERLESS_URL), gratis por petición: para páginas que existen
//      pero cuyo HTML llega vacío porque se pinta con JavaScript. Solo si está configurado.
//   3. Solo si la página BLOQUEA la lectura (401, 403, 429, 503 o red) y el llamador permite gasto (falta objetivo del
//      día), un desbloqueador de pago: ZenRows → ScrapingBee → Bright Data (Web Unlocker o, sin zona, Fetch API), el
//      primero con clave y tope para el peor caso (2 intentos). Una página que responde bien y no trae ofertas no se paga.
// Las ofertas se leen con el extractor común: JSON-LD `JobPosting`, RSS y, si no hay nada estructurado, los enlaces a
// ofertas del propio sitio (título = texto del enlace; lo demás queda vacío). Cada página deja su revisión en el
// historial (fuente `company`, nota `company:<código>`) y cada petición de pago se anota con `proveedor=… · coste_usd=…`.

const PAID_ORDER: UnlockerProvider[] = ['zenrows', 'scrapingbee', 'brightdata'];
const BLOCKED = new Set([401, 403, 429, 503]);
const UA = 'WDC-jobs/1.0 (+source review)';

export type CompanyPageRow = { code: string; detected: number; accepted: number; via: 'directa' | 'navegador' | UnlockerProvider | null; extraction?: string; cost_usd: number; error?: string };
export type CompanyPagesOutcome = { source: 'company'; ok: boolean; checked: number; accepted: number; cost_usd: number; pages: CompanyPageRow[]; truncated?: boolean; spend_unrecorded?: boolean; error?: string };

export const companyPagesMax = (env: NodeJS.ProcessEnv = process.env) => {
  const n = Number(env.COMPANY_PAGES_MAX ?? 6);
  return Number.isFinite(n) ? Math.min(Math.max(Math.floor(n), 0), 20) : 6;
};

/** Solo URLs HTTPS públicas de la lista verificada del repo; nunca algo escrito desde el navegador. */
export const publicHttps = (value: string) => {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0)/i.test(url.hostname)) return false;
    return url.hostname.includes('.');
  } catch { return false; }
};

export const companyPages = (list: CompanyWatch[] = COMPANY_WATCHLIST) =>
  list.filter(company => company.kind === 'careers' && company.url && publicHttps(company.url));

const WATCHED = new Set(['careers_page', 'ats_page', 'teamtailor_feed']);
const keyOf = (value: string) => { try { const u = new URL(value); return `${u.hostname.replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`.toLowerCase(); } catch { return value; } };

/**
 * Páginas de empleo que el MOTOR ya tiene dadas de alta (`/v1/company-targets`, seguimiento por página propia o ATS).
 * No se añade ninguna empresa aquí: se leen las que el motor ya vigila y tienen URL HTTPS pública. `null` si el motor
 * no está configurado o no responde (entonces solo se usa la lista del repo, y se dice).
 */
export async function engineCareerPages(env: NodeJS.ProcessEnv = process.env, timeoutMs = 4_000): Promise<CompanyWatch[] | null> {
  const base = (env.CAREER_ENGINE_URL ?? '').replace(/\/+$/, '');
  if (!base) return null;
  try {
    const response = await engineFetch(`${base}/v1/company-targets`, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    const payload = await response.json().catch(() => null) as { targets?: Array<Record<string, unknown>> } | null;
    if (!Array.isArray(payload?.targets)) return null;
    return payload.targets
      .filter(t => WATCHED.has(String(t.monitoring)) && typeof t.careers_url === 'string' && publicHttps(t.careers_url) && typeof t.slug === 'string')
      .map(t => ({ code: String(t.slug).slice(0, 60), name: String(t.name ?? t.slug), kind: 'careers' as const, url: t.careers_url as string, source: 'company', note: `Página de empleo del motor (${t.monitoring}).` }));
  } catch { return null; }
}

/** Lista del repo + las del motor, sin repetir la misma página. */
export const mergePages = (repo: CompanyWatch[], engine: CompanyWatch[] | null): CompanyWatch[] => {
  const seen = new Set<string>();
  return [...companyPages(repo), ...companyPages(engine ?? [])].filter(c => { const k = keyOf(c.url!); if (seen.has(k)) return false; seen.add(k); return true; });
};

type Options = { allowPaid: boolean; meter?: Meter | null; fetchImpl?: typeof fetch; list?: CompanyWatch[]; now?: number };

export async function collectCompanyPages(via: string, deadline: number | undefined, options: Options): Promise<CompanyPagesOutcome> {
  const { allowPaid, meter, fetchImpl = fetch, now = Date.now() } = options;
  const out: CompanyPagesOutcome = { source: 'company', ok: false, checked: 0, accepted: 0, cost_usd: 0, pages: [] };
  const max = companyPagesMax();
  if (max === 0) return { ...out, error: 'Páginas de empresa desactivadas (COMPANY_PAGES_MAX=0).' };
  const all = companyPages(options.list);
  if (!all.length) return { ...out, error: 'Ninguna empresa con página de empleo verificada.' };
  // Rota por día para que, con más empresas que el máximo, todas se lean a lo largo de la semana.
  const start = Math.floor(now / 86_400_000) % all.length;
  const queue = [...all.slice(start), ...all.slice(0, start)].slice(0, max);
  let keys: Set<string> | null | undefined; // se leen solo si hace falta pagar

  for (const company of queue) {
    if (timeLeft(deadline) < 3_000) { out.truncated = true; break; }
    const url = company.url!;
    const row: CompanyPageRow = { code: company.code, detected: 0, accepted: 0, via: null, cost_usd: 0 };
    out.pages.push(row);
    out.checked++;
    const read = (html: string) => extractJobPostings(html, url, { anchors: true, company: company.name });
    let body: string | null = null;
    let detected: ReturnType<typeof read> = [];
    let blocked = false;
    try {
      const response = await fetchImpl(url, { cache: 'no-store', redirect: 'follow', signal: AbortSignal.timeout(callTimeout(8_000, deadline)), headers: { 'User-Agent': UA } });
      if (response.ok) { body = await response.text(); row.via = 'directa'; detected = read(body); }
      else { blocked = BLOCKED.has(response.status); row.error = `HTTP ${response.status} en la lectura directa`; }
    } catch (err) {
      blocked = true;
      row.error = `Lectura directa fallida: ${(err as Error).message}`;
    }

    // 2. Navegador propio: gratis por petición. Sirve tanto si el HTML llegó vacío como si la lectura directa fue bloqueada.
    if (!detected.length && browserlessConfigured() && timeLeft(deadline) > 6_000) {
      try {
        const rendered = await renderHtml(url, { timeoutMs: callTimeout(20_000, deadline), fetchImpl });
        body = rendered; row.via = 'navegador'; row.error = undefined; detected = read(rendered);
      } catch (err) {
        row.error = `${row.error ? `${row.error} · ` : ''}navegador propio: ${(err as Error).message}`;
      }
    }

    // 3. De pago: solo con la página bloqueada y sin haber conseguido ninguna copia de ella.
    if (body === null && blocked) {
      if (!allowPaid) row.error += ' · objetivo cumplido o sin poder contarlo: no se paga un desbloqueador.';
      else if (!meter) row.error += ' · no se pudo leer el gasto del mes: no se paga un desbloqueador.';
      else {
        keys ??= await listConnections().then(rows => rows ? new Set(rows.map(r => r.provider)) : null).catch(() => null);
        const provider = keys ? PAID_ORDER.find(p => keys!.has(p) && meter.check(p, 2).ok) : undefined;
        if (!keys) row.error += ' · no se pudieron leer las claves: no se paga.';
        else if (!provider) row.error += ' · sin clave de ZenRows, ScrapingBee ni Bright Data con tope disponible.';
        else {
          const source = 'company';
          const note = (requests: number, costUsd: number, detail: string) => spendNote({ route: 'cascada', provider, requests, costUsd, detail: `company:${company.code} · ${detail}` });
          try {
            const secret = await getSecret(provider);
            if (!secret) throw new BrightDataError(`Sin clave de ${provider}`, null, 0);
            const page = await fetchHtml(provider, secret, url, { timeoutMs: callTimeout(25_000, deadline), fetchImpl });
            meter.charge(provider, page.costUsd);
            row.cost_usd += page.costUsd; out.cost_usd += page.costUsd;
            body = page.html; row.via = provider; row.error = undefined; detected = read(page.html);
            if (!await recordSpend(source, `${provider}-unlocker`, note(page.requests, page.costUsd, 'página leída'))) out.spend_unrecorded = true;
          } catch (err) {
            const e = err instanceof BrightDataError ? err : null;
            // Un 2xx o un fallo de red tras enviar pudo cobrarse: se anota el peor caso. Un 4xx/5xx de la pasarela, no.
            const charged = e && e.attempts > 0 && (e.status === null || (e.status >= 200 && e.status < 300));
            if (charged) {
              const usd = e!.attempts * PROVIDER_METERS[provider].usdPerRequest;
              meter.charge(provider, usd); row.cost_usd += usd; out.cost_usd += usd;
              if (!await recordSpend(source, `${provider}-unlocker`, note(e!.attempts, usd, 'fallo · se anota el peor caso'))) out.spend_unrecorded = true;
            }
            row.error += ` · ${provider}: ${(err as Error).message}`;
          }
        }
      }
    }

    const base = `revisión automática · company:${company.code} · ${via}`;
    if (body === null) {
      // Sin página no hay revisión que anotar como hecha: el error queda en el resultado del cron.
      continue;
    }
    row.detected = detected.length;
    row.extraction = detected[0]?.via;
    try {
      const saved = await ingest('company', 'company-page', detected, `${base} · ${row.via} · ${detected.length} detectada(s)${detected.length ? '' : ' · sin JobPosting ni RSS'}`);
      row.accepted = saved.accepted; out.accepted += saved.accepted;
    } catch (err) {
      row.error = `Ingesta fallida: ${(err as Error).message}`;
    }
  }
  out.cost_usd = Math.round(out.cost_usd * 1e6) / 1e6;
  out.ok = out.pages.some(p => p.via !== null && !p.error);
  if (!out.ok && !out.error) out.error = out.pages.map(p => `${p.code}: ${p.error ?? 'sin resultado'}`).join(' · ') || 'Sin páginas leídas.';
  return out;
}
