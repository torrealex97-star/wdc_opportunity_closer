// Tipo de llamada evaluada. No es lo mismo una llamada de cierre (la persona ya levantó la mano y
// hay una cita) que una llamada en frío (prospección: nadie la espera y el éxito es conseguir la cita).
// Se puntúan con rúbricas distintas, así que el tipo se declara o se detecta antes de puntuar;
// nunca se aplica la rúbrica del closer a una llamada en frío por defecto.
import type { PracticeRoom } from './practiceRubrics';

export type CallType = 'closer' | 'frio';

export const CALL_TYPE_LABELS: Record<CallType, string> = {
  closer: 'Closer · llamada con cita previa',
  frio: 'Frío · prospección sin cita',
};

export const CALL_TYPE_HINTS: Record<CallType, string> = {
  closer: 'Hay cita o lead que dejó sus datos: se puntúa descubrimiento, pitch, objeciones y cierre.',
  frio: 'Nadie espera la llamada: se puntúa apertura, gancho, cualificación y paso a cita, no el cierre.',
};

/** La rúbrica del panel con la que se puntúa cada tipo de llamada. */
export const callTypeRoom = (type: CallType): PracticeRoom => type === 'frio' ? 'frio' : 'venta';

export type CallTypeResult = {
  type: CallType;
  /** `explicita` cuando lo eligió quien revisa; `detectada` cuando se dedujo de la transcripción. */
  source: 'explicita' | 'detectada';
  confidence: 'alta' | 'media' | 'baja';
  reason: string;
};

// Señales de prospección: no hay relación previa y la persona no espera la llamada.
const COLD: Array<[RegExp, string]> = [
  [/¿quién (es|habla|llama|está)\??/i, 'la persona pregunta quién llama'],
  [/no (te|le) conozco/i, 'dice no conocerte'],
  [/no recuerdo haber/i, 'no recuerda haberte dejado sus datos'],
  [/¿esto (por qué|a qué) (es|se debe)\??/i, 'pregunta a qué se debe la llamada'],
  [/no me (interesa|hace falta|hace falta nada)/i, 'rechaza la llamada de entrada'],
  [/mánda(me|le|nos) (un|el) correo/i, 'pide un correo genérico'],
  [/estoy (entre|en) (reuni|reuniones|comida|obra| el coche)/i, 'no tiene un hueco reservado'],
  [/otra vez (tú|usted)/i, 'reconoce una insistencia anterior'],
  [/buzón de voz/i, 'cae en buzón de voz'],
];

// Señales de llamada de cierre: hay contexto previo, cita o lead que pidió hablar.
const WARM: Array<[RegExp, string]> = [
  [/te llamo por (tu|el) (formulario|solicitud|registro)/i, 'te llama por un formulario o solicitud que ella dejó'],
  [/(hemos|teníamos) (quedado|una cita|una llamada)/i, 'había una cita acordada'],
  [/la (reunión|llamada|cita) de (hoy|esta|las)/i, 'hay una reunión o cita de hoy'],
  [/(viste|vio|has visto) (el|la) (webinar|vídeo|video|presentación)/i, 'vio el material antes de la llamada'],
  [/estuvimos hablando/i, 'hubo una conversación anterior'],
  [/gracias por (venir|tu tiempo|atenderme)/i, 'la conversación estaba acordada'],
  [/(el|mi) (diagnóstico|presupuesto|propuesta) que (te|os) (mandé|envié)/i, 'continúa un proceso ya iniciado'],
];

const search = (lines: string[], patterns: Array<[RegExp, string]>) => {
  const found: string[] = [];
  for (const line of lines) for (const [pattern, why] of patterns) if (pattern.test(line)) found.push(why);
  return [...new Set(found)];
};

/**
 * Deduce si la transcripción es una llamada de cierre o en frío. Solo mira lo que dice la llamada:
 * si no hay señal clara devuelve `confidence: 'baja'` con el motivo, y quien revisa decide.
 * El resultado se puede sobrescribir a mano: esto es una ayuda, no una verdad.
 */
export function detectCallType(turns: Array<{ role: 'user' | 'coach'; content: string }>): CallTypeResult {
  const seller = turns.filter(turn => turn.role === 'user').map(turn => turn.content);
  const buyer = turns.filter(turn => turn.role === 'coach').map(turn => turn.content);
  // La apertura pesa más: es donde se ve si había relación previa.
  const opening = [...buyer.slice(0, 2), ...seller.slice(0, 2)];
  const cold = search(opening, COLD);
  const warm = search(opening, WARM);
  if (cold.length && !warm.length) {
    return { type: 'frio', source: 'detectada', confidence: cold.length >= 2 ? 'alta' : 'media', reason: `Parece una llamada en frío: ${cold.slice(0, 2).join('; ')}.` };
  }
  if (warm.length && !cold.length) {
    return { type: 'closer', source: 'detectada', confidence: warm.length >= 2 ? 'alta' : 'media', reason: `Parece una llamada de cierre: ${warm.slice(0, 2).join('; ')}.` };
  }
  if (cold.length && warm.length) {
    return { type: 'frio', source: 'detectada', confidence: 'baja', reason: `Hay señales de las dos: ${cold[0]} y ${warm[0]}. Se puntúa como frío; cámbialo si te equivocas.` };
  }
  return { type: 'closer', source: 'detectada', confidence: 'baja', reason: 'No hay señales claras de prospección: se puntúa como llamada de cierre. Cámbialo si era en frío.' };
}

/** Elige el resultado final: lo que pidió quien revisa manda sobre la detección. */
export function resolveCallType(
  requested: unknown,
  turns: Array<{ role: 'user' | 'coach'; content: string }>,
): CallTypeResult {
  const detected = detectCallType(turns);
  if (requested === 'closer' || requested === 'frio') {
    return { type: requested, source: 'explicita', confidence: 'alta', reason: `Elegida a mano: ${CALL_TYPE_LABELS[requested]}.` };
  }
  return detected;
}
