'use client';
import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, Save } from 'lucide-react';

// Objetivo diario y waterfall: cuántas ofertas CUALIFICADAS (aprobadas o publicadas) hacen falta hoy y qué vías de
// pago se lanzarán, por coste, mientras falten. Es el mismo plan que sigue el cron. Lo gratuito (motor y APIs
// oficiales) corre siempre antes; las de pago paran al cumplir el objetivo o al agotar el tope de su proveedor.
// Una raya (—) significa que no se pudo contar, nunca cero.
type Stage = { id: string; label: string; unit: string; automatic: boolean; available: boolean; reason: string | null; decision: 'run' | 'if-gap' | 'skip'; why: string };
type State = {
  target: { target: number; source: 'tabla' | 'entorno' | 'defecto'; updated_by: string | null; updated_at: string | null; error: string | null };
  qualified_today: number | null; pending_today: number | null; approval_rate: number | null; expected_from_pending: number; gap: number | null; basis: string;
};
type Payload = { state: State; stages: Stage[]; free: string };

const ORIGIN: Record<State['target']['source'], string> = { tabla: 'guardado por el propietario', entorno: 'variable de entorno DAILY_TARGET_OFFERS', defecto: 'valor por defecto (nadie lo ha fijado)' };
const DECISION: Record<Stage['decision'], { text: string; cls: string }> = {
  run: { text: 'Se lanza', cls: 'status ok' },
  'if-gap': { text: 'Solo si aún falta', cls: 'status' },
  skip: { text: 'No se lanza', cls: 'status' },
};
const num = (value: number | null) => value === null ? '—' : value.toLocaleString('es');
const date = (value: string | null) => value ? new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : null;

export default function WaterfallPanel({ owner, onSessionLost }: { owner: boolean; onSessionLost: () => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>('load');
  const [value, setValue] = useState('');

  const load = useCallback(() => {
    fetch('/api/admin/waterfall', { cache: 'no-store' })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) onSessionLost();
          throw new Error(typeof (body as { detail?: string }).detail === 'string' ? (body as { detail: string }).detail : 'No se pudo leer el objetivo diario.');
        }
        setData(body as Payload); setError('');
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(null));
  }, [onSessionLost]);
  useEffect(load, [load]);

  async function save() {
    setBusy('save'); setError(''); setNotice('');
    try {
      const response = await fetch('/api/admin/waterfall', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ qualified_per_day: value }) });
      const body = await response.json().catch(() => ({})) as { detail?: string; message?: string };
      if (!response.ok) throw new Error(body.detail ?? 'No se pudo guardar el objetivo.');
      setNotice(body.message ?? 'Objetivo guardado.'); setValue(''); load();
    } catch (err) { setError((err as Error).message); setBusy(null); }
  }

  const state = data?.state;
  const pct = state && state.qualified_today !== null && state.target.target > 0 ? Math.min(100, Math.round((state.qualified_today / state.target.target) * 100)) : null;

  return <section aria-label="Objetivo diario y waterfall" data-testid="waterfall" style={{ marginBottom: 28 }}>
    <h2 className="section-title">Objetivo diario y waterfall</h2>
    <p className="card-meta" style={{ marginTop: 0, maxWidth: 760 }}>
      La app recoge por orden de coste y para cuando llega al objetivo de ofertas cualificadas del día (aprobadas o publicadas, las que la alumna puede ver) o cuando se agota el tope de cada proveedor. Lo gratuito corre siempre primero. Una raya (—) significa que no se pudo contar, no que sea cero.
    </p>
    {error && <div className="alert error" role="alert"><span>{error}</span></div>}
    {notice && <div className="auth-note" role="status" style={{ marginBottom: 16 }}>{notice}</div>}
    {busy === 'load' ? <p className="muted"><LoaderCircle size={14} className="spin" /> Leyendo el objetivo y lo cualificado de hoy…</p> : data && state && <>
      <div className="source-dashboard">
        <article className="dash-kpi"><span className="eyebrow">CUALIFICADAS HOY</span><strong data-testid="wf-qualified">{num(state.qualified_today)}</strong><p>{state.qualified_today === null ? 'No se pudieron contar: no se gasta en vías de pago.' : `de un objetivo de ${num(state.target.target)} · ${num(state.pending_today)} pendientes de revisar`}</p></article>
        <article className="dash-kpi"><span className="eyebrow">QUE FALTAN</span><strong data-testid="wf-gap">{num(state.gap)}</strong><p>{state.basis}</p></article>
      </div>
      {pct !== null && <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Progreso hacia el objetivo de ofertas cualificadas" style={{ height: 8, borderRadius: 99, background: 'var(--inset)', margin: '12px 0 4px', overflow: 'hidden', maxWidth: 520 }}><div style={{ width: `${pct}%`, height: '100%', background: pct >= 100 ? 'var(--sage)' : 'var(--accent)' }} /></div>}
      <p className="card-meta" data-testid="wf-origin">Objetivo: {num(state.target.target)} al día · {ORIGIN[state.target.source]}{state.target.updated_by ? ` (${state.target.updated_by}${date(state.target.updated_at) ? `, ${date(state.target.updated_at)}` : ''})` : ''}.{state.target.error ? ` ${state.target.error}` : ''}</p>
      {owner && <form className="card-form" onSubmit={e => { e.preventDefault(); void save(); }} style={{ marginBottom: 16 }}>
        <input id="wf-target" aria-label="Objetivo de ofertas cualificadas al día" type="number" min={0} max={10000} step={1} placeholder={String(state.target.target)} value={value} onChange={e => setValue(e.target.value)} />
        <button className="primary" disabled={busy !== null || !value.trim()}>{busy === 'save' ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />} Guardar objetivo</button>
        <span className="card-meta">0 = no se gasta en vías de pago.</span>
      </form>}
      <div className="scorecard-scroll" style={{ marginBottom: 12 }}>
        <table className="scorecard-table" data-testid="wf-stages">
          <caption>Etapas por orden de coste. {data.free}</caption>
          <thead><tr><th scope="col">Etapa</th><th scope="col">Coste</th><th scope="col">Hoy</th><th scope="col">Por qué</th></tr></thead>
          <tbody>{data.stages.map((stage, index) => <tr key={stage.id} data-stage={stage.id}>
            <th scope="row">{index + 1}. {stage.label}{stage.automatic ? '' : <span className="card-meta" style={{ display: 'block' }}>Manual</span>}</th>
            <td>{stage.unit}</td>
            <td><span className={DECISION[stage.decision].cls}>{DECISION[stage.decision].text}</span></td>
            <td>{stage.why}{stage.decision === 'skip' && stage.reason && stage.reason !== stage.why ? <span className="card-meta" style={{ display: 'block' }}>{stage.reason}</span> : null}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </>}
  </section>;
}
