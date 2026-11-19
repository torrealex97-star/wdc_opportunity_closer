// «Tu siguiente práctica»: elección determinista a partir de lo ya registrado. Sin IA, sin azar y sin
// campos nuevos en la base: el eje más flojo (con al menos 3 prácticas), la categoría menos practicada
// de esa sala y los días desde la última práctica. La UI solo pinta el resultado y arranca el escenario.
export type NextTrack = 'llamada' | 'entrevista';
export const MIN_AXIS_SAMPLES = 3;

export type NextAxis = { axis: string; avg: number; count: number; track: NextTrack | null };
// Lo mínimo que se usa del catálogo: así la función se prueba sin cargar la UI.
export type NextScenario = { id: string; track: NextTrack; category: string; title: string };
export type NextPracticeInput = {
  axes: NextAxis[];
  mastery: { ref: string; count: number }[];
  lastPracticeAt: string | null;
};
export type NextPracticeChoice<S extends NextScenario = NextScenario> = {
  scenario: S;
  track: NextTrack;
  category: string;
  weakest: { axis: string; avg: number; count: number } | null;
  categoryCount: number;
  days: number | null;
};

type QualifiedAxis = NextAxis & { track: NextTrack };

const madridDay = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const dayNumber = (date: Date) => {
  const [year, month, day] = madridDay(date).split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
};

// Días de calendario en Madrid: una práctica a las 00:30 cuenta como el día nuevo, no como el anterior.
export function daysSince(iso: string | null, now = new Date()): number | null {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  return Math.max(0, Math.round(dayNumber(now) - dayNumber(then)));
}

export function nextPractice<S extends NextScenario>(scenarios: S[], input: NextPracticeInput, now = new Date()): NextPracticeChoice<S> | null {
  if (!scenarios.length) return null;
  const mastery = new Map(input.mastery.map(item => [item.ref, item.count]));
  // Menos de 3 prácticas en un eje no es una media: se ignora para elegir (en la ficha se muestra «—»).
  const qualified: QualifiedAxis[] = input.axes
    .filter((axis): axis is QualifiedAxis => axis.track !== null && axis.count >= MIN_AXIS_SAMPLES && Number.isFinite(axis.avg))
    .sort((a, b) => a.avg - b.avg || a.axis.localeCompare(b.axis));
  const weakAxis = qualified[0] ?? null;
  const trackCount = (track: NextTrack) => scenarios.filter(item => item.track === track).reduce((sum, item) => sum + (mastery.get(item.id) ?? 0), 0);
  // Sin ejes suficientes, la sala que menos ha tocado; empate → llamada (orden fijo del catálogo).
  const track: NextTrack = weakAxis?.track ?? (trackCount('llamada') <= trackCount('entrevista') ? 'llamada' : 'entrevista');
  const pool = scenarios.filter(item => item.track === track);
  const categories: string[] = [];
  for (const item of pool) if (!categories.includes(item.category)) categories.push(item.category);
  if (!categories.length) return null;
  const categoryCount = (category: string) => pool.filter(item => item.category === category).reduce((sum, item) => sum + (mastery.get(item.id) ?? 0), 0);
  // Empate → la primera categoría del catálogo: mismo resultado con los mismos datos, siempre.
  const category = categories.reduce((best, item) => categoryCount(item) < categoryCount(best) ? item : best, categories[0]);
  const scenario = pool.find(item => item.category === category) as S;
  return {
    scenario, track, category,
    weakest: weakAxis ? { axis: weakAxis.axis, avg: weakAxis.avg, count: weakAxis.count } : null,
    categoryCount: categoryCount(category),
    days: daysSince(input.lastPracticeAt, now),
  };
}
