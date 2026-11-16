import { NextRequest } from 'next/server';
import { originBlocked, withCookies } from '../../../../lib/adminAuth';
import { authenticateStudent } from '../../../../lib/studentAuth';
import { getAppProfile, CONTRACTS, LEVELS } from '../../../../lib/applicationProfile';
import { getProfile } from '../../../../lib/students';
import { listApplications } from '../../../../lib/applications';
import { ANSWER_SCHEMA, buildEvidence, buildMessages, cleanAnswers, parseQuestions } from '../../../../lib/answerAssistant';
import { createTurnBudget } from '../../../../lib/practiceBudget';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Asistente de respuestas del formulario de una empresa. Ella pega las preguntas y, SI lo marca, se
// adjunta lo que ya escribió en su formulario base (sin email, teléfono ni enlaces). El texto se
// envía al proveedor de IA configurado; la clave vive solo en el servidor y nunca viaja al navegador.
// Topes: preguntas por consulta, caracteres, y turnos por alumna y por día (además del gasto acotado
// por `max_tokens`). Sin clave configurada la función se declara apagada, no se finge una respuesta.
const GROQ_BASE = (process.env.GROQ_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, '');
const ALLOWED_MODEL = ['openai/gpt-oss-20b', 'openai/gpt-oss-120b'];
const MODEL = ALLOWED_MODEL.includes(process.env.ANSWER_MODEL || '')
  ? process.env.ANSWER_MODEL!
  : ALLOWED_MODEL.includes(process.env.PRACTICE_MODEL || '') ? process.env.PRACTICE_MODEL! : ALLOWED_MODEL[0];
const DAILY_CALLS = Number(process.env.ANSWER_DAILY_CALLS || 300);
const STUDENT_DAILY_CALLS = 25;
const budget = createTurnBudget();

type Body = { questions?: unknown; include_profile?: unknown; application_id?: unknown };
type GroqResult = { ok: true; content: string } | { ok: false; error: 'missing_key' | 'rate_limited' | 'provider' | 'unavailable' | 'invalid_output' };

async function askGroq(payload: unknown): Promise<GroqResult> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return { ok: false, error: 'missing_key' };
  try {
    const response = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
      cache: 'no-store',
    });
    if (!response.ok) return { ok: false, error: response.status === 429 ? 'rate_limited' : 'provider' };
    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = data.choices?.[0]?.message?.content;
    return typeof content === 'string' && content.trim() ? { ok: true, content } : { ok: false, error: 'invalid_output' };
  } catch {
    return { ok: false, error: 'unavailable' };
  }
}

function failure(code: 'missing_key' | 'rate_limited' | 'provider' | 'unavailable' | 'invalid_output') {
  const detail = code === 'missing_key'
    ? 'El asistente de respuestas no está configurado en este despliegue.'
    : code === 'rate_limited'
      ? 'El proveedor de IA ha limitado las peticiones. Espera un momento y vuelve a intentarlo.'
      : code === 'invalid_output'
        ? 'La respuesta no se pudo verificar y no se muestra nada inventado. Inténtalo otra vez.'
        : 'No se ha podido completar la respuesta. Tus preguntas siguen aquí: vuelve a intentarlo.';
  return Response.json({ detail }, { status: code === 'missing_key' ? 503 : code === 'rate_limited' ? 429 : 502 });
}

export async function POST(request: NextRequest) {
  if (originBlocked(request)) return Response.json({ detail: 'Origen no permitido' }, { status: 403 });
  const auth = await authenticateStudent(request);
  if (!auth.ok) return Response.json({ detail: auth.detail }, { status: auth.status });
  if (!process.env.GROQ_API_KEY) return failure('missing_key');

  let body: Body;
  try { body = await request.json() as Body; } catch { return Response.json({ detail: 'Cuerpo no válido' }, { status: 422 }); }

  const parsed = parseQuestions(body.questions);
  if (parsed.error) return Response.json({ detail: parsed.error }, { status: 422 });

  const uid = auth.student.user_id;
  if (budget.spend(`student:${uid}`, STUDENT_DAILY_CALLS) === null || budget.spend('global', DAILY_CALLS) === null) {
    return Response.json({ detail: 'Has usado el asistente muchas veces hoy. Vuelve mañana o escribe tú la respuesta: el resto de la app sigue igual.' }, { status: 429 });
  }

  // La oferta sale de SUS candidaturas (nunca del cliente): título y empresa son datos reales del catálogo.
  let company: string | null = null;
  let role: string | null = null;
  const applicationId = typeof body.application_id === 'string' ? body.application_id : '';
  if (applicationId) {
    const apps = await listApplications(uid);
    const application = apps?.rows.find(row => row.id === applicationId);
    if (!application) return Response.json({ detail: 'Esa candidatura no está en tu lista.' }, { status: 404 });
    company = application.offer_company;
    role = application.offer_title;
  }

  // El formulario solo viaja si ELLA lo marca en esta consulta; el consentimiento no se hereda.
  let evidence = '';
  if (body.include_profile === true) {
    const [profile, app] = await Promise.all([getProfile(uid), getAppProfile(uid)]);
    evidence = buildEvidence(app ? { ...app, city: profile?.city ?? null } : { city: profile?.city ?? null }, { levels: LEVELS, contracts: CONTRACTS });
  }

  const result = await askGroq({
    model: MODEL,
    messages: buildMessages({ company, role, questions: parsed.questions, evidence }),
    temperature: 0.5,
    max_tokens: 1400,
    response_format: { type: 'json_schema', json_schema: { name: 'application_answers', strict: true, schema: ANSWER_SCHEMA } },
  });
  if (!result.ok) return failure(result.error);

  const answers = cleanAnswers(result.content, parsed.questions);
  if (!answers) return failure('invalid_output');
  const pending = parsed.questions.filter(question => !answers.some(answer => answer.question === question));
  return withCookies(Response.json({
    answers,
    pending,
    with_profile: evidence.length > 0,
    model: MODEL,
    // Se declara: la alumna revisa y pega ella. La app no envía nada a la empresa.
    assisted_only: true,
  }, { headers: { 'Cache-Control': 'no-store' } }), auth.setCookies);
}
