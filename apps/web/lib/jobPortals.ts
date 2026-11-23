import type { Candidate } from './external';

// Portales de empleo y el patrón de URL de una OFERTA CONCRETA en cada uno (no un listado). Lo usan el respaldo de
// SerpApi (búsquedas `site:`) y Bright Data (resultados orgánicos cuando Google no muestra el recuadro de
// empleos). Un solo sitio para los patrones: si un portal cambia sus URL, se corrige aquí.

export type FallbackPortal = {
  source: string;            // código con el que se guarda (`serpapi-<portal>`)
  name: string;
  site: string;              // operador `site:` de la búsqueda
  query: string;             // término principal del SOP
  gl: 'es' | 'mx' | 'co' | 'ar';
  url: RegExp;               // qué enlaces son de verdad una oferta del portal
  replaces?: 'infojobs' | 'adzuna' | 'jooble' | 'indeed' | 'linkedin'; // API oficial o recolector que cubre
};

// Orden = prioridad cuando no hay presupuesto para todas. Primero los portales que no tienen ninguna
// otra vía (LatAm y agregadores) y después los que dependen de una API o de JobSpy.
export const FALLBACK_PORTALS: FallbackPortal[] = [
  // Patrones comprobados contra ofertas reales el 2026-11-22: Computrabajo usa subdominio de país o TLD
  // `.com.mx` en la misma ruta (`/ofertas-de-trabajo/oferta-de-trabajo-de-…`); Bumerán usa `.com.ar`,
  // `.com.mx` o `.com.pe` y una ficha `.html`; OCC, `/empleo/oferta/<id>-<slug>`. Sin el TLD opcional,
  // los anuncios de México y de Argentina se descartaban como si no fueran del portal.
  { source: 'serpapi-computrabajo', name: 'Computrabajo', site: 'computrabajo.com', query: 'closer de ventas', gl: 'co', url: /computrabajo\.(?:com|es)(?:\.[a-z]{2})?\/ofertas-de-trabajo\/[^/?#]+/i },
  { source: 'serpapi-occ', name: 'OCCMundial', site: 'occ.com.mx', query: 'closer de ventas', gl: 'mx', url: /occ\.com\.mx\/empleo\/oferta\/[^/?#]+/i },
  { source: 'serpapi-bumeran', name: 'Bumerán', site: 'bumeran.com', query: 'closer', gl: 'ar', url: /bumeran\.com(?:\.(?:ar|mx|pe|co|cl))?\/empleos\/[^/?#]+/i },
  { source: 'serpapi-bebee', name: 'BeBee', site: 'bebee.com', query: 'sales closer', gl: 'es', url: /bebee\.com\/jobs\//i },
  { source: 'serpapi-infojobs', name: 'InfoJobs', site: 'infojobs.net', query: 'closer de ventas', gl: 'es', url: /infojobs\.net\/(?:oferta|empleo|ofertas-trabajo)\//i, replaces: 'infojobs' },
  { source: 'serpapi-indeed', name: 'Indeed España', site: 'es.indeed.com', query: 'closer de ventas', gl: 'es', url: /indeed\.(?:es|com)\/(?:viewjob|rc\/clk|m\/viewjob)/i, replaces: 'indeed' },
  { source: 'serpapi-linkedin', name: 'LinkedIn', site: 'linkedin.com/jobs', query: 'high ticket closer', gl: 'es', url: /linkedin\.com\/jobs\/view\//i, replaces: 'linkedin' },
  { source: 'serpapi-adzuna', name: 'Adzuna', site: 'adzuna.es', query: 'closer', gl: 'es', url: /adzuna\.es\/details\//i, replaces: 'adzuna' },
  { source: 'serpapi-jooble', name: 'Jooble', site: 'jooble.org', query: 'closer de ventas', gl: 'es', url: /jooble\.org\/desc\//i, replaces: 'jooble' },
];

export const cleanTitle = (title: string) => title.replace(/\s*[|·–-]\s*(?:infojobs|indeed|linkedin|computrabajo|bumeran|occ mundial|occ|bebee|adzuna|jooble).*$/i, '').trim();

/** Una ficha orgánica de Google → candidato. `null` si el enlace no es una oferta del portal. */
export function organicToCandidate(result: unknown, portal: FallbackPortal, provider = 'serpapi', via = 'site'): Candidate | null {
  if (!result || typeof result !== 'object') return null;
  const r = result as Record<string, unknown>;
  const link = typeof r.link === 'string' ? r.link.trim() : '';
  const title = typeof r.title === 'string' ? cleanTitle(r.title).slice(0, 200) : '';
  if (!/^https?:\/\//i.test(link) || !title || !portal.url.test(link)) return null;
  const rawSnippet = typeof r.snippet === 'string' ? r.snippet : typeof r.description === 'string' ? r.description : '';
  const snippet = rawSnippet.replace(/\s+/g, ' ').trim().slice(0, 500);
  return {
    external_id: link.slice(0, 1000), title, company: null, location: null, url: link,
    salary: null, description: snippet || null, posted_at: null,
    raw: { provider, portal: portal.site, via },
  };
}


/** Resultados orgánicos de cualquier proveedor → candidatos, solo los que enlazan a una oferta concreta de un portal. */
export function organicJobCandidates(items: unknown[], provider: string): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const link = item && typeof item === 'object' && typeof (item as Record<string, unknown>).link === 'string' ? (item as Record<string, unknown>).link as string : '';
    const portal = FALLBACK_PORTALS.find(p => p.url.test(link));
    if (!portal) continue;
    const candidate = organicToCandidate(item, portal, provider, 'organic');
    if (candidate && !seen.has(candidate.url)) { seen.add(candidate.url); out.push(candidate); }
  }
  return out;
}
