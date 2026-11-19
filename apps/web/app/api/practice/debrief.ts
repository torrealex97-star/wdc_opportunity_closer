import type { PracticeScenario } from '../../../components/practiceScenarios';
import { axesFor } from './prompts';
import type { PracticeTurn } from './signals';
import {
  BANT_STATUSES, DEFAULT_BANT, DEFAULT_RUBRICS, PRACTICE_DECISIONS,
  roomOf, weightedScore,
  type BantConfig, type BantLetter, type BantStatus, type PracticeBant, type PracticeDecision, type RoomRubrics,
} from '../../../lib/practiceRubrics';

export type PracticeAxis = { id: string; label: string; score: number; note: string; quote: string };

export type PracticeDebrief = {
  summary: string;
  focus: string;
  strengths: string[];
  improvements: string[];
  axes: PracticeAxis[];
  score: number;
  model: string;
  next: string;
  scenario: string;
  // Solo en las salas de venta: setter, frío y closer. Se calcula con la rúbrica de
  // `analisis-llamadas-ventas` y se valida aquí (estados y citas literales).
  bant?: PracticeBant;
};

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();

const clampScore = (input: unknown) => {
  const value = typeof input === 'number' ? input : Number(input);
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, Math.round(value)));
};

// El feedback se valida en servidor: sin ejes completos no hay nota; una cita que no esté
// literalmente en la conversación se descarta; y la puntuación global sale de los PESOS de la
// rúbrica (media ponderada normalizada), nunca del modelo. BANT se valida igual: estado permitido
// y cita literal, o la respuesta entera se rechaza.
export function cleanDebrief(raw: string, turns: PracticeTurn[], scenario: PracticeScenario, rubrics: RoomRubrics = DEFAULT_RUBRICS, bantConfig: BantConfig = DEFAULT_BANT): PracticeDebrief | null {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const value = parsed as Record<string, unknown>;
  const text = (input: unknown, max = 400) => typeof input === 'string' ? input.trim().slice(0, max) : '';
  const list = (input: unknown) => Array.isArray(input) ? input.map(item => text(item, 240)).filter(Boolean).slice(0, 3) : [];
  const student = turns.filter(turn => turn.role === 'user').map(turn => normalize(turn.content));
  // La cita de un eje es de la alumna; la de BANT, del interlocutor (sus palabras son el hecho).
  const everyone = turns.map(turn => normalize(turn.content));
  const literal = (input: unknown, max = 200, lines = student) => {
    const quote = text(input, max);
    const needle = normalize(quote);
    return needle.length >= 8 && lines.some(line => line.includes(needle)) ? quote : '';
  };

  const definitions = axesFor(scenario, rubrics);
  if (!Array.isArray(value.axes) || value.axes.length !== definitions.length) return null;
  const received = new Map<string, Record<string, unknown>>();
  for (const item of value.axes) {
    if (typeof item !== 'object' || item === null) return null;
    const axis = item as Record<string, unknown>;
    if (typeof axis.id !== 'string' || received.has(axis.id)) return null;
    received.set(axis.id, axis);
  }
  const axes: PracticeAxis[] = [];
  for (const definition of definitions) {
    const axis = received.get(definition.id);
    if (!axis) return null;
    const score = clampScore(axis.score);
    if (score === null) return null;
    // Una cita inventada se elimina; el eje y su nota se mantienen.
    axes.push({ id: definition.id, label: definition.label, score, note: text(axis.note, 300), quote: literal(axis.quote) });
  }

  const summary = text(value.summary, 500);
  const next = text(value.next, 300);
  if (!summary || !next) return null;
  const strengths = list(value.strengths);
  const improvements = list(value.improvements);
  const focus = text(value.focus, 240) || improvements[0] || '';
  const model = text(value.model, 600);

  let bant: PracticeBant | undefined;
  if (bantConfig[roomOf(scenario.kind, scenario.rubric)]) {
    const rawBant = value.bant;
    if (!rawBant || typeof rawBant !== 'object') return null;
    const source = rawBant as Record<string, unknown>;
    const letters = {} as Record<BantLetter, { status: BantStatus; quote: string }>;
    for (const letter of ['budget', 'authority', 'need', 'timing'] as BantLetter[]) {
      const item = source[letter];
      if (!item || typeof item !== 'object') return null;
      const { status, quote } = item as { status?: unknown; quote?: unknown };
      if (typeof status !== 'string' || !BANT_STATUSES.includes(status as BantStatus)) return null;
      letters[letter] = { status: status as BantStatus, quote: literal(quote, 200, everyone) };
    }
    const decision = source.decision;
    if (typeof decision !== 'string' || !PRACTICE_DECISIONS.includes(decision as PracticeDecision)) return null;
    bant = { ...letters, decision: decision as PracticeDecision };
  }

  return {
    summary, focus, strengths, improvements, axes,
    score: weightedScore(axes, definitions),
    model, next, scenario: scenario.title,
    ...(bant ? { bant } : {}),
  };
}
