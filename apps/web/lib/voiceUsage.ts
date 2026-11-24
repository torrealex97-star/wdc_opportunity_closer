import { ORG } from './external';
import { serviceRest } from './supabaseAuth';
import { estimateUsd, providerById } from './voiceProvider';
import { dailyVoiceSeconds } from './voiceQuota';

// Consumo REAL de la voz continua (tabla `voice_usage`, migración 20261124). Lectura: `null` = no se pudo leer (tabla ausente o
// Supabase caído), nunca 0. Escritura: la hace solo el servicio de voz (ruta con token); acota los segundos a lo que queda de los 10 minutos.
const todayUtc = (now = new Date()) => now.toISOString().slice(0, 10);
const monthStartUtc = (now = new Date()) => `${now.toISOString().slice(0, 7)}-01`;
type Row = { seconds?: unknown; cost_usd?: unknown };
const sum = (rows: Row[], key: 'seconds' | 'cost_usd') => rows.reduce((total, r) => total + (Number(r[key]) || 0), 0);

async function rows(query: string): Promise<Row[] | null> {
  const response = await serviceRest(`voice_usage?org_id=eq.${ORG}&${query}&select=seconds,cost_usd&limit=10000`).catch(() => null);
  const data = response?.ok ? await response.json().catch(() => null) : null;
  return Array.isArray(data) ? data as Row[] : null;
}

export async function usedSecondsToday(studentId: string, now = new Date()): Promise<number | null> {
  if (!/^[0-9a-f-]{36}$/.test(studentId)) return null;
  const data = await rows(`student_id=eq.${studentId}&day=eq.${todayUtc(now)}`);
  return data ? sum(data, 'seconds') : null;
}
/** Gasto estimado y minutos del mes y de hoy, de TODAS las alumnas. */
export type ProviderUse = { provider: string; seconds: number; costUsd: number };
export async function monthSummary(now = new Date()): Promise<{ spentUsd: number; minutesToday: number; byProvider: ProviderUse[] } | null> {
  const data = await serviceRest(`voice_usage?org_id=eq.${ORG}&day=gte.${monthStartUtc(now)}&select=day,provider,seconds,cost_usd&limit=10000`).catch(() => null);
  const list = data?.ok ? await data.json().catch(() => null) as Array<Row & { day?: string; provider?: string }> | null : null;
  if (!Array.isArray(list)) return null;
  const by = new Map<string, ProviderUse>();
  for (const r of list) { const k = String(r.provider ?? '?'); const u = by.get(k) ?? { provider: k, seconds: 0, costUsd: 0 }; u.seconds += Number(r.seconds) || 0; u.costUsd += Number(r.cost_usd) || 0; by.set(k, u); }
  return { spentUsd: Math.round(sum(list, 'cost_usd') * 10_000) / 10_000, minutesToday: Math.round(sum(list.filter(r => r.day === todayUtc(now)), 'seconds') / 6) / 10, byProvider: [...by.values()].map(u => ({ ...u, costUsd: Math.round(u.costUsd * 10_000) / 10_000 })).sort((a, b) => b.costUsd - a.costUsd) };
}

export type RecordResult = { ok: true; seconds: number; costUsd: number; remainingSeconds: number } | { ok: false; kind: 'invalid' | 'cap' | 'store'; error: string };
/** Anota una sesión. Los segundos se acotan a lo que queda del día; con 0 restante no se anota y se dice. Una escritura fallida NO cuenta como hecha. */
export async function recordVoiceUsage(input: { studentId: string; provider: string; seconds: number }, env: Record<string, string | undefined> = process.env, now = new Date()): Promise<RecordResult> {
  if (!/^[0-9a-f-]{36}$/.test(input.studentId) || !providerById(input.provider) || !Number.isFinite(input.seconds) || input.seconds < 1) return { ok: false, kind: 'invalid', error: 'Alumna, proveedor o segundos no válidos.' };
  const used = await usedSecondsToday(input.studentId, now);
  if (used === null) return { ok: false, kind: 'store', error: 'No se pudo leer el consumo de hoy; no se anota nada.' };
  const remaining = Math.max(0, dailyVoiceSeconds(env) - used);
  if (remaining === 0) return { ok: false, kind: 'cap', error: 'La alumna ya llegó al límite diario de voz.' };
  const seconds = Math.min(Math.floor(input.seconds), remaining), costUsd = estimateUsd(input.provider, seconds) ?? 0;
  const response = await serviceRest('voice_usage', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ org_id: ORG, student_id: input.studentId, day: todayUtc(now), provider: input.provider, seconds, cost_usd: costUsd }) }).catch(() => null);
  if (!response?.ok) return { ok: false, kind: 'store', error: response?.status === 404 ? 'Falta aplicar la migración 20261124_voice_usage.sql.' : 'No se pudo anotar el consumo.' };
  return { ok: true, seconds, costUsd, remainingSeconds: remaining - seconds };
}
