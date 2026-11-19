// Señales de estilo de la práctica: se calculan sin IA, con la frase literal que
// las dispara. Son observaciones, no veredictos: el feedback del modelo decide.
export type PracticeTurn = { role: 'user' | 'coach'; content: string };
// Las tres salas de venta comparten las señales de apertura y siguiente paso; la entrevista, las suyas.
type PracticeKind = 'venta' | 'setter' | 'frio' | 'entrevista';

export type PracticeSignal = {
  id: string;
  label: string;
  detail: string;
  quote: string;
};

const EMPATHY = ['entiendo', 'comprendo', 'tiene sentido', 'razon', 'de acuerdo', 'es logico', 'es normal', 'razonable', 'te creo', 'lo veo'];
// «este» NO es relleno: en español es el demostrativo de «este jueves» o «este
// caso», y marcarlo convertía una frase normal en una muletilla.
const FILLER = /\b(bueno|o sea|digamos|eh)\b|¿(verdad|no|qué te parece)\?/i;
const PRICE = /(\d[\d.,]*\s*(€|euros?))|(inversi[oó]n[^.]{0,40}\d)|(cuesta\s+\d)/i;
const NEXT_STEP = /\b(reuni[oó]n|llamada|agenda|empezar|empezamos|siguiente paso|te env[ií]o|te paso|jueves|viernes|lunes|martes|mi[eé]rcoles|mañana|prueba|demo)\b/i;

// Apertura sumisa: pedir perdón por llamar o dar las gracias por el tiempo coloca a la alumna por debajo del interlocutor antes de empezar.
// Solo en venta: en una entrevista «gracias por su tiempo» es cortesía normal.
const SUBMISSIVE = /\b(gracias por (tu|su) tiempo|disculpa(me)?\b|perdona(me)?\b|perdone|no quiero molestar|siento molestar|ser[aá] solo un momento|te robo (un minuto|un momento|unos minutos))/i;
// Entusiasmo de comisionista: elogiar en exceso lo que dice el interlocutor suena a venta y baja la confianza.
const GUSHING = /(¡\s*(qu[eé] )?(genial|incre[ií]ble|fant[aá]stic[oa]|maravill\w+|espectacular|perfecto)\b[^.!?]*!?)|\b(me encanta(s)? (tanto|much\w+)|incre[ií]ble|fant[aá]stic[oa])\b/i;

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

// Divide en frases conservando el texto original: la cita debe poder buscarse
// literalmente en el mensaje de la alumna.
function clauses(text: string): string[] {
  return text.split(/(?<=[.!?…])\s+|\n+/).map(part => part.trim()).filter(Boolean);
}

function clauseWith(text: string, index: number) {
  const found = clauses(text).find(part => normalize(part).includes(normalize(text.slice(index, index + 5))));
  return found ?? text.trim();
}

function quoteAround(text: string, pattern: RegExp) {
  const match = pattern.exec(text);
  if (!match || match.index === undefined) return '';
  const start = text.lastIndexOf('.', match.index) + 1;
  const end = text.indexOf('.', match.index + match[0].length);
  return text.slice(start, end === -1 ? text.length : end + 1).trim() || clauseWith(text, match.index);
}

function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// «Pero» después de validar: destruye el rapport que la propia alumna acaba de crear.
function contradictoryValidation(turns: PracticeTurn[]): PracticeSignal | null {
  for (const turn of turns) {
    const text = turn.content;
    const normalized = normalize(text);
    const empathyAt = EMPATHY.map(marker => normalized.indexOf(marker)).find(index => index >= 0);
    const butAt = normalized.search(/\bpero\b/);
    if (empathyAt === undefined || butAt < 0 || butAt < empathyAt) continue;
    return {
      id: 'pero',
      label: 'Validaste con «pero»',
      detail: 'El «pero» borra la validación anterior. Cambiarlo por «y» mantiene el acuerdo y abre el reencuadre.',
      quote: quoteAround(text, /\bpero\b/i),
    };
  }
  return null;
}

