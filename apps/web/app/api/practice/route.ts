import { scenarioById } from '../../../components/practiceScenarios';
import { buildPersonaPrompt, debriefInstructions, debriefSchema } from './prompts';
import { cleanDebrief } from './debrief';
import { analyzeSignals } from './signals';
import type { PracticeTurn } from './signals';
import { clientIp, createTurnBudget } from '../../../lib/practiceBudget';
import { callModel, hasModelKey, providerFailure, resolveModel } from '../../../lib/aiProvider';

export const dynamic = 'force-dynamic';

// Sala de práctica: el proveedor se configura por entorno y la ruta queda apagada
// por defecto. La clave vive solo en el servidor y nunca viaja al navegador.
// El acceso es abierto (sin código de cohorte): el gasto se contiene con los topes
// de turnos por IP y globales de más abajo, que son la única puerta que queda.
const MODEL = resolveModel(process.env.PRACTICE_MODEL);
// El tope de turnos no puede quedar por debajo de lo que permite la UI: con 16,
// una conversación larga llegaba a un estado en el que ni la réplica ni el
// feedback podían enviarse (422 para siempre). La UI corta en 20 turnos y este
// margen deja sitio al feedback.
const MAX_TURNS = 24;
const MAX_TURN_CHARS = 800;
// El tope de caracteres tiene que cubrir una conversación completa del tope de la
// UI (20 turnos: 10 mensajes de 800 + 10 réplicas de 900 = 17.000). Con 6.000, una
// alumna que escribía largo dejaba de poder enviar y tampoco podía pedir feedback
// (la ruta valida el mismo tope en el debrief).
const MAX_TOTAL_CHARS = 18000;
const DAILY_TURNS = Number(process.env.PRACTICE_DAILY_TURNS || 400);
const IP_DAILY_TURNS = 60;

type Body = { scenario?: unknown; messages?: unknown; mode?: unknown };

// Topes por instancia (ver lib/practiceBudget): la IP no puede salir de un valor que elija quien llama y el mapa
// tiene tope duro. En serverless son best-effort, por eso además se limita cada petición (turnos y caracteres) y el
// gasto por llamada (max_tokens).
const budget = createTurnBudget();

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

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host') ?? '';
  if (origin && origin !== `https://${host}` && origin !== `http://${host}`) {
    return Response.json({ detail: 'Origen no permitido' }, { status: 403 });
  }
  if (!hasModelKey()) return providerFailure('missing_key', 'La sala de práctica');
  let body: Body;
  try { body = await request.json() as Body; } catch { return Response.json({ detail: 'Cuerpo no válido' }, { status: 422 }); }
  const scenario = typeof body.scenario === 'string' ? scenarioById(body.scenario) : null;
  if (!scenario) return Response.json({ detail: 'Situación desconocida' }, { status: 422 });
  const turns = readTurns(body.messages);
  if (!turns) return Response.json({ detail: 'La conversación no es válida o es demasiado larga.' }, { status: 422 });
  const mode = body.mode === 'debrief' ? 'debrief' : 'reply';
  const ip = clientIp(request.headers);
  if (budget.spend(`ip:${ip}`, IP_DAILY_TURNS) === null || budget.spend('global', DAILY_TURNS) === null) {
    return Response.json({ detail: 'La sala de práctica ha llegado a su límite de hoy. Vuelve mañana o pide a tu coordinadora que lo amplíe.' }, { status: 429 });
  }
  const studentTurns = turns.filter(turn => turn.role === 'user').length;

  if (mode === 'debrief') {
    const transcript = turns.map(turn => `${turn.role === 'coach' ? 'INTERLOCUTOR' : 'ALUMNA'}: ${turn.content}`).join('\n');
    const result = await callModel({
      model: MODEL,
      messages: [
        { role: 'system', content: debriefInstructions(scenario) },
        { role: 'user', content: `Conversación:\n${transcript}\n\nDevuelve el feedback con el esquema indicado.` },
      ],
      temperature: 0.3,
      maxTokens: 900,
      schema: { name: 'practice_debrief', schema: debriefSchema(scenario) },
    });
    if (!result.ok) return providerFailure(result.error, 'La sala de práctica');
    const debrief = cleanDebrief(result.content, turns, scenario);
    if (!debrief) return providerFailure('invalid_output', 'La sala de práctica');
    // Las señales son deterministas y no dependen del modelo: se calculan aquí y
    // viajan con el feedback (también al historial local).
    return Response.json({ debrief: { ...debrief, signals: analyzeSignals(turns, scenario.kind) } });
  }

  const messages: Array<{ role: 'system' | 'assistant' | 'user'; content: string }> = [
    { role: 'system', content: buildPersonaPrompt(scenario, studentTurns) },
    ...turns.map(turn => ({ role: turn.role === 'coach' ? 'assistant' as const : 'user' as const, content: turn.content })),
  ];
  const result = await callModel({ model: MODEL, messages, temperature: 0.75, maxTokens: 260 });
  if (!result.ok) return providerFailure(result.error, 'La sala de práctica');
  return Response.json({ reply: result.content.trim().slice(0, 900), turns: turns.length });
}
