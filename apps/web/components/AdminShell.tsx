'use client';
import { useCallback, useEffect, useState } from 'react';
import { Activity, BriefcaseBusiness, Building2, CloudCog, Globe2, ChevronRight, FileCheck2, LayoutDashboard, ListChecks, KeyRound, LoaderCircle, LogOut, Plug, RefreshCcw, Search, ShieldCheck, SlidersHorizontal, Trash2, UserPlus, Users, GraduationCap, Target } from 'lucide-react';
import CloudAdminPanel from './CloudAdminPanel';
import EngineAlertBanner from './EngineAlertBanner';
import ApifyTab from './ApifyTab';
import ApisTab from './ApisTab';
import CatalogTab from './CatalogTab';
import ExternalTab from './ExternalTab';
import QuickReview from './QuickReview';
import StudentsTab from './StudentsTab';
import SourceScorecard from './SourceScorecard';
import SummaryTab from './SummaryTab';
import SourcesCenter from './SourcesCenter';
import CompanyPages from './CompanyPages';
import PracticeSettings from './PracticeSettings';

// Panel hospedado: mismo marco que el panel local (barra lateral, cabecera, título en serif), con acceso por
// email + contraseña de Supabase Auth (solo usuarios invitados) y las secciones de gestión de la app.
export type Me = { email: string; role: 'owner' | 'admin' };
type Tab = 'summary' | 'quick' | 'external' | 'apify' | 'review' | 'catalog' | 'sources' | 'companies' | 'scorecard' | 'apis' | 'students' | 'practice' | 'users';

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/admin/${path}`, { headers: { 'Content-Type': 'application/json' }, ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof (data as { detail?: string }).detail === 'string' ? (data as { detail: string }).detail : 'La operación falló.');
  return data as T;
}

const Brand = () => <a className="brand" href="/admin" aria-label="Closer IA OPs · panel"><span className="brand-mark">w.</span><span>Women Digital<br /><strong>Closer</strong></span></a>;

function Login({ onLogin }: { onLogin: (me: Me) => void }) {
  const [mode, setMode] = useState<'login' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      if (mode === 'login') onLogin(await api<Me>('session', { method: 'POST', body: JSON.stringify({ email, password }) }));
      else setNotice((await api<{ message: string }>('auth/recover', { method: 'POST', body: JSON.stringify({ email }) })).message);
    } catch (err) { setError((err as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="auth-wrap"><div className="auth-card">
    <Brand />
    <div><span className="eyebrow">{mode === 'login' ? 'ACCESO DEL EQUIPO' : 'RECUPERAR ACCESO'}</span>
      <h1>{mode === 'login' ? 'Panel de administración' : 'Crea una contraseña nueva'}</h1>
      <p>{mode === 'login' ? 'Solo pueden entrar las personas invitadas por el propietario.' : 'Escribe tu email y te enviamos un enlace para elegir una contraseña nueva.'}</p></div>
    <form onSubmit={submit}>
      <label htmlFor="admin-email">Email<input id="admin-email" type="email" value={email} onChange={e => setEmail(e.target.value)} autoFocus autoComplete="username" required /></label>
      {mode === 'login' && <label htmlFor="admin-password">Contraseña<input id="admin-password" type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required /></label>}
      {error && <div className="alert error" role="alert"><span>{error}</span></div>}
      {notice && <div className="auth-note" role="status">{notice}</div>}
      <button className="primary" disabled={busy || !email || (mode === 'login' && !password)}>
        {busy ? <LoaderCircle size={16} className="spin" /> : mode === 'login' ? <ShieldCheck size={16} /> : <KeyRound size={16} />}{mode === 'login' ? 'Entrar' : 'Enviar enlace'}</button>
    </form>
    <button type="button" className="link-button" onClick={() => { setMode(mode === 'login' ? 'forgot' : 'login'); setError(''); setNotice(''); }}>
      {mode === 'login' ? '¿Has olvidado tu contraseña?' : 'Volver a entrar'}</button>
  </div></div>;
}

type Overview = {
  engine: { catalog_active: number; raw_items: number; raw_items_by_route: { collection: number | null; verification: number | null } | null; last_run: { day: string; status: string; completed_at: string | null } | null } | null;
  sources: Array<{ code: string; name: string; run_status: string | null; fetched: number | null; catalog: number; eligible: number; selected: number; warning: string | null }>;
  audit: { day: string; slugs: Array<{ source: string; slug: string; status: string; http_status: number | null; canonical_url: string | null }> } | null;
  connections: Array<{ id: string; name: string; status: 'ok' | 'error' | 'not_configured'; detail: string; ms?: number }>;
  paid: Array<{ id: string; name: string; status: 'ok' | 'error' | 'not_configured'; detail: string; ms?: number }>;
  external?: { pending: number; sources: ExtSource[]; paused?: string[] };
};
const CONN: Record<string, string> = { ok: 'Conectado', error: 'Con fallo', not_configured: 'Sin configurar' };
// `deferred`: el motor aplazó la fuente porque se acabó el presupuesto de peticiones de esa
// ejecución (no es un fallo ni una fuente apagada); entra en la siguiente pasada.
const RUN: Record<string, string> = { completed: 'Completada', failed: 'Fallida', running: 'En curso', queued: 'En cola', skipped: 'Omitida', deferred: 'Aplazada' };
const statusClass = (s: string | null) => s === 'ok' || s === 'completed' ? 'status ok' : s === 'error' || s === 'failed' ? 'status bad' : 'status';

type ExtSource = { source: string; live: number; approved: number; last_seen: string | null };
type CloudSource = Overview['sources'][number];

function SourcesTab({ onSessionLost, onOpenApis, owner }: { onSessionLost: () => void; onOpenApis: () => void; owner: boolean }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const load = useCallback(() => {
    setBusy(true);
    api<Overview>('overview').then(d => { setData(d); setError(''); })
      .catch(err => { if ((err as Error).message.includes('Sesión')) onSessionLost(); setError((err as Error).message); })
      .finally(() => setBusy(false));
  }, [onSessionLost]);
  useEffect(load, [load]);
  return <section aria-label="Fuentes y conexiones">
    {error && <div className="alert error" role="alert"><span>{error}</span></div>}
    <div className="admin-toolbar" style={{ justifyContent: 'space-between' }}>
      {data?.engine ? <div className="stat-strip" style={{ margin: 0 }}><span><strong>{data.engine.catalog_active}</strong>ofertas activas</span><span><strong>{data.engine.raw_items_by_route?.collection ?? '—'}</strong>anuncios recogidos</span><span><strong>{data.engine.raw_items_by_route?.verification ?? '—'}</strong>evidencias de verificación</span>
        {data.engine.last_run && <span>Última recogida <strong>{data.engine.last_run.day}</strong>{RUN[data.engine.last_run.status] ?? data.engine.last_run.status}</span>}</div> : <span />}
      <button disabled={busy} onClick={load}>{busy ? <LoaderCircle size={15} className="spin" /> : <RefreshCcw size={15} />} Actualizar</button>
    </div>
    {busy && !data ? <p className="muted"><LoaderCircle size={14} className="spin" /> Comprobando…</p> : data && <>
      <SourcesCenter sources={data.sources} external={data.external?.sources} paused={data.external?.paused} engineDown={data.engine === null}
        connections={data.connections} paid={data.paid} engine={data.engine} owner={owner} onOpenApis={onOpenApis} />
      <h2 className="section-title">Auditoría de enlaces JobToday{data.audit ? ` · ${data.audit.day}` : ''}</h2>
      {!data.audit ? <p className="muted">Sin auditoría disponible hoy.</p> : <div className="table-wrap"><table className="data-table">
        <thead><tr><th>Fuente</th><th>Enlace</th><th>Estado</th><th className="num">HTTP</th></tr></thead>
        <tbody>{data.audit.slugs.map(a => <tr key={a.source}><td className="primary-cell"><strong>{a.source}</strong></td><td>{a.slug}{a.canonical_url && <span className="sub">→ {a.canonical_url}</span>}</td>
          <td><span className={a.status === 'ok' ? 'status ok' : 'status bad'}>{a.status}</span></td><td className="num">{a.http_status ?? '—'}</td></tr>)}</tbody></table></div>}
    </>}
  </section>;
}

type Row = { email: string; role: 'owner' | 'admin'; invited_by: string | null; created_at: string };
function UsersTab({ me, onSessionLost }: { me: Me; onSessionLost: () => void }) {
  const [users, setUsers] = useState<Row[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'owner'>('admin');
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const owner = me.role === 'owner';
  const load = useCallback(() => {
    setBusy(true);
    api<{ users: Row[] }>('users').then(d => { setUsers(d.users); setError(''); })
      .catch(err => { if ((err as Error).message.includes('Sesión')) onSessionLost(); setError((err as Error).message); })
      .finally(() => setBusy(false));
  }, [onSessionLost]);
  useEffect(load, [load]);
  async function invite(e: React.FormEvent) {
    e.preventDefault(); setError(''); setNotice('');
    try {
      const r = await api<{ email_sent: boolean }>('users', { method: 'POST', body: JSON.stringify({ email, role }) });
      setNotice(r.email_sent ? `Invitación enviada a ${email}.` : `${email} añadido, pero el correo no salió: pídele que use «¿Has olvidado tu contraseña?».`);
      setEmail(''); load();
    } catch (err) { setError((err as Error).message); }
  }
  async function remove(target: string) {
    if (!window.confirm(`¿Quitar el acceso a ${target}?`)) return;
    setError(''); setNotice('');
    try { await api(`users?email=${encodeURIComponent(target)}`, { method: 'DELETE' }); setNotice(`Acceso retirado a ${target}.`); load(); }
    catch (err) { setError((err as Error).message); }
  }
  return <section aria-label="Usuarios del panel">
    {error && <div className="alert error" role="alert"><span>{error}</span></div>}
    {notice && <div className="auth-note" role="status" style={{ marginBottom: 20 }}>{notice}</div>}
    {owner ? <form className="search-panel admin-toolbar" onSubmit={invite} style={{ marginBottom: 28 }}>
      <label className="grow" htmlFor="invite-email">Invitar a una persona<input id="invite-email" type="email" required placeholder="nombre@empresa.com" value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label htmlFor="invite-role">Rol<select id="invite-role" value={role} onChange={e => setRole(e.target.value as 'admin' | 'owner')}><option value="admin">Administrador</option><option value="owner">Propietario</option></select></label>
      <button className="primary" disabled={!email}><UserPlus size={16} /> Enviar invitación</button></form>
      : <p className="muted" style={{ marginBottom: 20 }}>Solo el propietario puede invitar o quitar personas.</p>}
    {busy ? <p className="muted"><LoaderCircle size={14} className="spin" /> Cargando…</p> : <div className="table-wrap"><table className="data-table">
      <thead><tr><th>Persona</th><th>Rol</th><th>Alta</th><th /></tr></thead>
      <tbody>{users.map(u => <tr key={u.email}>
        <td className="primary-cell"><strong>{u.email}{u.email === me.email && <span className="source-tag" style={{ marginLeft: 8 }}>tú</span>}</strong>{u.invited_by && u.invited_by !== 'bootstrap' && <span>invitado por {u.invited_by}</span>}</td>
        <td><span className={u.role === 'owner' ? 'status ok' : 'status'}>{u.role === 'owner' ? 'Propietario' : 'Administrador'}</span></td>
        <td>{new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(u.created_at))}</td>
        <td style={{ textAlign: 'right' }}>{owner && u.email !== me.email && <button onClick={() => void remove(u.email)} aria-label={`Quitar acceso a ${u.email}`}><Trash2 size={14} /> Quitar</button>}</td></tr>)}</tbody></table></div>}
  </section>;
}

// Las secciones se agrupan por el momento del trabajo —mirar, trabajar ofertas, sistema, equipo—:
// diez destinos en una lista plana obligaban a leerlos todos cada vez. El grupo es solo orden, no
// permisos: las diez siguen a un clic.
type Group = 'Empezar' | 'Ofertas' | 'Sistema' | 'Equipo';
const GROUPS: Group[] = ['Empezar', 'Ofertas', 'Sistema', 'Equipo'];

const TABS: Array<{ id: Tab; label: string; group: Group; icon: React.ReactNode; eyebrow: string; title: string; lead: string }> = [
  { id: 'summary', group: 'Empezar', label: 'Resumen', icon: <LayoutDashboard size={18} />, eyebrow: 'TU OBJETIVO', title: 'Cómo vamos.', lead: 'Cuántas ofertas de closer en España ven ya las alumnas y qué toca hacer para llegar a 20.' },
  { id: 'quick', group: 'Ofertas', label: 'Revisión rápida', icon: <ListChecks size={18} />, eyebrow: 'MUCHAS OFERTAS, POCOS CLICS', title: 'Revisa en bloque.', lead: 'Filtra por perfil, verifica la vigencia y aprueba varias a la vez. Todo se puede deshacer.' },
  { id: 'external', group: 'Ofertas', label: 'Fuentes externas', icon: <Globe2 size={18} />, eyebrow: 'APIS OFICIALES, JOBSPY Y GOOGLE JOBS', title: 'Ofertas de España y del mercado en dólares.', lead: 'Lo que cumple las reglas (perfil, mercado, español, puntuación y enlace vivo) se aprueba solo, hasta 100 al día. Lo que no, queda aquí: esta es tu cola de excepciones.' },
  { id: 'apify', group: 'Ofertas', label: 'Búsqueda automática', icon: <CloudCog size={18} />, eyebrow: 'MÁS OFERTAS SIN TRABAJO MANUAL', title: 'Buscar ofertas.', lead: 'Elige en qué portales de empleo buscar. Si un buscador falla, la app prueba otro sola; lo encontrado entra como borrador para que lo apruebes.' },
  { id: 'review', group: 'Ofertas', label: 'Revisión una a una', icon: <FileCheck2 size={18} />, eyebrow: 'DE LA OFERTA BRUTA A LA OPORTUNIDAD', title: 'Revisar a fondo lo que lo merece.', lead: 'Las ofertas claras ya entran solas por reglas; aquí publicas o retiras las que necesitan criterio, y cada guardado crea una versión nueva e inmutable.' },
  { id: 'catalog', group: 'Ofertas', label: 'Probar ofertas', icon: <Search size={18} />, eyebrow: 'LO QUE RECOGE EL MOTOR', title: 'Prueba las ofertas.', lead: 'Mira todo el catálogo o lo que vería una alumna ahora mismo con los mismos filtros.' },
  { id: 'sources', group: 'Sistema', label: 'Fuentes', icon: <Activity size={18} />, eyebrow: 'TU MESA DE TRABAJO', title: 'Fuentes de datos.', lead: 'Estado real de cada fuente, sus vías por coste y la guía para conectar la que falte. Sin clave no hay conexión.' },
  { id: 'companies', group: 'Ofertas', label: 'Empresas', icon: <Building2 size={18} />, eyebrow: 'FEED ATS, PÁGINA PROPIA O LINKEDIN', title: 'Empresas, una a una.', lead: 'Las que tienen ATS público entran solas; las que tienen página propia se revisan con el extractor común; las que solo publican en LinkedIn se buscan en Google Jobs.' },
  { id: 'scorecard', group: 'Sistema', label: 'Resultados por fuente', icon: <Target size={18} />, eyebrow: 'LO QUE PASA DESPUÉS DE PUBLICAR', title: 'Qué fuente trae entrevistas.', lead: 'Candidaturas del tablero de las alumnas cruzadas con la fuente del anuncio: enviadas, respuestas, entrevistas y ofertas por cada 1.000 anuncios vivos. Solo mide; no retira fuentes.' },
  { id: 'apis', group: 'Sistema', label: 'APIs', icon: <Plug size={18} />, eyebrow: 'CLAVES Y PROVEEDORES', title: 'APIs y conexiones.', lead: 'Guarda las claves de los proveedores y comprueba que funcionan.' },
  { id: 'students', group: 'Equipo', label: 'Alumnas', icon: <GraduationCap size={18} />, eyebrow: 'QUIÉN ENTRA A SU ESPACIO', title: 'Alumnas con acceso.', lead: 'Invita, pausa o da de baja a las alumnas. Solo ellas ven su propio perfil.' },
  { id: 'practice', group: 'Equipo', label: 'Criterios de práctica', icon: <SlidersHorizontal size={18} />, eyebrow: 'CÓMO SE PUNTÚA Y QUÉ SE CORRIGE', title: 'Los criterios de las salas.', lead: 'Rúbricas por sala, pesos, la cualificación de la llamada y la única corrección prioritaria. Lo que cambies aquí es lo que aplica el servidor al puntuar la próxima práctica.' },
  { id: 'users', group: 'Equipo', label: 'Usuarios', icon: <Users size={18} />, eyebrow: 'QUIÉN ENTRA', title: 'Equipo con acceso.', lead: 'Solo las personas de esta lista pueden entrar al panel.' },
];

export default function AdminShell() {
  const [state, setState] = useState<'checking' | 'out' | 'in' | 'unconfigured'>('checking');
  const [me, setMe] = useState<Me | null>(null);
  const [tab, setTab] = useState<Tab>('summary');
  // La sección vive en el hash (#quick, #sources…): recargar, guardar el enlace o volver atrás
  // devuelve al operador al mismo sitio en vez de a Resumen.
  useEffect(() => {
    const read = () => {
      const wanted = window.location.hash.replace('#', '');
      const found = TABS.find(t => t.id === wanted);
      if (found) setTab(found.id);
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  const go = useCallback((id: Tab) => {
    setTab(id);
    if (typeof window !== 'undefined') history.replaceState(null, '', `#${id}`);
  }, []);
  useEffect(() => {
    fetch('/api/admin/session').then(r => r.json()).then((s: { configured?: boolean; authenticated?: boolean; email?: string; role?: Me['role'] }) => {
      if (s.authenticated && s.email && s.role) { setMe({ email: s.email, role: s.role }); setState('in'); } else setState(s.configured ? 'out' : 'unconfigured');
    }).catch(() => setState('out'));
  }, []);
  const lost = useCallback(() => { setMe(null); setState('out'); }, []);
  function logout() { fetch('/api/admin/session', { method: 'DELETE' }).finally(lost); }

  if (state === 'checking') return <div className="auth-wrap"><p className="muted"><LoaderCircle size={18} className="spin" /> Comprobando sesión…</p></div>;
  if (state === 'unconfigured') return <div className="auth-wrap"><div className="auth-card"><Brand /><h1>Acceso sin configurar</h1><p>Faltan las variables de Supabase (URL, clave pública y service role) en el servidor de este despliegue.</p></div></div>;
  if (state === 'out' || !me) return <Login onLogin={m => { setMe(m); setState('in'); }} />;
  const current = TABS.find(t => t.id === tab)!;
  return <div className="shell" data-surface="admin" data-tab={tab}>
    <aside className="sidebar">
      <Brand />
      <div className="workspace-label">PANEL DE ADMINISTRACIÓN</div>
      <nav aria-label="Secciones del panel">{GROUPS.map(group => <div className="nav-group" key={group}>
        <p className="nav-group-label">{group}</p>
        {TABS.filter(t => t.group === group).map(t => <button key={t.id} className={t.id === tab ? 'nav active' : 'nav'} aria-current={t.id === tab ? 'page' : undefined} title={t.lead} onClick={() => go(t.id)}>{t.icon} {t.label}</button>)}
      </div>)}</nav>
      <div className="sidebar-note"><span className="eyebrow">DE LA PREPARACIÓN<br />A LA OPORTUNIDAD</span><p>El siguiente paso profesional empieza con una buena selección.</p></div>
      <div className="local-user"><span className="avatar-sm" aria-hidden="true">{me.email.slice(0, 2).toUpperCase()}</span><div><strong>{me.email}</strong><small>{me.role === 'owner' ? 'Propietario' : 'Administrador'}</small></div>
        <button onClick={logout}><LogOut size={14} /> Salir</button></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div>Women Digital Closer <ChevronRight size={14} /> <strong>{current.label}</strong></div>
        <label className="admin-jump">Sección<select value={tab} onChange={e => go(e.target.value as Tab)}>{GROUPS.map(group => <optgroup label={group} key={group}>{TABS.filter(t => t.group === group).map(t => <option key={t.id} value={t.id}>{t.label}</option>)}</optgroup>)}</select></label>
        <a className="local-badge" href="/" target="_blank" rel="noopener noreferrer" aria-label="Ver la app de alumnas" title="Ver la app de alumnas"><BriefcaseBusiness size={14} /> Ver la app</a></header>
      <main>
        <div className="page-heading"><div><span className="eyebrow">{current.eyebrow}</span><h1>{current.title}</h1><p>{current.lead}</p></div></div>
        {/* El aviso del motor vive aquí, no dentro de una pestaña: si el motor se pausa o deja de responder,
            el operador lo ve en cualquiera de ellas sin ir a buscarlo a «Fuentes». */}
        <EngineAlertBanner go={() => go('sources')} />
        {tab === 'summary' && <SummaryTab go={go} onSessionLost={lost} />}
        {tab === 'quick' && <QuickReview onSessionLost={lost} />}
        {tab === 'external' && <ExternalTab owner={me.role === 'owner'} onSessionLost={lost} />}
        {tab === 'apify' && <ApifyTab owner={me.role === 'owner'} onSessionLost={lost} goApis={() => go('apis')} />}
        {tab === 'review' && <CloudAdminPanel onSessionLost={lost} />}
        {tab === 'catalog' && <CatalogTab onSessionLost={lost} />}
        {tab === 'sources' && <SourcesTab onSessionLost={lost} onOpenApis={() => go('apis')} owner={me.role === 'owner'} />}
        {tab === 'companies' && <CompanyPages owner={me.role === 'owner'} onSessionLost={lost} />}
        {tab === 'apis' && <ApisTab owner={me.role === 'owner'} onSessionLost={lost} />}
        {tab === 'scorecard' && <SourceScorecard onSessionLost={lost} />}
        {tab === 'students' && <StudentsTab owner={me.role === 'owner'} onSessionLost={lost} />}
        {tab === 'practice' && <PracticeSettings onSessionLost={lost} />}
        {tab === 'users' && <UsersTab me={me} onSessionLost={lost} />}
      </main>
    </div>
  </div>;
}
