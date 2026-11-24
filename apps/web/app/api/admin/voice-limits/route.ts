import { NextRequest } from 'next/server';
import { authenticate, originBlocked, withCookies } from '../../../../lib/adminAuth';
import { VOICE_PROVIDERS } from '../../../../lib/voiceProvider';
import { dailyVoiceSeconds, globalVoiceUsd } from '../../../../lib/voiceQuota';
import { voiceSwitchOn } from '../../../../lib/voice';
import { monthSummary } from '../../../../lib/voiceUsage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Topes de la voz para el panel de gasto: solo lectura. Los fija el entorno (VOICE_DAILY_MINUTES solo puede bajar los 10 min; VOICE_MONTHLY_USD).
// Consumo real de `voice_usage`: `null` solo si no se pudo leer (tabla sin migrar o base caída), nunca un 0 inventado.
export async function GET(request: NextRequest) {
  if (originBlocked(request)) return Response.json({ detail: 'Origen no permitido' }, { status: 403 });
  const auth = await authenticate(request);
  if (!auth.ok) return Response.json({ detail: auth.detail }, { status: auth.status });
  const month = await monthSummary();
  return withCookies(Response.json({
    switch_on: voiceSwitchOn(),
    daily_minutes_per_student: dailyVoiceSeconds() / 60,
    monthly_cap_usd: globalVoiceUsd(),
    spent_usd_month: month?.spentUsd ?? null, minutes_today: month?.minutesToday ?? null,
    usage_note: month ? 'Gasto y minutos leídos de las sesiones anotadas; el gasto es una estimación en el peor caso del proveedor, no una factura.' : 'No se pudo leer el consumo (¿falta aplicar la migración 20261124_voice_usage.sql?). Se muestra «—», no 0.',
    providers: VOICE_PROVIDERS,
  }, { headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);
}
