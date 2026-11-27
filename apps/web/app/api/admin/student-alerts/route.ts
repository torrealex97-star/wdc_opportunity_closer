import { NextRequest } from 'next/server';
import { authenticate, withCookies } from '../../../../lib/adminAuth';
import { ALERT_CAP_PER_DAY } from '../../../../lib/studentAlerts';
import { alertsOverview } from '../../../../lib/studentAlertsStore';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Estado de los avisos para el panel (solo lectura): interruptor, secreto, clave de Resend y recuentos de la semana. Un recuento ilegible es `null`, nunca 0.
export async function GET(request: NextRequest) {
  const auth = await authenticate(request);
  if (!auth.ok) return Response.json({ detail: auth.detail }, { status: auth.status });
  return withCookies(Response.json({ ...(await alertsOverview()), cap_per_day: ALERT_CAP_PER_DAY }, { headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);
}
