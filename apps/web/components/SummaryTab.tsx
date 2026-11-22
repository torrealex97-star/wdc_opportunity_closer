'use client';
import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, LoaderCircle, RefreshCcw } from 'lucide-react';

// Resumen: cuánto falta para el objetivo (ofertas de closer en España visibles para las alumnas) y qué hacer ahora.
export const TARGET_CLOSERS_ES = 20;
type Overview = { external?: { pending: number; exceptions?: number; counts?: Record<string, number> | null; sources: Array<{ source: string; live: number; approved: number }> }; engine: { catalog_active: number; last_run: { day: string; status: string } | null } | null; engine_reason?: 'allowance' | 'timeout' | 'down' | null; engine_http_status?: number | null; sources: Array<{ code: string; name: string; run_status: string | null }>; pool: { eligible: number | null; by_role: Record<string, number> } };
type Student = { items: Array<{ id: string }>; total: number };
type Go = (tab: 'quick' | 'external' | 'apify' | 'review' | 'catalog' | 'sources' | 'apis') => void;

// Por qué el motor no da datos. Una pausa de cuota de plataforma NO es una caída: se levanta sola cuando la
// cuota del mes se reinicia, y decir «no responde» a secas obligaba a adivinar qué hacer.
const ENGINE_CAUSE: Record<string, string> = {
  allowance: 'está en pausa por cuota de hosting (la plataforma responde 429)',
  timeout: 'no responde a tiempo (más de 20 s)',
  down: 'no responde',
};
const ENGINE_SHORT: Record<string, string> = { allowance: 'pausa de cuota', timeout: 'no responde', down: 'no responde' };

async function get<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const fail = data as { detail?: string; engine_down?: boolean };
    const error = new Error(typeof fail.detail === 'string' ? fail.detail : 'La consulta falló.');
    // Un fallo del motor se cuenta UNA vez: en el aviso con su causa. Repetirlo como error suelto hacía que el
    // resumen pareciera roto por dos sitios y escondía si había además un problema real de otra sección.
    (error as Error & { engine?: boolean }).engine = fail.engine_down === true;
    throw error;
  }
  return data as T;
}
const search = (role: string | null) => get<Student>('/api/backend/opportunities/search', { method: 'POST', body: JSON.stringify({ role, market: 'ES', days: 10, include_bilingual: false, starred_only: false, include_extra_roles: true }) });

// Objetivo del día y dinero del mes: lo que decide si hay que tocar algo en APIs. Dos lecturas independientes; si una
// falla, esa cifra es «—» con su causa, nunca 0 (y el resto del resumen sigue igual).
type Money = { qualified: number | null; target: number | null; gap: number | null; spent: number | null; cap: number | null; why: string };
async function readMoney(): Promise<Money> {
  const [wf, sp] = await Promise.all([
    get<{ state: { qualified_today: number | null; gap: number | null; target: { target: number } } }>('/api/admin/waterfall').catch((e: Error) => e),
    get<{ spent_readable: boolean; providers: Array<{ spent_usd: number | null; cap_usd: number }>; apify: { spent_usd: number | null; cap_usd: number } }>('/api/admin/spend').catch((e: Error) => e),
  ]);
  const why: string[] = [];
  let qualified: number | null = null, target: number | null = null, gap: number | null = null, spent: number | null = null, cap: number | null = null;
  if (wf instanceof Error) why.push(`objetivo: ${wf.message}`);
  else { qualified = wf.state.qualified_today; target = wf.state.target.target; gap = wf.state.gap; }
  if (sp instanceof Error) why.push(`gasto: ${sp.message}`);
  else {
    const all = [...sp.providers, sp.apify];
    cap = all.reduce((sum, row) => sum + row.cap_usd, 0);
    spent = all.every(row => row.spent_usd !== null) ? all.reduce((sum, row) => sum + (row.spent_usd ?? 0), 0) : null;
    if (spent === null) why.push('gasto: algún proveedor no se pudo leer, no se suma un total parcial');
  }
  return { qualified, target, gap, spent, cap, why: why.join(' · ') };
}
const usd = (value: number) => new Intl.NumberFormat('es', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);

