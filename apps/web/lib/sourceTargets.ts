// Direcciones a vigilar por fuente (grupos y páginas de Facebook, comunidades de Skool, canales públicos de Telegram).
// Solo las fuentes cuyos actores esperan direcciones de verdad: Reddit devuelve publicaciones y las empresas se buscan por título, no por URL.
// Módulo PURO (sin red ni base de datos): valida y normaliza lo que el propietario escribe en Fuentes → «Direcciones a vigilar».
// Estas direcciones son destinos de los actores de Apify (`startUrls`/`profiles`), no verificaciones de enlaces: por eso no usan el
// allowlist de `urlGuard`, pero siguen sus reglas de fondo (https, sin credenciales, solo el dominio de la red social de cada fuente).

export type TargetKind = 'facebook_group' | 'facebook_page' | 'skool_community' | 'telegram_channel';
export const TARGET_SOURCES: Record<string, { label: string; kinds: TargetKind[]; hint: string; example: string }> = {
  'apify-facebook': { label: 'Facebook · grupos y páginas', kinds: ['facebook_group', 'facebook_page'], hint: 'Dirección del grupo o de la página (los grupos privados exigen acceso autorizado).', example: 'https://www.facebook.com/groups/nombre-del-grupo' },
  'apify-skool': { label: 'Skool · comunidades', kinds: ['skool_community'], hint: 'Dirección de la comunidad. El acceso de miembro se guarda como clave, nunca aquí.', example: 'https://www.skool.com/nombre-de-la-comunidad' },
  'apify-telegram': { label: 'Telegram · canales públicos', kinds: ['telegram_channel'], hint: 'Canal público: @nombre, nombre o t.me/nombre. Las invitaciones privadas no se admiten.', example: '@canal_de_empleo' },
};
/** Tope de direcciones por fuente: cada una es una búsqueda más en cada ejecución de pago. */
export const MAX_TARGETS = 30;
/** Direcciones que se pasan a un actor en una sola ejecución (coste acotado). */
export const MAX_PER_RUN = 20;

export type TargetResult = { ok: true; kind: TargetKind; url: string; label: string | null } | { ok: false; error: string };
const fail = (error: string): TargetResult => ({ ok: false, error });

const FB_RESERVED = new Set(['login', 'login.php', 'sharer', 'sharer.php', 'share', 'dialog', 'policies', 'help', 'privacy', 'ads', 'watch', 'marketplace', 'events', 'gaming', 'hashtag', 'stories', 'reel', 'photo', 'photo.php', 'permalink.php', 'profile.php', 'plugins', 'tr', 'l.php', 'home.php']);

/** Texto con esquema https y sin espacios; admite «dominio.com/ruta» sin esquema. `null` si no parece una dirección. */
function parseUrl(raw: string): URL | { error: string } {
  const text = raw.trim();
  if (!text || /\s/.test(text)) return { error: 'Escribe una sola dirección, sin espacios.' };
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/^https?:\/\//i.test(text)) return { error: 'Solo se admiten direcciones https.' };
  if (/^http:\/\//i.test(text)) return { error: 'La dirección debe ser https.' };
  let url: URL;
  try { url = new URL(/^https:\/\//i.test(text) ? text : `https://${text}`); } catch { return { error: 'No parece una dirección válida.' }; }
  if (url.username || url.password) return { error: 'La dirección no puede llevar credenciales.' };
  if (url.port && url.port !== '443') return { error: 'La dirección no puede llevar un puerto distinto del 443.' };
  return url;
}
const host = (u: URL) => u.hostname.toLowerCase().replace(/\.$/, '');
const segments = (u: URL) => u.pathname.split('/').filter(Boolean);
const isHost = (h: string, domain: string) => h === domain || h.endsWith(`.${domain}`);

function facebook(u: URL): TargetResult {
  const h = host(u); if (!isHost(h, 'facebook.com')) return fail('La dirección debe ser de facebook.com.');
  const [first, second] = segments(u);
  if (!first) return fail('Falta el grupo o la página en la dirección de Facebook.');
  if (first === 'groups') return second ? { ok: true, kind: 'facebook_group', url: `https://www.facebook.com/groups/${second}`, label: null } : fail('Falta el nombre del grupo.');
  if (FB_RESERVED.has(first.toLowerCase())) return fail(first.toLowerCase() === 'profile.php' ? 'Usa la dirección con nombre de la página (no profile.php?id=).' : 'Esa dirección de Facebook no es un grupo ni una página.');
  return { ok: true, kind: 'facebook_page', url: `https://www.facebook.com/${first}`, label: null };
}
function skool(u: URL): TargetResult {
  const h = host(u); if (!isHost(h, 'skool.com')) return fail('La dirección debe ser de skool.com.');
  const [first] = segments(u); if (!first) return fail('Falta el nombre de la comunidad.');
  return { ok: true, kind: 'skool_community', url: `https://www.skool.com/${first}`, label: null };
}
function telegramName(name: string): TargetResult {
  if (/^\+|^joinchat$/i.test(name)) return fail('Las invitaciones privadas de Telegram no se admiten: solo canales públicos.');
  if (!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(name)) return fail('El nombre del canal debe tener 5-32 letras, números o guion bajo.');
  return { ok: true, kind: 'telegram_channel', url: `https://t.me/${name}`, label: null };
}
function telegram(raw: string): TargetResult {
  const text = raw.trim();
  if (/^@?[A-Za-z0-9_+]+$/.test(text) && !/\./.test(text)) return telegramName(text.replace(/^@/, ''));
  const u = parseUrl(text); if (!(u instanceof URL)) return fail(u.error);
  if (host(u) !== 't.me') return fail('La dirección debe ser de t.me.');
  const parts = segments(u); const name = parts[0] === 's' ? parts[1] : parts[0];
  if (parts[0] === 'joinchat') return fail('Las invitaciones privadas de Telegram no se admiten: solo canales públicos.');
  return name ? telegramName(name) : fail('Falta el nombre del canal.');
}

/** Valida y normaliza una dirección para una fuente. Nunca lanza; el error dice qué corregir. */
export function validateTarget(source: string, raw: string, label?: string | null): TargetResult {
  const config = TARGET_SOURCES[source]; if (!config) return fail('Esa fuente no admite direcciones a vigilar.');
  if (typeof raw !== 'string' || !raw.trim()) return fail('Escribe una dirección.');
  if (raw.length > 500) return fail('La dirección es demasiado larga (máximo 500 caracteres).');
  let result: TargetResult;
  if (source === 'apify-telegram') result = telegram(raw);
  else { const u = parseUrl(raw); result = !(u instanceof URL) ? fail(u.error) : source === 'apify-facebook' ? facebook(u) : skool(u); }
  if (!result.ok) return result;
  if (!config.kinds.includes(result.kind)) return fail('Ese tipo de dirección no vale para esta fuente.');
  const clean = typeof label === 'string' ? label.trim().slice(0, 120) : '';
  return { ...result, label: clean || null };
}

/** Nombre corto (último tramo de la dirección): lo que piden los actores de Telegram o Skool en vez de una URL. */
export const targetName = (url: string): string => { try { const parts = new URL(url).pathname.split('/').filter(Boolean); return parts[parts[0] === 'groups' ? 1 : 0] ?? ''; } catch { return ''; } };
