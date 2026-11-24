import { NextRequest } from 'next/server';
import { authenticate, originBlocked, withCookies } from '../../../../lib/adminAuth';
import { VOICE_PROVIDERS } from '../../../../lib/voiceProvider';
import { dailyVoiceSeconds, globalVoiceUsd } from '../../../../lib/voiceQuota';
import { voiceSwitchOn } from '../../../../lib/voice';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Topes de la voz para el panel de gasto: solo lectura. Los fija el entorno (VOICE_DAILY_MINUTES solo puede bajar los 10 min; VOICE_MONTHLY_USD).
// El consumo real NO se mide todavía (no hay sesiones de voz): se devuelve `null`, nunca 0, y el panel lo dice.
export async function GET(request: NextRequest) {
  if (originBlocked(request)) return Response.json({ detail: 'Origen no permitido' }, { status: 403 });
  const auth = await authenticate(request);
  if (!auth.ok) return Response.json({ detail: auth.detail }, { status: auth.status });
  return withCookies(Response.json({
    switch_on: voiceSwitchOn(),
    daily_minutes_per_student: dailyVoiceSeconds() / 60,
    monthly_cap_usd: globalVoiceUsd(),
    spent_usd_month: null, minutes_today: null,
    usage_note: 'Todavía no se mide: la voz continua no está activa y no hay sesiones. Cuando haya, este panel mostrará el gasto y los minutos reales.',
    providers: VOICE_PROVIDERS,
  }, { headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);
}
