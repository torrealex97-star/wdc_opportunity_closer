import { NextRequest } from 'next/server';
import { authenticate, originBlocked, withCookies } from '../../../../../../lib/adminAuth';
import { listStudents } from '../../../../../../lib/students';
import { readActivity } from '../../../../../../lib/studentActivity';
import { challengeViews, checkChallengeInput, createChallenge, readChallenges } from '../../../../../../lib/studentChallenges';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Retos de UNA alumna desde el panel. Solo se abre/edita una alumna de la lista de la organización:
// `listStudents` ya filtra por org_id, así que un id ajeno responde 404. El estado no se escribe:
// se deriva de `student_activity` (organización + alumna + escenario + plazo + nota mínima).
async function studentOf(id: string) {
  const students = await listStudents();
  if (!students) return { error: Response.json({ detail: 'No se pudo leer la lista de alumnas.' }, { status: 503 }) };
  const student = students.find(row => row.id === id);
  if (!student) return { error: Response.json({ detail: 'Esa alumna no está en la lista.' }, { status: 404 }) };
  return { student };
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (!auth.ok) return Response.json({ detail: auth.detail }, { status: auth.status });
  const reply = (body: unknown, status = 200) => withCookies(Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);
  const { id } = await context.params;
  const found = await studentOf(id);
  if (found.error) return found.error;
  const challenges = await readChallenges(found.student.id);
  if (!challenges) return reply({ available: false, challenges: null, activity_available: null, detail: 'La tabla de retos no está disponible en este despliegue (migración sin aplicar).' });
  const read = await readActivity({ studentId: found.student.id });
  return reply({ available: true, activity_available: read !== null, challenges: challengeViews(challenges, read?.rows ?? null) });
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  if (originBlocked(request)) return Response.json({ detail: 'Origen no permitido' }, { status: 403 });
  const auth = await authenticate(request);
  if (!auth.ok) return Response.json({ detail: auth.detail }, { status: auth.status });
  const reply = (body: unknown, status: number) => withCookies(Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);
  const { id } = await context.params;
  const found = await studentOf(id);
  if (found.error) return found.error;
  const checked = checkChallengeInput(await request.json().catch(() => null));
  if (!checked.ok) return reply({ detail: checked.detail }, 422);
  const challenge = await createChallenge(found.student.id, checked.value, auth.admin.email);
  // Sin tabla (migración sin aplicar) el alta falla: se declara la causa, no se responde como si se hubiera guardado.
  if (!challenge) return reply({ detail: 'No se pudo guardar el reto. Comprueba que la migración de retos esté aplicada.' }, 503);
  return reply({ ok: true, challenge }, 201);
}
