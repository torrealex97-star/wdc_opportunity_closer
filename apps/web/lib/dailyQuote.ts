// Frase motivadora diaria, determinista por día y navegador. No es aleatoria en cada recarga: la misma
// persona ve la misma frase durante el día, y el índice avanza con un paso coprimo con la lista para
// que dos días seguidos nunca repitan la misma frase.

export type QuoteCategory = 'Mentalidad' | 'Prospección' | 'Rechazo' | 'Constancia';
export type DailyQuote = { id: string; text: string; category: QuoteCategory };

export const QUOTES: DailyQuote[] = [
  { id: 'q01', category: 'Mentalidad', text: 'No entras a agradar: entras a entender si puedes ayudar y a decirlo con claridad.' },
  { id: 'q02', category: 'Mentalidad', text: 'El tono de igual a igual no se pide: se elige antes de marcar el número.' },
  { id: 'q03', category: 'Mentalidad', text: 'Una closer no necesita sonar perfecta; necesita sonar honesta.' },
  { id: 'q04', category: 'Mentalidad', text: 'Decir «esto no encaja» también es parte del trabajo.' },
  { id: 'q05', category: 'Prospección', text: 'La conversación empieza días antes de la llamada.' },
  { id: 'q06', category: 'Prospección', text: 'Un mensaje que no pide nada concreto es solo ruido con buena intención.' },
  { id: 'q07', category: 'Prospección', text: 'Agenda a 24 horas: la cita que se vende se presenta.' },
  { id: 'q08', category: 'Prospección', text: 'No persigas a quien no puede decidir: cualifica antes de invertir la llamada.' },
  { id: 'q09', category: 'Rechazo', text: 'El no de hoy no dice quién eres; dice que esa conversación no encajaba.' },
  { id: 'q10', category: 'Rechazo', text: 'Después de un no, anota una cosa y ajusta una frase. Eso es avanzar.' },
  { id: 'q11', category: 'Rechazo', text: 'La closer que consigue trabajo no es la que nunca recibe un no: es la que tiene un sistema para el día después.' },
  { id: 'q12', category: 'Rechazo', text: 'No te defiendas de una objeción. Pregunta qué hay detrás.' },
  { id: 'q13', category: 'Constancia', text: 'Dos prácticas cortas y una candidatura valen más que una semana de intención.' },
  { id: 'q14', category: 'Constancia', text: 'La racha se construye con retorno, no con perfección.' },
  { id: 'q15', category: 'Constancia', text: 'Practicar, preparar y aplicar: el bucle no se rompe por un día malo, se rompe por dejar de volver.' },
  { id: 'q16', category: 'Constancia', text: 'Un hábito sostenible gana a un arranque heroico.' },
];

// 5 y 16 son coprimos: el índice recorre las 16 frases antes de repetir y nunca repite dos días seguidos.
const STRIDE = 5;

const hash = (value: string) => {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) { h ^= value.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
};

const dayNumber = (dayKey: string) => {
  const [y, m, d] = dayKey.split('-').map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
};

const madridDayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' });
export const quoteDayKey = (date: Date = new Date()) => madridDayFormat.format(date);

/** Frase del día para un navegador (`seed`) y una fecha de Madrid (`YYYY-MM-DD`). */
export function quoteOfDay(seed: string, dayKey: string): DailyQuote {
  const index = (hash(seed) + dayNumber(dayKey) * STRIDE) % QUOTES.length;
  return QUOTES[index];
}

/** Semilla estable del navegador; si no hay almacenamiento, una semilla fija evita frases distintas por render. */
export function quoteSeed(storage: Pick<Storage, 'getItem' | 'setItem'> | null): string {
  const fallback = 'wdc-anon';
  if (!storage) return fallback;
  try {
    const existing = storage.getItem('wdc_quote_seed');
    if (existing && /^[a-z0-9-]{6,40}$/i.test(existing)) return existing;
    const created = `seed-${Math.random().toString(36).slice(2, 12)}`;
    storage.setItem('wdc_quote_seed', created);
    return created;
  } catch { return fallback; }
}