export default function SummaryTab({ go, onSessionLost }: { go: Go; onSessionLost: () => void }) {
  const [closers, setClosers] = useState<number | null>(null);
  const [allEs, setAllEs] = useState<number | null>(null);
  // null = no se pudo leer (se muestra «—», nunca 0): la cola del motor y la de fuentes externas son distintas.
  const [engineCounts, setEngineCounts] = useState<Record<string, number> | null>(null);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [money, setMoney] = useState<Money | null>(null);
  const load = useCallback(() => {
    setBusy(true); setError(''); setMoney(null);
    void readMoney().then(setMoney);
    // Cada consulta es independiente: si una falla, el resto del resumen se muestra igual.
    const errors: string[] = [];
    const safe = <T,>(p: Promise<T>) => p.catch((err: Error & { engine?: boolean }) => { if (!err.engine) errors.push(err.message); return null; });
    Promise.all([safe(search('closer')), safe(search(null)), safe(get<{ counts: Record<string, number> }>('/api/admin/opportunities?limit=1')), safe(get<Overview>('/api/admin/overview'))])
      .then(([c, a, o, ov]) => {
        // Una lectura fallida deja el hueco en «—», no el número de la carga anterior: con el motor en pausa,
        // conservar las cifras viejas hacía que el Resumen pareciera al día y escondía la pausa.
        setClosers(c ? c.items.length : null);
        setAllEs(a ? a.items.length : null);
        setEngineCounts(o ? o.counts : null);
        setOverview(ov);
        if (errors.some(m => m.includes('Sesión'))) onSessionLost();
        setError(errors[0] ?? '');
      }).finally(() => setBusy(false));
  }, [onSessionLost]);
  useEffect(load, [load]);

  // Un motor que no responde no son «0 ofertas»: el hueco va con «—» y su causa, y las cifras que sí se pueden
  // leer (fuentes externas, claves, alumnas) se siguen enseñando.
  const engineKnown = !!overview && overview.engine !== null;
  const engineCause = overview && !overview.engine ? ENGINE_CAUSE[overview.engine_reason ?? 'down'] : '';
  const engineShort = overview && !overview.engine ? ENGINE_SHORT[overview.engine_reason ?? 'down'] ?? 'sin datos' : '';
  const closersKnown = closers !== null;
  const visible = closers ?? 0;
  const pct = Math.min(100, Math.round((visible / TARGET_CLOSERS_ES) * 100));
  // Las excepciones humanas viven en DOS sitios: el catálogo del motor y las fuentes externas. Contar solo
  // el motor escondía la cola real (102 externas invisibles mientras la tarjeta decía 63).
  const extCounts = overview?.external?.counts ?? null;
  const engineExceptions = engineCounts ? engineCounts.needs_review ?? 0 : null;
  const extExceptions = extCounts ? extCounts.needs_review ?? 0 : null;
  const engineDrafts = engineCounts ? engineCounts.draft ?? 0 : null;
  const extDrafts = extCounts ? extCounts.draft ?? 0 : null;
  // Una suma con un sumando desconocido no es un total: si falta una cola, el número es «—» y se dice cuál falta.
  const exceptions = engineExceptions !== null && extExceptions !== null ? engineExceptions + extExceptions : null;
  const drafts = engineDrafts !== null && extDrafts !== null ? engineDrafts + extDrafts : null;
  const extPending = overview?.external?.pending ?? 0;
  const missing = [engineCounts === null ? `motor${engineShort ? ` (${engineShort})` : ''}` : '', extCounts === null ? 'fuentes externas' : ''].filter(Boolean);
  const gap = !busy && missing.length ? `sin datos: ${missing.join(' y ')}` : '';
  const show = (v: number | null) => busy ? '…' : v === null ? '—' : v;
  const failed = overview?.sources.filter(s => s.run_status === 'failed') ?? [];
  const poolClosers = overview?.pool.by_role.closer ?? 0;
  const reached = visible >= TARGET_CLOSERS_ES;
  const steps: Array<{ text: string; action: string; tab: Parameters<Go>[0] }> = [];
  // Cada aviso lleva a la cola que de verdad tiene trabajo; antes siempre abría la del motor.
  if (engineCause) steps.push({ text: `El motor ${engineCause}: sus ofertas y su catálogo no se pueden leer ahora. Todo lo demás (fuentes externas, claves, alumnas) sigue funcionando; mira el estado de la conexión en Fuentes.`, action: 'Ver fuentes', tab: 'sources' });
  if (extExceptions) steps.push({ text: `Hay ${extExceptions} oferta(s) de fuentes externas que la clasificación automática no pudo cerrar. Revisa solo esas.`, action: 'Ver excepciones externas', tab: 'external' });
  if (engineExceptions) steps.push({ text: `Hay ${engineExceptions} oferta(s) del motor que esperan criterio humano.`, action: 'Ver excepciones del motor', tab: 'review' });
  if (extPending > 0) steps.push({ text: `Hay ${extPending} borrador(es) de fuentes externas esperando la pasada automática (reglas + IA). No hace falta que las revises a mano.`, action: 'Clasificar ahora', tab: 'external' });
  if (failed.length) steps.push({ text: `${failed.length} fuente(s) fallan en la última recogida: ${failed.slice(0, 3).map(f => f.name).join(', ')}${failed.length > 3 ? '…' : ''}.`, action: 'Ver fuentes', tab: 'sources' });
  // «No quedan ofertas por revisar» solo se puede afirmar con las DOS colas leídas y en cero: con el motor
  // caído el total es «—», y decir que no queda nada sería justo lo contrario de lo que pasa.
  if (!reached && exceptions === 0 && extPending === 0 && !!overview) steps.push({ text: 'No quedan ofertas por revisar. Para llegar al objetivo hacen falta más: lanza un actor de Apify (scraping a escala sin proxies propios) o guarda las claves de InfoJobs, Adzuna y Jooble.', action: 'Abrir Apify', tab: 'apify' });
  if (reached && !steps.length) steps.push({ text: 'Objetivo cumplido. Prueba la vista de alumna para comprobar cómo se ve.', action: 'Probar ofertas', tab: 'catalog' });

  return <section aria-label="Resumen">
    {error && <div className="alert error" role="alert"><span>{error}</span></div>}
    {!busy && engineCause && <div className="alert" role="status"><span>El motor {engineCause}. Las ofertas y el catálogo del motor van con «—»; el resto de secciones se lee con normalidad.</span></div>}
    <div className="admin-toolbar" style={{ justifyContent: 'flex-end' }}><button disabled={busy} onClick={load}>{busy ? <LoaderCircle size={15} className="spin" /> : <RefreshCcw size={15} />} Actualizar</button></div>
    <article className="source-card" style={{ marginBottom: 20 }}>
      <div className="card-head"><div><span className="eyebrow">OBJETIVO</span><h3 style={{ fontSize: 18, marginTop: 4 }}>Ofertas de closer en España visibles para las alumnas</h3></div>
        <span className={reached ? 'status ok' : 'status'}>{!closersKnown ? (busy ? '…' : 'Sin datos') : reached ? 'Cumplido' : `Faltan ${Math.max(0, TARGET_CLOSERS_ES - visible)}`}</span></div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 16 }}><span style={{ fontFamily: "'Libre Caslon Display',Georgia,serif", fontSize: 56, lineHeight: 1 }}>{closers ?? (busy ? '…' : '—')}</span><span className="muted">de {TARGET_CLOSERS_ES}</span></div>
      {closersKnown ? <div role="progressbar" aria-valuemin={0} aria-valuemax={TARGET_CLOSERS_ES} aria-valuenow={visible} aria-label="Progreso hacia el objetivo" style={{ height: 8, borderRadius: 99, background: 'var(--inset)', marginTop: 16, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: reached ? 'var(--sage)' : 'var(--accent)', transition: 'width .3s' }} /></div>
        : <p className="card-meta" style={{ marginTop: 16 }}>{busy ? 'Leyendo el catálogo…' : 'Sin datos del motor: el progreso no se puede medir ahora mismo.'}</p>}
      <p className="card-meta">Cuenta lo que una alumna ve hoy con perfil Closer, mercado España y publicadas en los últimos 10 días: solo ofertas aprobadas o publicadas que además cumplen las reglas del motor.</p>
    </article>
    <div className="card-grid" style={{ marginBottom: 20 }}>
      <article className="source-card"><span className="eyebrow">VISIBLES EN ESPAÑA (TODOS LOS PERFILES)</span><div className="stat-strip" style={{ margin: '8px 0 0' }}><span><strong style={{ fontSize: 28 }}>{allEs ?? '…'}</strong>ofertas</span></div></article>
      <article className="source-card"><span className="eyebrow">EXCEPCIONES PARA TI</span><div className="stat-strip" style={{ margin: '8px 0 0' }}><span><strong style={{ fontSize: 28 }}>{show(exceptions)}</strong>necesitan criterio humano</span></div>
        <p className="card-meta">{busy ? 'Leyendo las dos colas…' : `${engineExceptions ?? '—'} del motor · ${extExceptions ?? '—'} de fuentes externas${gap ? ` · ${gap}` : ''}`}</p></article>
      <article className="source-card"><span className="eyebrow">POR CLASIFICAR (AUTOMÁTICO)</span><div className="stat-strip" style={{ margin: '8px 0 0' }}><span><strong style={{ fontSize: 28 }}>{show(drafts)}</strong>reglas + IA, sin ti</span></div>
        <p className="card-meta">{busy ? 'Leyendo las dos colas…' : `${engineDrafts ?? '—'} del motor · ${extDrafts ?? '—'} de fuentes externas${gap ? ` · ${gap}` : ''}`}</p></article>
      <article className="source-card"><span className="eyebrow">LISTAS PARA APROBAR (CUALQUIER MERCADO)</span><div className="stat-strip" style={{ margin: '8px 0 0' }}><span><strong style={{ fontSize: 28 }}>{overview ? (engineKnown ? poolClosers : '—') : '…'}</strong>de perfil closer que ya cumplen las reglas</span></div></article>
      <article className="source-card" data-testid="summary-money"><span className="eyebrow">META DEL DÍA (24 H)</span><div className="stat-strip" style={{ margin: '8px 0 0' }}><span><strong style={{ fontSize: 28 }}>{money === null ? '…' : money.qualified === null ? '—' : money.qualified}</strong>{money?.target != null ? `cualificadas de ${money.target}` : 'cualificadas'}</span></div>
        <p className="card-meta">{money === null ? 'Leyendo el objetivo y el gasto…' : money.gap === null ? 'Hueco desconocido: las vías de pago no se lanzan.' : money.gap > 0 ? `Faltan ${money.gap}: el cron seguirá con las vías de pago.` : 'Objetivo cubierto: no se gasta más hoy.'}</p>
        <p className="card-meta">Gasto del mes: {money === null ? '…' : money.spent === null ? '—' : `${usd(money.spent)}${money.cap !== null ? ` de ${usd(money.cap)} de topes` : ''}`}{money?.why ? ` · ${money.why}` : ''}</p>
        <button type="button" onClick={() => go('apis')}>Ver APIs y topes</button></article>
      <article className="source-card"><span className="eyebrow">FUENTES CON FALLO</span><div className="stat-strip" style={{ margin: '8px 0 0' }}><span><strong style={{ fontSize: 28 }}>{overview ? (engineKnown ? failed.length : '—') : '…'}</strong>{!overview || engineKnown ? `de ${overview?.sources.length ?? '…'} en el motor cloud` : 'sin datos del motor cloud'}</span></div></article>
    </div>
    <h2 className="section-title">Qué hacer ahora</h2>
    <div className="card-grid" style={{ gridTemplateColumns: '1fr' }}>{steps.map((s, i) => <article className="source-card" key={`${s.tab}-${i}`}><div className="card-head"><p style={{ fontSize: 14 }}>{s.text}</p><button className="primary" onClick={() => go(s.tab)}>{s.action} <ArrowRight size={14} /></button></div></article>)}</div>
  </section>;
}
