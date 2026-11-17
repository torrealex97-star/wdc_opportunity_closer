// Asistente de respuestas para el formulario de una empresa: piezas PURAS (sin red, sin base de
// datos) para poder probarlas sin levantar la app. La ruta solo pone la sesión, la cuota y la clave.
//
// Regla que gobierna este fichero: la alumna escribe las preguntas y decide si su formulario viaja o
// no. Nunca se envían email, teléfono ni enlaces, y el modelo no puede inventar datos: si algo no
// está en lo que ella ha escrito, va en «te falta contar» en vez de rellenarse.

export const MAX_QUESTIONS = 10;
export const MAX_QUESTION_CHARS = 400;
export const MAX_ANSWER_CHARS = 1200;

export type AnswerInput = {
  company: string | null;
  role: string | null;
  questions: string[];
  // Texto con lo que ella ha escrito (formulario y perfil). Vacío = no se envía nada suyo.
  evidence: string;
};

export type SuggestedAnswer = { question: string; answer: string; why: string; missing: string[] };

// Pegar la lista de preguntas de una empresa es sucio por naturaleza: numeración, guiones, viñetas,
// líneas en blanco y preguntas repetidas. Se normaliza sin reordenar ni inventar.
export function parseQuestions(raw: unknown): { questions: string[]; error: string | null } {
  if (typeof raw !== 'string') return { questions: [], error: 'Escribe las preguntas de la empresa.' };
  const text = raw.replace(/\r/g, '');
  const cleaned = text
    .split('\n')
    .map(line => line.replace(/^\s*(?:[-*•·]|\d+[.)]|[a-z][.)])\s*/i, '').trim())
    .filter(line => line.length > 0);
  const questions: string[] = [];
  for (const line of cleaned) {
    if (line.length > MAX_QUESTION_CHARS) return { questions: [], error: `Una pregunta pasa de ${MAX_QUESTION_CHARS} caracteres: divídela en varias.` };
    if (!questions.some(q => q.toLowerCase() === line.toLowerCase())) questions.push(line);
  }
  if (!questions.length) return { questions: [], error: 'Escribe al menos una pregunta.' };
  if (questions.length > MAX_QUESTIONS) return { questions: [], error: `Máximo ${MAX_QUESTIONS} preguntas por vez: empieza por las que más te bloquean.` };
  return { questions, error: null };
}

// Lo que el modelo puede ver de su formulario. Se excluye a propósito todo dato de contacto o
// identificador (email, teléfono, LinkedIn, CV, vídeo, nombre): no hacen falta para redactar una
// respuesta y no deben salir del servidor.
export type EvidenceSource = {
  years_sales?: number | null;
  years_high_ticket?: number | null;
  sales_experience?: string | null;
  tools?: string[] | null;
  language_levels?: Record<string, string> | null;
  availability?: string | null;
  hours_per_week?: number | null;
  contract_preferences?: string[] | null;
  salary_expectation?: string | null;
  notice_period?: string | null;
  pitch?: string | null;
  motivation?: string | null;
  answers?: Record<string, string> | null;
  city?: string | null;
};

export function buildEvidence(source: EvidenceSource | null, labels: { levels: Record<string, string>; contracts: Record<string, string> }): string {
  if (!source) return '';
  const lines: string[] = [];
  const add = (label: string, value: string | number | null | undefined) => {
    if (value === null || value === undefined) return;
    const text = String(value).trim();
    if (text) lines.push(`${label}: ${text}`);
  };
  add('Años de experiencia en ventas', source.years_sales);
  add('Años en ventas high ticket', source.years_high_ticket);
  add('Experiencia', source.sales_experience);
  add('Herramientas/CRM', (source.tools ?? []).join(', '));
  add('Idiomas', Object.entries(source.language_levels ?? {}).map(([code, level]) => `${code.toUpperCase()} ${labels.levels[level] ?? level}`).join(', '));
  add('Ciudad', source.city);
  add('Disponibilidad', source.availability);
  add('Horas por semana', source.hours_per_week);
  add('Contrato que busca', (source.contract_preferences ?? []).map(kind => labels.contracts[kind] ?? kind).join(', '));
  add('Expectativa salarial', source.salary_expectation);
  add('Preaviso', source.notice_period);
  add('Presentación breve', source.pitch);
  add('Motivación', source.motivation);
  for (const [key, value] of Object.entries(source.answers ?? {})) add(`Respuesta guardada (${key})`, value);
  return lines.join('\n');
}

