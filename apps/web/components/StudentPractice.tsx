'use client';

import { logActivity } from './studentActivityClient';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BriefcaseBusiness, Check, CircleAlert, Clock3, Gauge, LoaderCircle, MessageSquare, Mic, MicOff, Phone, Play, Quote, RotateCcw, ScanLine, Send, ShieldCheck, Sparkles, Target, Users, Volume2 } from 'lucide-react';
import { INTENSITY_LABELS, PRACTICE_SCENARIOS, TRACK_CHANNEL, categoriesFor, scenarioById } from './practiceScenarios';
import type { PracticePersona, PracticeScenario, PracticeTrack } from './practiceScenarios';
import StudentQualificationForm from './StudentQualificationForm';
import CallReview from './CallReview';
import JarvisOrb from './JarvisOrb';
import type { OrbState } from './JarvisOrb';
import { useVoiceInput } from './useVoiceInput';
import { isEcho } from '../lib/voiceEcho';
import { analyzeSignals } from '../app/api/practice/signals';
import { MIN_AXIS_SAMPLES, nextPractice, type NextPracticeChoice } from '../lib/nextPractice';
import { AXIS_LABELS } from '../lib/practiceAxes';
import { BANT_LABELS, DECISION_LABELS, type PracticeBant } from '../lib/practiceRubrics';
import type { Progress } from '../lib/studentActivity';

// Por qué esa práctica y no otra: los tres criterios salen de sus datos (eje flojo, categoría menos
// practicada y días sin practicar), sin azar y sin IA.
function nextReason(choice: NextPracticeChoice, labels: Record<string, string>): string {
  const parts: string[] = [];
  parts.push(choice.days === null ? 'Todavía no has hecho ninguna práctica.'
    : choice.days === 0 ? 'Hoy ya has practicado, pero esta es la que más te conviene ahora.'
    : `Llevas ${choice.days} ${choice.days === 1 ? 'día' : 'días'} sin practicar.`);
  parts.push(choice.weakest
    ? `Tu eje más flojo es «${labels[choice.weakest.axis] ?? choice.weakest.axis}» (${choice.weakest.avg}/100 en ${choice.weakest.count} prácticas).`
    : `Aún no hay ${MIN_AXIS_SAMPLES} prácticas con nota por eje: empieza por lo que menos has tocado.`);
  const label = categoriesFor(choice.track).find(item => item.id === choice.category)?.label ?? choice.category;
  parts.push(choice.categoryCount === 0 ? `«${label}» todavía no la has practicado.` : `«${label}» es la que menos has practicado (${choice.categoryCount} ${choice.categoryCount === 1 ? 'vez' : 'veces'}).`);
  return parts.join(' ');
}

type Turn = { role: 'user' | 'coach'; content: string };
type Axis = { id: string; label: string; score: number; note: string; quote: string };
type Signal = { id: string; label: string; detail: string; quote: string };
type Debrief = {
  summary: string;
  focus?: string;
  strengths: string[];
  improvements: string[];
  // Las prácticas anteriores al método guardaban solo momentos citados.
  moments?: { quote: string; why: string }[];
  axes?: Axis[];
  score?: number;
  // Auditoría BANT de las salas de venta (rúbrica de `analisis-llamadas-ventas`).
  bant?: PracticeBant;
  signals?: Signal[];
  model?: string;
  next: string;
  scenario?: string;
};

const band = (score: number) => score >= 70 ? 'alto' : score >= 40 ? 'medio' : 'bajo';
type Stored = { id: string; scenarioId: string; title: string; startedAt: number; turns: number; debrief: Debrief };
type View = 'scenarios' | 'room' | 'debrief' | 'formulario' | 'review';
const KIND_TEXT: Record<PracticeScenario['kind'], string> = { venta: 'VENTA', setter: 'SETTER', frio: 'LLAMADA EN FRÍO', entrevista: 'ENTREVISTA' };

