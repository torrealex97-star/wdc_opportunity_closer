// Evaluación de una llamada real: superficie separada del roleplay. La rúbrica vive en
// `lib/practiceRubrics` y sale de la skill `analisis-llamadas-ventas` (fases, BANT y evidencia).
// El servidor no guarda la transcripción; solo devuelve el feedback y la nota.
import type { PracticeScenario } from '../components/practiceScenarios';

export const CALL_REVIEW_SCENARIO: PracticeScenario = {
  id: 'revision-llamada',
  kind: 'venta',
  track: 'closer',
  category: 'apertura',
  rubric: 'llamada',
  persona: { name: 'Transcripción', role: 'llamada de venta real', initials: 'LL', tone: 'sage' },
  title: 'Evaluación de una llamada real',
  context: 'Transcripción etiquetada VENDEDOR / CLIENTE',
  summary: 'Se puntúa la ejecución de la vendedora con la rúbrica de analisis-llamadas-ventas, sin inventar lo que la transcripción no demuestra.',
  objectives: [
    'Puntuar cada fase con evidencia literal',
    'Auditar BANT y la decisión tomada',
    'Separar ejecución de resultado',
    'Elegir una sola corrección prioritaria',
  ],
  opening: 'Pega la transcripción para empezar.',
  level: 'Revisión de llamada',
  intensity: 'real',
  minutes: 5,
};

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
