import { NextRequest } from 'next/server';
import { originBlocked, withCookies } from '../../../../lib/adminAuth';
import { authenticateStudent } from '../../../../lib/studentAuth';
import { ASSISTANT_SCHEMA, buildMessages, cleanAnswer, prepare, type AssistantContext } from '../../../../lib/academyAssistant';
import { clientIp, createTurnBudget } from '../../../../lib/practiceBudget';
import { callModel, hasModelKey, providerFailure, resolveModel } from '../../../../lib/aiProvider';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Asistente de la academia: responde dudas de la alumna con TROZOS de la skill `metodo-wdc`.
// Si la pregunta no toca la formación, no se llama al modelo (y no se gasta nada): se dice que eso
// no está en el programa, en vez de improvisar una respuesta. La clave vive solo en el servidor.
const MODEL = resolveModel(process.env.ASSISTANT_MODEL, process.env.PRACTICE_MODEL);
const DAILY_CALLS = Number(process.env.ASSISTANT_DAILY_CALLS || 400);
const STUDENT_DAILY_CALLS = 40;
const IP_DAILY_CALLS = 20;
const budget = createTurnBudget();
const FEATURE = 'El asistente de la academia';

const ROOMS = new Set(['formacion', 'practica', 'revision', 'general']);

export async function POST(request: NextRequest) {
  if (originBlocked(request)) return Response.json({ detail: 'Origen no permitido' }, { status: 403 });
  // La sesión es opcional a propósito: lo que viaja al modelo es la formación publicada, nunca el
  // perfil de la alumna. Con sesión se limita por cuenta; sin sesión, por IP y por el tope global.
  const auth = await authenticateStudent(request);

  let body: { question?: unknown; lesson_title?: unknown; room?: unknown };
  try { body = await request.json(); } catch { return Response.json({ detail: 'Cuerpo no válido' }, { status: 422 }); }

  const context: AssistantContext = {
    lessonTitle: typeof body.lesson_title === 'string' ? body.lesson_title.slice(0, 140) : null,
    room: typeof body.room === 'string' && ROOMS.has(body.room) ? (body.room as AssistantContext['room']) : 'general',
  };

  // La recuperación va ANTES de la cuota y de la clave: una pregunta fuera de programa no gasta ni
  // una llamada ni un turno del día.
  const prepared = prepare(body.question, context);
  if (!prepared.ok) return Response.json({ detail: prepared.detail, in_programme: false }, { status: 422 });

  if (!hasModelKey()) return providerFailure('missing_key', FEATURE);
  const perStudent = auth.ok;
  const who = perStudent ? `student:${auth.student.user_id}` : `ip:${clientIp(request.headers)}`;
  const cap = perStudent ? STUDENT_DAILY_CALLS : IP_DAILY_CALLS;
  if (budget.spend(who, cap) === null || budget.spend('global', DAILY_CALLS) === null) {
    return Response.json({ detail: 'Has usado el asistente muchas veces hoy. Vuelve mañana; la formación y la práctica siguen abiertas.' }, { status: 429 });
  }

  const result = await callModel({
    model: MODEL,
    messages: buildMessages(prepared.question, prepared.retrieved, context),
    temperature: 0.3,
    maxTokens: 900,
    schema: { name: 'academy_answer', schema: ASSISTANT_SCHEMA },
  });
  if (!result.ok) return providerFailure(result.error, FEATURE);

  const answer = cleanAnswer(result.content, prepared.retrieved);
  if (!answer) return providerFailure('invalid_output', FEATURE);

  const payload = Response.json(
    {
      answer: answer.answer,
      sources: answer.sources,
      in_programme: answer.inProgramme,
      next_step: answer.nextStep,
      lessons: answer.lessons,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
  return auth.ok ? withCookies(payload, auth.setCookies) : payload;
}