const HISTORY_KEY = 'wdc_practice_history';
// Una candidatura de su tablero: el id es lo único que se manda al servidor; el anuncio y el
// formulario los resuelve él (la página no ve el contexto que va al modelo).
type Prepared = { id: string; offer_title: string; offer_company: string | null };
// Reto asignado por la coordinadora: el estado llega calculado del servidor con la actividad real.
type AssignedChallenge = {
  id: string; scenario_id: string; min_score: number | null; due_on: string; coach_note: string;
  status: 'pending' | 'completed' | 'missed' | 'unknown'; attempts: number | null; best_score: number | null;
  qualifying_score: number | null; completed_at: string | null; late: boolean;
};
const challengeDay = (iso: string) => new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', timeZone: 'Europe/Madrid' }).format(new Date(`${iso}T12:00:00Z`));
const challengeMoment = (iso: string) => new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }).format(new Date(iso));
function challengeStatusText(c: AssignedChallenge): string {
  if (c.status === 'completed') return `Completado${c.qualifying_score !== null ? ` con ${c.qualifying_score}/100` : ''}${c.completed_at ? ` el ${challengeMoment(c.completed_at)}` : ''} · plazo ${challengeDay(c.due_on)}.`;
  if (c.status === 'missed') return c.late ? 'Fuera de plazo: alcanzaste la nota después de la fecha límite.' : 'Fuera de plazo: no hay una práctica que cumpla el reto.';
  if (c.status === 'unknown') return '— No se pudo leer tu actividad: el estado no se puede saber ahora mismo.';
  return c.attempts ? `Pendiente · ${c.attempts} ${c.attempts === 1 ? 'intento' : 'intentos'}${c.best_score !== null ? ` · mejor ${c.best_score}/100` : ''}.` : 'Pendiente · todavía sin intentos.';
}
type OfferSession = { applicationId: string; title: string; company: string | null; includeProfile: boolean };
// La ruta acepta 24 turnos por petición. La sala corta antes para que el feedback
// siempre quepa: sin este tope, una conversación larga acababa en 422 y no había
// forma de cerrarla ni de recibir nota.
const TURN_LIMIT = 20;
const clock = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
const when = (value: number) => new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(value));

function Bubble({ turn, onSpeak }: { turn: Turn; onSpeak?: (text: string) => void }) {
  const mine = turn.role === 'user';
  return <div className={`practice-turn ${mine ? 'is-mine' : 'is-them'}`}>
    <div className="practice-bubble">
      <p>{turn.content}</p>
      {!mine && onSpeak && <button type="button" className="speak" onClick={() => onSpeak(turn.content)}><Volume2 size={13} />Escuchar</button>}
    </div>
  </div>;
}

// Cuatro salas por rol y un test de formulario. Todo es ficticio y se dice; el feedback cita
// solo frases literales de la alumna (validadas en servidor) y se apoya en el método de WDC.
// Closer, frío y entrevista son salas de VOZ; el setter practica por CHAT, que es donde trabaja.
const TRACK_TEXT: Record<PracticeTrack, { nav: string; eyebrow: string; title: string; lead: string; categoriesLabel: string }> = {
  closer: {
    nav: 'Closer · voz',
    eyebrow: 'SALA DE VOZ · CLOSER',
    title: 'Ensaya la llamada de cierre.',
    lead: 'Un cliente simulado al otro lado. Habla en voz alta: el dictado escribe lo que dices y tú decides cuándo enviarlo. Recibes feedback sobre lo que has dicho.',
    categoriesLabel: 'Momento de la llamada',
  },
  setter: {
    nav: 'Setter · chat',
    eyebrow: 'SALA DE CHAT · SETTER',
    title: 'Abre conversaciones y agenda la llamada.',
    lead: 'Un lead simulado por chat, como en WhatsApp o un mensaje directo. Practicas el primer mensaje, las tres preguntas de cualificación (urgencia, autoridad y recursos) y la cita con el closer.',
    categoriesLabel: 'Momento del setter',
  },
  frio: {
    nav: 'Frío · voz',
    eyebrow: 'SALA DE VOZ · LLAMADA EN FRÍO',
    title: 'Aguanta los primeros treinta segundos.',
    lead: 'Una llamada que nadie espera. Habla en voz alta: practicas el motivo en una frase, la pregunta que abre la conversación y la cita con día y hora. Aquí el objetivo es la reunión, no la venta.',
    categoriesLabel: 'Lo que cuesta la llamada',
  },
  entrevista: {
    nav: 'Entrevista · voz',
    eyebrow: 'SALA DE VOZ · ENTREVISTA',
    title: 'Practica con cada tipo de entrevistador.',
    lead: 'Un entrevistador simulado, del dueño directo a dirección o Recursos Humanos. Elige su estilo y ensaya tus respuestas hablando: el dictado las escribe para que las corrijas.',
    categoriesLabel: 'Tipo de entrevistador',
  },
};
const TRACK_ICONS: Record<PracticeTrack, typeof Phone> = { closer: Phone, setter: MessageSquare, frio: Phone, entrevista: Users };

// «Carita» del personaje con las iniciales, en un solo sitio para la tarjeta y la sala.
export function PersonaFace({ persona, size = 'md' }: { persona: PracticePersona; size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`persona-face is-${persona.tone} size-${size}`} aria-hidden="true">{persona.initials}</span>;
}

