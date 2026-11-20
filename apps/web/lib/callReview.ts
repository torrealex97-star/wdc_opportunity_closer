// Evaluación de una llamada real: superficie separada del roleplay. La rúbrica vive en
// `lib/practiceRubrics` y sale de la skill `analisis-llamadas-ventas` (fases, BANT y evidencia).
// El servidor no guarda la transcripción; solo devuelve el feedback y la nota.
import type { PracticeScenario } from '../components/practiceScenarios';

import type { CallType } from './callType';

// Cada tipo de llamada se puntúa con SU rúbrica: la de cierre (`venta`) o la de prospección (`frio`).
// Antes todo se puntuaba con la rúbrica del closer, que mide descubrimiento y cierre en una llamada
// en frío donde ese trabajo ni siquiera toca: el tipo se detecta o se elige antes de puntuar.
export function callReviewScenario(type: CallType): PracticeScenario {
  const cold = type === 'frio';
  return {
    id: `revision-llamada-${type}`,
    kind: cold ? 'frio' : 'venta',
    track: cold ? 'frio' : 'closer',
    category: cold ? 'apertura' : 'cierre',
    // El cierre revisado usa la rúbrica propia de evaluación de llamadas del panel; la llamada en frío,
    // la de su sala, donde el cierre no se exige porque el objetivo es conseguir la cita.
    ...(cold ? {} : { rubric: 'llamada' as const }),
    review: true,
    persona: { name: 'Transcripción', role: cold ? 'llamada en frío real' : 'llamada de cierre real', initials: 'LL', tone: 'sage' },
    title: cold ? 'Evaluación de una llamada en frío' : 'Evaluación de una llamada de cierre',
    context: 'Transcripción etiquetada VENDEDOR / CLIENTE',
    summary: cold
      ? 'Se puntúa la prospección con la rúbrica de llamada en frío: apertura, gancho, cualificación y paso a cita. El cierre no se exige porque no es el objetivo de esta llamada.'
      : 'Se puntúa la ejecución de la vendedora con la rúbrica del closer, sin inventar lo que la transcripción no demuestra.',
    objectives: cold
      ? ['Medir los primeros segundos con evidencia literal', 'Comprobar si cualificó urgencia, autoridad y recursos', 'Ver si pidió la cita con día y hora', 'Elegir una sola corrección prioritaria']
      : ['Puntuar cada fase con evidencia literal', 'Auditar BANT y la decisión tomada', 'Separar ejecución de resultado', 'Elegir una sola corrección prioritaria'],
    opening: 'Pega la transcripción para empezar.',
    level: cold ? 'Revisión · llamada en frío' : 'Revisión · llamada de cierre',
    intensity: 'real',
    minutes: 5,
  };
}

/** Compatibilidad: escenario de cierre por defecto. */
export const CALL_REVIEW_SCENARIO = callReviewScenario('closer');

export type ParsedCall =
  | { ok: true; turns: Array<{ role: 'user' | 'coach'; content: string }> }
  | { ok: false; detail: string };

const MAX_TURNS = 40;
const MAX_TURN_CHARS = 900;
const MAX_TOTAL_CHARS = 16000;
const SELLER = /^(vendedor|vendedora|closer|setter|agente|sales(?:rep)?)[a-z0-9 _-]{0,20}\s*[:：-]\s*(.+)$/i;
const BUYER = /^(cliente|prospecto|prospecta|lead|comprador|buyer|customer)[a-z0-9 _-]{0,20}\s*[:：-]\s*(.+)$/i;

/**
 * Convierte una transcripción etiquetada en turnos. No adivina hablantes: si una línea no declara
 * quién habla, se rechaza con la línea exacta para que la alumna la corrija. Las líneas vacías se
 * ignoran y se conservan los saltos internos de cada intervención.
 */
export function parseCallTranscript(value: unknown): ParsedCall {
  if (typeof value !== 'string') return { ok: false, detail: 'Falta la transcripción.' };
  const text = value.replace(/\r\n?/g, '\n').trim();
  if (!text) return { ok: false, detail: 'La transcripción está vacía.' };
  if (text.length > MAX_TOTAL_CHARS) return { ok: false, detail: `La transcripción supera ${MAX_TOTAL_CHARS.toLocaleString('es')} caracteres.` };
  const turns: Array<{ role: 'user' | 'coach'; content: string }> = [];
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line) continue;
    const seller = line.match(SELLER);
    const buyer = line.match(BUYER);
    if (!seller && !buyer) {
      return { ok: false, detail: `La línea ${index + 1} no empieza por «VENDEDOR:» o «CLIENTE:». Corrige el formato y vuelve a pegarla.` };
    }
    const content = (seller?.[2] ?? buyer?.[2] ?? '').trim();
    if (!content) return { ok: false, detail: `La línea ${index + 1} no tiene texto después de la etiqueta.` };
    if (content.length > MAX_TURN_CHARS) return { ok: false, detail: `La línea ${index + 1} supera ${MAX_TURN_CHARS} caracteres.` };
    turns.push({ role: seller ? 'user' : 'coach', content });
    if (turns.length > MAX_TURNS) return { ok: false, detail: `La transcripción supera ${MAX_TURNS} intervenciones.` };
  }
  if (!turns.some(turn => turn.role === 'user')) return { ok: false, detail: 'No hay ninguna intervención de VENDEDOR: no hay nada que puntuar.' };
  if (!turns.some(turn => turn.role === 'coach')) return { ok: false, detail: 'No hay ninguna intervención de CLIENTE: sin discovery no se puede evaluar la llamada.' };
  return { ok: true, turns };
}
