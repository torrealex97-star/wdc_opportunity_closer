import { NextRequest } from 'next/server';
import { authenticate, originBlocked, withCookies } from '../../../../lib/adminAuth';
import { MAX_PER_RUN, MAX_TARGETS, TARGET_SOURCES } from '../../../../lib/sourceTargets';
import { addTarget, listTargets, removeTarget, setTargetEnabled } from '../../../../lib/sourceTargetsStore';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// «Direcciones a vigilar»: grupos de Facebook, comunidades de Skool y canales de Telegram que alimentan a sus actores de Apify.
// Leer: cualquier operador. Añadir, pausar o quitar: solo el propietario. Cada escritura responde con su resultado real.
async function gate(request: NextRequest, ownerOnly: boolean) {
  if (originBlocked(request)) return { error: Response.json({ detail: 'Origen no permitido' }, { status: 403 }) };
  const auth = await authenticate(request);
  if (!auth.ok) return { error: Response.json({ detail: auth.detail }, { status: auth.status }) };
  if (ownerOnly && auth.admin.role !== 'owner') return { error: Response.json({ detail: 'Solo el propietario puede cambiar las direcciones.' }, { status: 403 }) };
  return { auth };
}
const reply = (auth: { setCookies: string[] }, body: unknown, status = 200) => withCookies(Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);
const sourcesInfo = () => Object.entries(TARGET_SOURCES).map(([source, c]) => ({ source, label: c.label, hint: c.hint, example: c.example }));

export async function GET(request: NextRequest) {
  const g = await gate(request, false); if (g.error) return g.error;
  const list = await listTargets();
  const base = { sources: sourcesInfo(), max_per_source: MAX_TARGETS, max_per_run: MAX_PER_RUN };
  return reply(g.auth, list.ok ? { ...base, targets: list.rows, error: null, pending: false } : { ...base, targets: null, error: list.error, pending: list.pending });
}

export async function POST(request: NextRequest) {
  const g = await gate(request, true); if (g.error) return g.error;
  const body = await request.json().catch(() => null) as { source?: unknown; url?: unknown; label?: unknown } | null;
  if (!body || typeof body.source !== 'string' || typeof body.url !== 'string') return reply(g.auth, { detail: 'Se espera { source, url, label? }.' }, 422);
  const result = await addTarget(body.source, body.url, typeof body.label === 'string' ? body.label : null, g.auth.admin.email);
  return result.ok ? reply(g.auth, { ok: true, target: result.row ?? null }, 201) : reply(g.auth, { detail: result.error }, result.status);
}

export async function PATCH(request: NextRequest) {
  const g = await gate(request, true); if (g.error) return g.error;
  const body = await request.json().catch(() => null) as { id?: unknown; enabled?: unknown } | null;
  if (!body || typeof body.id !== 'string' || typeof body.enabled !== 'boolean') return reply(g.auth, { detail: 'Se espera { id, enabled }.' }, 422);
  const result = await setTargetEnabled(body.id, body.enabled);
  return result.ok ? reply(g.auth, { ok: true, target: result.row ?? null }) : reply(g.auth, { detail: result.error }, result.status);
}

export async function DELETE(request: NextRequest) {
  const g = await gate(request, true); if (g.error) return g.error;
  const body = await request.json().catch(() => null) as { id?: unknown } | null;
  if (!body || typeof body.id !== 'string') return reply(g.auth, { detail: 'Se espera { id }.' }, 422);
  const result = await removeTarget(body.id);
  return result.ok ? reply(g.auth, { ok: true }) : reply(g.auth, { detail: result.error }, result.status);
}
