'use client';
import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { cost, money, unit, usd } from '../lib/money';

// Marcador por fuente: lo que pasa DESPUÉS de publicar. Envía la alumna, contesta la empresa y aquí se
// cruza con la fuente del anuncio. No retira ninguna fuente: solo enseña dónde merece la pena insistir.
// El coste es el YA registrado (Apify y respaldo de SerpApi), convertido a euros con el tipo del BCE.
type Row = {
  source: string; ingested: number | null; sent: number; responded: number; interviews: number; offers: number; rejected: number;
  per_1000: { sent: number | null; responded: number | null; interviews: number | null; offers: number | null };
  cost_usd: number | null; cost_eur: number | null; per_send_eur: number | null; per_interview_eur: number | null; cost_partial: boolean; unlinked?: boolean;
  prepared: number; opened: number; sent_ever: number; sends_missing: number; conclusive: boolean;
};
type Payload = {
  rows: Row[];
  totals: { sources: number; ingested: number; sent: number; responded: number; interviews: number; offers: number; cost_sources: number; cost_usd: number | null; cost_eur: number | null; per_send_eur: number | null; per_interview_eur: number | null; cost_partial: boolean; prepared: number; opened: number; sent_ever: number; conclusive_sources: number };
  basis: string; truncated: boolean;
  attribution: { first_seen: string; shared_live: number | null };
  cost: { fx: { eur_per_usd: number; source: 'EUR_PER_USD' | 'BCE'; date: string | null } | null; unattributed_usd: number | null; error: string | null; note: string };
};

const num = (value: number | null) => value === null ? '—' : String(value);
const rate = (value: number | null) => value === null ? '—' : value.toLocaleString('es', { maximumFractionDigits: 1 });
// Vía de la fuente por su prefijo de proveedor. No es una estimación de coste: el importe real está en
// la columna de coste y en «APIs». Una fuente del motor sin prefijo es gratuita; las de pago llevan su
// proveedor en el nombre (`apify-…`, `serpapi-…`, `brightdata-…`).
const routeKind = (source: string) => /^(apify|serpapi|brightdata|zenrows|scrapingbee)-/.test(source) ? 'Pago' : 'Gratis';

