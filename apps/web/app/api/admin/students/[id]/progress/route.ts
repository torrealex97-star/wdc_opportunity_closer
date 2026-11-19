import { NextRequest } from 'next/server';
import { authenticate, withCookies } from '../../../../../../lib/adminAuth';
import { listApplications } from '../../../../../../lib/applications';
import { listStudents } from '../../../../../../lib/students';
import { periodDays, readActivity, summarize } from '../../../../../../lib/studentActivity';
import { directReview, idleNudge, sentThisWeek, weeklyGoals } from '../../../../../../lib/studentRetention';
import { applicationFunnel, masteryByScenario, xpAndLevel } from '../../../../../../lib/studentMetrics';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Ficha de UNA alumna desde el panel: la misma lectura que ella ve en «Mi progreso»
// (`readActivity` + `summarize` + métricas + retención), atada a SU id. No se reutiliza el
// agregado de `/api/admin/students`: aquel suma por periodo y pierde sus ejes, su evolución y su
// historial. Solo se abre una alumna de la lista de la organización; un id ajeno responde 404.
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const auth = await authenticate(request);
  if (!auth.ok) return Response.json({ detail: auth.detail }, { status: auth.status });
  const reply = (body: unknown, status = 200) => withCookies(Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);
  const { id } = await context.params;
  // `listStudents` ya filtra por organización: una alumna de otra empresa no se puede abrir.
  const studentPage = await listStudents();
  if (!studentPage) return reply({ detail: 'No se pudo leer la lista de alumnas.' }, 503);
  const student = studentPage.rows.find(row => row.id === id);
  if (!student) return reply({ detail: studentPage.truncated ? 'La lista de alumnas es demasiado grande para abrir esta ficha; acota la lista o revisa la paginación.' : 'Esa alumna no está en la lista.' }, studentPage.truncated ? 503 : 404);
  const days = periodDays(request.nextUrl.searchParams.get('days'));
  const read = await readActivity({ studentId: student.id });
  // Sin lectura no se inventan ceros: se declara y la ficha lo dice.
  if (!read) return reply({ detail: 'No se pudo leer la actividad de esa alumna ahora mismo.' }, 503);
  // Candidaturas de ella, no del resto: si no se pueden leer se declara (`applications: null`).
  const appPage = student.user_id ? await listApplications(student.user_id).catch(() => null) : null;
  const apps = appPage?.rows ?? null;
  const statuses = apps ? apps.map(app => app.status) : null;
  return reply({
    student: { id: student.id, email: student.email, status: student.status },
    days,
    progress: summarize(read.rows, days, new Date(), read.truncated),
    metrics: { xp: xpAndLevel(read.rows, statuses), mastery: masteryByScenario(read.rows), applications: statuses ? applicationFunnel(statuses) : null, applications_truncated: appPage?.truncated ?? null },
    retention: { nudge: idleNudge(read.rows), review: directReview(read.rows), goals: weeklyGoals(read.rows, apps && !appPage?.truncated ? sentThisWeek(apps) : null) },
  });
}
