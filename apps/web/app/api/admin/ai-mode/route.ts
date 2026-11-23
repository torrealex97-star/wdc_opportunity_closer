import { NextRequest } from 'next/server';
import { authenticate, originBlocked, withCookies } from '../../../../lib/adminAuth';
import { readAiMode, writeAiMode } from '../../../../lib/aiMode';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Modo del revisor IA. Leer: cualquier operador. Cambiar: solo el propietario (activar «live» deja que la IA apruebe y
// retire ofertas por sí sola). Se puede volver a «shadow» en cualquier momento; el cambio vale desde la siguiente pasada.
async function gate(request: NextRequest, ownerOnly: boolean) {
  if (originBlocked(request)) return { error: Response.json({ detail: 'Origen no permitido' }, { status: 403 }) };
  const auth = await authenticate(request);
  if (!auth.ok) return { error: Response.json({ detail: auth.detail }, { status: auth.status }) };
  if (ownerOnly && auth.admin.role !== 'owner') return { error: Response.json({ detail: 'Solo el propietario puede cambiar el modo de la IA.' }, { status: 403 }) };
  return { auth };
}
const reply = (auth: { setCookies: string[] }, body: unknown, status = 200) => withCookies(Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);

export async function GET(request: NextRequest) {
  const { auth, error } = await gate(request, false);
  if (error) return error;
  return reply(auth!, { ...await readAiMode(), owner: auth!.admin.role === 'owner' });
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { mode?: unknown };
  const { auth, error } = await gate(request, true);
  if (error) return error;
  const saved = await writeAiMode(body.mode, auth!.admin.email);
  if (!saved.ok) return Response.json({ detail: saved.error }, { status: saved.kind === 'invalid' ? 422 : 503 });
  const state = await readAiMode();
  return reply(auth!, { ok: true, ...state, owner: true, message: saved.mode === 'live' ? 'IA en «live»: desde la siguiente pasada aprueba y retira por sí sola, dentro del cupo diario. Puedes volver a «shadow» cuando quieras.' : 'IA en «shadow»: solo anota; las reglas siguen decidiendo.' });
}
