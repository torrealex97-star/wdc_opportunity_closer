// Interrupción de voz en la sala: mientras el interlocutor habla, el micrófono puede captar su propia voz por los
// altavoces. Antes de cortar la locución o de aceptar un dictado se comprueba si lo oído es eco de lo que se está
// leyendo. Regla determinista y explicable; sin audio ni servicio externo.

const words = (text: string) => text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9ñ\s]/g, ' ').split(/\s+/).filter(Boolean);

/** Parte de las palabras oídas que aparece en lo que se está leyendo, de 0 a 1. */
export function overlap(heard: string, spoken: string): number {
  const said = words(heard);
  if (!said.length) return 0;
  const pool = new Set(words(spoken));
  return said.filter(word => pool.has(word)).length / said.length;
}

export const ECHO_THRESHOLD = 0.75;
/** Mínimo de palabras para juzgar: con una o dos no se puede distinguir eco de una interrupción real, y se deja interrumpir. */
export const ECHO_MIN_WORDS = 3;

/** `true` si lo oído parece la propia voz del interlocutor y debe ignorarse. Sin locución en curso nunca es eco. */
export function isEcho(heard: string, spoken: string | null | undefined): boolean {
  if (!spoken?.trim()) return false;
  if (words(heard).length < ECHO_MIN_WORDS) return false;
  return overlap(heard, spoken) >= ECHO_THRESHOLD;
}
