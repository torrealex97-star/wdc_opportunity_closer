import { NextRequest } from 'next/server';
import { originBlocked, withCookies } from '../../../../lib/adminAuth';
import { authenticateStudent } from '../../../../lib/studentAuth';
import { ALERTS_CONSENT_TEXT } from '../../../../lib/legal';
import { ALERTS_CONSENT_VERSION, ALERT_CAP_PER_DAY } from '../../../../lib/studentAlerts';
import { getPrefs, setOptIn } from '../../../../lib/studentAlertsStore';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Consentimiento de avisos de la alumna logueada (casilla propia y revocable). El user_id sale SIEMPRE de la sesión.
const reply = (auth: { setCookies: string[] }, body: unknown, status = 200) => withCookies(Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);
const info = { consent_text: ALERTS_CONSENT_TEXT, version: ALERTS_CONSENT_VERSION, cap_per_day: ALERT_CAP_PER_DAY };

export async function GET(request: NextRequest) {
  const auth = await authenticateStudent(request);
  if (!auth.ok) return Response.json({ detail: auth.detail }, { status: auth.status });
  const prefs = await getPrefs(auth.student.user_id);
  return reply(auth, prefs ? { ...info, opted_in: prefs.opted_in, at: prefs.at } : { ...info, opted_in: null, at: null, error: 'No pudimos leer tu preferencia de avisos. Inténtalo de nuevo en unos minutos.' });
}

export async function PUT(request: NextRequest) {
  if (originBlocked(request)) return Response.json({ detail: 'Origen no permitido' }, { status: 403 });
  const auth = await authenticateStudent(request);
  if (!auth.ok) return Response.json({ detail: auth.detail }, { status: auth.status });
  const body = await request.json().catch(() => null) as { opt_in?: unknown } | null;
  if (typeof body?.opt_in !== 'boolean') return Response.json({ detail: 'Indica si quieres recibir avisos (opt_in: true o false).' }, { status: 422 });
  const saved = await setOptIn(auth.student.user_id, body.opt_in);
  if (!saved) return Response.json({ detail: 'No pudimos guardar tu preferencia. Inténtalo de nuevo en unos minutos.' }, { status: 503 });
  return reply(auth, { ok: true, ...info, opted_in: saved.opted_in, at: saved.at });
}
