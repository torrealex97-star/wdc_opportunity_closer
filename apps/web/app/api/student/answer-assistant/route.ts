import { NextRequest } from 'next/server';
import { originBlocked, withCookies } from '../../../../lib/adminAuth';
import { authenticateStudent } from '../../../../lib/studentAuth';
import { getAppProfile, CONTRACTS, LEVELS } from '../../../../lib/applicationProfile';
import { getProfile } from '../../../../lib/students';
import { listApplications } from '../../../../lib/applications';
import { ANSWER_SCHEMA, buildEvidence, buildMessages, cleanAnswers, parseQuestions } from '../../../../lib/answerAssistant';
import { createTurnBudget } from '../../../../lib/practiceBudget';
import { callModel, hasModelKey, providerFailure, resolveModel } from '../../../../lib/aiProvider';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Asistente de respuestas del formulario de una empresa. Ella pega las preguntas y, SI lo marca en
// esa consulta, se adjunta lo que ya escribió en su formulario base (sin email, teléfono ni enlaces).
// La llamada al proveedor, la lista de modelos y los fallos vienen de lib/aiProvider, compartidos con
// la sala de práctica. La app no envía nada a la empresa: ella revisa, copia y pega.
const MODEL = resolveModel(process.env.ANSWER_MODEL, process.env.PRACTICE_MODEL);
const DAILY_CALLS = Number(process.env.ANSWER_DAILY_CALLS || 300);
const STUDENT_DAILY_CALLS = 25;
const budget = createTurnBudget();

const FEATURE = 'El asistente de respuestas';

export async function POST(request: NextRequest) {
  if (originBlocked(request)) return Response.json({ detail: 'Origen no permitido' }, { status: 403 });
  const auth = await authenticateStudent(request);
  if (!auth.ok) return Response.json({ detail: auth.detail }, { status: auth.status });
  if (!hasModelKey()) return providerFailure('missing_key', FEATURE);

  let body: { questions?: unknown; include_profile?: unknown; application_id?: unknown };
  try { body = await request.json(); } catch { return Response.json({ detail: 'Cuerpo no válido' }, { status: 422 }); }

  const parsed = parseQuestions(body.questions);
  if (parsed.error) return Response.json({ detail: parsed.error }, { status: 422 });

  const uid = auth.student.user_id;
  if (budget.spend(`student:${uid}`, STUDENT_DAILY_CALLS) === null || budget.spend('global', DAILY_CALLS) === null) {
    return Response.json({ detail: 'Has usado el asistente muchas veces hoy. Vuelve mañana o escribe tú la respuesta: el resto de la app sigue igual.' }, { status: 429 });
  }

  // Título y empresa salen de SUS candidaturas, nunca de lo que mande el cliente.
  let company: string | null = null;
  let role: string | null = null;
  if (typeof body.application_id === 'string' && body.application_id) {
    const application = (await listApplications(uid))?.rows.find(row => row.id === body.application_id);
    if (!application) return Response.json({ detail: 'Esa candidatura no está en tu lista.' }, { status: 404 });
    company = application.offer_company;
    role = application.offer_title;
  }

  // El formulario solo viaja si ELLA lo marca en esta consulta; el permiso no se hereda.
  const evidence = body.include_profile === true
    ? buildEvidence({ ...(await getAppProfile(uid)), city: (await getProfile(uid))?.city ?? null }, { levels: LEVELS, contracts: CONTRACTS })
    : '';

  const result = await callModel({
    model: MODEL,
    messages: buildMessages({ company, role, questions: parsed.questions, evidence }),
    temperature: 0.5,
    maxTokens: 1400,
    schema: { name: 'application_answers', schema: ANSWER_SCHEMA },
  });
  if (!result.ok) return providerFailure(result.error, FEATURE);

  const answers = cleanAnswers(result.content, parsed.questions);
  if (!answers) return providerFailure('invalid_output', FEATURE);
  const pending = parsed.questions.filter(question => !answers.some(answer => answer.question === question));
  return withCookies(Response.json({ answers, pending }, { headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);
}
