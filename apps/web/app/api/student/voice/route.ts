import { NextRequest } from 'next/server';
import { withCookies } from '../../../../lib/adminAuth';
import { authenticateStudent } from '../../../../lib/studentAuth';
import { studentByEmail } from '../../../../lib/students';
import { voiceStatus } from '../../../../lib/voice';
import { dailyVoiceSeconds, voiceGate } from '../../../../lib/voiceQuota';
import { monthSummary, usedSecondsToday } from '../../../../lib/voiceUsage';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// ¿Puede esta alumna usar la voz continua? Hoy siempre «no» salvo que el propietario encienda VOICE_ROLEPLAY y ella tenga consentimiento vigente.
// No abre ninguna sesión de audio: solo informa a la interfaz para que no ofrezca lo que no está disponible.
export async function GET(request: NextRequest) {
  const auth = await authenticateStudent(request);
  if (!auth.ok) return Response.json({ detail: auth.detail }, { status: auth.status });
  const reply = (body: unknown, status = 200) => withCookies(Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);
  const row = await studentByEmail(auth.student.email);
  if (!row) return reply({ detail: 'Tu cuenta no tiene acceso al portal de alumnas.' }, 403);
  const status = await voiceStatus(row.id);
  const limits = { daily_minutes: dailyVoiceSeconds() / 60 };
  if (!status.enabled) return reply({ ...status, limits });
  // Con la voz encendida y consentimiento vigente: cuánto queda hoy. Un consumo ilegible NO abre la voz.
  const [used, month] = await Promise.all([usedSecondsToday(row.id), monthSummary()]);
  const gate = voiceGate({ usedSecondsToday: used, spentUsdMonth: month?.spentUsd ?? null });
  return reply({ ...status, enabled: gate.allowed, reason: gate.allowed ? status.reason : gate.reason, limits: { ...limits, remaining_seconds: gate.remainingSeconds } });
}
