import { NextRequest } from 'next/server';
import { withCookies } from '../../../../lib/adminAuth';
import { authenticateStudent } from '../../../../lib/studentAuth';
import { studentByEmail } from '../../../../lib/students';
import { readActivity } from '../../../../lib/studentActivity';
import { challengeViews, readChallenges } from '../../../../lib/studentChallenges';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Retos que la coordinadora ha asignado a la alumna logueada, con el estado DERIVADO de su actividad.
// Si la tabla no está migrada se declara (`available:false`, `challenges:null`); no se devuelve «ningún reto».
export async function GET(request: NextRequest) {
  const auth = await authenticateStudent(request);
  if (!auth.ok) return Response.json({ detail: auth.detail }, { status: auth.status });
  const reply = (body: unknown, status = 200) => withCookies(Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);
  const row = await studentByEmail(auth.student.email);
  if (!row) return reply({ detail: 'Tu cuenta no tiene acceso al portal de alumnas.' }, 403);
  const challenges = await readChallenges(row.id);
  if (!challenges) return reply({ available: false, challenges: null, activity_available: null, detail: 'Los retos asignados todavía no están disponibles en este despliegue.' });
  // Sin lectura de actividad el reto existe, pero su estado es «—» (unknown), no «pendiente» ni «cero intentos».
  const read = await readActivity({ studentId: row.id });
  return reply({ available: true, activity_available: read !== null, challenges: challengeViews(challenges, read?.rows ?? null) });
}
