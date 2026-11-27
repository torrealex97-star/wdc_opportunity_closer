import { createHmac, timingSafeEqual } from 'node:crypto';
import type { Match, Opp, Recommendation } from './matching';

// Avisos rápidos por email a las alumnas (incremento 3). Módulo SIN red ni base de datos: reglas puras y la orquestación con sus dependencias
// inyectadas (el acceso real vive en `studentAlertsStore.ts`). Reglas, todas con prueba (tests/admin-auth/alerts.mjs):
//  · APAGADO por defecto (`STUDENT_ALERTS_ENABLED`): enviar correo automático a alumnas exige la autorización explícita del propietario.
//  · Solo alumnas con consentimiento explícito y aparte; cada correo lleva una baja firmada (`ALERTS_SECRET`); sin secreto no se envía.
//  · Emparejamiento DETERMINISTA (`recommendForStudent`): ningún dato de la alumna sale a un modelo, ni siquiera al correo salvo su email.
//  · Una oferta se avisa una sola vez por alumna; tope diario; reclamo atómico antes de enviar; un envío fallido nunca cuenta como enviado.
//  · El correo solo repite lo que dice la oferta aprobada (título, empresa, retribución tal cual, enlace): nada se inventa.
export const ALERT_CAP_PER_DAY = 3;
export const MIN_ALERT_SCORE = 50; // solo ofertas de los perfiles que la alumna eligió (el emparejador da ≥ 50 por perfil)
export const ALERTS_CONSENT_VERSION = 'v1-borrador'; // texto legal pendiente de revisión

export const alertsEnabled = (env: Record<string, string | undefined>) => ['1', 'true'].includes((env.STUDENT_ALERTS_ENABLED ?? '').trim().toLowerCase());
export const alertsSecret = (env: Record<string, string | undefined>): string | null => { const s = (env.ALERTS_SECRET ?? '').trim(); return s.length >= 16 ? s : null; };