// Por qué una celda de coste está en «—»: un hueco no es un cero y el motivo se puede leer.
const costReason = (row: Row) => row.cost_usd === null
  ? 'Sin coste registrado para esta fuente (no significa que sea gratis).'
  : row.cost_eur === null
    ? `Registrado ${usd(row.cost_usd)}, pero falta el tipo de cambio para pasarlo a euros.`
    : `${usd(row.cost_usd)} registrados${row.cost_partial ? ' (mínimo: alguna ejecución no informó importe)' : ''}.`;

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
  // Barras comparativas: el máximo de cada serie es la referencia para que una fuente con 3 envíos no
  // parezca igual de grande que una con 300. Sin envíos no se dibuja nada: se dice que aún no hay dato.
  const peakSent = Math.max(1, ...data.rows.map(row => row.sent));
  const peakInterviews = Math.max(1, ...data.rows.map(row => row.interviews));
  const topRows = [...data.rows].sort((a, b) => b.interviews - a.interviews || b.sent - a.sent).slice(0, 6);
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
    <div className="source-dashboard" data-testid="source-dashboard">
      <article className="dash-kpi"><span className="eyebrow">ANUNCIOS VIVOS</span><strong>{data.totals.ingested.toLocaleString('es')}</strong><p>{data.totals.sources} fuentes con actividad · {data.totals.conclusive_sources} comparables (≥30 envíos)</p></article>
      <article className="dash-kpi"><span className="eyebrow">ENVIADAS</span><strong>{data.totals.sent.toLocaleString('es')}</strong><p>{data.totals.prepared.toLocaleString('es')} candidaturas preparadas en el tablero</p></article>
      <article className="dash-kpi"><span className="eyebrow">ENTREVISTAS</span><strong>{data.totals.interviews.toLocaleString('es')}</strong><p>{data.totals.responded.toLocaleString('es')} respuestas · {data.totals.offers.toLocaleString('es')} ofertas</p></article>
      <article className="dash-kpi is-money"><span className="eyebrow">GASTO REGISTRADO</span><strong>{money(data.totals.cost_eur)}{data.totals.cost_partial ? '*' : ''}</strong><p>{unit(data.totals.per_send_eur)} por envío · {unit(data.totals.per_interview_eur)} por entrevista</p></article>
    </div>
    <div className="dash-bars" data-testid="scorecard-bars">
      <div className="dash-bars-head"><span className="eyebrow">RENDIMIENTO POR FUENTE</span><span className="card-meta">Envíos y entrevistas en la misma escala; el importe es el coste ya registrado de esa fuente.</span></div>
      {!data.totals.sent && !data.totals.interviews
        ? <p className="card-meta">Todavía no hay envíos ni entrevistas que comparar: las barras aparecerán en cuanto las alumnas empiecen a enviar candidaturas.</p>
        : topRows.map(row => <div className="dash-bar" key={`bar-${row.source}`}>
          <div className="dash-bar-name"><strong>{row.source}</strong><span>{row.cost_eur === null ? 'coste sin datos' : `${cost(row.cost_eur)}${row.cost_partial ? '*' : ''}`}</span></div>
          <div className="dash-bar-track" role="img" aria-label={`${row.source}: ${row.sent} envíos, ${row.interviews} entrevistas`}>
            <span className="is-sent" style={{ width: `${Math.max(row.sent ? 2 : 0, (row.sent / peakSent) * 100)}%` }} />
            <span className="is-interview" style={{ width: `${Math.max(row.interviews ? 2 : 0, (row.interviews / peakInterviews) * 100)}%` }} />
          </div>
          <div className="dash-bar-values"><span>{row.sent} enviadas</span><span>{row.interviews} entrevistas</span><span>{unit(row.per_interview_eur)} / entrevista</span></div>
        </div>)}
      <p className="dash-legend"><span className="key is-sent" />Enviadas <span className="key is-interview" />Entrevistas (incluye ofertas)</p>
    </div>
    <div className="scorecard-scroll">
      <table className="scorecard-table">
        <caption>Estados del tablero de cada alumna cruzados con la fuente del anuncio. Entrevistas incluye las ofertas recibidas. El coste es el registrado en Apify y en el respaldo de SerpApi, no una estimación.</caption>
        <thead>
          <tr>
            <th scope="col">Fuente</th>
            <th scope="col" title="Gratis = fuente del motor o feed; Pago = proveedor por petición/resultado">Vía</th>
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
            <td><span className={routeKind(row.source) === 'Pago' ? 'status' : 'status ok'}>{routeKind(row.source)}</span></td>
            <td>{num(row.ingested)}</td>
            <td>{row.sent}</td>
            <td>{row.responded}</td>
            <td>{row.interviews}</td>
            <td>{row.offers}</td>
            <td>{rate(row.per_1000.sent)}</td>
            <td>{rate(row.per_1000.interviews)}</td>
            <td>{rate(row.per_1000.offers)}</td>
            <td title={costReason(row)}>{cost(row.cost_eur)}{row.cost_partial && row.cost_eur !== null ? '*' : ''}</td>
            <td title={row.cost_eur === null ? costReason(row) : row.sent === 0 ? 'Sin envíos: no hay denominador.' : undefined}>{unit(row.per_send_eur)}</td>
            <td title={row.cost_eur === null ? costReason(row) : row.interviews === 0 ? 'Sin entrevistas: no hay denominador.' : undefined}>{unit(row.per_interview_eur)}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
    <span className="eyebrow">EMBUDO POR FUENTE</span>
    <p className="card-meta">Preparadas = candidaturas creadas (acumulado). Vistas = abrió el anuncio y aún no lo ha marcado como enviada (foto de ahora). Enviadas = tiene fecha de envío (acumulado). Respuestas = estado actual que declara ella. «Aún no concluyente» significa que todavía no hay envíos suficientes para comparar dos fuentes: faltan los que dice la celda.</p>
    <div className="scorecard-scroll">
      <table className="scorecard-table" data-testid="scorecard-funnel">
        <caption>De la tarjeta al resultado. El umbral para comparar dos fuentes es de 30 envíos en cada una: es un mínimo declarado, no una prueba de significación.</caption>
        <thead>
          <tr>
            <th scope="col">Fuente</th>
            <th scope="col" title="Candidaturas creadas para ofertas de esa fuente">Preparadas</th>
            <th scope="col" title="Abrió el anuncio desde su tarjeta y aún no lo ha enviado">Vistas</th>
            <th scope="col" title="Candidaturas con fecha de envío, aunque después se descartaran">Enviadas</th>
            <th scope="col" title="Estado actual: la empresa ha respondido">Respuestas</th>
            <th scope="col" title="Para comparar dos fuentes hacen falta 30 envíos en cada una">¿Se puede comparar?</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.filter(row => row.prepared > 0 || row.opened > 0 || row.sent_ever > 0).map(row => <tr key={`funnel-${row.source}`} className={row.unlinked ? 'is-unlinked' : undefined}>
            <th scope="row">{row.source}</th>
            <td>{row.prepared}</td>
            <td>{row.opened}</td>
            <td>{row.sent_ever}</td>
            <td>{row.responded}</td>
            <td>{row.conclusive ? 'Sí (≥30 envíos)' : `Aún no concluyente · faltan ${row.sends_missing} envíos`}</td>
          </tr>)}
        </tbody>
      </table>
    </div>
    {!data.rows.some(row => row.prepared > 0 || row.opened > 0 || row.sent_ever > 0) && <p className="card-meta">Todavía no hay ninguna candidatura preparada: el embudo empezará en cuanto prepares la primera.</p>}
    <p className="card-meta">Atribución: {data.attribution.first_seen}. {data.attribution.shared_live === null ? 'No se pudo contar cuántos anuncios vivos se vieron también en otra fuente.' : `${data.attribution.shared_live} de los anuncios vivos también estaban en otra fuente («Vista también en» en la oferta).`}</p>
    {!data.rows.length && <p className="card-meta">Todavía no hay candidaturas ni fuentes que medir.</p>}
    {data.cost.error && <p className="inline-hint" role="alert">{data.cost.error}</p>}
    <p className="card-meta">{data.cost.note}</p>
    {fx
      ? <p className="card-meta">Tipo de cambio: 1 USD = {fx.eur_per_usd.toLocaleString('es', { maximumFractionDigits: 4 })} € ({fx.source === 'BCE' ? `BCE${fx.date ? `, ${fx.date}` : ''}` : 'fijado en EUR_PER_USD'}).</p>
      : <p className="card-meta">Sin tipo de cambio EUR/USD: el coste queda en dólares registrados y las columnas en € en «—».</p>}
    {data.cost.unattributed_usd !== null && data.cost.unattributed_usd > 0 && <p className="card-meta">{usd(data.cost.unattributed_usd)} de Apify no se pudieron atribuir a una fuente (su actor ya no está en la tabla).</p>}
    {data.totals.cost_partial && <p className="card-meta">* Coste mínimo: alguna ejecución no informó su importe, así que el total real puede ser mayor.</p>}
  </section>;
}
