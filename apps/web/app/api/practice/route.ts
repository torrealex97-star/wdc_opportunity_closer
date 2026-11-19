import { NextRequest } from 'next/server';
import { withCookies } from '../../../lib/adminAuth';
import { authenticateStudent } from '../../../lib/studentAuth';
import { loadPracticeContext, type PracticeContext } from '../../../lib/practiceContext';
import { scenarioById } from '../../../components/practiceScenarios';
import { buildPersonaPrompt, debriefInstructions, debriefSchema } from './prompts';
import { cleanDebrief } from './debrief';
import { analyzeSignals } from './signals';
import type { PracticeTurn } from './signals';
import { clientIp, createTurnBudget } from '../../../lib/practiceBudget';
import { callModel, hasModelKey, providerFailure, resolveModel } from '../../../lib/aiProvider';
import { allAxisLabels } from '../../../lib/practiceRubrics';
import { loadPracticeConfig } from '../../../lib/practiceRubricStore';
import { CALL_REVIEW_SCENARIO, parseCallTranscript } from '../../../lib/callReview';

export const dynamic = 'force-dynamic';

// Sala de práctica: el proveedor se configura por entorno y la ruta queda apagada
// por defecto. La clave vive solo en el servidor y nunca viaja al navegador.
// El acceso es abierto (sin código de cohorte): el gasto se contiene con los topes
// de turnos por IP y globales de más abajo, que son la única puerta que queda.
// Con `application_id` la práctica se ata a UNA candidatura suya: exige sesión de alumna,
// resuelve el anuncio y —solo si lo pide— el formulario base, y manda al modelo únicamente
// ese contexto (ver lib/practiceContext, que es donde se decide qué viaja).
const MODEL = resolveModel(process.env.PRACTICE_MODEL);
// El tope de turnos no puede quedar por debajo de lo que permite la UI: con 16,
// una conversación larga llegaba a un estado en el que ni la réplica ni el
// feedback podían enviarse (422 para siempre). La UI corta en 20 turnos y este
// margen deja sitio al feedback.
const MAX_TURNS = 24;
const MAX_TURN_CHARS = 800;
// El tope de caracteres tiene que cubrir una conversación completa del tope de
// la UI (20 turnos: 10 mensajes de 800 + 10 réplicas de 900 = 17.000). Con 6.000,
// una alumna que escribía largo dejaba de poder enviar y tampoco podía pedir feedback
// (la ruta valida el mismo tope en el debrief).
const MAX_TOTAL_CHARS = 18000;
const DAILY_TURNS = Number(process.env.PRACTICE_DAILY_TURNS || 400);
const IP_DAILY_TURNS = 60;

type Body = { scenario?: unknown; messages?: unknown; mode?: unknown; transcript?: unknown; application_id?: unknown; include_profile?: unknown };

// Topes por instancia (ver lib/practiceBudget): la IP no puede salir de un valor que elija quien llama y el mapa
// tiene tope duro. En serverless son best-effort, por eso además se limita cada petición (turnos y caracteres) y el
// gasto por llamada (max_tokens).
const budget = createTurnBudget();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readTurns(value: unknown): PracticeTurn[] | null {
  if (!Array.isArray(value) || !value.length || value.length > MAX_TURNS) return null;
  const turns: PracticeTurn[] = [];
  let total = 0;
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return null;
    const { role, content } = item as { role?: unknown; content?: unknown };
    if ((role !== 'user' && role !== 'coach') || typeof content !== 'string') return null;
    const text = content.trim();
    if (!text || text.length > MAX_TURN_CHARS) return null;
    total += text.length;
    if (total > MAX_TOTAL_CHARS) return null;
    turns.push({ role, content: text });
  }
  return turns;
}

