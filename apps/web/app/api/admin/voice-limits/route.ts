import { NextRequest } from 'next/server';
import { authenticate, originBlocked, withCookies } from '../../../../lib/adminAuth';
import { VOICE_PROVIDERS } from '../../../../lib/voiceProvider';
import { dailyVoiceSeconds, globalVoiceUsd } from '../../../../lib/voiceQuota';
import { voiceSwitchOn } from '../../../../lib/voice';
import { monthSummary } from '../../../../lib/voiceUsage';
import { currentCascade } from '../../../../lib/voiceEvents';
import { workerConfigured } from '../../../../lib/voiceWorker';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Sección «Voz» del panel (solo lectura): topes, cascada de proveedores (el más barato con clave y sano), gasto por proveedor, incidencias y
// el estado del servicio de voz. Los datos sin leer salen `null` (nunca un 0 inventado). Las claves se guardan en APIs; aquí no se muestran.
export async function GET(request: NextRequest) {
  if (originBlocked(request)) return Response.json({ detail: 'Origen no permitido' }, { status: 403 });
  const auth = await authenticate(request);
  if (!auth.ok) return Response.json({ detail: auth.detail }, { status: auth.status });
  const [month, cascade] = await Promise.all([monthSummary(), currentCascade()]);
  const use = new Map((month?.byProvider ?? []).map(u => [u.provider, u]));
  return withCookies(Response.json({
    switch_on: voiceSwitchOn(), worker_configured: workerConfigured(),
    daily_minutes_per_student: dailyVoiceSeconds() / 60, monthly_cap_usd: globalVoiceUsd(),
    spent_usd_month: month?.spentUsd ?? null, minutes_today: month?.minutesToday ?? null,
    usage_note: month ? 'Gasto y minutos leídos de las sesiones anotadas; el gasto es una estimación en el peor caso del proveedor, no una factura.' : 'No se pudo leer el consumo (¿falta aplicar la migración 20261124_voice_usage.sql?). Se muestra «—», no 0.',
    cascade_readable: cascade.readable, chosen: cascade.chosen,
    providers: cascade.order.map(e => {
      const info = VOICE_PROVIDERS.find(p => p.id === e.id)!;
      return { ...info, state: e.state, reason: e.reason, until: e.until, key: e.key, spent_usd: month ? use.get(e.id)?.costUsd ?? 0 : null, minutes: month ? Math.round((use.get(e.id)?.seconds ?? 0) / 6) / 10 : null };
    }),
    events: cascade.events.slice(0, 10),
  }, { headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);
}
