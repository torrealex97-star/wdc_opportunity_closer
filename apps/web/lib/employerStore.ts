import { createHash } from 'node:crypto';
import { ingest, ORG } from './external';
import { serviceRest } from './supabaseAuth';
import { validateEmployerOffer } from './employerOffer';

// Envío del formulario público de empleadores: valida, frena abusos, guarda el contacto aparte y entra la oferta como BORRADOR por la misma
// ingesta de todas las fuentes (la revisión automática y la humana la clasifican; nunca se publica sola). Cada paso consume su resultado:
// si algo falla después de guardar el contacto, se deshace y se dice, para que la empresa pueda reintentar.
export const PER_IP_DAY = 5, PER_EMAIL_DAY = 5;
export const SOURCE = 'empleadores', VIA = 'employer-form';
export type SubmitResult = { status: number; body: Record<string, unknown> };
const fail = (status: number, detail: string, extra: Record<string, unknown> = {}): SubmitResult => ({ status, body: { detail, ...extra } });

/** Huella diaria del origen: sirve para el límite del día, no para identificar a nadie (la IP no se guarda). */
export const ipHash = (ip: string, now: Date) => createHash('sha256').update(`${now.toISOString().slice(0, 10)}|${ip}|empleadores`).digest('hex').slice(0, 32);

async function recentCount(filter: string): Promise<number | null> {
  const response = await serviceRest(`employer_submissions?org_id=eq.${ORG}&${filter}&select=id&limit=${Math.max(PER_IP_DAY, PER_EMAIL_DAY) + 1}`).catch(() => null);
  if (!response?.ok) return null;
  const rows = await response.json().catch(() => null);
  return Array.isArray(rows) ? rows.length : null;
}

export async function submitEmployerOffer(input: unknown, ip: string, now: Date = new Date()): Promise<SubmitResult> {
  const checked = validateEmployerOffer(input, now);
  if (!checked.ok) {
    // Honeypot: respuesta idéntica a un éxito y no se guarda nada (no se le enseña al bot qué falló).
    if (checked.honeypot) return { status: 200, body: { ok: true, message: 'Recibida. Una persona del equipo la revisa antes de que la vean las alumnas.' } };
    return fail(422, 'Revisa los campos marcados.', { fields: checked.errors });
  }
  const since = new Date(now.getTime() - 24 * 3600_000).toISOString(), hash = ipHash(ip, now);
  const [byIp, byEmail] = await Promise.all([
    recentCount(`ip_hash=eq.${hash}&created_at=gte.${encodeURIComponent(since)}`),
    recentCount(`contact_email=eq.${encodeURIComponent(checked.contact.email)}&created_at=gte.${encodeURIComponent(since)}`),
  ]);
  // Sin poder contar los envíos de hoy no se acepta nada: un hueco no es un cero (si no, el límite no frenaría a nadie).
  if (byIp === null || byEmail === null) return fail(503, 'Ahora mismo no podemos recibir ofertas. Inténtalo de nuevo en unos minutos.');
  if (byIp >= PER_IP_DAY || byEmail >= PER_EMAIL_DAY) return fail(429, 'Has enviado varias ofertas hoy. Escríbenos si necesitas publicar más.');
  const saved = await serviceRest('employer_submissions', { method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ org_id: ORG, offer_external_id: checked.candidate.external_id, company: checked.company, contact_name: checked.contact.name, contact_email: checked.contact.email, offer_url: checked.offer_url, ip_hash: hash }) }).catch(() => null);
  if (saved && saved.status === 409) return fail(409, 'Esa oferta ya la tenemos: no hace falta enviarla otra vez.');
  if (!saved?.ok) return fail(503, 'No pudimos guardar tu oferta. Inténtalo de nuevo en unos minutos.');
  const undo = () => serviceRest(`employer_submissions?org_id=eq.${ORG}&offer_external_id=eq.${checked.candidate.external_id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).catch(() => null);
  try {
    const result = await ingest(SOURCE, VIA, [checked.candidate], `Formulario de empleadores · ${checked.company}`);
    if (result.paused) { await undo(); return fail(503, 'Ahora mismo no estamos recibiendo ofertas. Inténtalo más tarde.'); }
    if (result.accepted < 1) { await undo(); return fail(422, 'No pudimos aceptar la oferta: revisa que el enlace y la descripción sean los de una oferta real.', { fields: { offer_url: 'Comprueba el enlace de la oferta.', description: 'Describe el puesto con más detalle.' } }); }
  } catch { await undo(); return fail(503, 'No pudimos guardar tu oferta. Inténtalo de nuevo en unos minutos.'); }
  return { status: 200, body: { ok: true, message: 'Recibida. Una persona del equipo la revisa antes de que la vean las alumnas.' } };
}
