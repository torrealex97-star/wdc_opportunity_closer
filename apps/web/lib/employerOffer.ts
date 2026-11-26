import { createHash } from 'node:crypto';
import type { Candidate } from './external';

// Formulario público de empleadores: valida y convierte lo que escribe una empresa en un candidato a oferta. Módulo PURO (sin red ni base).
// Reglas: el pago es SOLO el texto que escribe la empresa (nunca se infiere); el contacto (nombre y email) va aparte y nunca viaja en lo que
// verá la alumna; el enlace de la oferta no puede ser un acortador ni mensajería (no se pueden verificar); una oferta por enlace (misma
// huella aunque cambien mayúsculas, barra final o parámetros de seguimiento); el HTML no entra; honeypot descarta bots sin avisarles.
export const ROLE_LABELS_FORM = { closer: 'Closer de ventas', setter: 'Setter de ventas', cold_calling: 'Cold calling', sdr: 'SDR' } as const;
export const CONTRACTS = { fijo: 'Contrato fijo', fijo_variable: 'Fijo + variable', solo_comision: 'Solo comisión', freelance: 'Freelance' } as const;
export const MARKETS = { ES: 'España', LATAM: 'Latinoamérica', US_ES: 'Estados Unidos (en español)' } as const;
export type FormRole = keyof typeof ROLE_LABELS_FORM;
export const LIMITS = { company: 120, name: 80, email: 120, pay: 200, descriptionMin: 60, descriptionMax: 4000, url: 500 } as const;

const SHORTENERS = new Set(['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly', 'cutt.ly', 'rebrand.ly', 'shorturl.at', 'tiny.cc', 'lnkd.in']);
const MESSAGING = new Set(['t.me', 'telegram.me', 'wa.me', 'api.whatsapp.com', 'chat.whatsapp.com', 'whatsapp.com', 'discord.gg', 'discord.com']);
const TRACKING = /^(utm_|fbclid$|gclid$|mc_|ref$|ref_)/i;

/** Quita etiquetas HTML (con el contenido de script/style) y normaliza espacios sin perder los saltos de línea. */
function plain(input: unknown): string {
  return String(input ?? '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}
const oneLine = (input: unknown) => plain(input).replace(/\s+/g, ' ');

function cleanUrl(raw: unknown, opts: { offer: boolean }): { url: string } | { error: string } {
  const text = String(raw ?? '').trim();
  if (!text) return { error: 'Escribe la dirección (https).' };
  if (text.length > LIMITS.url) return { error: `La dirección es demasiado larga (máximo ${LIMITS.url} caracteres).` };
  let url: URL;
  try { url = new URL(text); } catch { return { error: 'No parece una dirección válida.' }; }
  if (url.protocol !== 'https:') return { error: 'La dirección debe empezar por https://.' };
  if (url.username || url.password) return { error: 'La dirección no puede llevar usuario ni contraseña.' };
  const host = url.hostname.toLowerCase();
  if (!host.includes('.') || /^\d+(\.\d+){3}$/.test(host) || host.startsWith('[') || host === 'localhost' || host.endsWith('.local')) return { error: 'Usa la dirección pública de la empresa, no una IP ni un nombre interno.' };
  if (opts.offer && (SHORTENERS.has(host) || MESSAGING.has(host))) return { error: 'El enlace de la oferta no puede ser un acortador ni un enlace de mensajería: pon la dirección real de la oferta.' };
  return { url: url.toString() };
}

/** Huella estable de una oferta: la misma dirección (sin seguimiento, hash ni barra final, host en minúsculas) da el mismo id. */
export function offerExternalId(rawUrl: string): string {
  let canon = rawUrl.trim();
  try {
    const u = new URL(rawUrl); u.hash = ''; u.hostname = u.hostname.toLowerCase();
    for (const key of [...u.searchParams.keys()]) if (TRACKING.test(key)) u.searchParams.delete(key);
    canon = u.toString().replace(/\/+$/, '');
  } catch { /* se usa el texto tal cual */ }
  return `emp-${createHash('sha1').update(canon).digest('hex').slice(0, 16)}`;
}

export type EmployerResult =
  | { ok: true; candidate: Candidate; contact: { name: string; email: string }; offer_url: string; company: string }
  | { ok: false; honeypot: true; errors?: undefined }
  | { ok: false; honeypot?: false; errors: Record<string, string> };

export function validateEmployerOffer(input: unknown, now: Date = new Date()): EmployerResult {
  const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  // Trampa para bots: un campo oculto que una persona nunca rellena. Se descarta sin error (no se le enseña al bot qué falló).
  if (typeof body.hp === 'string' && body.hp.trim() !== '') return { ok: false, honeypot: true };
  const errors: Record<string, string> = {};
  const company = oneLine(body.company), name = oneLine(body.contact_name), email = oneLine(body.contact_email).toLowerCase();
  const pay = oneLine(body.pay), description = plain(body.description);
  if (company.length < 2 || company.length > LIMITS.company) errors.company = `Escribe el nombre de la empresa (2 a ${LIMITS.company} caracteres).`;
  if (name.length < 2 || name.length > LIMITS.name) errors.contact_name = `Escribe tu nombre (2 a ${LIMITS.name} caracteres).`;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > LIMITS.email) errors.contact_email = 'Escribe un email válido: es donde te escribiremos si hace falta aclarar algo.';
  const website = cleanUrl(body.website, { offer: false }); if ('error' in website) errors.website = website.error;
  const offer = cleanUrl(body.offer_url, { offer: true }); if ('error' in offer) errors.offer_url = offer.error;
  const role = typeof body.role === 'string' && body.role in ROLE_LABELS_FORM ? body.role as FormRole : null; if (!role) errors.role = 'Elige el puesto: closer, setter, cold calling o SDR.';
  const contract = typeof body.contract === 'string' && body.contract in CONTRACTS ? body.contract as keyof typeof CONTRACTS : null; if (!contract) errors.contract = 'Elige el tipo de contrato.';
  const market = typeof body.market === 'string' && body.market in MARKETS ? body.market as keyof typeof MARKETS : null; if (!market) errors.market = 'Elige el mercado.';
  if (pay.length > LIMITS.pay) errors.pay = `Resume el pago en ${LIMITS.pay} caracteres o menos.`;
  if (description.length < LIMITS.descriptionMin) errors.description = `Describe el puesto con al menos ${LIMITS.descriptionMin} caracteres: qué haría la persona y cómo se trabaja.`;
  if (description.length > LIMITS.descriptionMax) errors.description = `La descripción es demasiado larga (máximo ${LIMITS.descriptionMax} caracteres).`;
  if (body.accepted_terms !== true) errors.accepted_terms = 'Hay que aceptar los términos para publicar la oferta.';
  if (Object.keys(errors).length || !role || !contract || !market || 'error' in offer) return { ok: false, errors };
  const url = (offer as { url: string }).url;
  const candidate: Candidate = {
    external_id: offerExternalId(url), title: `${ROLE_LABELS_FORM[role]} · ${company}`, company, location: MARKETS[market], url,
    salary: pay || null, description, posted_at: now.toISOString(),
    raw: { site: 'empleadores', job_type: contract, provider: 'employer-form', kind: 'employer_submission' },
  };
  return { ok: true, candidate, contact: { name, email }, offer_url: url, company };
}
