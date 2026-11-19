'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Award, Flame, LoaderCircle, RotateCw } from 'lucide-react';
import { REVIEW_REFS } from './trainingRefs';
import { TRAINING_MODULES } from './trainingContent';
import { scenarioById } from './practiceScenarios';
import type { Progress } from '../lib/studentActivity';
import type { AppFunnel, Mastery, XpResult } from '../lib/studentMetrics';
import type { DirectReview, Goal, IdleNudge } from '../lib/studentRetention';
import { AXIS_LABELS } from '../lib/practiceAxes';
import { MIN_AXIS_SAMPLES } from '../lib/nextPractice';

// Progreso de la alumna (adaptado del panel «Mis métricas» de closer-ai-coach): solo datos reales de su actividad.
// Un periodo sin datos es «—», nunca 0; una carga fallida no se pinta como vacío; cada gráfico trae su tabla.
type Metrics = { xp: XpResult; mastery: Mastery[]; applications: AppFunnel | null; applications_truncated?: boolean | null };
type Retention = { nudge: IdleNudge; review: DirectReview; goals: Goal[] };
type State = { kind: 'loading' } | { kind: 'login' } | { kind: 'error'; message: string } | { kind: 'ready'; progress: Progress; metrics: Metrics | null; retention: Retention | null };
const PERIODS = [7, 30, 90] as const;
const REVIEW_LABELS: Record<string, string> = Object.fromEntries(TRAINING_MODULES.map(m => [m.id, m.title]));
const KIND_LABELS: Record<string, string> = { session: 'Entrada', training_review: 'Formación', training_exam: 'Examen de egreso', practice: 'Sala de práctica' };
const number = new Intl.NumberFormat('es');
const dateFmt = new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', timeZone: 'Europe/Madrid' });
const weekLabel = (iso: string) => dateFmt.format(new Date(`${iso}T12:00:00Z`));
const dash = (value: number | null, suffix = '') => value === null ? '—' : `${number.format(value)}${suffix}`;
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