export default function StudentPractice({ track, mode = 'roleplay', onTrackChange }: { track: PracticeTrack; mode?: 'roleplay' | 'entrevista' | 'review'; onTrackChange: (track: PracticeTrack) => void }) {
  const [category, setCategory] = useState<string>('todas');
  const [view, setView] = useState<View>('scenarios');
  const [scenario, setScenario] = useState<PracticeScenario | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [debrief, setDebrief] = useState<Debrief | null>(null);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [history, setHistory] = useState<Stored[]>([]);
  const [canSpeak, setCanSpeak] = useState(false);
  const [prepared, setPrepared] = useState<Prepared[]>([]);
  const [preparedId, setPreparedId] = useState('');
  const [canUseProfile, setCanUseProfile] = useState(false);
  const [useProfile, setUseProfile] = useState(false);
  const [offerSession, setOfferSession] = useState<OfferSession | null>(null);
  const [next, setNext] = useState<NextPracticeChoice<PracticeScenario> | null>(null);
  const [challenges, setChallenges] = useState<AssignedChallenge[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>(AXIS_LABELS);
  const [speaking, setSpeaking] = useState(false);
  // Lo que el interlocutor está leyendo ahora: sirve para distinguir una interrupción real del eco de sus altavoces.
  const spoken = useRef<string | null>(null);
  const currentUtterance = useRef<SpeechSynthesisUtterance | null>(null);
  function stopSpeaking() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    currentUtterance.current = null;
    window.speechSynthesis.cancel();
    spoken.current = null;
    setSpeaking(false);
  }
  // Dictado del navegador: lo que se reconoce se añade al borrador, nunca se envía solo.
  // Si en esta sesión ha dictado algo, la práctica se registra como «voz»: el modo es el que usó, no el que tocaba.
  const usedVoice = useRef(false);
  const voice = useVoiceInput(text => { usedVoice.current = true; setDraft(current => current.trim() ? `${current.trimEnd()} ${text}` : text); }, {
    onHeard: heard => { if (spoken.current && !isEcho(heard, spoken.current)) stopSpeaking(); },
    accept: heard => !isEcho(heard, spoken.current),
  });
  const chat = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? '[]');
      if (Array.isArray(stored)) setHistory(stored.filter((item): item is Stored => Boolean(item?.id && item?.title)));
    } catch { /* almacenamiento no disponible: la práctica sigue funcionando sin historial */ }
    setCanSpeak(typeof window !== 'undefined' && 'speechSynthesis' in window);
  }, []);
  // Candidaturas del tablero para practicar una oferta concreta. Sin sesión no hay panel: la sala
  // genérica sigue funcionando igual. El permiso del formulario base lo decide el servidor también.
  useEffect(() => {
    fetch('/api/student/applications', { cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then((data: { applications?: Prepared[] } | null) => { if (Array.isArray(data?.applications)) setPrepared(data.applications); })
      .catch(() => undefined);
    fetch('/api/student/application-profile', { cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then((data: { profile?: { autofill_consent_at?: string | null } | null } | null) => setCanUseProfile(Boolean(data?.profile?.autofill_consent_at)))
      .catch(() => undefined);
    // «Tu siguiente práctica»: se calcula con su progreso real. Sin sesión o sin lectura no se muestra;
    // nunca se rellena con una recomendación inventada.
    fetch('/api/student/progress?days=90', { cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then((data: { progress?: Progress; metrics?: { mastery?: { ref: string; count: number }[] } } | null) => {
        if (!data?.progress) return;
        setNext(nextPractice(PRACTICE_SCENARIOS, {
          axes: data.progress.axes ?? [],
          mastery: data.metrics?.mastery ?? [],
          lastPracticeAt: data.progress.last_practice_at ?? null,
        }));
      })
      .catch(() => undefined);
    // Retos de su coach. Si la tabla aún no está migrada el servidor lo declara (`available:false`) y no
    // se pinta la tarjeta: nunca se enseña «ningún reto» cuando en realidad no se pudo leer.
    // El panel puede renombrar un eje: el mismo nombre que usa la nota, también en «tu siguiente práctica».
    fetch('/api/practice', { cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then((data: { labels?: Record<string, string> } | null) => { if (data?.labels) setLabels(current => ({ ...current, ...data.labels })); })
      .catch(() => undefined);
    fetch('/api/student/challenges', { cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then((data: { available?: boolean; challenges?: AssignedChallenge[] | null } | null) => {
        if (data?.available && Array.isArray(data.challenges)) setChallenges(data.challenges);
      })
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    if (view !== 'room') return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [view]);
  useEffect(() => {
    chat.current?.scrollTo({ top: chat.current.scrollHeight, behavior: 'smooth' });
  }, [turns, busy]);

  const studentTurns = useMemo(() => turns.filter(turn => turn.role === 'user').length, [turns]);
  // Señales «en vivo»: las MISMAS reglas deterministas del feedback final (analyzeSignals), calculadas en el navegador sobre lo
  // dicho hasta ahora. Sin IA, sin red y sin guardar nada; no sustituyen al feedback ni puntúan.
  const liveSignals = useMemo(() => scenario && studentTurns > 0 ? analyzeSignals(turns, scenario.kind) : [], [turns, scenario, studentTurns]);
  const elapsed = startedAt ? Math.max(0, Math.round((now - startedAt) / 1000)) : 0;
  const atLimit = turns.length >= TURN_LIMIT;
  // Quien tiene la palabra manda: si el interlocutor está leyendo, el orbe dice «hablando» aunque el micrófono esté abierto para interrumpir.
  const orb: OrbState = speaking ? 'speaking' : voice.listening ? 'listening' : busy ? 'thinking' : 'idle';

  function saveHistory(next: Stored[]) {
    setHistory(next);
    try { window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next.slice(0, 8))); } catch { /* sin historial */ }
  }
  function speak(text: string) {
    if (!canSpeak) return;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'es-ES';
    utterance.onstart = () => setSpeaking(true);
    // El fin de una locución cancelada llega tarde: solo cuenta si sigue siendo la actual.
    const done = () => { if (currentUtterance.current !== utterance) return; currentUtterance.current = null; spoken.current = null; setSpeaking(false); };
    utterance.onend = done;
    utterance.onerror = done;
    currentUtterance.current = null;
    window.speechSynthesis.cancel();
    currentUtterance.current = utterance;
    spoken.current = text;
    window.speechSynthesis.speak(utterance);
  }
  function begin(item: PracticeScenario, offer: OfferSession | null = null) {
    stopSpeaking();
    setError('');
    setScenario(item);
    setOfferSession(offer);
    setTurns([{ role: 'coach', content: item.opening }]);
    setDebrief(null);
    setDraft('');
    usedVoice.current = false;
    setStartedAt(Date.now());
    setNow(Date.now());
    setView('room');
  }
  // La candidatura viaja como id: el servidor comprueba que es suya y resuelve el anuncio y el
  // formulario. La página nunca manda el texto de la oferta ni sus datos personales.
  async function post(body: Record<string, unknown>) {
    const payload = offerSession ? { ...body, application_id: offerSession.applicationId, include_profile: offerSession.includeProfile } : body;
    const response = await fetch('/api/practice', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await response.json().catch(() => ({})) as { detail?: string };
    if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'No se ha podido completar la práctica.');
    return data as { reply?: string; debrief?: Debrief };
  }
  async function send(event?: React.FormEvent) {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || !scenario || busy || turns.length >= TURN_LIMIT) return;
    const next: Turn[] = [...turns, { role: 'user', content: text }];
    setTurns(next); setDraft(''); setBusy(true); setError('');
    try {
      const data = await post({ scenario: scenario.id, messages: next, mode: 'reply' });
      setTurns(current => [...current, { role: 'coach', content: String(data.reply ?? '').trim() || 'No he recibido respuesta. Vuelve a intentarlo.' }]);
    } catch (exception) {
      setError((exception as Error).message);
    } finally {
      setBusy(false);
      requestAnimationFrame(() => composer.current?.focus());
    }
  }
  async function finish() {
    if (!scenario || busy) return;
    setBusy(true); setError('');
    try {
      const data = await post({ scenario: scenario.id, messages: turns, mode: 'debrief' });
      if (!data.debrief) throw new Error('No se ha recibido feedback. Vuelve a intentarlo.');
      setDebrief(data.debrief);
      setView('debrief');
      // Alimenta «Mi progreso» (solo con sesión; sin ella la práctica sigue igual). Se guarda la nota y la de cada eje, no el texto.
      if (typeof data.debrief.score === 'number') void logActivity({ kind: 'practice', ref: scenario.id, score: Math.max(0, Math.min(100, Math.round(data.debrief.score))), detail: { mode: usedVoice.current ? 'voz' : 'texto', duration_s: Math.min(7200, Math.max(1, Math.round((Date.now() - startedAt) / 1000))), axes: Object.fromEntries((data.debrief.axes ?? []).map(axis => [axis.id, Math.max(0, Math.min(100, Math.round(axis.score)))])) } });
      saveHistory([{ id: crypto.randomUUID?.() ?? String(Date.now()), scenarioId: scenario.id, title: scenario.title, startedAt, turns: studentTurns, debrief: data.debrief }, ...history]);
    } catch (exception) {
      setError((exception as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function startPrepared(kind: 'entrevista' | 'closer') {
    const application = prepared.find(item => item.id === preparedId);
    const item = scenarioById(kind === 'entrevista' ? 'entrevista-closer' : 'llamada-completa');
    if (!application || !item) return;
    onTrackChange(kind);
    begin(item, { applicationId: application.id, title: application.offer_title, company: application.offer_company, includeProfile: useProfile && canUseProfile });
  }

  if (view === 'formulario') return <div className="practice"><StudentQualificationForm onBack={() => setView('scenarios')} /></div>;
  // La revisión de una llamada es su propia entrada del menú: dentro de la práctica solo se llega por esa
  // sección, no como una pestaña más de las salas.
  if (mode === 'review' || view === 'review') return <div className="practice"><CallReview onBack={() => onTrackChange('closer')} /></div>;

  if (view === 'room' && scenario) {
    const voiceRoom = TRACK_CHANNEL[scenario.track] === 'voz';
    return <section className="practice practice-room">
      <div className="practice-room-head">
        <button className="practice-back" type="button" onClick={() => { setView('scenarios'); setScenario(null); setOfferSession(null); setTurns([]); }}><ArrowLeft size={16} />Salir</button>
        <div>
          <span className="eyebrow">{offerSession ? 'SIMULACRO · TU CANDIDATURA' : `SIMULACRO · ${KIND_TEXT[scenario.kind]} · ${INTENSITY_LABELS[scenario.intensity].toUpperCase()}`}</span>
          <h1>{offerSession ? offerSession.title : scenario.title}</h1>
          <p>{offerSession ? `${offerSession.company ?? 'Empresa no indicada'} · Conversación basada en el anuncio público que estás trabajando.` : scenario.context}</p>
        </div>
        <div className="practice-clock" role="timer" aria-label={`Tiempo de práctica: ${clock(elapsed)}`}><Clock3 size={15} /><span>{clock(elapsed)}</span></div>
      </div>
      <div className="practice-grid">
        <div className="practice-chat">
          <div className="practice-chat-head"><PersonaFace persona={scenario.persona} /><div><strong>{scenario.persona.name}</strong><small>{scenario.persona.role} · simulación</small></div>{voiceRoom
            ? <div className="practice-voice"><JarvisOrb state={orb} /><small>{orb === 'listening' ? 'Te escucho' : orb === 'thinking' ? 'Pensando' : orb === 'speaking' ? 'Hablando' : 'Voz en espera'}</small></div>
            : <div className="practice-voice is-chat"><MessageSquare size={17} /><small>Chat simulado</small></div>}</div>
          <div className="practice-body" ref={chat} aria-live="polite">
            {turns.map((turn, index) => <Bubble key={`${index}-${turn.role}`} turn={turn} onSpeak={canSpeak && turn.role === 'coach' ? speak : undefined} />)}
            {busy && <div className="practice-turn is-them"><div className="practice-bubble is-typing" role="status" aria-label="El interlocutor está escribiendo"><i /><i /><i /></div></div>}
          </div>
          {error && <p className="practice-error" role="alert"><CircleAlert size={15} />{error}</p>}
          {voice.error && <p className="practice-error" role="alert"><CircleAlert size={15} />{voice.error}</p>}
          <form className="practice-composer" onSubmit={send}>
            <label htmlFor="practice-reply" className="sr-only">Tu respuesta</label>
            {voice.supported && <button type="button" className="practice-mic" data-listening={voice.listening} aria-pressed={voice.listening} onClick={() => voice.listening ? voice.stop() : voice.start()} disabled={busy || atLimit} aria-label={voice.listening ? 'Parar el dictado' : 'Dictar la respuesta'} title={voice.listening ? 'Parar el dictado' : 'Dictar la respuesta'}>{voice.listening ? <MicOff size={17} /> : <Mic size={17} />}</button>}
            <textarea ref={composer} id="practice-reply" value={draft} onChange={event => { if (spoken.current) stopSpeaking(); setDraft(event.target.value); }} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) void send(event); }} placeholder={atLimit ? 'La conversación ha llegado a su final.' : voice.interim || (voiceRoom ? 'Habla y dicta tu respuesta, o escríbela como lo dirías…' : 'Escribe como en WhatsApp: un mensaje, una pregunta…')} rows={2} maxLength={800} disabled={busy || atLimit} />
            <button className="primary" type="submit" disabled={busy || atLimit || !draft.trim()} aria-label="Enviar respuesta">{busy ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />}Enviar</button>
          </form>
          <div className="practice-finish">
            <button type="button" onClick={() => void finish()} disabled={busy || studentTurns < 2}><Sparkles size={16} />Terminar y ver feedback</button>
            <small>{atLimit ? 'Habéis llegado al final de la simulación: pide el feedback para cerrar la práctica.' : studentTurns < 2 ? 'Responde al menos dos veces para recibir feedback.' : 'El feedback cita solo lo que has escrito.'}</small>
          </div>
        </div>
        <aside className="practice-aside">
          <h2>Lo que practicas</h2>
          <ol>{scenario.objectives.map(objective => <li key={objective}>{objective}</li>)}</ol>
          {studentTurns > 0 && <div className="practice-live" data-testid="live-signals" aria-live="polite">
            <h3><Gauge size={14} />Señales hasta ahora</h3>
            {liveSignals.length
              ? <ul>{liveSignals.map(signal => <li key={signal.id}><strong>{signal.label}</strong>{signal.quote && <q>{signal.quote}</q>}</li>)}</ul>
              : <p>Ninguna por ahora. Sigue así.</p>}
            <small>Posibles, calculadas sin IA con tus frases. El feedback final decide.</small>
          </div>}
          {offerSession && <div className="practice-hint"><BriefcaseBusiness size={16} /><p>Practicas para {offerSession.title}{offerSession.company ? ` en ${offerSession.company}` : ''}. El anuncio es público; lo que no publica, no se inventa.</p></div>}
          <div className="practice-hint"><MessageSquare size={16} /><p>{voiceRoom ? 'Habla como en la llamada real: frases cortas, una pregunta cada vez. El dictado escribe lo que dices; tú decides cuándo enviarlo.' : 'Escribe como en WhatsApp: una o dos frases y una sola pregunta por mensaje. Un párrafo largo se contesta tarde.'}</p></div>
          <div className="practice-hint"><Target size={16} /><p>No hay respuestas perfectas. Si te bloqueas, pide contexto o propón un siguiente paso.</p></div>
          <p className="practice-note">Empresa y personas son ficticias. Esta práctica no envía nada a ninguna empresa.</p>
        </aside>
      </div>
    </section>;
  }

  if (view === 'debrief' && debrief) {
    return <section className="practice practice-debrief">
      <button className="practice-back" type="button" onClick={() => { setView('scenarios'); setScenario(null); setOfferSession(null); setDebrief(null); }}><ArrowLeft size={16} />Volver a las situaciones</button>
      <span className="eyebrow">FEEDBACK DE PRÁCTICA</span>
      <h1>Qué ha funcionado y qué pulir.</h1>
      <p className="practice-summary">{debrief.summary}</p>
      {offerSession && <p className="card-meta">Práctica de tu candidatura: {offerSession.title}{offerSession.company ? ` · ${offerSession.company}` : ''}.</p>}
      {typeof debrief.score === 'number' && debrief.axes?.length ? <div className="practice-score">
        <div className="practice-score-total" data-band={band(debrief.score)}>
          <Gauge size={16} />
          <b>{debrief.score}</b>
          <span>/100</span>
          <small>estimación</small>
        </div>
        <div className="practice-score-detail">
          <div className="practice-score-head"><h2>{`Los ${debrief.axes.length} criterios`}</h2><small>Media ponderada según la rúbrica. No es una nota oficial.</small></div>
          <dl className="practice-axes">
            {debrief.axes.map(axis => <div className="practice-axis" key={axis.id}>
              <dt><span>{axis.label}</span><b data-band={band(axis.score)}>{axis.score}</b></dt>
              <div className="practice-bar" role="meter" aria-valuenow={axis.score} aria-valuemin={0} aria-valuemax={100} aria-label={`${axis.label}: ${axis.score} de 100`}><i data-band={band(axis.score)} style={{ width: `${axis.score}%` }} /></div>
              {axis.note && <dd>{axis.note}</dd>}
              {axis.quote && <blockquote>«{axis.quote}»</blockquote>}
            </div>)}
          </dl>
        </div>
      </div> : null}
      {debrief.bant && <div className="practice-bant">
        <span className="eyebrow">CUALIFICACIÓN DE LA LLAMADA · BANT</span>
        <dl className="practice-bant-grid">
          {(['budget', 'authority', 'need', 'timing'] as const).map(letter => {
            const item = debrief.bant![letter];
            return <div key={letter}>
              <dt><b>{item.status}</b> {BANT_LABELS[letter]}</dt>
              {item.quote && <dd>«{item.quote}»</dd>}
            </div>;
          })}
        </dl>
        <p className="practice-bant-decision"><strong>Decisión:</strong> {DECISION_LABELS[debrief.bant.decision]}</p>
      </div>}
      {debrief.focus && <div className="practice-focus"><span className="eyebrow">LA CORRECCIÓN PRIORITARIA · UNA SOLA</span><p>{debrief.focus}</p></div>}
      <div className="practice-columns">
        <div><h2><Check size={17} />Qué has hecho bien</h2><ul>{debrief.strengths.map(item => <li key={item}>{item}</li>)}</ul></div>
        <div><h2><Target size={17} />Qué pulir</h2><ul>{debrief.improvements.map(item => <li key={item}>{item}</li>)}</ul></div>
      </div>
      {debrief.signals?.length ? <div className="practice-signals">
        <h2><Gauge size={17} />Señales de estilo</h2>
        <p className="practice-signals-note">Calculadas sobre tus mensajes, sin IA. Son observaciones, no una nota.</p>
        <ul>{debrief.signals.map(signal => <li key={signal.id}>
          <strong>{signal.label}</strong>
          <p>{signal.detail}</p>
          {signal.quote && <blockquote>«{signal.quote}»</blockquote>}
        </li>)}</ul>
      </div> : null}
      {debrief.model && <div className="practice-model"><span className="eyebrow">CÓMO PODRÍA SONAR</span><p>{debrief.model}</p><small>Una forma posible con tus propias palabras. No es la única respuesta.</small></div>}
      {!debrief.axes?.length && debrief.moments?.length ? <div className="practice-moments">
        <h2><Quote size={17} />Momentos de la conversación</h2>
        {debrief.moments.map(moment => <figure key={moment.quote}><blockquote>«{moment.quote}»</blockquote><figcaption>{moment.why}</figcaption></figure>)}
      </div> : null}
      <div className="practice-next"><span className="eyebrow">SIGUIENTE PRÁCTICA</span><p>{debrief.next}</p></div>
      <div className="practice-actions">
        <button type="button" onClick={() => scenario && begin(scenario, offerSession)}><RotateCcw size={16} />Repetir esta situación</button>
        <button className="primary" type="button" onClick={() => { setView('scenarios'); setScenario(null); setOfferSession(null); setDebrief(null); }}>Elegir otra situación<ArrowRight size={16} /></button>
      </div>
      <p className="practice-note">El feedback y la puntuación los estima un modelo de IA a partir de tu conversación; la puntuación no es una nota oficial. Es un simulacro: no evalúa tu candidatura ni decide nada sobre ningún proceso. Tu texto se envía a un proveedor de IA: no escribas datos personales de terceros (<a href="/privacidad">Privacidad</a> · <a href="/terminos">Términos</a>).</p>
    </section>;
  }

  const text = TRACK_TEXT[track];
  const categories = categoriesFor(track);
  const pool = PRACTICE_SCENARIOS.filter(item => item.track === track);
  // Cambiar de sala (o de Práctica a Entrevistas) no arrastra un filtro de categoría que ya no existe ahí.
  const activeCategory = categories.some(item => item.id === category) ? category : 'todas';
  const shown = activeCategory === 'todas' ? pool : pool.filter(item => item.category === activeCategory);
  return <section className="practice">
    <div className="practice-head">
      <div>
        <span className="eyebrow">{text.eyebrow}</span>
        <h1>{text.title}</h1>
        <p>{text.lead}</p>
      </div>
      <span className="practice-icon">{track === 'entrevista' ? <Users size={26} strokeWidth={1.4} /> : track === 'setter' ? <MessageSquare size={26} strokeWidth={1.4} /> : <Phone size={26} strokeWidth={1.4} />}</span>
    </div>
    <div className="practice-rooms" role="tablist" aria-label="Salas de práctica">
      {(mode === 'entrevista' ? ['entrevista'] as PracticeTrack[] : ['closer', 'setter', 'frio'] as PracticeTrack[]).map(item => {
        const Icon = TRACK_ICONS[item];
        return <button key={item} type="button" role="tab" aria-selected={track === item && view === 'scenarios'} className={`practice-room-tab ${track === item && view === 'scenarios' ? 'is-active' : ''}`} onClick={() => { onTrackChange(item); setCategory('todas'); setView('scenarios'); }}>
          <Icon size={16} />{TRACK_TEXT[item].nav}
        </button>;
      })}
      {mode !== 'entrevista' && <button type="button" role="tab" aria-selected={false} className="practice-room-tab" onClick={() => setView('formulario')}><ShieldCheck size={16} />Formulario · test</button>}
    </div>
    {challenges.length > 0 && <section className="practice-prepared" aria-label="Retos de tu coach">
      <div className="practice-prepared-head"><Target size={18} /><div><span className="eyebrow">RETOS DE TU COACH</span><h2>Lo que te ha pedido practicar</h2><p>Un reto se cumple con una práctica de ese escenario, después de asignarlo y dentro del plazo; si tiene nota mínima, también hay que alcanzarla. El estado sale de tu actividad, no se marca a mano.</p></div></div>
      <div className="practice-prepared-form">
        {challenges.map(c => { const item = scenarioById(c.scenario_id); return <div key={c.id} className="challenge-item">
          <div>
            <h3>{item?.title ?? `Escenario no disponible (${c.scenario_id})`}</h3>
            <p>Hasta el {challengeDay(c.due_on)}{c.min_score !== null ? ` · nota mínima ${c.min_score}/100` : ' · cualquier nota'}</p>
            <p className="card-meta">«{c.coach_note}»</p>
            <p className="card-meta"><strong>{challengeStatusText(c)}</strong></p>
          </div>
          {item && <button type="button" className={c.status === 'completed' ? undefined : 'primary'} onClick={() => { onTrackChange(item.track); begin(item); }}><Play size={15} />{c.status === 'completed' ? 'Repetir' : 'Practicar'}</button>}
        </div>; })}
      </div>
    </section>}
    {next && <section className="practice-prepared practice-next-card" aria-label="Tu siguiente práctica">
      <div className="practice-prepared-head"><Sparkles size={18} /><div><span className="eyebrow">TU SIGUIENTE PRÁCTICA</span><h2>{next.scenario.title}</h2>      <p>{nextReason(next, labels)}</p></div></div>
      <div className="practice-prepared-actions"><button type="button" className="primary" onClick={() => { onTrackChange(next.track); begin(next.scenario); }}><Play size={15} />Practicar esta</button></div>
    </section>}
    {prepared.length > 0 && <section className="practice-prepared" aria-label="Practica una candidatura tuya">
      <div className="practice-prepared-head"><BriefcaseBusiness size={18} /><div><span className="eyebrow">CON UNA CANDIDATURA TUYA</span><h2>Ensaya la conversación de una oferta real</h2><p>Elige una candidatura de tu tablero y practica con el anuncio que estás trabajando, no con un caso genérico.</p></div></div>
      <div className="practice-prepared-form">
        <label htmlFor="practice-application">Candidatura<select id="practice-application" value={preparedId} onChange={event => { setPreparedId(event.target.value); setUseProfile(false); }}><option value="">Elige una oferta preparada</option>{prepared.map(item => <option key={item.id} value={item.id}>{item.offer_title}{item.offer_company ? ` · ${item.offer_company}` : ''}</option>)}</select></label>
        <label className="check-label"><input type="checkbox" checked={useProfile} disabled={!canUseProfile} onChange={event => setUseProfile(event.target.checked)} />Usar mi formulario base en esta práctica{canUseProfile ? '' : ' (marca antes el permiso en «Mi formulario base»)'}</label>
        <div className="practice-prepared-actions">
          <button type="button" className="primary" disabled={!preparedId} onClick={() => startPrepared('entrevista')}><Users size={15} />Entrevista de esta oferta</button>
          <button type="button" disabled={!preparedId} onClick={() => startPrepared('closer')}><Phone size={15} />Llamada de cierre</button>
        </div>
      </div>
      <p className="practice-note">Al proveedor de IA solo viajan el anuncio público y la conversación. Si marcas el formulario, también tu experiencia, herramientas, presentación y motivación; nunca tu email, teléfono, LinkedIn, CV, vídeo ni expectativa salarial.</p>
    </section>}
    {error && <p className="practice-error" role="alert"><CircleAlert size={15} />{error}</p>}
    <div className="practice-categories">
      <span className="practice-categories-label">{text.categoriesLabel}</span>
      <div role="group" aria-label={text.categoriesLabel}>
        <button type="button" aria-pressed={activeCategory === 'todas'} onClick={() => setCategory('todas')}>Todas</button>
        {categories.map(item => <button key={item.id} type="button" aria-pressed={activeCategory === item.id} onClick={() => setCategory(item.id)}>{item.label}</button>)}
      </div>
    </div>
    {activeCategory !== 'todas' && <p className="practice-category-hint">{categories.find(item => item.id === activeCategory)?.hint}</p>}
    <div className="practice-scenarios" data-track={track}>
      {shown.map(item => <article className="practice-card" key={item.id} data-category={item.category}>
        <div className="practice-card-top">
          <span className="practice-persona"><PersonaFace persona={item.persona} /><span><strong>{item.persona.name}</strong><small>{item.persona.role}</small></span></span>
          <span className="practice-card-meta"><span className={`practice-kind ${item.kind}`}>{item.kind === 'venta' ? 'Cliente' : 'Entrevistador'}</span><span className="practice-level" data-intensity={item.intensity}>{INTENSITY_LABELS[item.intensity]}</span><span className="practice-minutes"><Clock3 size={13} />{item.minutes} min</span></span>
        </div>
        <h2>{item.title}</h2>
        <p className="practice-context">{item.context}</p>
        <p>{item.summary}</p>
        <ul>{item.objectives.map(objective => <li key={objective}>{objective}</li>)}</ul>
        <div className="practice-card-foot"><span>{item.level}</span><button className="primary" type="button" onClick={() => begin(item)}><Play size={15} />Practicar</button></div>
      </article>)}
    </div>
    {!shown.length && <p className="card-meta">— Todavía no hay situaciones en esta categoría.</p>}
    {history.length > 0 && <div className="practice-history">
      <h2>Tus últimas prácticas</h2>
      <ul>{history.map(entry => <li key={entry.id}>
        <div><strong>{entry.title}</strong><small>{when(entry.startedAt)} · {entry.turns} respuestas</small><p>{entry.debrief.summary}</p></div>
        {typeof entry.debrief.score === 'number' && <span className="practice-history-score" data-band={band(entry.debrief.score)}>{entry.debrief.score}<small>/100</small></span>}
        <button type="button" onClick={() => { setScenario(scenarioById(entry.scenarioId)); setDebrief(entry.debrief); setView('debrief'); }}>Ver feedback</button>
      </li>)}</ul>
    </div>}
    <p className="practice-note">La sala de práctica es un simulacro formativo. No se envía nada a empresas y no sustituye a una entrevista real. Lo que escribes (o dices) se envía a un proveedor de inteligencia artificial para simular la conversación: no escribas datos personales de terceros. Más en <a href="/privacidad">Privacidad</a> y <a href="/terminos">Términos</a>.</p>
  </section>;
}
