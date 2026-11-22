'use client';
import { useCallback, useEffect, useState } from 'react';
import { ArrowUpRight, Building2, LoaderCircle, RefreshCcw, Search } from 'lucide-react';
import { COMPANY_KIND_LABEL, linkedinSearch, type CompanyKind } from '../lib/companyWatchlist';

// Empresas, una a una. Tres formas de seguirlas y cada una dice lo que es:
//  · feed ATS público → lo recoge el motor, sin clave ni revisión manual;
//  · página de empleo propia → «Revisar ahora» descarga y extrae JSON-LD/RSS, y enseña qué es nuevo;
//  · solo LinkedIn → no se rastrea la red: se abre la búsqueda en Google Jobs.
// Hermes/Manus quedan como hueco declarado (ADR-009), no como una tarjeta que finge estar conectada.

type Company = { code: string; name: string; kind: CompanyKind; url: string | null; source: string; note: string; ats?: string; live: number | null; approved: number | null; last_review: string | null; review_unknown?: boolean };
type Payload = { companies: Company[]; detail?: string };
type Review = { note: string; detected: number; fresh: number; accepted: number; sample: Array<{ title: string; company: string | null; url: string }> };

async function call<T>(init?: RequestInit): Promise<T> {
  const response = await fetch('/api/admin/companies', { cache: 'no-store', headers: { 'Content-Type': 'application/json' }, ...init });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof (body as { detail?: string }).detail === 'string' ? (body as { detail: string }).detail : 'La operación falló.');
  return body as T;
}

const fmt = (value: string | null) => value ? new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—';
// La fecha se pinta solo si hay evidencia. Sin ella no se inventa una revisión ni se deja un guion
// indistinguible de «no se pudo leer»: se dice qué pasa con esa vía.
const reviewLabel = (company: Company) => company.last_review
  ? fmt(company.last_review)
  : company.review_unknown
    ? 'Dato no disponible'
    : company.kind === 'linkedin'
      ? 'Sin revisar (solo búsqueda)'
      : 'Sin revisar';

export default function CompanyPages({ owner, onSessionLost }: { owner: boolean; onSessionLost: () => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>('load');
  const [reviews, setReviews] = useState<Record<string, Review>>({});
  const load = useCallback(() => {
    setBusy('load');
    call<Payload>().then(setData).catch((err: Error) => {
      if (err.message.includes('Sesión')) onSessionLost();
      setError(err.message);
    }).finally(() => setBusy(null));
  }, [onSessionLost]);
  useEffect(load, [load]);

  async function review(company: Company) {
    setBusy(company.code); setError('');
    try {
      const result = await call<Review>({ method: 'POST', body: JSON.stringify({ action: 'review', code: company.code }) });
      setReviews(old => ({ ...old, [company.code]: result }));
      load();
    } catch (err) {
      if ((err as Error).message.includes('Sesión')) onSessionLost();
      setError((err as Error).message);
    } finally { setBusy(null); }
  }

  return <section aria-label="Empresas" data-testid="company-pages">
    <p className="card-meta" style={{ marginTop: 0, maxWidth: 760 }}>Tres formas de seguir una empresa, sin mezclarlas: un ATS público entra solo en cada pasada; una página propia se revisa con el mismo extractor JSON-LD/RSS de la app y se compara por huella; y las que solo publican en LinkedIn no se rastrean: se busca su oferta en Google Jobs. Dar de alta una empresa exige una URL que responda 200 y traiga ofertas; no se añade ninguna a ojo.</p>
    {error && <div className="alert error" role="alert"><span>{error}</span></div>}
    <div className="admin-toolbar" style={{ justifyContent: 'flex-end' }}>
      <button onClick={load} disabled={busy === 'load'}>{busy === 'load' ? <LoaderCircle size={15} className="spin" /> : <RefreshCcw size={15} />} Actualizar</button>
    </div>

    <div className="source-dashboard">
      {(['ats', 'careers', 'linkedin'] as CompanyKind[]).map(kind => {
        const list = data?.companies.filter(company => company.kind === kind) ?? [];
        return <article className="dash-kpi" key={kind}><span className="eyebrow">{COMPANY_KIND_LABEL[kind].toUpperCase()}</span><strong>{data ? list.length : '—'}</strong><p>{kind === 'ats' ? `${list.reduce((sum, company) => sum + (company.live ?? 0), 0)} anuncios vivos conocidos` : kind === 'careers' ? 'Con extractor propio y diff por revisión.' : 'Sin rastreo de la red; búsqueda en Google Jobs.'}</p></article>;
      })}
      <article className="dash-kpi"><span className="eyebrow">HERMES / MANUS</span><strong>—</strong><p>No disponibles (ADR-009). No se finge su estado ni se usa como proveedor.</p></article>
    </div>

    {busy === 'load' && !data ? <p className="muted"><LoaderCircle size={14} className="spin" /> Cargando empresas…</p>
      : !data ? null
      : <div className="table-wrap"><table className="data-table">
        <thead><tr><th>Empresa</th><th>Vía</th><th>Estado</th><th className="num">Vivos</th><th>Última revisión</th><th /></tr></thead>
        <tbody>{data.companies.map(company => {
          const result = reviews[company.code];
          const state = company.kind === 'ats' ? (company.live === null ? 'Sin datos del motor' : `${company.live} vivos`) : company.kind === 'linkedin' ? 'Solo búsqueda' : result ? `${result.accepted} guardadas` : 'Sin revisar aquí';
          return <tr key={company.code}>
            <td className="primary-cell"><strong>{company.name}</strong><span>{company.code} · {company.source}</span><span>{company.note}</span>
              {result && <span className="sub">{result.note}{!!result.sample.length && <> · {result.sample.slice(0, 2).map(job => job.title).join(' · ')}</>}</span>}</td>
            <td>{COMPANY_KIND_LABEL[company.kind]}</td>
            <td><span className={company.kind === 'linkedin' ? 'status' : company.live ? 'status ok' : 'status'}>{state}</span></td>
            <td className="num">{company.live ?? '—'}</td>
            <td data-testid={`company-review-${company.code}`} title={company.review_unknown ? 'No se pudo leer todo el historial: no se afirma que nunca se revisó.' : undefined}>{reviewLabel(company)}</td>
            <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
              {company.url && <a href={company.url} target="_blank" rel="noopener noreferrer" aria-label={`Abrir ${company.name}`}><ArrowUpRight size={14} /></a>}
              {company.kind === 'linkedin' && <a href={linkedinSearch(company.name)} target="_blank" rel="noopener noreferrer" aria-label={`Buscar ${company.name} en Google Jobs`}><Search size={14} /></a>}
              {owner && company.kind === 'careers' && company.url && <button type="button" disabled={busy !== null} onClick={() => void review(company)}>{busy === company.code ? <LoaderCircle size={14} className="spin" /> : <Building2 size={14} />} Revisar ahora</button>}
            </td></tr>;
        })}</tbody></table></div>}
    <p className="card-meta">Una página sin `JobPosting` ni RSS no genera ofertas: se declara «sin ofertas detectadas», no se inventa una ficha. La cortesía por dominio y el límite de peticiones los aplica el motor y el adaptador de lectura; este panel no rastrea en bucle.</p>
  </section>;
}
