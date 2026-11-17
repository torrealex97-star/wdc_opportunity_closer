'use client';
import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';

// Marcador por fuente: lo que pasa DESPUÉS de publicar. Envía la alumna, contesta la empresa y aquí se
// cruza con la fuente del anuncio. No retira ninguna fuente: solo enseña dónde merece la pena insistir.
type Row = { source: string; ingested: number | null; sent: number; responded: number; interviews: number; offers: number; rejected: number; per_1000: { sent: number | null; responded: number | null; interviews: number | null; offers: number | null }; unlinked?: boolean };
type Payload = { rows: Row[]; totals: { sources: number; ingested: number; sent: number; responded: number; interviews: number; offers: number }; basis: string; truncated: boolean };

const num = (value: number | null) => value === null ? '—' : String(value);
const rate = (value: number | null) => value === null ? '—' : value.toLocaleString('es', { maximumFractionDigits: 1 });

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

  return <section aria-label="Resultados por fuente" data-testid="source-scorecard">
    <p className="card-meta">Denominador: <strong>{data.basis}</strong>. Una raya (—) significa que no hay denominador, no que el resultado sea cero. Nada se retira solo: la decisión sigue siendo tuya.</p>
    <div className="scorecard-totals">
      <span><strong>{data.totals.sources}</strong> fuentes</span>
      <span><strong>{data.totals.ingested.toLocaleString('es')}</strong> anuncios vivos</span>
      <span><strong>{data.totals.sent}</strong> enviadas</span>
      <span><strong>{data.totals.responded}</strong> respuestas</span>
      <span><strong>{data.totals.interviews}</strong> entrevistas</span>
      <span><strong>{data.totals.offers}</strong> ofertas</span>
    </div>
    {data.truncated && <p className="inline-hint">Se leyó hasta el tope de candidaturas: las cifras son un mínimo, no el total.</p>}
    <div className="scorecard-scroll">
      <table className="scorecard-table">
        <caption>Estados del tablero de cada alumna cruzados con la fuente del anuncio. Entrevistas incluye las ofertas recibidas.</caption>
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
          </tr>)}
        </tbody>
      </table>
    </div>
    {!data.rows.length && <p className="card-meta">Todavía no hay candidaturas ni fuentes que medir.</p>}
  </section>;
}
