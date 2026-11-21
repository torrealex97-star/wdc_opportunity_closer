'use client';
import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, Save } from 'lucide-react';
import { usd } from '../lib/money';

// Control de inversión: el gasto del mes y el tope de TODOS los proveedores de pago en una sola tabla.
// Antes solo Apify enseñaba su tope; Bright Data, SerpApi, ZenRows y ScrapingBee gastaban sin que el panel
// dijera cuánto ni hasta dónde. El gasto es lo ya registrado (no una estimación); una raya (—) es «no se
// pudo leer», nunca cero.
type Row = {
  provider: string; name: string; configured: boolean | null;
  cap_usd: number; cap_source: 'tabla' | 'entorno' | 'defecto' | 'propietario'; cap_updated_by: string | null; cap_updated_at: string | null;
  spent_usd: number | null; remaining_usd: number | null; used_pct: number | null; requests: number | null; partial: boolean;
  usd_per_request: number | null; note: string;
};
type Payload = {
  month_from: string; table_ok: boolean; spent_readable: boolean; keys_readable: boolean;
  providers: Row[];
  apify: { configured: boolean; spent_usd: number | null; cap_usd: number; cap_source: 'propietario' | 'entorno' | 'defecto'; cap_updated_by: string | null; cap_updated_at: string | null; note: string | null };
};

const ORIGIN: Record<Row['cap_source'], string> = {
  tabla: 'guardado por el propietario', propietario: 'guardado por el propietario', entorno: 'variable de entorno', defecto: 'valor por defecto (nadie lo ha fijado)',
};
const date = (value: string | null) => value ? new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : null;
const pctOf = (spent: number | null, cap: number) => spent === null || cap <= 0 ? null : Math.min(100, Math.round((spent / cap) * 1000) / 10);

