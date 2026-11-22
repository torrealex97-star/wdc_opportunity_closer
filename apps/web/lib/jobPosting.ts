// Extractor común de páginas de empleo: JSON-LD `JobPosting`, RSS y, como último recurso, los ENLACES de la página.
//
// Es el mismo extractor para las páginas de empresa, el Unlocker y cualquier feed. Sin `JobPosting` ni RSS, solo se
// toman enlaces del propio sitio que apuntan a una oferta concreta (`extractAnchorJobs`); nunca se inventa un dato. Se deduplica por URL y
// se resuelven los enlaces relativos; la descripción se guarda como texto, sin etiquetas.
//
// No usa DOM ni dependencias: Next lo empaqueta igual en servidor y las pruebas lo ejecutan en Node.

import type { Candidate } from './external';

export type DetectedJob = Candidate & { via: 'jsonld' | 'rss' | 'anchors' };

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', laquo: '«', raquo: '»', ndash: '–', mdash: '—', hellip: '…' };

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-zA-Z]+);/g, (match, name: string) => ENTITIES[name] ?? match);
}

export function stripHtml(html: string): string {
  return decodeEntities(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function absolute(url: string, base: string): string | null {
  try { return new URL(decodeEntities(url.trim()), base).toString(); } catch { return null; }
}

const text = (value: unknown): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const clean = decodeEntities(String(value)).replace(/\s+/g, ' ').trim();
  return clean || null;
};

const first = (value: unknown): Record<string, unknown> | null => {
  const item = Array.isArray(value) ? value[0] : value;
  return item && typeof item === 'object' ? item as Record<string, unknown> : null;
};

/** `JobPosting.jobLocation` puede ser un objeto, una lista o `Place` con `address`. */
function locationOf(job: Record<string, unknown>): string | null {
  const place = first(job.jobLocation);
  const address = place ? first(place.address) ?? place : null;
  if (!address) return null;
  const parts = [address.addressLocality, address.addressRegion, address.addressCountry]
    .map(part => (part && typeof part === 'object' ? text((part as Record<string, unknown>).name) : text(part)))
    .filter((part): part is string => Boolean(part));
  return parts.length ? [...new Set(parts)].join(', ') : text(address.name);
}

function salaryOf(job: Record<string, unknown>): string | null {
  const base = first(job.baseSalary);
  if (!base) return text(job.salary);
  const currency = text(base.currency);
  const value = first(base.value);
  const min = text(value?.minValue ?? value?.value);
  const max = text(value?.maxValue);
  const unit = text(value?.unitText);
  if (!min && !max) return null;
  const amount = min && max && min !== max ? `${min}–${max}` : (min ?? max);
  return [amount, currency, unit].filter(Boolean).join(' ');
}

type JsonLdNode = Record<string, unknown>;
const isJobPosting = (node: JsonLdNode) => {
  const type = node['@type'];
  return type === 'JobPosting' || (Array.isArray(type) && type.includes('JobPosting'));
};

function walk(node: unknown, out: JsonLdNode[], depth = 0): void {
  if (!node || typeof node !== 'object' || depth > 6) return;
  if (Array.isArray(node)) { for (const item of node) walk(item, out, depth + 1); return; }
  const record = node as JsonLdNode;
  if (isJobPosting(record)) out.push(record);
  if (Array.isArray(record['@graph'])) walk(record['@graph'], out, depth + 1);
  if (record.mainEntity) walk(record.mainEntity, out, depth + 1);
  if (record.itemListElement) walk(record.itemListElement, out, depth + 1);
}

/** Todos los `JobPosting` del HTML, ya normalizados y deduplicados por URL. */
export function extractJsonLdJobs(html: string, baseUrl: string): DetectedJob[] {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
  const nodes: JsonLdNode[] = [];
  for (const raw of scripts) {
    // Algunos gestores de plantillas dejan comentarios o comas finales: se limpian sin evaluar nada.
    // Se aceptan los dos cierres de comentario HTML (`-->` y `--!>`), no solo el clásico.
    let cleaned = raw.trim();
    if (cleaned.startsWith('<!--')) cleaned = cleaned.slice(4).trimStart();
    if (cleaned.endsWith('-->')) cleaned = cleaned.slice(0, -3).trimEnd();
    else if (cleaned.endsWith('--!>')) cleaned = cleaned.slice(0, -4).trimEnd();
    cleaned = cleaned.replace(/,\s*([}\]])/g, '$1').trim();
    if (!cleaned) continue;
    try { walk(JSON.parse(cleaned), nodes); } catch { /* un bloque roto no invalida los demás */ }
  }
  const seen = new Set<string>();
  const jobs: DetectedJob[] = [];
  for (const node of nodes) {
    const title = text(node.title) ?? text(node.name);
    const url = absolute(text(node.url) ?? text(node.sameAs) ?? baseUrl, baseUrl);
    if (!title || !url || !/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    const company = text(first(node.hiringOrganization)?.name);
    jobs.push({
      external_id: `jp-${hash(url)}`,
      title: title.slice(0, 200),
      company,
      location: locationOf(node),
      url,
      salary: salaryOf(node),
      description: text(node.description) ? stripHtml(String(node.description)).slice(0, 6000) : null,
      posted_at: text(node.datePosted) && Number.isFinite(Date.parse(String(node.datePosted))) ? new Date(String(node.datePosted)).toISOString() : null,
      raw: { provider: 'job-posting', site: hostOf(url) },
      apply_url: url,
      via: 'jsonld',
    });
  }
  return jobs;
}

