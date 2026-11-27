import { ORG } from './external';
import { getSecret } from './integrations';
import { recommendForStudent } from './matching';
import { pagedRest, serviceRest } from './supabaseAuth';
import { ALERTS_CONSENT_VERSION, alertsEnabled, alertsSecret, type AlertDeps, type OptedIn, type Queued } from './studentAlerts';

// Acceso a datos de los avisos rápidos: consentimiento (student_alert_prefs), cola (student_alerts) y envío por Resend. Cada escritura
// consume su resultado (`ok` y filas afectadas): una escritura fallida nunca se cuenta como hecha.
const EMAIL_TIMEOUT_MS = 15_000, DAY = 86_400_000;
const rows = async <T,>(response: Response | null): Promise<T[] | null> => { if (!response?.ok) return null; const data = await response.json().catch(() => null); return Array.isArray(data) ? data as T[] : null; };
const inList = (values: string[]) => `in.(${values.join(',')})`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type Prefs = { opted_in: boolean; version: string | null; at: string | null };
export async function getPrefs(userId: string): Promise<Prefs | null> {
  if (!UUID.test(userId)) return null;
  const found = await rows<{ opted_in_at: string | null; opt_in_version: string | null }>(await serviceRest(`student_alert_prefs?org_id=eq.${ORG}&user_id=eq.${userId}&select=opted_in_at,opt_in_version&limit=1`).catch(() => null));
  if (!found) return null;
  const row = found[0];
  return { opted_in: Boolean(row?.opted_in_at), version: row?.opt_in_version ?? null, at: row?.opted_in_at ?? null };
}
/** Activa o desactiva el consentimiento. `null` si no se pudo guardar (nada se da por hecho). */
export async function setOptIn(userId: string, on: boolean, now = new Date()): Promise<Prefs | null> {
  if (!UUID.test(userId)) return null;
  const body = { org_id: ORG, user_id: userId, opted_in_at: on ? now.toISOString() : null, opt_in_version: on ? ALERTS_CONSENT_VERSION : null, updated_at: now.toISOString() };
  const saved = await rows<{ opted_in_at: string | null }>(await serviceRest('student_alert_prefs?on_conflict=org_id,user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(body) }).catch(() => null));
  return saved?.length === 1 ? { opted_in: on, version: body.opt_in_version, at: body.opted_in_at } : null;
}

async function listOptedIn(): Promise<OptedIn[] | null> {
  const prefs = await pagedRest<{ user_id: string }>(`student_alert_prefs?org_id=eq.${ORG}&opted_in_at=not.is.null&select=user_id`, 'user_id.asc').catch(() => null);
  if (!prefs) return null;
  const ids = prefs.rows.map(r => r.user_id).filter(id => UUID.test(id)), out: OptedIn[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const chunk = await rows<{ user_id: string; email: string }>(await serviceRest(`students?org_id=eq.${ORG}&status=eq.active&user_id=${inList(ids.slice(i, i + 50))}&select=user_id,email`).catch(() => null));
    if (!chunk) return null; // un hueco no es un cero: sin poder leer a las alumnas no se envía nada
    out.push(...chunk.filter(s => s.user_id && s.email));
  }
  return out;
}

async function existing(userId: string, now: number) {
  const since = encodeURIComponent(new Date(now - 30 * DAY).toISOString());
  const found = await rows<{ offer_id: string; status: string; created_at: string }>(await serviceRest(`student_alerts?org_id=eq.${ORG}&user_id=eq.${userId}&created_at=gte.${since}&select=offer_id,status,created_at&limit=1000`).catch(() => null));
  if (!found) return null;
  const today = new Date(now).toISOString().slice(0, 10);
  return { offerIds: new Set(found.map(r => r.offer_id)), sentToday: found.filter(r => r.created_at.slice(0, 10) === today && (r.status === 'sending' || r.status === 'sent')).length };
}

async function enqueue(userId: string, offerIds: string[]): Promise<Queued[] | null> {
  const body = offerIds.map(offer_id => ({ org_id: ORG, user_id: userId, offer_id }));
  return rows<Queued>(await serviceRest('student_alerts?on_conflict=org_id,user_id,offer_id&select=id,offer_id', { method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify(body) }).catch(() => null));
}
/** Reclamo atómico: solo las filas que ESTA llamada pasa de pending a sending son suyas. */
async function claim(ids: string[]): Promise<string[] | null> {
  const claimed = await rows<{ id: string }>(await serviceRest(`student_alerts?org_id=eq.${ORG}&id=${inList(ids)}&status=eq.pending&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'sending' }) }).catch(() => null));
  return claimed ? claimed.map(r => r.id) : null;
}
async function mark(id: string, status: 'sent' | 'failed', reason: string | null, now = new Date()): Promise<boolean> {
  const done = await rows<{ id: string }>(await serviceRest(`student_alerts?org_id=eq.${ORG}&id=eq.${id}&status=eq.sending&select=id`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status, reason, sent_at: status === 'sent' ? now.toISOString() : null }) }).catch(() => null));
  return done?.length === 1;
}

export function resendSender(env: Record<string, string | undefined>, key: string, fetchImpl: typeof fetch = fetch): AlertDeps['send'] {
  const from = (env.RESEND_FROM ?? '').trim() || 'onboarding@resend.dev', base = (env.RESEND_API_BASE ?? 'https://api.resend.com').replace(/\/$/, '');
  return async (to, message) => {
    try {
      const response = await fetchImpl(`${base}/emails`, { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to: [to], subject: message.subject, text: message.text, html: message.html }) });
      const data = await response.json().catch(() => null) as { message?: string } | null;
      return response.ok ? { ok: true, detail: 'Enviado.' } : { ok: false, detail: `Resend rechazó el aviso (HTTP ${response.status}${typeof data?.message === 'string' ? `: ${data.message.replace(/\s+/g, ' ').slice(0, 160)}` : ''}).` };
    } catch { return { ok: false, detail: 'No se pudo contactar con Resend.' }; }
  };
}

export async function liveAlertDeps(deadline: () => boolean, env: Record<string, string | undefined> = process.env, fetchImpl: typeof fetch = fetch): Promise<AlertDeps> {
  const key = alertsEnabled(env) ? await getSecret('resend').catch(() => null) : null;
  return {
    env, now: () => Date.now(), hasKey: async () => Boolean(key), listOptedIn, recommend: userId => recommendForStudent(userId), existing, enqueue, claim, mark,
    send: key ? resendSender(env, key, fetchImpl) : async () => ({ ok: false, detail: 'Sin clave de Resend.' }), deadline,
  };
}

/** Lo que el panel enseña: interruptor, secreto, clave y recuentos de la última semana. `null` en un recuento = no se pudo leer (nunca 0). */
export async function alertsOverview(env: Record<string, string | undefined> = process.env, now = Date.now()) {
  const [prefs, recent, key] = await Promise.all([
    pagedRest<{ user_id: string }>(`student_alert_prefs?org_id=eq.${ORG}&opted_in_at=not.is.null&select=user_id`, 'user_id.asc').catch(() => null),
    pagedRest<{ status: string; reason: string | null }>(`student_alerts?org_id=eq.${ORG}&created_at=gte.${encodeURIComponent(new Date(now - 7 * DAY).toISOString())}&select=status,reason`, 'created_at.desc').catch(() => null),
    getSecret('resend').catch(() => null),
  ]);
  const by: Record<string, number> = { pending: 0, sending: 0, sent: 0, failed: 0, skipped: 0 };
  for (const r of recent?.rows ?? []) by[r.status] = (by[r.status] ?? 0) + 1;
  return {
    enabled: alertsEnabled(env), secret_set: Boolean(alertsSecret(env)), key_saved: Boolean(key),
    opted_in: prefs ? prefs.rows.length : null, week: recent ? by : null,
    last_failure: recent?.rows.find(r => r.status === 'failed')?.reason ?? null,
  };
}
