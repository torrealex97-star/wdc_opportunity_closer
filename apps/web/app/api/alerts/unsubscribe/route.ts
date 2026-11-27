import { NextRequest } from 'next/server';
import { alertsSecret, verifyUnsub } from '../../../../lib/studentAlerts';
import { setOptIn } from '../../../../lib/studentAlertsStore';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Baja desde el enlace del correo. La página (GET) NO cambia nada —los escáneres de enlaces del correo la abren—: la baja es el botón (POST).
// El token es una firma de esa alumna con ALERTS_SECRET; un token ajeno o sin secreto no sirve.
const HTML = { 'content-type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' };
const page = (title: string, body: string, status = 200) => new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title><style>body{font:16px/1.5 system-ui,sans-serif;max-width:32rem;margin:3rem auto;padding:0 1rem}button{font:inherit;padding:.6rem 1rem;cursor:pointer}</style></head><body><h1>${title}</h1>${body}</body></html>`, { status, headers: HTML });
const parse = (params: URLSearchParams) => { const u = params.get('u') ?? '', t = params.get('t') ?? '', secret = alertsSecret(process.env); return secret && /^[0-9a-f-]{36}$/i.test(u) && verifyUnsub(u, t, secret) ? { u, t } : null; };
const invalid = () => page('Enlace no válido', '<p>Este enlace de baja no es válido o ha caducado. Puedes darte de baja desde tu perfil en la plataforma.</p>', 400);

export async function GET(request: NextRequest) {
  const ok = parse(request.nextUrl.searchParams);
  if (!ok) return invalid();
  return page('Darte de baja de los avisos', `<p>No recibirás más avisos de ofertas por email. Puedes volver a activarlos cuando quieras desde tu perfil.</p><form method="post" action="/api/alerts/unsubscribe?u=${ok.u}&amp;t=${ok.t}"><button type="submit">Darme de baja</button></form>`);
}
export async function POST(request: NextRequest) {
  const ok = parse(request.nextUrl.searchParams);
  if (!ok) return invalid();
  const saved = await setOptIn(ok.u, false);
  return saved ? page('Baja confirmada', '<p>Listo: no recibirás más avisos de ofertas por email.</p>') : page('No pudimos darte de baja', '<p>Ha habido un problema. Inténtalo de nuevo en unos minutos o desactívalos desde tu perfil.</p>', 503);
}