const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return null; } };
function hash(value: string): string {
  let h = 5381;
  for (let i = 0; i < value.length; i++) h = ((h << 5) + h + value.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

const tag = (block: string, name: string): string | null => {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i').exec(block);
  if (!match) return null;
  const raw = match[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '');
  return text(raw);
};

/** RSS 2.0 y Atom: título, enlace, descripción y fecha. Deduplica por enlace. */
export function extractRssJobs(xml: string, baseUrl: string): DetectedJob[] {
  const blocks = [...xml.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi)].map(match => match[2]);
  const seen = new Set<string>();
  const jobs: DetectedJob[] = [];
  for (const block of blocks) {
    const title = tag(block, 'title');
    const linkTag = tag(block, 'link');
    const atomLink = /<link[^>]+href=["']([^"']+)["']/i.exec(block)?.[1] ?? null;
    const url = absolute(linkTag ?? atomLink ?? tag(block, 'guid') ?? baseUrl, baseUrl);
    if (!title || !url || !/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    const description = tag(block, 'description') ?? tag(block, 'summary') ?? tag(block, 'content');
    const date = tag(block, 'pubDate') ?? tag(block, 'published') ?? tag(block, 'updated');
    const parsed = date ? Date.parse(date) : NaN;
    jobs.push({
      external_id: `rss-${hash(url)}`,
      title: title.slice(0, 200),
      company: tag(block, 'company') ?? tag(block, 'author'),
      location: tag(block, 'location'),
      url,
      salary: null,
      description: description ? stripHtml(description).slice(0, 6000) : null,
      posted_at: Number.isFinite(parsed) ? new Date(parsed).toISOString() : null,
      raw: { provider: 'job-posting', site: hostOf(url) },
      apply_url: url,
      via: 'rss',
    });
  }
  return jobs;
}

const JOB_PATH = /\/(?:jobs?|empleos?|ofertas?(?:-de-(?:empleo|trabajo))?|vacantes?|puestos?|posici[oó]n(?:es)?|trabajos?|careers?|carreras|positions?|openings?|vacancies|opportunit(?:y|ies)|join-us|trabaja-con-nosotros)\/[^/?#]{3,}/i;
const NOT_A_ROLE = /^(?:ver|m[aá]s|saber|leer|aplicar|apply|inscri|enviar|volver|back|home|inicio|todas?|all|login|iniciar|registr|compartir|share|cookies?|pol[ií]tica|aviso|contacto|contact|suscr|newsletter|blog|noticias)\b/i;
const FILE = /\.(?:pdf|docx?|jpe?g|png|gif|svg|webp|zip|xml|json|css|js)(?:$|\?)/i;
const siteOf = (value: string) => { try { return new URL(value).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };

/**
 * Último recurso para una página de empleo que no publica `JobPosting` ni RSS: los enlaces del propio sitio cuya ruta es
 * la de una oferta concreta (`/empleo/…`, `/jobs/…`, `/vacantes/…`). El título es el texto visible del enlace; la
 * empresa, solo la que indique el llamador (la de la lista verificada); lugar, sueldo y fecha quedan vacíos porque la
 * página no los da en un formato fiable. Se descartan enlaces a otro sitio, a archivos, al propio listado y los de
 * navegación («Ver todas», «Aplicar»…). Es una heurística: entra como borrador y pasa por la revisión de siempre.
 */
export function extractAnchorJobs(html: string, baseUrl: string, options: { company?: string | null; max?: number } = {}): DetectedJob[] {
  const { company = null, max = 40 } = options;
  const host = siteOf(baseUrl);
  if (!host) return [];
  let basePath = '';
  try { basePath = new URL(baseUrl).pathname.replace(/\/+$/, ''); } catch { return []; }
  const jobs: DetectedJob[] = [];
  const seen = new Set<string>();
  const re = /<a\b[^>]*?\shref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi;
  for (let m = re.exec(html); m && jobs.length < max; m = re.exec(html)) {
    const href = decodeEntities((m[1] ?? m[2] ?? '').trim());
    if (!href || href.startsWith('#') || /^(?:mailto|tel|javascript):/i.test(href)) continue;
    let url: URL;
    try { url = new URL(href, baseUrl); } catch { continue; }
    if (url.protocol !== 'https:' || FILE.test(url.pathname + url.search)) continue;
    const linkHost = url.hostname.replace(/^www\./, '').toLowerCase();
    if (linkHost !== host && !linkHost.endsWith(`.${host}`)) continue;
    url.hash = '';
    const path = url.pathname.replace(/\/+$/, '');
    if (!JOB_PATH.test(url.pathname) || (path === basePath && !url.search)) continue;
    const title = stripHtml(m[3]).replace(/\s+/g, ' ').trim();
    if (title.length < 4 || title.length > 140 || !/\p{L}{3}/u.test(title) || NOT_A_ROLE.test(title)) continue;
    const link = url.toString();
    if (seen.has(link)) continue;
    seen.add(link);
    jobs.push({
      external_id: `anchor-${link}`.slice(0, 1000), title, company: company ?? null, location: null, url: link,
      salary: null, description: null, posted_at: null,
      raw: { provider: 'html-anchors', site: host, via: 'anchors', note: 'Enlace de una página de empleo sin JobPosting ni RSS: título = texto del enlace; el resto no se infiere.' },
      apply_url: link, via: 'anchors',
    });
  }
  return jobs;
}

/** Detecta el formato por el contenido, no por la URL: una página puede servir RSS con otro nombre. */
export function extractJobPostings(body: string, baseUrl: string, options: { anchors?: boolean; company?: string | null } = {}): DetectedJob[] {
  const trimmed = body.trim();
  const looksXml = /^<\?xml|<rss|<feed[\s>]/i.test(trimmed);
  const jobs = looksXml ? extractRssJobs(body, baseUrl) : extractJsonLdJobs(body, baseUrl);
  const structured = looksXml && !jobs.length ? extractJsonLdJobs(body, baseUrl) : jobs;
  // Los enlaces solo se leen si el llamador lo pide y la página no trae datos estructurados: «Revisar ahora» sigue igual.
  return !structured.length && options.anchors && !looksXml ? extractAnchorJobs(body, baseUrl, { company: options.company }) : structured;
}

export function diffDetected(existingIds: Iterable<string>, detected: DetectedJob[]): { fresh: DetectedJob[]; known: DetectedJob[] } {
  const known = new Set(existingIds);
  return { fresh: detected.filter(job => !known.has(job.external_id)), known: detected.filter(job => known.has(job.external_id)) };
}