// Etiquetas de los ejes para «Mi progreso» y «Tu siguiente práctica». El panel puede renombrar un
// criterio; la alumna tiene que ver el mismo nombre en su nota. Solo viajan id → etiqueta, nunca
// las guías (que son el criterio interno de evaluación) ni los pesos.
export async function GET() {
  const config = await loadPracticeConfig();
  return Response.json({ labels: allAxisLabels(config.rubrics) }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host') ?? '';
  if (origin && origin !== `https://${host}` && origin !== `http://${host}`) {
    return Response.json({ detail: 'Origen no permitido' }, { status: 403 });
  }
  let body: Body;
  try { body = await request.json() as Body; } catch { return Response.json({ detail: 'Cuerpo no válido' }, { status: 422 }); }
  // Revisión de una llamada real: misma rúbrica de `llamada`, otro punto de entrada. No usa
  // escenario del catálogo ni guarda la transcripción; solo devuelve feedback y nota.
  if (body.mode === 'review') {
    const parsed = parseCallTranscript(body.transcript);
    if (!parsed.ok) return Response.json({ detail: parsed.detail }, { status: 422 });
    if (!hasModelKey()) return providerFailure('missing_key', 'La evaluación de llamadas');
    const criteria = await loadPracticeConfig();
    if (budget.spend(`ip:${clientIp(request.headers)}`, IP_DAILY_TURNS) === null || budget.spend('global', DAILY_TURNS) === null) {
      return Response.json({ detail: 'La evaluación de llamadas ha llegado a su límite de hoy. Vuelve mañana.' }, { status: 429 });
    }
    const transcript = parsed.turns.map(turn => `${turn.role === 'user' ? 'VENDEDOR' : 'CLIENTE'}: ${turn.content}`).join('\n');
    const result = await callModel({
      model: MODEL,
      messages: [
        { role: 'system', content: debriefInstructions(CALL_REVIEW_SCENARIO, null, criteria.rubrics, criteria.priorities, criteria.bant) },
        { role: 'user', content: `Transcripción:\n${transcript}\n\nDevuelve el feedback con el esquema indicado.` },
      ],
      temperature: 0.3,
      maxTokens: 900,
      schema: { name: 'call_review', schema: debriefSchema(CALL_REVIEW_SCENARIO, criteria.rubrics, criteria.bant) },
    });
    if (!result.ok) return providerFailure(result.error, 'La evaluación de llamadas');
    const debrief = cleanDebrief(result.content, parsed.turns, CALL_REVIEW_SCENARIO, criteria.rubrics, criteria.bant);
    if (!debrief) return providerFailure('invalid_output', 'La evaluación de llamadas');
    return Response.json({ debrief: { ...debrief, signals: analyzeSignals(parsed.turns, 'venta') } }, { headers: { 'Cache-Control': 'no-store' } });
  }
  const scenario = typeof body.scenario === 'string' ? scenarioById(body.scenario) : null;
  if (!scenario) return Response.json({ detail: 'Situación desconocida' }, { status: 422 });
  const turns = readTurns(body.messages);
  if (!turns) return Response.json({ detail: 'La conversación no es válida o es demasiado larga.' }, { status: 422 });
  const mode = body.mode === 'debrief' ? 'debrief' : 'reply';

  // Práctica de una candidatura: la sesión y la propiedad se comprueban ANTES de llamar al
  // proveedor o gastar cupo. El formulario base solo se lee si lo pide y dio el permiso.
  let setCookies: string[] | null = null;
  let context: PracticeContext | null = null;
  const applicationId = typeof body.application_id === 'string' ? body.application_id : null;
  if (applicationId) {
    if (!uuid.test(applicationId)) return Response.json({ detail: 'Candidatura no válida.' }, { status: 422 });
    const auth = await authenticateStudent(request);
    if (!auth.ok) return Response.json({ detail: auth.detail }, { status: auth.status });
    setCookies = auth.setCookies;
    const loaded = await loadPracticeContext(auth.student.user_id, applicationId, body.include_profile === true);
    if (!loaded.ok) return Response.json({ detail: loaded.detail }, { status: loaded.status });
    context = loaded.context;
  }
  const reply = (payload: unknown, status = 200) => {
    const response = Response.json(payload, { status });
    return setCookies?.length ? withCookies(response, setCookies) : response;
  };

  if (!hasModelKey()) return providerFailure('missing_key', 'La sala de práctica');
  // Los criterios son los del panel (o los de las skills si aún no se ha guardado nada).
  const criteria = await loadPracticeConfig();
  const ip = clientIp(request.headers);
  if (budget.spend(`ip:${ip}`, IP_DAILY_TURNS) === null || budget.spend('global', DAILY_TURNS) === null) {
    return reply({ detail: 'La sala de práctica ha llegado a su límite de hoy. Vuelve mañana o pide a tu coordinadora que lo amplíe.' }, 429);
  }
  const studentTurns = turns.filter(turn => turn.role === 'user').length;

  if (mode === 'debrief') {
    const transcript = turns.map(turn => `${turn.role === 'coach' ? 'INTERLOCUTOR' : 'ALUMNA'}: ${turn.content}`).join('\n');
    const result = await callModel({
      model: MODEL,
      messages: [
        { role: 'system', content: debriefInstructions(scenario, context, criteria.rubrics, criteria.priorities, criteria.bant) },
        { role: 'user', content: `Conversación:\n${transcript}\n\nDevuelve el feedback con el esquema indicado.` },
      ],
      temperature: 0.3,
      maxTokens: 900,
      schema: { name: 'practice_debrief', schema: debriefSchema(scenario, criteria.rubrics, criteria.bant) },
    });
    if (!result.ok) return providerFailure(result.error, 'La sala de práctica');
    const debrief = cleanDebrief(result.content, turns, scenario, criteria.rubrics, criteria.bant);
    if (!debrief) return providerFailure('invalid_output', 'La sala de práctica');
    // Las señales son deterministas y no dependen del modelo: se calculan aquí y
    // viajan con el feedback (también al historial local).
    return reply({ debrief: { ...debrief, signals: analyzeSignals(turns, scenario.kind) } });
  }

  const messages: Array<{ role: 'system' | 'assistant' | 'user'; content: string }> = [
    { role: 'system', content: buildPersonaPrompt(scenario, studentTurns, context, criteria.rubrics) },
    ...turns.map(turn => ({ role: turn.role === 'coach' ? 'assistant' as const : 'user' as const, content: turn.content })),
  ];
  const result = await callModel({ model: MODEL, messages, temperature: 0.75, maxTokens: 260 });
  if (!result.ok) return providerFailure(result.error, 'La sala de práctica');
  return reply({ reply: result.content.trim().slice(0, 900), turns: turns.length });
}
