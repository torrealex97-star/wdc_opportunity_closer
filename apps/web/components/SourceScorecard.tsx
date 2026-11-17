'use client';
import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';

// Marcador por fuente: lo que pasa DESPUÉS de publicar. Envía la alumna, contesta la empresa y aquí se
// cruza con la fuente del anuncio. No retira ninguna fuente: solo enseña dónde merece la pena insistir.
// El coste es el YA registrado (Apify y respaldo de SerpApi), convertido a euros con el tipo del BCE.
type Row = {
  source: string; ingested: number | null; sent: number; responded: number; interviews: number; offers: number; rejected: number;
  per_1000: { sent: number | null; responded: number | null; interviews: number | null; offers: number | null };
  cost_usd: number | null; cost_eur: number | null; per_send_eur: number | null; per_interview_eur: number | null; cost_partial: boolean; unlinked?: boolean;
};
type Payload = {
  rows: Row[];
  totals: { sources: number; ingested: number; sent: number; responded: number; interviews: number; offers: number; cost_sources: number; cost_usd: number | null; cost_eur: number | null; per_send_eur: number | null; per_interview_eur: number | null; cost_partial: boolean };
  basis: string; truncated: boolean;
  cost: { fx: { eur_per_usd: number; source: 'EUR_PER_USD' | 'BCE'; date: string | null } | null; unattributed_usd: number | null; error: string | null; note: string };
};

const num = (value: number | null) => value === null ? '—' : String(value);
const rate = (value: number | null) => value === null ? '—' : value.toLocaleString('es', { maximumFractionDigits: 1 });
const eur = new Intl.NumberFormat('es', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 });
const eurUnit = new Intl.NumberFormat('es', { style: 'currency', currency: 'EUR', maximumFractionDigits: 4 });
const usd = new Intl.NumberFormat('es', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 });
const money = (value: number | null) => value === null ? '—' : eur.format(value);
const unit = (value: number | null) => value === null ? '—' : eurUnit.format(value);

// Por qué una celda de coste está en «—»: un hueco no es un cero y el motivo se puede leer.
const costReason = (row: Row) => row.cost_usd === null
  ? 'Sin coste registrado para esta fuente (no significa que sea gratis).'
  : row.cost_eur === null
    ? `Registrado ${usd.format(row.cost_usd)}, pero falta el tipo de cambio para pasarlo a euros.`
    : `${usd.format(row.cost_usd)} registrados${row.cost_partial ? ' (mínimo: alguna ejecución no informó importe)' : ''}.`;

