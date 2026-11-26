'use client';
import { useCallback, useEffect, useState } from 'react';
import { FlaskConical, LoaderCircle, Pause, Play, Plus, RefreshCcw, Trash2 } from 'lucide-react';

// «Direcciones a vigilar»: los grupos de Facebook, comunidades de Skool y canales de Telegram que mira cada fuente. Se editan aquí (añadir,
// pausar, quitar) sin tocar código. Un dato sin leer es «—» con su causa, nunca un 0; con la tabla sin crear se dice qué falta.
type Row = { id: string; source: string; kind: string; url: string; label: string | null; enabled: boolean; created_at: string };
type SourceInfo = { source: string; label: string; hint: string; example: string };
type Payload = { sources: SourceInfo[]; targets: Row[] | null; error: string | null; pending: boolean; max_per_source: number; max_per_run: number };
const date = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' });

export default function SourceTargets({ owner, onSessionLost }: { owner: boolean; onSessionLost: () => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [notice, setNotice] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Record<string, { url: string; label: string }>>({});
  const [working, setWorking] = useState('');
  const [info, setInfo] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setBusy(true); setError('');
    fetch('/api/admin/source-targets', { cache: 'no-store' }).then(async r => {
      const d = await r.json().catch(() => ({}));
      if (r.status === 401 || r.status === 403) onSessionLost();
      if (!r.ok) throw new Error(typeof d.detail === 'string' ? d.detail : 'No se pudieron leer las direcciones.');
      setData(d as Payload);
    }).catch((e: Error) => { setData(null); setError(e.message); }).finally(() => setBusy(false));
  }, [onSessionLost]);
  useEffect(load, [load]);

  async function send(method: 'POST' | 'PATCH' | 'DELETE', body: Record<string, unknown>, source: string, key: string) {
    setWorking(key); setNotice(n => ({ ...n, [source]: '' }));
    try {
      const r = await fetch('/api/admin/source-targets', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json().catch(() => ({}));
      if (r.status === 401) { onSessionLost(); return false; }
      if (!r.ok) { setNotice(n => ({ ...n, [source]: typeof d.detail === 'string' ? d.detail : 'No se pudo guardar el cambio.' })); return false; }
      load(); return true;
    } catch { setNotice(n => ({ ...n, [source]: 'No se pudo contactar con el servidor: el cambio no se guardó.' })); return false; }
    finally { setWorking(''); }
  }
  async function add(source: string) {
    const d = draft[source] ?? { url: '', label: '' };
    if (await send('POST', { source, url: d.url, label: d.label || undefined }, source, `add-${source}`)) setDraft(x => ({ ...x, [source]: { url: '', label: '' } }));
  }

  // «Probar con estas direcciones»: la misma prueba pequeña de la pestaña Apify (10 elementos, tope de coste), sin salir de aquí.
  async function probe(source: string, active: number) {
    const portal = source.replace(/^apify-/, '');
    if (!window.confirm(`Prueba pequeña en ${portal}: máximo 10 elementos y un tope de coste, usando ${Math.min(active, data?.max_per_run ?? 20)} dirección(es) activa(s). ¿Lanzarla?`)) return;
    setWorking(`probe-${source}`); setNotice(n => ({ ...n, [source]: '' })); setInfo(n => ({ ...n, [source]: '' }));
    try {
      const r = await fetch('/api/admin/apify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'search_now', portal, test: true }) });
      const d = await r.json().catch(() => ({}));
      if (r.status === 401) { onSessionLost(); return; }
      if (!r.ok) setNotice(n => ({ ...n, [source]: typeof d.detail === 'string' ? d.detail : 'No se pudo lanzar la prueba.' }));
      else setInfo(n => ({ ...n, [source]: typeof d.message === 'string' ? d.message : 'Prueba lanzada. Los resultados entran solos en 1-5 minutos.' }));
    } catch { setNotice(n => ({ ...n, [source]: 'No se pudo contactar con el servidor: la prueba no se lanzó.' })); }
    finally { setWorking(''); }
  }

  const rows = data?.targets ?? null;
  return <article className="source-card" style={{ marginBottom: 20 }} data-testid="source-targets">
    <div className="card-head"><div><span className="eyebrow">DIRECCIONES A VIGILAR</span><h3 style={{ fontSize: 18, marginTop: 4 }}>Dónde mira cada red: Facebook, Skool y Telegram</h3></div>
      <button type="button" onClick={load} disabled={busy} aria-label="Volver a leer las direcciones">{busy ? <LoaderCircle size={15} className="spin" /> : <RefreshCcw size={15} />} Actualizar</button></div>
    <p className="card-meta" style={{ marginTop: 4 }}>Cada una de estas fuentes solo busca en las direcciones que añadas aquí. Puedes pausarlas, quitarlas o cambiarlas cuando quieras: el siguiente rastreo usa la lista de ese momento.
      {data && ` Máximo ${data.max_per_source} por fuente y ${data.max_per_run} por ejecución (cada una es una búsqueda de pago más).`} Las redes sociales limitan el uso automático en sus condiciones (ADR-011): empezar por pocas y comprobar qué recogen.</p>
    {error && <div className="alert error" role="alert"><span>{error}</span> <button type="button" onClick={load}>Reintentar</button></div>}
    {busy && !data && !error && <p className="muted"><LoaderCircle size={15} className="spin" /> Leyendo las direcciones…</p>}
    {data?.pending && <div className="alert" role="status"><span>Aún no se pueden guardar direcciones: falta aplicar la migración <code>20261124_source_targets.sql</code> en la base. {data.error}</span></div>}
    {data && !data.pending && data.error && <div className="alert error" role="alert"><span>{data.error}</span></div>}
    {data && !owner && <p className="inline-hint" role="status">Solo el propietario puede añadir, pausar o quitar direcciones; tú puedes verlas.</p>}
    {data?.sources.map(src => {
      const mine = rows ? rows.filter(r => r.source === src.source) : null;
      const active = mine ? mine.filter(r => r.enabled).length : null;
      const d = draft[src.source] ?? { url: '', label: '' };
      const full = mine ? mine.length >= data.max_per_source : false;
      return <section key={src.source} data-testid={`targets-${src.source}`} style={{ marginTop: 16 }} aria-label={src.label}>
        <h4 style={{ margin: '8px 0 2px' }}>{src.label}</h4>
        <p className="card-meta" style={{ marginTop: 0 }}>{active === null ? '— direcciones (no se pudieron leer).' : active === 0 ? 'Sin direcciones activas: esta fuente no recoge nada hasta que añadas una.' : `${active} activa${active === 1 ? '' : 's'}${mine && mine.length > active ? ` de ${mine.length}` : ''}.`} {src.hint}</p>
        {mine && mine.length > 0 && <div className="table-wrap"><table className="data-table">
          <caption className="card-meta" style={{ textAlign: 'left' }}>Direcciones de {src.label}</caption>
          <thead><tr><th scope="col">Dirección</th><th scope="col">Nota</th><th scope="col">Añadida</th><th scope="col">Estado</th>{owner && <th scope="col">Acciones</th>}</tr></thead>
          <tbody>{mine.map(row => <tr key={row.id} data-url={row.url}>
            <th scope="row" style={{ fontWeight: 400, wordBreak: 'break-all' }}>{row.url}</th>
            <td>{row.label ?? '—'}</td><td>{date.format(new Date(row.created_at))}</td>
            <td><span className={row.enabled ? 'status ok' : 'status'}>{row.enabled ? 'Activa' : 'Pausada'}</span></td>
            {owner && <td style={{ whiteSpace: 'nowrap' }}>
              <button type="button" disabled={working !== ''} onClick={() => send('PATCH', { id: row.id, enabled: !row.enabled }, src.source, `toggle-${row.id}`)} aria-label={`${row.enabled ? 'Pausar' : 'Reanudar'} ${row.url}`}>{row.enabled ? <Pause size={14} /> : <Play size={14} />} {row.enabled ? 'Pausar' : 'Reanudar'}</button>{' '}
              <button type="button" disabled={working !== ''} onClick={() => send('DELETE', { id: row.id }, src.source, `del-${row.id}`)} aria-label={`Quitar ${row.url}`}><Trash2 size={14} /> Quitar</button>
            </td>}
          </tr>)}</tbody></table></div>}
        {owner && !data.pending && rows !== null && <form data-testid={`target-form-${src.source}`} onSubmit={e => { e.preventDefault(); void add(src.source); }} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginTop: 8 }}>
          <label style={{ flex: '2 1 260px' }}>Dirección<input value={d.url} onChange={e => setDraft(x => ({ ...x, [src.source]: { ...d, url: e.target.value } }))} placeholder={src.example} autoComplete="off" /></label>
          <label style={{ flex: '1 1 160px' }}>Nota (opcional)<input value={d.label} maxLength={120} onChange={e => setDraft(x => ({ ...x, [src.source]: { ...d, label: e.target.value } }))} autoComplete="off" /></label>
          <button type="submit" disabled={working !== '' || !d.url.trim() || full}>{working === `add-${src.source}` ? <LoaderCircle size={14} className="spin" /> : <Plus size={14} />} Añadir</button>
        </form>}
        {owner && !data.pending && active !== null && active > 0 && <p style={{ marginTop: 8 }}><button type="button" data-testid={`target-probe-${src.source}`} disabled={working !== ''} onClick={() => void probe(src.source, active)}>{working === `probe-${src.source}` ? <LoaderCircle size={14} className="spin" /> : <FlaskConical size={14} />} Probar con estas direcciones</button> <span className="card-meta">Cuesta céntimos y no activa la búsqueda diaria.</span></p>}
        {info[src.source] && <div className="alert" role="status"><span>{info[src.source]}</span></div>}
        {full && <p className="inline-hint" role="status">Has llegado al máximo de {data.max_per_source} direcciones: quita alguna antes de añadir otra.</p>}
        {notice[src.source] && <div className="alert error" role="alert"><span>{notice[src.source]}</span></div>}
      </section>;
    })}
  </article>;
}