// Un eje puede existir en las dos salas («objeciones»): se pinta por sala para no mezclar medias.
function AxisGroup({ title, rows }: { title: string; rows: Progress['axes'] }) {
  if (!rows.length) return null;
  return <section className="axis-room"><h3>{title}</h3><div className="table-wrap"><table className="data-table"><thead><tr><th scope="col">Eje</th><th scope="col">Nota</th></tr></thead><tbody>
    {rows.map(a => <tr key={`${a.track ?? 'sin'}:${a.axis}`}><th scope="row">{AXIS_LABELS[a.axis] ?? a.axis}</th><td>
      {a.count < MIN_AXIS_SAMPLES
        ? <><span className="num">—</span> <small>menos de {MIN_AXIS_SAMPLES} prácticas ({a.count})</small></>
        : <><div className="meter" role="progressbar" aria-label={`${AXIS_LABELS[a.axis] ?? a.axis} en ${title.toLowerCase()}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={a.avg}><span style={{ width: `${a.avg}%` }} /></div><span className="num">{a.avg}/100</span> <small>{a.count} prácticas</small></>}
    </td></tr>)}
  </tbody></table></div></section>;
}

// Barras verticales con base en 0; una semana sin prácticas se queda sin barra y con «—» (no es un cero).
function WeeklyBars({ weekly }: { weekly: Progress['weekly'] }) {
  const W = 300, H = 120, PAD = 24, slot = W / weekly.length, bar = Math.min(30, slot - 12); // viewBox estrecho: en una tarjeta de ~300 px el texto se ve a su tamaño real
  const filled = weekly.filter(w => w.avg !== null);
  const summary = filled.length ? `Nota media semanal de prácticas, últimas 6 semanas: ${filled.map(w => `${weekLabel(w.week)} ${w.avg}`).join(', ')}.` : 'Sin prácticas puntuadas en las últimas 6 semanas.';
  return <svg viewBox={`0 0 ${W} ${H + PAD}`} role="img" aria-label={summary} width="100%" style={{ maxWidth: 380, display: 'block' }}>
    <line x1="0" y1={H} x2={W} y2={H} stroke="var(--line)" strokeWidth="1" />
    <text x="0" y="10" fontSize="11" fill="var(--secondary)">100</text>
    {weekly.map((w, i) => { const h = w.avg === null ? 0 : Math.max(2, (w.avg / 100) * (H - 18)); const x = i * slot + (slot - bar) / 2; return <g key={w.week}>
      {w.avg !== null && <rect x={x} y={H - h} width={bar} height={h} rx="2" fill="var(--accent)"><title>{`Semana del ${weekLabel(w.week)}: ${w.avg} (${w.count} prácticas)`}</title></rect>}
      <text x={i * slot + slot / 2} y={w.avg === null ? H - 6 : H - h - 4} fontSize="11" fontWeight="600" textAnchor="middle" fill={w.avg === null ? 'var(--secondary)' : 'var(--ink)'}>{w.avg === null ? '—' : w.avg}</text>
      <text x={i * slot + slot / 2} y={H + 16} fontSize="11" textAnchor="middle" fill="var(--secondary)">{weekLabel(w.week)}</text>
    </g>; })}
  </svg>;
}

// La MISMA ficha para la alumna y para quien la acompaña. `endpoint` cambia quién la lee (la
// suya por sesión, la del panel por id de alumna) y `audience` cambia la voz, nunca los datos.
type Props = { endpoint?: string; audience?: 'student' | 'coach'; heading?: { eyebrow: string; title: string; lead: string } };
const DEFAULT_HEADING: Record<'student' | 'coach', { eyebrow: string; title: string; lead: string }> = {
  student: { eyebrow: 'TU CAMINO', title: 'Tu progreso.', lead: 'Lo que has practicado y estudiado en WDC, con tus propios datos. Nada se compara con otras alumnas.' },
  coach: { eyebrow: 'FICHA DE LA ALUMNA', title: 'Progreso de la alumna.', lead: 'Lo que ha practicado y estudiado, con sus datos. La lectura no compara alumnas.' },
};

export default function StudentProgress({ endpoint = '/api/student/progress', audience = 'student', heading }: Props = {}) {
  const coach = audience === 'coach';
  const [days, setDays] = useState<(typeof PERIODS)[number]>(30);
  const [state, setState] = useState<State>({ kind: 'loading' });
  const seq = useRef(0);
  const load = useCallback((period: number) => {
    const mine = ++seq.current; setState({ kind: 'loading' });
    fetch(`${endpoint}${endpoint.includes('?') ? '&' : '?'}days=${period}`, { cache: 'no-store' }).then(async response => {
      const data = await response.json().catch(() => ({})) as { progress?: Progress; metrics?: Metrics; retention?: Retention; detail?: string };
      if (mine !== seq.current) return; // respuesta vieja de otro periodo
      if (response.status === 401 || response.status === 503 && data.detail?.includes('no está configurado')) setState({ kind: 'login' });
      else if (!response.ok || !data.progress) setState({ kind: 'error', message: data.detail ?? 'No se pudo cargar tu progreso.' });
      else setState({ kind: 'ready', progress: data.progress, metrics: data.metrics ?? null, retention: data.retention ?? null });
    }).catch(() => { if (mine === seq.current) setState({ kind: 'error', message: 'No se pudo conectar. Revisa tu conexión.' }); });
  }, [endpoint]);
  useEffect(() => { load(days); }, [days, load]);
  const copy = heading ?? DEFAULT_HEADING[coach ? 'coach' : 'student'];

  return <section aria-label={coach ? 'Progreso de la alumna' : 'Tu progreso'} className="student-progress">
    <div className="page-heading"><div><span className="eyebrow">{copy.eyebrow}</span><h1>{copy.title}</h1><p>{copy.lead}</p></div></div>
    <div className="training-chips" role="group" aria-label="Periodo">{PERIODS.map(p => <button key={p} aria-pressed={days === p} onClick={() => setDays(p)}>Últimos {p} días</button>)}</div>
    {state.kind === 'loading' && <p className="card-meta" role="status"><LoaderCircle size={14} className="spin" /> {coach ? 'Cargando el progreso…' : 'Cargando tu progreso…'}</p>}
    {state.kind === 'login' && (coach
      ? <div className="empty"><h3>La sesión del panel ha caducado.</h3><p>Vuelve a entrar en el panel para leer esta ficha.</p></div>
      : <div className="empty"><h3>Entra con tu cuenta para guardar tu progreso.</h3><p>Puedes practicar y estudiar igualmente, pero solo queda registrado si has iniciado sesión.</p><a className="primary" href="/alumna">Iniciar sesión</a></div>)}
    {state.kind === 'error' && <div className="alert error" role="alert"><span>{state.message}</span><button onClick={() => load(days)}><RotateCw size={14} /> Reintentar</button></div>}
    {state.kind === 'ready' && <Ready progress={state.progress} metrics={state.metrics} retention={state.retention} coach={coach} />}
  </section>;
}

// Objetivos de la semana (lunes a domingo, Madrid) y avisos amables. Un dato que no se pudo leer es «—», no 0.
function ThisWeek({ retention: r, coach }: { retention: Retention; coach: boolean }) {
  const idle = r.nudge.level !== 'none' && r.nudge.idleDays !== null;
  return <article className="progress-card" data-testid="this-week"><h2>Esta semana</h2>
    {idle && <p className="card-meta" role="status">{coach
      ? (r.nudge.streakAtRisk ? `Su racha de ${r.nudge.streakAtRisk} ${r.nudge.streakAtRisk === 1 ? 'día' : 'días'} está en juego: ` : '') + `lleva ${r.nudge.idleDays} días sin practicar. No se le envía ningún aviso automático: la decisión de escribirla es tuya.`
      : `${r.nudge.streakAtRisk ? `Tu racha de ${r.nudge.streakAtRisk} ${r.nudge.streakAtRisk === 1 ? 'día' : 'días'} está en juego: ` : ''}llevas ${r.nudge.idleDays} días sin practicar. Con 5 minutos en la sala vuelves a la rutina.`}</p>}
    {r.review.eligible && <p className="card-meta" role="status">{coach
      ? <><strong>Sus tres últimas prácticas han quedado por debajo de 60.</strong> Es buen momento para revisarle una práctica directamente.</>
      : <><strong>Tus tres últimas prácticas han quedado por debajo de 60.</strong> Es normal al principio: pide a tu coordinadora que te revise una práctica directamente.</>}</p>}
    <ul className="plain-list">{r.goals.map(g => <li key={g.id}><span className={g.done ? 'status ok' : 'status'}>{g.done ? 'Hecho' : 'Pendiente'}</span> {g.label} · <strong>{g.current === null ? '—' : `${Math.min(g.current, g.target)}/${g.target}`}</strong>
      {g.current !== null && <div className="meter" role="progressbar" aria-label={g.label} aria-valuemin={0} aria-valuemax={g.target} aria-valuenow={Math.min(g.current, g.target)}><span style={{ width: `${Math.min(100, Math.round((g.current / g.target) * 100))}%` }} /></div>}</li>)}</ul>
    <p className="card-meta">Los objetivos son una guía para coger ritmo, no una evaluación.</p></article>;
}

function Ready({ progress: p, metrics, retention, coach }: { progress: Progress; metrics: Metrics | null; retention: Retention | null; coach: boolean }) {
  const empty = !p.lifetime.practice.count && !p.lifetime.training.modules.length && !p.lifetime.training.examBest;
  return <>
    {p.truncated && <p className="card-meta" role="status">Tienes tanta actividad que solo se han leído los últimos 5.000 movimientos: los totales pueden quedarse cortos.</p>}
    <div className="stat-strip" aria-label={`Resumen de los últimos ${p.days} días`}>
      <span><strong>{number.format(p.practice.count)}</strong>prácticas</span>
      <span><strong>{dash(p.practice.avg)}</strong>nota media</span>
      <span><strong>{dash(p.practice.best)}</strong>mejor nota</span>
      <span><strong>{number.format(p.sessions)}</strong>entradas</span>
      <span><strong><Flame size={14} aria-hidden="true" /> {number.format(p.streak.current)}</strong>{p.streak.current === 1 ? 'día seguido' : 'días seguidos'} (mejor racha: {number.format(p.streak.best)})</span>
    </div>
    {metrics && <Level xp={metrics.xp} />}
    {empty && <div className="empty"><h3>{coach ? 'Todavía no hay actividad.' : 'Aún no hay actividad.'}</h3><p>{coach ? 'No ha hecho ninguna práctica ni repasado un módulo todavía. Los totales de arriba son ceros reales.' : 'Haz tu primera práctica en la sala o repasa un módulo de Formación y aquí verás tu evolución.'}</p></div>}
    <div className="progress-grid">
      {retention && <ThisWeek retention={retention} coach={coach} />}
      <article className="progress-card"><h2>Evolución semanal</h2><p className="card-meta">Nota media de tus prácticas por semana (de lunes a domingo, hora de Madrid). Una semana sin prácticas se queda en «—».</p>
        <WeeklyBars weekly={p.weekly} />
        <details><summary>Ver como tabla</summary><div className="table-wrap"><table className="data-table"><thead><tr><th scope="col">Semana del</th><th scope="col" className="num">Prácticas</th><th scope="col" className="num">Nota media</th></tr></thead><tbody>{p.weekly.map(w => <tr key={w.week}><th scope="row">{weekLabel(w.week)}</th><td className="num">{w.count}</td><td className="num">{dash(w.avg)}</td></tr>)}</tbody></table></div></details></article>
      <article className="progress-card"><h2>{coach ? 'Competencias' : 'Tus competencias'}</h2><p className="card-meta">Media por eje en los últimos {p.days} días. Cada sala va por separado —closer, setter, frío y entrevista— y, con menos de {MIN_AXIS_SAMPLES} prácticas en un eje, se muestra «—»: dos datos no son una tendencia.</p>
        {p.axes.length ? <div className="axis-rooms">
          <AxisGroup title="Closer (voz)" rows={p.axes.filter(a => a.track === 'closer')} />
          <AxisGroup title="Setter (chat)" rows={p.axes.filter(a => a.track === 'setter')} />
          <AxisGroup title="Frío (voz)" rows={p.axes.filter(a => a.track === 'frio')} />
          <AxisGroup title="Entrevista (voz)" rows={p.axes.filter(a => a.track === 'entrevista')} />
          <AxisGroup title="Prácticas anteriores sin sala" rows={p.axes.filter(a => a.track === null)} />
        </div>
          : <p className="card-meta">— Todavía no hay prácticas puntuadas por eje en este periodo.</p>}</article>
      <article className="progress-card"><h2>Formación</h2><p className="card-meta">{p.lifetime.training.modules.length} de {REVIEW_REFS.length} módulos repasados (en total, no solo este periodo).</p>
        <ul className="plain-list">{REVIEW_REFS.map(ref => { const done = p.lifetime.training.modules.includes(ref); return <li key={ref}><span className={done ? 'status ok' : 'status'}>{done ? 'Repasado' : 'Pendiente'}</span> {REVIEW_LABELS[ref] ?? ref}</li>; })}</ul>
        <p className="card-meta"><strong>Examen de egreso:</strong> {p.lifetime.training.examBest === null ? '— sin intentar' : `mejor nota ${p.lifetime.training.examBest}/100 (${p.lifetime.training.examPassed ? 'superado' : 'no superado'}, ${p.lifetime.training.examAttempts} ${p.lifetime.training.examAttempts === 1 ? 'intento' : 'intentos'})`}. Es una señal de uso, no una certificación oficial.</p></article>
      {metrics && <article className="progress-card"><h2>Maestría por escenario</h2><p className="card-meta">{coach ? 'Su' : 'Tu'} nota media en cada práctica de la sala (de siempre, no solo este periodo). Es una estimación del modelo.</p>
        {metrics.mastery.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th scope="col">Escenario</th><th scope="col" className="num">Veces</th><th scope="col" className="num">Media</th><th scope="col" className="num">Mejor</th></tr></thead>
          <tbody>{metrics.mastery.map(m => <tr key={m.ref}><th scope="row">{scenarioById(m.ref)?.title ?? m.ref}</th><td className="num">{m.count}</td><td className="num">{m.avg}</td><td className="num">{m.best}</td></tr>)}</tbody></table></div>
          : <p className="card-meta">— Aún no hay prácticas con nota.</p>}</article>}
      {metrics && <article className="progress-card"><h2>Mis candidaturas</h2>
        {metrics.applications ? <><p className="card-meta">{coach ? 'Lo que ha anotado ella' : 'Lo que has anotado tú'}: la app no recibe las respuestas de las empresas.</p>
          <dl className="kv"><div><dt>Enviadas</dt><dd>{metrics.applications.sent}</dd></div><div><dt>Con respuesta</dt><dd>{metrics.applications.responded}</dd></div>
            <div><dt>Tasa de respuesta</dt><dd>{metrics.applications.responseRate === null ? '— (aún no has enviado ninguna)' : `${metrics.applications.responseRate} %`}</dd></div>
            <div><dt>Entrevistas</dt><dd>{metrics.applications.interviews}</dd></div><div><dt>Ofertas</dt><dd>{metrics.applications.offers}</dd></div></dl>
          {metrics.applications_truncated && <p className="card-meta" role="status">Tienes más de 10.000 candidaturas anotadas: estas cifras son parciales.</p>}</>
          : <p className="card-meta">— {coach ? 'No se pudieron leer sus candidaturas ahora mismo.' : 'No se pudieron leer tus candidaturas ahora mismo.'}</p>}</article>}
      <article className="progress-card"><h2><Award size={16} aria-hidden="true" /> Logros</h2>
        <ul className="achievements">{p.lifetime.achievements.map(a => <li key={a.id} data-on={a.unlocked}><strong>{a.label}</strong><br /><small>{a.unlocked ? 'Conseguido' : 'Por conseguir'}</small></li>)}</ul></article>
    </div>
    <h2 className="progress-heading">Actividad reciente</h2>
    {p.recent.length ? <div className="table-wrap"><table className="data-table"><thead><tr><th scope="col">Fecha</th><th scope="col">Qué</th><th scope="col">Detalle</th><th scope="col" className="num">Nota</th></tr></thead><tbody>{p.recent.map((r, i) => <tr key={r.id ?? i}>
      <td>{dateFmt.format(new Date(r.created_at))}</td><td>{KIND_LABELS[r.kind] ?? r.kind}</td>
      <td>{r.kind === 'training_review' ? `${REVIEW_LABELS[r.ref ?? ''] ?? r.ref}: ${r.detail.met}/${r.detail.total} criterios` : r.kind === 'training_exam' ? (r.detail.passed ? 'Superado' : 'No superado') : r.kind === 'practice' ? `${scenarioById(r.ref ?? '')?.title ?? r.ref ?? 'Práctica'}${r.detail.mode === 'voz' ? ' · por voz' : ''}${typeof r.detail.duration_s === 'number' ? ` · ${clock(r.detail.duration_s)}` : ''}` : null}</td>
      <td className="num">{dash(r.score)}</td></tr>)}</tbody></table></div>
      : <p className="card-meta">— Nada en los últimos {p.days} días.</p>}
  </>;
}

// Nivel y XP: derivados de lo que has hecho, no de un contador que se pueda inflar. Siempre con su desglose.
function Level({ xp }: { xp: XpResult }) {
  const span = xp.next === null ? 1 : xp.next - xp.floor, done = xp.next === null ? 1 : (xp.xp - xp.floor) / span;
  return <div className="level-card" data-testid="level">
    <div><strong>Nivel {xp.level}</strong> · {number.format(xp.xp)} XP{xp.next === null ? ' (nivel máximo)' : ` · te faltan ${number.format(xp.next - xp.xp)} para el nivel ${xp.level + 1}`}</div>
    <div className="meter" role="progressbar" aria-label="Progreso hacia el siguiente nivel" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(done * 100)}><span style={{ width: `${Math.round(done * 100)}%` }} /></div>
    <details><summary>Cómo se calcula</summary><div className="table-wrap"><table className="data-table"><thead><tr><th scope="col">Qué cuenta</th><th scope="col" className="num">XP</th></tr></thead>
      <tbody>{xp.parts.map(part => <tr key={part.id}><th scope="row">{part.label}</th><td className="num">{part.xp}</td></tr>)}</tbody></table></div>
      <p className="card-meta">Máximo tres prácticas por día para sumar XP. Los borradores de candidatura no suman.</p></details>
  </div>;
}