export function buildMessages(input: AnswerInput): Array<{ role: 'system' | 'user'; content: string }> {
  const system = [
    'Eres una coach de ventas que ayuda a una alumna a preparar las respuestas de un formulario de candidatura.',
    'Escribes en español de España, en primera persona, como lo diría ella: frases cortas, sin florituras y sin sonar a plantilla.',
    'Objetivo: que quien lea la candidatura vea una comercial concreta, con criterio y con resultados, y quiera pasar a la entrevista.',
    'Reglas estrictas:',
    '1. Usa SOLO la información de «Lo que ella ha escrito». No inventes empresas, cifras, fechas, títulos ni herramientas.',
    '2. Si falta un dato para responder bien, escribe la mejor respuesta posible con lo que hay y añade en «missing» qué dato necesita ella para completarla.',
    '3. No prometas lo que no consta (idiomas, permisos, disponibilidad, salario).',
    '4. Máximo 120 palabras por respuesta. Nada de listas numeradas dentro de la respuesta.',
    '5. Devuelve exactamente una entrada por pregunta, en el mismo orden y con la pregunta tal cual te la dan.',
  ].join('\n');
  const context = [
    input.company ? `Empresa: ${input.company}` : 'Empresa: no indicada en la candidatura.',
    input.role ? `Puesto: ${input.role}` : 'Puesto: no indicado.',
    '',
    'Lo que ella ha escrito:',
    input.evidence.trim() || '(No ha compartido su formulario en esta consulta: escribe respuestas genéricas y pide en «missing» los datos concretos que necesita.)',
    '',
    'Preguntas de la empresa:',
    ...input.questions.map((question, index) => `${index + 1}. ${question}`),
  ].join('\n');
  return [
    { role: 'system', content: system },
    { role: 'user', content: context },
  ];
}

export const ANSWER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['answers'],
  properties: {
    answers: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['question', 'answer', 'why', 'missing'],
        properties: {
          question: { type: 'string' },
          answer: { type: 'string' },
          why: { type: 'string' },
          missing: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
} as const;

const text = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/\r/g, '').trim().slice(0, max) : '';

// Lo que vuelve del modelo se valida contra las preguntas que ELLA escribió: una respuesta que no
// corresponde a ninguna pregunta no se muestra (evita invenciones y desorden).
export function cleanAnswers(content: string, questions: string[]): SuggestedAnswer[] | null {
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { return null; }
  const list = (parsed as { answers?: unknown })?.answers;
  if (!Array.isArray(list) || !list.length) return null;
  const byQuestion = new Map<string, SuggestedAnswer>();
  for (const entry of list) {
    if (typeof entry !== 'object' || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const question = text(row.question, 600);
    const answer = text(row.answer, MAX_ANSWER_CHARS);
    if (!question || !answer) continue;
    const key = question.toLowerCase();
    if (byQuestion.has(key)) continue;
    byQuestion.set(key, {
      question,
      answer,
      why: text(row.why, 400),
      missing: Array.isArray(row.missing) ? row.missing.map(item => text(item, 200)).filter(Boolean).slice(0, 4) : [],
    });
  }
  // Se recorren las preguntas en su orden y solo se acepta la que coincide por texto: una respuesta
  // que no corresponde a ninguna pregunta no se muestra.
  const out: SuggestedAnswer[] = [];
  for (const question of questions) {
    const found = byQuestion.get(question.toLowerCase());
    if (found) out.push({ ...found, question });
  }
  return out.length ? out : null;
}