// Relleno después del precio: quien habla primero después del precio, pierde.
function fillerAfterPrice(turns: PracticeTurn[]): PracticeSignal | null {
  for (const turn of turns) {
    const text = turn.content;
    const price = PRICE.exec(text);
    if (!price || price.index === undefined) continue;
    const after = text.slice(price.index + price[0].length);
    const filler = FILLER.exec(after);
    if (!filler) continue;
    return {
      id: 'stfu',
      label: 'Relleno después del precio',
      detail: 'Después de decir el precio, el silencio trabaja para ti. Cualquier «bueno» o «¿qué te parece?» invita a negociar.',
      quote: quoteAround(after, FILLER) || after.trim().slice(0, 120),
    };
  }
  return null;
}

function submissiveOpening(turns: PracticeTurn[]): PracticeSignal | null {
  const first = turns.find(turn => turn.role === 'user');
  if (!first || !SUBMISSIVE.test(first.content)) return null;
  return {
    id: 'sumision',
    label: 'Apertura sumisa',
    detail: 'Pedir perdón o dar las gracias por el tiempo te pone por debajo antes de empezar. Abre con contexto y pide permiso para preguntar, sin disculparte.',
    quote: quoteAround(first.content, SUBMISSIVE),
  };
}

function gushing(turns: PracticeTurn[]): PracticeSignal | null {
  const turn = turns.find(item => item.role === 'user' && GUSHING.test(item.content));
  if (!turn) return null;
  return {
    id: 'entusiasmo',
    label: 'Entusiasmo de más',
    detail: 'Elogiar con exceso lo que dice la otra persona suena a venta. Un «entiendo» tranquilo y una pregunta concreta generan más confianza.',
    quote: quoteAround(turn.content, GUSHING),
  };
}

function noNextStep(turns: PracticeTurn[], kind: PracticeKind): PracticeSignal | null {
  const student = turns.filter(turn => turn.role === 'user');
  if (student.length < 3) return null;
  if (student.some(turn => NEXT_STEP.test(turn.content))) return null;
  const interview = kind === 'entrevista';
  return {
    id: 'sin-paso',
    label: interview ? 'Sin siguiente paso concreto' : 'No pediste un paso concreto',
    detail: interview
      ? 'La conversación se queda en las respuestas. Un día, una hora y una acción pequeña convierten el interés en algo que se puede cumplir.'
      : 'BAMFAM: la siguiente conversación se agenda dentro de esta. «Te mando información» o «ya te escribo» no es un siguiente paso; un día y una hora, sí.',
    quote: student[student.length - 1].content.trim().slice(0, 140),
  };
}

// Ratio de habla (rúbrica D1): en una llamada de venta el prospecto habla ~2/3 y la vendedora ~1/3.
// Se mide sobre las palabras, sin IA; solo avisa cuando hay conversación suficiente para que signifique algo.
function talksTooMuch(turns: PracticeTurn[]): PracticeSignal | null {
  const count = (role: PracticeTurn['role']) => turns
    .filter(turn => turn.role === role)
    .reduce((total, turn) => total + wordCount(turn.content), 0);
  const mine = count('user');
  const theirs = count('coach');
  const total = mine + theirs;
  if (total < 120 || mine / total <= 0.55) return null;
  const share = Math.round((mine / total) * 100);
  return {
    id: 'hablas',
    label: 'Hablas más que el cliente',
    detail: `Has dicho el ${share} % de las palabras. En una llamada de venta el cliente habla alrededor de dos tercios: una pregunta abierta y silencio devuelven el marco.`,
    quote: turns.filter(turn => turn.role === 'user').sort((a, b) => wordCount(b.content) - wordCount(a.content))[0]?.content.trim().slice(0, 140) ?? '',
  };
}

