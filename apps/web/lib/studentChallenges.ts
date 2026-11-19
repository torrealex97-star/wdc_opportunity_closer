import { scenarioById } from '../components/practiceScenarios';
import type { PracticeTrack } from '../components/practiceScenarios';
import { ORG, scrub } from './external';
import { madridDay, type ActivityRow } from './studentActivity';
import { pagedRest, serviceRest } from './supabaseAuth';

// Retos asignados por la coordinadora (tabla `student_challenges`, solo service role).
// Principios:
// - el estado NO se guarda ni viene del navegador: se deriva de `student_activity` (práctica del mismo
//   escenario, posterior al encargo, dentro del plazo y con la nota mínima si la hay);
// - toda lectura va filtrada por organización y alumna; un id ajeno no se puede abrir;
// - un hueco no es un cero: si la actividad no se puede leer, el estado es `unknown` («—»), no «pendiente».
export const CHALLENGE_COLUMNS = 'id,org_id,student_id,scenario_id,min_score,due_on,coach_note,created_by,created_at';
export const MAX_COACH_NOTE = 500;

export type ChallengeStatus = 'pending' | 'completed' | 'missed' | 'unknown';
export type StudentChallenge = {
  id: string;
  org_id: string;
  student_id: string;
  scenario_id: string;
  min_score: number | null;
  due_on: string; // día de Madrid, YYYY-MM-DD
  coach_note: string;
  created_by: string | null;
  created_at: string;
};
export type ChallengeProgress = {
  status: ChallengeStatus;
  // `null` = no se pudo leer la actividad (no es «cero intentos»).
  attempts: number | null;
  best_score: number | null;
  completed_at: string | null;
  qualifying_score: number | null;
  // Cumplió la nota, pero después de la fecha límite: se declara en vez de aprobarlo tarde.
  late: boolean;
};
export type ChallengeView = StudentChallenge & ChallengeProgress & { scenario: { title: string; track: PracticeTrack } | null };

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const isInt = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function addDays(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// El calendario del reto es el de Madrid: una práctica a las 00:30 del día siguiente no cuenta como el día anterior.
export function challengeProgress(challenge: StudentChallenge, activity: ActivityRow[], now = new Date()): ChallengeProgress {
  const since = new Date(challenge.created_at).getTime();
  const done = activity
    .filter(row => row.kind === 'practice' && row.ref === challenge.scenario_id && typeof row.score === 'number' && new Date(row.created_at).getTime() >= since)
    .map(row => ({ at: row.created_at, day: madridDay(row.created_at), score: row.score as number }))
    .sort((a, b) => a.at.localeCompare(b.at));
  const scored = done.filter(item => challenge.min_score === null || item.score >= challenge.min_score);
  const inTime = scored.filter(item => item.day <= challenge.due_on);
  const first = inTime[0] ?? null;
  const best = done.length ? Math.max(...done.map(item => item.score)) : null;
  const late = !first && scored.some(item => item.day > challenge.due_on);
  const status: ChallengeStatus = first ? 'completed' : madridDay(now) > challenge.due_on ? 'missed' : 'pending';
  return {
    status,
    attempts: done.length,
    best_score: best,
    completed_at: first?.at ?? null,
    qualifying_score: first?.score ?? null,
    late,
  };
}

export function challengeViews(challenges: StudentChallenge[], activity: ActivityRow[] | null, now = new Date()): ChallengeView[] {
  return challenges.map(challenge => {
    const scenario = scenarioById(challenge.scenario_id);
    const scenarioView = scenario ? { title: scenario.title, track: scenario.track } : null;
    const progress: ChallengeProgress = activity
      ? challengeProgress(challenge, activity, now)
      : { status: 'unknown', attempts: null, best_score: null, completed_at: null, qualifying_score: null, late: false };
    return { ...challenge, ...progress, scenario: scenarioView };
  });
}

export type ChallengeInput = { scenario_id: string; min_score: number | null; due_on: string; coach_note: string };
export type CheckedChallenge = { ok: true; value: ChallengeInput } | { ok: false; detail: string };

// Valida lo que envía el panel. El escenario sale del catálogo (no se acepta un id inventado), la fecha es
// un día real de Madrid entre hoy y un año, y la nota del coach es obligatoria (1–500 caracteres).
export function checkChallengeInput(body: unknown, now = new Date()): CheckedChallenge {
  if (!isRecord(body)) return { ok: false, detail: 'Cuerpo no válido.' };
  const scenarioId = body.scenario_id;
  if (typeof scenarioId !== 'string' || !scenarioById(scenarioId)) return { ok: false, detail: 'Ese escenario no existe en la sala.' };
  const rawScore = body.min_score;
  const minScore = rawScore === undefined || rawScore === null || rawScore === '' ? null : rawScore;
  if (minScore !== null && !isInt(minScore, 1, 100)) return { ok: false, detail: 'La nota mínima debe ser un entero de 1 a 100, o quedarse vacía.' };
  const due = body.due_on;
  if (typeof due !== 'string' || !DATE_RE.test(due)) return { ok: false, detail: 'La fecha límite debe ser un día (AAAA-MM-DD).' };
  const parsed = new Date(`${due}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== due) return { ok: false, detail: 'Esa fecha no existe.' };
  const today = madridDay(now);
  if (due < today) return { ok: false, detail: 'La fecha límite no puede estar en el pasado.' };
  if (due > addDays(today, 365)) return { ok: false, detail: 'La fecha límite no puede pasar de un año.' };
  if (typeof body.coach_note !== 'string') return { ok: false, detail: 'Escribe una nota para la alumna.' };
  const note = scrub(body.coach_note).slice(0, MAX_COACH_NOTE + 1);
  if (!note) return { ok: false, detail: 'Escribe una nota para la alumna.' };
  if (note.length > MAX_COACH_NOTE) return { ok: false, detail: `La nota no puede pasar de ${MAX_COACH_NOTE} caracteres.` };
  return { ok: true, value: { scenario_id: scenarioId, min_score: minScore, due_on: due, coach_note: note } };
}

// `null` = no se pudo leer (tabla sin migrar o Supabase caído): quien llama lo declara, no lo convierte en «ningún reto».
export async function readChallenges(studentId: string): Promise<StudentChallenge[] | null> {
  if (!/^[0-9a-f-]{36}$/.test(studentId)) return null;
  const page = await pagedRest<StudentChallenge>(
    `student_challenges?org_id=eq.${ORG}&student_id=eq.${studentId}&select=${CHALLENGE_COLUMNS}`,
    'due_on.asc,created_at.asc',
    200,
  );
  return page?.rows ?? null;
}

export async function createChallenge(studentId: string, input: ChallengeInput, createdBy: string): Promise<StudentChallenge | null> {
  if (!/^[0-9a-f-]{36}$/.test(studentId)) return null;
  const response = await serviceRest('student_challenges', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ ...input, org_id: ORG, student_id: studentId, created_by: createdBy.slice(0, 200) }),
  });
  const rows = response.ok ? await response.json().catch(() => null) : null;
  return Array.isArray(rows) && rows[0] ? rows[0] as StudentChallenge : null;
}
