'use client';
import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import { fmtInt } from '../lib/formatInt';

// Muestra por fuente: ofertas únicas recogidas frente al objetivo de 1.000 antes de juzgar una fuente de pago. Mientras no
// se llegue, la lectura es «sin conclusión»: no se recorta ni se pausa nada. Una raya (—) es «no se pudo contar», no cero.
type Row = {
  source: string; seen: number | null; approved: number | null; cost_usd: number | null;
  state: 'sin_dato' | 'sin_conclusion' | 'medida'; missing: number | null; approved_pct: number | null; approved_per_usd: number | null;
  since: string | null; note: string;
  drafts: number | null;
  health: { state: 'conectada' | 'sin_via' | 'sin_clave' | 'mal_conectada' | 'sin_programar' | 'sin_juzgar'; cause: string; next: string } | null;
};
type Payload = { target: number; rows: Row[]; basis: string; cost_note: string | null; health_note: string | null };

// Estado de conexión: texto siempre (el color no es la única señal). «Conectada» no es «buena»: eso solo se sabe con 1.000 ofertas.
const HEALTH: Record<NonNullable<Row['health']>['state'], { text: string; cls: string }> = {
  conectada: { text: 'Conectada', cls: 'status ok' },
  sin_via: { text: 'Sin vía verificada', cls: 'status' },
  sin_clave: { text: 'Falta clave o saldo', cls: 'status bad' },
  mal_conectada: { text: 'Mal conectada', cls: 'status bad' },
  sin_programar: { text: 'Sin programar', cls: 'status bad' },
  sin_juzgar: { text: 'Ofertas sin juzgar', cls: 'status bad' },
};

const num = (value: number | null) => value === null ? '—' : fmtInt(value);
const usd = (value: number | null) => value === null ? '—' : `${new Intl.NumberFormat('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)} US$`;
const STATE: Record<Row['state'], { text: string; cls: string }> = {
  sin_dato: { text: 'Sin dato', cls: 'status' },
  sin_conclusion: { text: 'Sin conclusión', cls: 'status' },
  medida: { text: 'Muestra suficiente', cls: 'status ok' },
};

export default function SourceSample({ onSessionLost }: { onSessionLost: () => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);

  const load = useCallback(() => {
    setBusy(true);
    fetch('/api/admin/source-sample', { cache: 'no-store' })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) onSessionLost();
          throw new Error(typeof (body as { detail?: string }).detail === 'string' ? (body as { detail: string }).detail : 'No se pudo leer la muestra por fuente.');
        }
        setData(body as Payload); setError('');
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(false));
  }, [onSessionLost]);
  useEffect(load, [load]);

  return <section aria-label="Muestra por fuente" data-testid="source-sample">
    <h2 className="section-title">Salud y muestra por fuente</h2>
    <p className="card-meta" style={{ marginTop: 0, maxWidth: 760 }}>
      Antes de decidir si una fuente de pago rinde, hacen falta al menos {fmtInt(data?.target ?? 1000)} ofertas recogidas con búsquedas de closer bien hechas. Con menos, la lectura es «sin conclusión», no «rinde mal», y no se recorta ni se pausa nada. {data?.basis ? `Se cuenta: ${data.basis}.` : ''}
    </p>
    {error && <div className="alert error" role="alert"><span>{error}</span> <button className="ghost" onClick={load} disabled={busy}><RefreshCw size={14} /> Reintentar</button></div>}
    {busy && !data ? <p className="muted"><LoaderCircle size={14} className="spin" /> Contando lo recogido por fuente…</p>
      : data && (data.rows.length === 0
        ? <p className="empty">Todavía no hay fuentes con ofertas recogidas. Cuando una fuente recoja, aparecerá aquí con su avance hacia las {fmtInt(data.target)}.</p>
        : <>
          {data.cost_note && <p className="inline-hint" role="status">{data.cost_note}</p>}
          {data.health_note && <p className="inline-hint" role="status">{data.health_note}</p>}
          <div className="scorecard-scroll stack-wrap" style={{ marginBottom: 12 }}>
            <table className="scorecard-table stack-table" data-testid="sample-table">
              <caption>Conexión, ofertas únicas recogidas, aprobadas y coste registrado por fuente</caption>
              <thead><tr><th scope="col">Fuente</th><th scope="col">Conexión</th><th scope="col">Recogidas</th><th scope="col">Aprobadas</th><th scope="col">% aprobadas</th><th scope="col">Coste</th><th scope="col">Aprobadas por US$</th><th scope="col">Lectura</th></tr></thead>
              <tbody>{data.rows.map(row => {
                const pct = row.seen === null ? null : Math.min(100, Math.round((row.seen / data.target) * 100));
                return <tr key={row.source} data-source={row.source}>
                  <th scope="row">{row.source}{row.since ? <span className="card-meta" style={{ display: 'block' }}>Desde {new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(new Date(row.since))}</span> : null}</th>
                  <td data-label="Conexión">{row.health ? <><span className={HEALTH[row.health.state].cls} data-health={row.health.state}>{HEALTH[row.health.state].text}</span><span className="card-meta" style={{ display: 'block' }}>{row.health.cause}{row.health.state === 'conectada' ? '' : ` Siguiente paso: ${row.health.next}`}</span></> : '—'}</td>
                  <td data-label="Recogidas" className="num">
                    {row.seen === null ? '—' : <div>
                      <div role="progressbar" aria-valuemin={0} aria-valuemax={data.target} aria-valuenow={Math.min(row.seen, data.target)} aria-label={`Recogidas de ${row.source}: ${num(row.seen)} de ${num(data.target)}`} style={{ height: 8, borderRadius: 99, background: 'var(--inset)', overflow: 'hidden', minWidth: 80 }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)' }} />
                      </div>
                      <span className="card-meta" style={{ display: 'block' }}>{num(row.seen)} de {num(data.target)}</span>
                    </div>}
                  </td>
                  <td data-label="Aprobadas" className="num">{num(row.approved)}</td>
                  <td data-label="% aprobadas" className="num">{row.approved_pct === null ? '—' : `${row.approved_pct.toLocaleString('es')} %`}</td>
                  <td data-label="Coste" className="num">{usd(row.cost_usd)}</td>
                  <td data-label="Aprobadas por US$" className="num">{row.approved_per_usd === null ? '—' : row.approved_per_usd.toLocaleString('es')}</td>
                  <td data-label="Lectura"><span className={STATE[row.state].cls}>{STATE[row.state].text}</span><span className="card-meta" style={{ display: 'block' }}>{row.note}</span></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        </>)}
  </section>;
}