// Precio antes de descubrir (rubrica.md: bandera roja de la fase B): si el precio aparece en los
// primeros turnos y antes de cualquier pregunta, el pitch se ha adelantado al dolor.
function priceBeforeDiscovery(turns: PracticeTurn[]): PracticeSignal | null {
  const student = turns.filter(turn => turn.role === 'user');
  if (student.length < 2) return null;
  for (const [index, turn] of student.slice(0, 4).entries()) {
    const price = PRICE.exec(turn.content);
    if (!price) continue;
    const before = student.slice(0, index).some(item => item.content.includes('?'));
    if (before || turn.content.slice(0, price.index).includes('?')) continue;
    return {
      id: 'precio-antes',
      label: 'Precio antes de descubrir',
      detail: 'El precio apareció antes de que el cliente contara su problema. Primero se vende el método y se cuantifica el coste de seguir igual; el precio, después.',
      quote: quoteAround(turn.content, PRICE),
    };
  }
  return null;
}

function noQuestions(turns: PracticeTurn[], kind: PracticeKind): PracticeSignal | null {
  const student = turns.filter(turn => turn.role === 'user');
  if (!student.length) return null;
  if (student.some(turn => turn.content.includes('?'))) return null;
  return {
    id: 'sin-preguntas',
    label: kind === 'entrevista' ? 'No has hecho ninguna pregunta' : 'No has preguntado nada',
    detail: kind === 'entrevista'
      ? 'La entrevista también se juega al final: una pregunta demuestra interés real por el puesto.'
      : 'Sin una pregunta no hay descubrimiento: el interlocutor solo puede responder a lo que ya has dicho.',
    quote: student[student.length - 1].content.trim().slice(0, 140),
  };
}

function longMessages(turns: PracticeTurn[]): PracticeSignal | null {
  const long = turns.find(turn => turn.role === 'user' && turn.content.length > 320);
  if (!long) return null;
  return {
    id: 'largo',
    label: 'Un mensaje demasiado largo',
    detail: `Ese mensaje tiene ${long.content.length} caracteres. En una llamada real, tres frases seguidas suelen perder al interlocutor.`,
    quote: long.content.trim().slice(0, 120),
  };
}

function shortAnswers(turns: PracticeTurn[]): PracticeSignal | null {
  const short = turns.filter(turn => turn.role === 'user' && wordCount(turn.content) <= 4);
  if (short.length < 2) return null;
  return {
    id: 'cortas',
    label: 'Respuestas demasiado cortas',
    detail: `${short.length} de tus respuestas tienen cuatro palabras o menos. Una frase con contexto abre más que un «sí» o un «vale».`,
    quote: short[0].content.trim(),
  };
}

function filler(turns: PracticeTurn[]): PracticeSignal | null {
  for (const turn of turns) {
    if (turn.role !== 'user' || !FILLER.test(turn.content)) continue;
    return {
      id: 'relleno',
      label: 'Muletillas al responder',
      detail: 'El relleno resta autoridad. Decir la frase sin «bueno», «o sea» ni «¿verdad?» suena más firme.',
      quote: quoteAround(turn.content, FILLER),
    };
  }
  return null;
}

// Prioridad docente: primero lo que más cuesta una venta, después el estilo.
export function analyzeSignals(turns: PracticeTurn[], kind: PracticeKind): PracticeSignal[] {
  const sale = kind !== 'entrevista';
  const candidates = [
    fillerAfterPrice(turns),
    contradictoryValidation(turns),
    sale ? priceBeforeDiscovery(turns) : null,
    sale ? submissiveOpening(turns) : null,
    sale ? gushing(turns) : null,
    sale ? talksTooMuch(turns) : null,
    sale ? noNextStep(turns, kind) : null,
    noQuestions(turns, kind),
    longMessages(turns),
    filler(turns),
    shortAnswers(turns),
  ].filter((signal): signal is PracticeSignal => Boolean(signal?.quote));

  const seen = new Set<string>();
  const stfuQuote = candidates.find(signal => signal.id === 'stfu')?.quote;
  return candidates.filter(signal => {
    if (seen.has(signal.id)) return false;
    // El relleno tras el precio ya se cuenta como STFU: repetir la misma frase
    // con otro nombre solo confunde en el feedback.
    if (signal.id === 'relleno' && stfuQuote && normalize(signal.quote) === normalize(stfuQuote)) return false;
    seen.add(signal.id);
    return true;
  }).slice(0, 3);
}