export default function SourceScorecard({ onSessionLost }: { onSessionLost: () => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/admin/source-scorecard', { cache: 'no-store' })
      .then(response => response.json().then(body => ({ ok: response.ok, status: response.status, body })))
      .then(({ ok, status, body }) => {
        if (!ok) {
          if (status === 401 || status === 403) onSessionLost();
          throw new Error(typeof (body as { detail?: string }).detail === 'string' ? (body as { detail: string }).detail : 'No se pudo cargar el marcador.');
        }
        setData(body as Payload);
      })
      .catch((e: Error) => setError(e.message));
  }, [onSessionLost]);

  if (error) return <div className="alert error" role="alert"><span>{error}</span></div>;
  if (!data) return <p className="muted"><LoaderCircle size={14} className="spin" /> Cruzando candidaturas con fuentes…</p>;

  const fx = data.cost.fx;
  return <section aria-label="Resultados por fuente" data-testid="source-scorecard">
    <p className="card-meta">Denominador: <strong>{data.basis}</strong>. Una raya (—) significa que no hay denominador o que no hay dato, no que el resultado sea cero. Nada se retira solo: la decisión sigue siendo tuya.</p>
    <div className="scorecard-totals">
      <span><strong>{data.totals.sources}</strong> fuentes</span>
      <span><strong>{data.totals.ingested.toLocaleString('es')}</strong> anuncios vivos</span>
      <span><strong>{data.totals.sent}</strong> enviadas</span>
      <span><strong>{data.totals.responded}</strong> respuestas</span>
      <span><strong>{data.totals.interviews}</strong> entrevistas</span>
      <span><strong>{data.totals.offers}</strong> ofertas</span>
      <span><strong>{money(data.totals.cost_eur)}</strong> coste registrado{data.totals.cost_partial ? '*' : ''}</span>
      <span><strong>{unit(data.totals.per_send_eur)}</strong> por envío</span>
      <span><strong>{unit(data.totals.per_interview_eur)}</strong> por entrevista</span>
    </div>
    {data.truncated && <p className="inline-hint">Se leyó hasta el tope de candidaturas: las cifras son un mínimo, no el total.</p>}
    <div className="scorecard-scroll">
      <table className="scorecard-table">
        <caption>Estados del tablero de cada alumna cruzados con la fuente del anuncio. Entrevistas incluye las ofertas recibidas. El coste es el registrado en Apify y en el respaldo de SerpApi, no una estimación.</caption>
        <thead>
          <tr>
            <th scope="col">Fuente</th>
            <th scope="col" title="Anuncios vivos ingeridos por esa fuente">Vivos</th>
            <th scope="col">Enviadas</th>
            <th scope="col">Respuestas</th>
            <th scope="col">Entrevistas</th>
            <th scope="col">Ofertas</th>
            <th scope="col">Enviadas /1.000</th>
            <th scope="col">Entrevistas /1.000</th>
            <th scope="col">Ofertas /1.000</th>
            <th scope="col" title="Coste ya registrado, convertido a euros con el tipo del BCE">Coste (€)</th>
            <th scope="col" title="Coste registrado dividido por candidaturas enviadas">€ / envío</th>
            <th scope="col" title="Coste registrado dividido por entrevistas (incluye ofertas)">€ / entrevista</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map(row => <tr key={row.source} className={row.unlinked ? 'is-unlinked' : undefined}>
            <th scope="row">{row.source}</th>
            <td>{num(row.ingested)}</td>
            <td>{row.sent}</td>
            <td>{row.responded}</td>
            <td>{row.interviews}</td>
            <td>{row.offers}</td>
            <td>{rate(row.per_1000.sent)}</td>
            <td>{rate(row.per_1000.interviews)}</td>
            <td>{rate(row.per_1000.offers)}</td>
            <td title={costReason(row)}>{money(row.cost_eur)}{row.cost_partial && row.cost_eur !== null ? '*' : ''}</td>
            <td title={row.cost_eur === null ? costReason(row) : row.sent === 0 ? 'Sin envíos: no hay denominador.' : undefined}>{unit(row.per_send_eur)}</td>
            <td title={row.cost_eur === null ? costReason(row) : row.interviews === 0 ? 'Sin entrevistas: no hay denominador.' : undefined}>{unit(row.per_interview_eur)}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
    {!data.rows.length && <p className="card-meta">Todavía no hay candidaturas ni fuentes que medir.</p>}
    {data.cost.error && <p className="inline-hint" role="alert">{data.cost.error}</p>}
    <p className="card-meta">{data.cost.note}</p>
    {fx
      ? <p className="card-meta">Tipo de cambio: 1 USD = {fx.eur_per_usd.toLocaleString('es', { maximumFractionDigits: 4 })} € ({fx.source === 'BCE' ? `BCE${fx.date ? `, ${fx.date}` : ''}` : 'fijado en EUR_PER_USD'}).</p>
      : <p className="card-meta">Sin tipo de cambio EUR/USD: el coste queda en dólares registrados y las columnas en € en «—».</p>}
    {data.cost.unattributed_usd !== null && data.cost.unattributed_usd > 0 && <p className="card-meta">{usd.format(data.cost.unattributed_usd)} de Apify no se pudieron atribuir a una fuente (su actor ya no está en la tabla).</p>}
    {data.totals.cost_partial && <p className="card-meta">* Coste mínimo: alguna ejecución no informó su importe, así que el total real puede ser mayor.</p>}
  </section>;
}