const sig = (userId: string, secret: string) => createHmac('sha256', secret).update(`student-alerts-unsubscribe|${userId}`).digest('hex').slice(0, 40);
export const signUnsub = sig;
export function verifyUnsub(userId: string, token: string, secret: string): boolean {
  if (typeof token !== 'string' || token.length !== 40) return false;
  const a = Buffer.from(token), b = Buffer.from(sig(userId, secret));
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Ofertas a avisar hoy: de su perfil, sin repetir, sin las ya avisadas y dentro de lo que queda del tope diario. */
export function pickForDigest(input: { matches: Match[]; alreadyQueued: Set<string>; sentToday: number; cap?: number }): Match[] {
  const room = Math.max(0, (input.cap ?? ALERT_CAP_PER_DAY) - input.sentToday), seen = new Set<string>(), out: Match[] = [];
  for (const m of input.matches) {
    if (out.length >= room) break;
    const id = m.opportunity.id;
    if (m.score < MIN_ALERT_SCORE || input.alreadyQueued.has(id) || seen.has(id)) continue;
    seen.add(id); out.push(m);
  }
  return out;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export function renderDigest(input: { offers: Opp[]; unsubscribeUrl: string }): { subject: string; text: string; html: string } {
  const n = input.offers.length, subject = `${n} ${n === 1 ? 'oferta nueva' : 'ofertas nuevas'} para ti en WDC`;
  const lines = input.offers.map(o => ({ title: o.original_title, company: o.company || 'Empresa no indicada', pay: o.compensation || 'No publicado', place: [o.modality, o.location].filter(Boolean).join(' · ') || 'No indicada', url: o.source_url }));
  const foot = 'Recibes este aviso porque lo activaste en tu perfil de WDC. Las ofertas las ha revisado el equipo, pero compruébalas en el enlace de la empresa antes de aplicar.';
  const text = [`Hola,`, '', `Estas son tus ofertas nuevas:`, '', ...lines.flatMap(l => [`• ${l.title} — ${l.company}`, `  Retribución: ${l.pay}`, `  Lugar: ${l.place}`, `  ${l.url}`, '']), foot, `Darte de baja: ${input.unsubscribeUrl}`].join('\n');
  const html = `<p>Hola,</p><p>Estas son tus ofertas nuevas:</p><ul>${lines.map(l => `<li><strong>${esc(l.title)}</strong> — ${esc(l.company)}<br>Retribución: ${esc(l.pay)}<br>Lugar: ${esc(l.place)}<br><a href="${esc(l.url)}">${esc(l.url)}</a></li>`).join('')}</ul><p style="color:#555;font-size:13px">${esc(foot)}<br><a href="${esc(input.unsubscribeUrl)}">Darte de baja</a></p>`;
  return { subject, text, html };
}

export type OptedIn = { user_id: string; email: string };
export type Queued = { id: string; offer_id: string };
export type AlertDeps = {
  env: Record<string, string | undefined>;
  now: () => number;
  hasKey: () => Promise<boolean>;
  listOptedIn: () => Promise<OptedIn[] | null>;
  recommend: (userId: string) => Promise<Recommendation>;
  existing: (userId: string, now: number) => Promise<{ offerIds: Set<string>; sentToday: number } | null>;
  enqueue: (userId: string, offerIds: string[]) => Promise<Queued[] | null>;
  claim: (ids: string[]) => Promise<string[] | null>;
  mark: (id: string, status: 'sent' | 'failed', reason: string | null) => Promise<boolean>;
  send: (to: string, message: { subject: string; text: string; html: string }) => Promise<{ ok: boolean; detail: string }>;
  deadline: () => boolean;
};
export type AlertRun = { enabled: boolean; reason?: string; opted_in: number; offers: number; sent: number; failed: number; skipped_claim: number; unreadable: number; mark_failed: number; truncated: boolean };
const empty = (over: Partial<AlertRun> = {}): AlertRun => ({ enabled: true, opted_in: 0, offers: 0, sent: 0, failed: 0, skipped_claim: 0, unreadable: 0, mark_failed: 0, truncated: false, ...over });

export async function runAlerts(deps: AlertDeps): Promise<AlertRun> {
  if (!alertsEnabled(deps.env)) return empty({ enabled: false, reason: 'Avisos apagados (STUDENT_ALERTS_ENABLED): no se lee ni se envía nada.' });
  const secret = alertsSecret(deps.env);
  if (!secret) return empty({ reason: 'Falta ALERTS_SECRET (mínimo 16 caracteres): sin él no se puede firmar la baja y no se envía nada.' });
  if (!(await deps.hasKey())) return empty({ reason: 'Falta la clave de Resend (Panel → APIs): no se envía ni se encola nada.' });
  const students = await deps.listOptedIn();
  if (!students) return empty({ reason: 'No se pudo leer la lista de alumnas con consentimiento: no se envía nada.' });
  const out = empty({ opted_in: students.length });
  const base = (deps.env.ADMIN_PUBLIC_URL ?? 'https://app.womendigitalclosers.com').replace(/\/$/, '');
  for (const student of students) {
    if (deps.deadline()) { out.truncated = true; break; }
    const rec = await deps.recommend(student.user_id).catch(() => null);
    if (!rec?.ready || !rec.matches.length) continue;
    const seen = await deps.existing(student.user_id, deps.now());
    if (!seen) { out.unreadable++; continue; }
    const picked = pickForDigest({ matches: rec.matches, alreadyQueued: seen.offerIds, sentToday: seen.sentToday });
    if (!picked.length) continue;
    const queued = await deps.enqueue(student.user_id, picked.map(m => m.opportunity.id));
    if (!queued) { out.unreadable++; continue; }
    if (!queued.length) continue;
    const claimed = await deps.claim(queued.map(q => q.id));
    const mine = queued.filter(q => claimed?.includes(q.id));
    if (!mine.length) { out.skipped_claim++; continue; }
    const offers = picked.filter(m => mine.some(q => q.offer_id === m.opportunity.id)).map(m => m.opportunity);
    const message = renderDigest({ offers, unsubscribeUrl: `${base}/api/alerts/unsubscribe?u=${student.user_id}&t=${signUnsub(student.user_id, secret)}` });
    const result = await deps.send(student.email, message).catch(() => ({ ok: false, detail: 'No se pudo contactar con Resend.' }));
    out.offers += offers.length;
    if (result.ok) out.sent++; else out.failed++;
    for (const q of mine) if (!(await deps.mark(q.id, result.ok ? 'sent' : 'failed', result.ok ? null : result.detail.slice(0, 300)))) out.mark_failed++;
  }
  return out;
}
