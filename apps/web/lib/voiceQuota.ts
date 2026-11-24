// Topes de la práctica por voz (decisión del propietario, 2026-11-24): como máximo 10 minutos por alumna y día, y un tope global
// mensual de gasto en voz. Función pura: decide con los datos que le dan (consumo de hoy y gasto del mes); no lee ni escribe nada.

export const DAILY_VOICE_SECONDS_MAX = 600;
export const GLOBAL_VOICE_USD_DEFAULT = 10;

const num = (v: string | undefined) => { const n = Number((v ?? '').trim().replace(',', '.')); return Number.isFinite(n) && n > 0 ? n : null; };
/** Segundos diarios por alumna. El entorno solo puede BAJAR el tope (10 min es el máximo acordado). */
export const dailyVoiceSeconds = (env: Record<string, string | undefined> = process.env) => {
  const minutes = num(env.VOICE_DAILY_MINUTES);
  return minutes === null ? DAILY_VOICE_SECONDS_MAX : Math.min(DAILY_VOICE_SECONDS_MAX, Math.floor(minutes * 60));
};
export const globalVoiceUsd = (env: Record<string, string | undefined> = process.env) => num(env.VOICE_MONTHLY_USD) ?? GLOBAL_VOICE_USD_DEFAULT;

export type VoiceGate = { allowed: true; remainingSeconds: number } | { allowed: false; reason: 'daily_cap' | 'global_cap' | 'usage_unreadable'; remainingSeconds: number };
/** `usedSecondsToday` y `spentUsdMonth` en `null` = no se pudieron leer: no se abre la voz (un hueco no es un cero). */
export function voiceGate(input: { usedSecondsToday: number | null; spentUsdMonth: number | null; sessionEstimateUsd?: number }, env: Record<string, string | undefined> = process.env): VoiceGate {
  const cap = dailyVoiceSeconds(env);
  if (input.usedSecondsToday === null || input.spentUsdMonth === null) return { allowed: false, reason: 'usage_unreadable', remainingSeconds: 0 };
  const remaining = Math.max(0, cap - Math.max(0, Math.floor(input.usedSecondsToday)));
  if (remaining === 0) return { allowed: false, reason: 'daily_cap', remainingSeconds: 0 };
  if (input.spentUsdMonth + (input.sessionEstimateUsd ?? 0) > globalVoiceUsd(env)) return { allowed: false, reason: 'global_cap', remainingSeconds: remaining };
  return { allowed: true, remainingSeconds: remaining };
}