export default function SpendControl({ owner, onSessionLost }: { owner: boolean; onSessionLost: () => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<string | null>('load');
  const [caps, setCaps] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    fetch('/api/admin/spend', { cache: 'no-store' })
      .then(async response => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (response.status === 401 || response.status === 403) onSessionLost();
          throw new Error(typeof (body as { detail?: string }).detail === 'string' ? (body as { detail: string }).detail : 'No se pudo leer el control de inversión.');
        }
        setData(body as Payload); setError('');
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setBusy(null));
  }, [onSessionLost]);
  useEffect(load, [load]);

  async function save(provider: string) {
    setBusy(provider); setError(''); setNotice('');
    try {
      const response = await fetch('/api/admin/spend', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, monthly_usd: caps[provider] }) });
      const body = await response.json().catch(() => ({})) as { detail?: string; message?: string };
      if (!response.ok) throw new Error(body.detail ?? 'No se pudo guardar el tope.');
      setNotice(body.message ?? 'Tope guardado.'); setCaps(current => ({ ...current, [provider]: '' })); load();
    } catch (err) { setError((err as Error).message); setBusy(null); }
  }

  // Apify entra en la misma tabla con la misma forma; su tope se edita en su pestaña (reparte por portal).
  const rows: Array<Row & { editable: boolean; where?: string }> = data ? [
    {
      provider: 'apify', name: 'Apify', configured: data.apify.configured, cap_usd: data.apify.cap_usd, cap_source: data.apify.cap_source,
      cap_updated_by: data.apify.cap_updated_by, cap_updated_at: data.apify.cap_updated_at, spent_usd: data.apify.spent_usd,
      remaining_usd: data.apify.spent_usd === null ? null : Math.max(0, data.apify.cap_usd - data.apify.spent_usd),
      used_pct: pctOf(data.apify.spent_usd, data.apify.cap_usd), requests: null, partial: false, usd_per_request: null,
      note: 'Pago por resultado de cada actor; el coste real de cada ejecución terminada.', editable: false, where: 'Se cambia en la pestaña Apify.',
    },
    ...data.providers.map(row => ({ ...row, editable: owner })),
  ] : [];
  const readableTotal = rows.length > 0 && rows.every(row => row.spent_usd !== null);
  const totalSpent = readableTotal ? rows.reduce((sum, row) => sum + (row.spent_usd ?? 0), 0) : null;
  const totalCap = rows.reduce((sum, row) => sum + row.cap_usd, 0);

  return <section aria-label="Control de inversión" data-testid="spend-control" style={{ marginBottom: 28 }}>
    <h2 className="section-title">Control de inversión</h2>
    <p className="card-meta" style={{ marginTop: 0, maxWidth: 760 }}>
      Lo gastado este mes y el tope de cada proveedor de pago. El gasto es lo ya registrado, no una estimación: antes de cada búsqueda automática la app lo compara con el tope y, al llegar, no lanza nada más y lo dice. Una raya (—) significa que no se pudo leer, no que sea cero.
    </p>
    {error && <div className="alert error" role="alert"><span>{error}</span></div>}
    {notice && <div className="auth-note" role="status" style={{ marginBottom: 16 }}>{notice}</div>}
    {busy === 'load' ? <p className="muted"><LoaderCircle size={14} className="spin" /> Leyendo el gasto del mes…</p> : data && <>
      <div className="source-dashboard">
        <article className="dash-kpi is-money"><span className="eyebrow">GASTO DEL MES</span><strong>{totalSpent === null ? '—' : usd(totalSpent)}</strong><p>{totalSpent === null ? 'Algún proveedor no se pudo leer: no se suma un total parcial.' : `de ${usd(totalCap)} de topes sumados · desde ${new Intl.DateTimeFormat('es', { day: 'numeric', month: 'long' }).format(new Date(data.month_from))}`}</p></article>
      </div>
      {!data.table_ok && <p className="inline-hint" role="alert">No se pudo leer la tabla de topes (provider_budget): se usan las variables de entorno o los valores por defecto. Cambiar un tope desde aquí no funcionará hasta que la tabla esté disponible.</p>}
      {!data.spent_readable && <p className="inline-hint" role="alert">No se pudo leer el historial de gasto de Bright Data, SerpApi, ZenRows y ScrapingBee: la app no lanzará gasto nuevo con ellos hasta poder comprobarlo.</p>}
      <div className="scorecard-scroll" style={{ marginBottom: 12 }}>
        <table className="scorecard-table" data-testid="spend-table">
          <caption>Gasto del mes y tope por proveedor de pago, en dólares (la moneda en la que se registra).</caption>
          <thead><tr>
            <th scope="col">Proveedor</th><th scope="col">Clave</th><th scope="col">Gastado</th><th scope="col">Tope</th><th scope="col">Uso del tope</th><th scope="col">Peticiones</th><th scope="col">Origen del tope</th>{owner && <th scope="col">Cambiar tope (USD)</th>}
          </tr></thead>
          <tbody>
            {rows.map(row => {
              const pct = row.used_pct;
              const hot = pct !== null && pct >= 90;
              return <tr key={row.provider} data-provider={row.provider}>
                <th scope="row">{row.name}<span className="card-meta" style={{ display: 'block' }}>{row.usd_per_request !== null ? `${usd(row.usd_per_request)} por petición` : row.note}</span></th>
                <td>{row.configured === null ? <span className="status">—</span> : row.configured ? <span className="status ok">Con clave</span> : <span className="status">Sin clave</span>}</td>
                <td title={row.spent_usd === null ? 'No se pudo leer el gasto: no es cero.' : row.partial ? 'Mínimo: alguna ejecución no informó su importe.' : undefined}>{usd(row.spent_usd)}{row.partial ? '*' : ''}</td>
                <td>{usd(row.cap_usd)}{row.cap_usd === 0 ? <span className="card-meta" style={{ display: 'block' }}>Tope 0: no gasta</span> : null}</td>
                <td>
                  {pct === null ? '—' : <>
                    <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={`Uso del tope de ${row.name}`} style={{ height: 8, borderRadius: 99, background: 'var(--inset)', overflow: 'hidden', minWidth: 80 }}>
                      <div style={{ width: `${pct}%`, height: '100%', background: hot ? 'var(--warning)' : 'var(--accent)' }} />
                    </div>
                    <span className={hot ? 'status bad' : 'status'}>{pct} %{hot ? ' · casi agotado' : ''}</span>
                  </>}
                  {row.remaining_usd !== null && <span className="card-meta" style={{ display: 'block' }}>Quedan {usd(row.remaining_usd)}</span>}
                </td>
                <td className="num">{row.requests === null ? '—' : row.requests.toLocaleString('es')}</td>
                <td>{ORIGIN[row.cap_source]}{row.cap_updated_by ? <span className="card-meta" style={{ display: 'block' }}>{row.cap_updated_by}{date(row.cap_updated_at) ? `, ${date(row.cap_updated_at)}` : ''}</span> : null}</td>
                {owner && <td>{row.editable
                  ? <form className="card-form" onSubmit={e => { e.preventDefault(); void save(row.provider); }}>
                    <label htmlFor={`cap-${row.provider}`} className="sr-only">Tope mensual de {row.name} en USD</label>
                    <input id={`cap-${row.provider}`} type="number" min={0} max={5000} step="0.5" placeholder={String(row.cap_usd)} value={caps[row.provider] ?? ''} onChange={e => setCaps(current => ({ ...current, [row.provider]: e.target.value }))} />
                    <button className="primary" disabled={busy !== null || !(caps[row.provider] ?? '').trim() || !data.table_ok} title={!data.table_ok ? 'La tabla de topes no está disponible.' : undefined}>{busy === row.provider ? <LoaderCircle size={14} className="spin" /> : <Save size={14} />} Guardar</button>
                  </form>
                  : <span className="card-meta">{row.where}</span>}</td>}
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      {rows.some(row => row.partial) && <p className="card-meta">* Gasto mínimo: alguna ejecución no informó su importe, así que el total real puede ser mayor.</p>}
      <p className="card-meta">Las pruebas de clave y cada búsqueda automática se anotan en el momento. Un gasto que no se pudo anotar se declara en el resultado de la recogida. Los topes son un límite de esta app: ponlos también en la cuenta de cada proveedor.</p>
    </>}
  </section>;
}
