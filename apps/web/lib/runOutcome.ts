// Desenlace de una ejecución de Apify en lenguaje llano. Pura: la usan el panel (para decirle a quien prueba una ruta qué pasó) y las pruebas.
// Un hueco no es un cero: «sin ninguna ejecución» es otra cosa que «terminó con 0 ofertas», y una que sigue en marcha no se da por fallida.

export type RunLite = { status: string; harvested: number | null; cost_usd: number | null; error: string | null; started_at: string; finished_at: string | null };
export type OutcomeState = 'none' | 'running' | 'collected' | 'empty' | 'failed';
export type Outcome = { state: OutcomeState; text: string };

/** Una ejecución que lleva más de esto «en marcha» se declara posible atasco (el actor tiene su propio tiempo máximo). */
export const STUCK_AFTER_MIN = 25;

const usd = (v: number) => `${new Intl.NumberFormat('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)} US$`;
const FAIL = /^(FAILED|ABORTED|TIMED[-_]OUT)$/;

export function describeRun(run: RunLite | null, now = Date.now()): Outcome {
  if (!run) return { state: 'none', text: 'Todavía no hay ninguna ejecución de Apify de esta fuente.' };
  const cost = run.cost_usd !== null && run.cost_usd > 0 ? ` Coste: ${usd(run.cost_usd)}.` : '';
  if (FAIL.test(run.status)) return { state: 'failed', text: `Falló: ${run.error?.replace(/^La ejecución terminó como [A-Z_-]+:?\s*/, '').trim() || `Apify la dejó como ${run.status}, sin motivo registrado`}.${cost}` };
  const minutes = Math.max(0, Math.round((now - Date.parse(run.started_at)) / 60_000));
  if (run.status === 'RUNNING' || (run.status === 'SUCCEEDED' && !run.finished_at)) {
    if (minutes > STUCK_AFTER_MIN) return { state: 'failed', text: `Lleva ${minutes} min en marcha: puede haberse atascado. Revísala en Apify.` };
    return { state: 'running', text: run.status === 'RUNNING' ? `Ejecutándose en Apify (hace ${minutes} min)…` : 'Apify terminó; recogiendo los resultados…' };
  }
  if (run.status === 'SUCCEEDED') {
    const n = run.harvested ?? 0;
    return n > 0
      ? { state: 'collected', text: `Recogió ${n} oferta(s).${cost}` }
      : { state: 'empty', text: `Terminó correctamente pero sin ofertas: la búsqueda o la entrada de ese actor no devuelve nada. Revisa la plantilla de entrada.${cost}` };
  }
  return { state: 'running', text: `Estado de Apify: ${run.status}…` };
}
