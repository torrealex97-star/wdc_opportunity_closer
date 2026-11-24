import type { NextRequest } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { voiceStatus } from '../../../../lib/voice';
import { recordVoiceUsage } from '../../../../lib/voiceUsage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Anotación del consumo de voz por el SERVICIO de voz (no por el navegador: una alumna no puede decidir cuánto ha gastado).
// Sin VOICE_WORKER_TOKEN (≥ 24 caracteres) la ruta responde 503. Solo anota si la voz está encendida y la alumna tiene consentimiento vigente.
function authorized(request: NextRequest) {
  const expected = Buffer.from(process.env.VOICE_WORKER_TOKEN ?? '');
  const given = Buffer.from((request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, ''));
  return expected.length >= 24 && given.length === expected.length && timingSafeEqual(given, expected);
}

export async function POST(request: NextRequest) {
  if ((process.env.VOICE_WORKER_TOKEN ?? '').length < 24) return Response.json({ detail: 'El servicio de voz no está configurado.' }, { status: 503 });
  if (!authorized(request)) return Response.json({ detail: 'No autorizado.' }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { student_id?: unknown; provider?: unknown; seconds?: unknown };
  const studentId = typeof body.student_id === 'string' ? body.student_id : '', provider = typeof body.provider === 'string' ? body.provider : '', seconds = Number(body.seconds);
  const status = await voiceStatus(studentId);
  if (!status.enabled) return Response.json({ detail: 'La voz no está disponible para esta alumna.', reason: status.reason }, { status: 403 });
  const result = await recordVoiceUsage({ studentId, provider, seconds });
  if (result.ok) return Response.json({ recorded_seconds: result.seconds, cost_usd: result.costUsd, remaining_seconds: result.remainingSeconds }, { headers: { 'Cache-Control': 'no-store' } });
  return Response.json({ detail: result.error }, { status: result.kind === 'invalid' ? 422 : result.kind === 'cap' ? 429 : 503 });
}
