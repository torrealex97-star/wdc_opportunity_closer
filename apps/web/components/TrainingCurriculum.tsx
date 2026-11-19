'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, ArrowRight, BookOpen, Check, CheckCircle2, ChevronDown, Clock3, Copy, ExternalLink,
  FileText, GraduationCap, Layers3, LoaderCircle, RotateCcw, Sparkles, Target, Trophy, X,
} from 'lucide-react';
import DailyQuote from './DailyQuote';
import { logActivity } from './studentActivityClient';
import {
  DEFAULT_CURRICULUM, RESOURCE_LABELS, lessonsOf, resourcesOf, type Curriculum, type CurriculumLesson,
  type CurriculumModule, type CurriculumQuestion, type CurriculumResource, type ResourceType,
} from '../lib/trainingCurriculum';
import type { TrainingId } from './trainingContent';

const COMPLETED_KEY = 'wdc_training_lessons';
const QUIZZES_KEY = 'wdc_training_quizzes';
type QuizResult = { correct: number; total: number; passed: boolean; at: number };

const readArray = (key: string): string[] => {
  try { const value = JSON.parse(window.localStorage.getItem(key) ?? '[]'); return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []; } catch { return []; }
};
const readResults = (): Record<string, QuizResult> => {
  try { const value = JSON.parse(window.localStorage.getItem(QUIZZES_KEY) ?? '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, QuizResult> : {}; } catch { return {}; }
};
const save = (key: string, value: unknown) => { try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* sin almacenamiento: la sesión sigue */ } };

function ProgressBar({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max ? Math.round((value / max) * 100) : 0;
  return <div className="curriculum-progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
    <div className="meter" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
    <small>{value} de {max} · {pct} %</small>
  </div>;
}

function ResourceCard({ resource, moduleTitle, lessonTitle }: { resource: CurriculumResource; moduleTitle: string; lessonTitle: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(resource.content ?? resource.url ?? ''); setCopied(true); window.setTimeout(() => setCopied(false), 2200); }
    catch { setCopied(false); }
  }
  return <article className="resource-card" data-type={resource.type}>
    <div className="resource-card-head"><span className="training-tag">{RESOURCE_LABELS[resource.type]}</span>
      <span className="card-meta">{moduleTitle} · {lessonTitle}</span></div>
    <h3>{resource.title}</h3>
    <p>{resource.description}</p>
    <div className="resource-card-actions">
      {resource.url && <a href={resource.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={14} /> Abrir recurso</a>}
      {resource.content && <button type="button" onClick={() => void copy()}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Copiado' : 'Copiar'}</button>}
    </div>
    {resource.content && <details><summary>Ver contenido</summary><p className="resource-content">{resource.content}</p></details>}
  </article>;
}

function QuestionCard({ question, index, answer, checked, onAnswer }: {
  question: CurriculumQuestion; index: number; answer: number | undefined; checked: boolean;
  onAnswer: (value: number) => void;
}) {
  const ok = checked && answer === question.correct;
  return <li className="quiz-question" data-ok={checked ? ok : undefined}>
    <fieldset>
      <legend><span className="quiz-index">{index + 1}</span>{question.prompt}</legend>
      <div className="quiz-options">{question.options.map((option, optionIndex) => <label key={optionIndex} className="quiz-option" data-state={checked ? (optionIndex === question.correct ? 'correct' : optionIndex === answer ? 'wrong' : undefined) : undefined}>
        <input type="radio" name={question.id} checked={answer === optionIndex} disabled={checked} onChange={() => onAnswer(optionIndex)} />
        <span>{option}</span>
        {checked && optionIndex === question.correct && <Check size={15} aria-label="Respuesta correcta" />}
        {checked && optionIndex === answer && optionIndex !== question.correct && <X size={15} aria-label="Respuesta incorrecta" />}
      </label>)}</div>
    </fieldset>
    {checked && <div className="quiz-feedback" data-ok={ok} role="status">
      <strong>{ok ? 'Correcto.' : 'No es la opción que pide el método.'}</strong> {question.explanation}
    </div>}
  </li>;
}

function LessonView({ module, lesson, completed, onComplete, onBack, onOpenMethod, onNext, nextTitle }: {
  module: CurriculumModule; lesson: CurriculumLesson; completed: boolean;
  onComplete: (result: QuizResult) => void; onBack: () => void; onOpenMethod: (id: string) => void; onNext: (() => void) | null; nextTitle: string | null;
}) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [notice, setNotice] = useState('');
  const result = useMemo(() => {
    const done = lesson.questions.filter(question => checked[question.id]);
    const correct = done.filter(question => answers[question.id] === question.correct).length;
    return { answered: done.length, correct, total: lesson.questions.length, all: done.length === lesson.questions.length, passed: done.length === lesson.questions.length && correct === lesson.questions.length };
  }, [answers, checked, lesson.questions]);

  useEffect(() => {
    if (!result.passed || completed) return;
    onComplete({ correct: result.correct, total: result.total, passed: true, at: Date.now() });
  }, [completed, onComplete, result]);

  function check(question: CurriculumQuestion) {
    if (answers[question.id] === undefined) { setNotice('Elige una opción antes de comprobar.'); return; }
    setNotice('');
    setChecked(current => ({ ...current, [question.id]: true }));
  }
  function retryFailed() {
    const wrong = lesson.questions.filter(question => checked[question.id] && answers[question.id] !== question.correct);
    setAnswers(current => Object.fromEntries(Object.entries(current).filter(([id]) => !wrong.some(question => question.id === id))));
    setChecked(current => Object.fromEntries(Object.entries(current).filter(([id]) => !wrong.some(question => question.id === id))));
    setNotice(`Reintenta ${wrong.length === 1 ? 'la pregunta fallada' : `las ${wrong.length} preguntas falladas`}.`);
  }
  function reset() { setAnswers({}); setChecked({}); setNotice(''); }
  const wrong = lesson.questions.filter(question => checked[question.id] && answers[question.id] !== question.correct).length;

  return <section className="curriculum-lesson" aria-label={lesson.title}>
    <button type="button" className="training-back" onClick={onBack}><ArrowLeft size={16} />Toda la ruta</button>
    <div className="curriculum-lesson-head">
      <div><span className="eyebrow">{module.title.toUpperCase()} · LECCIÓN {lesson.position}</span>
        <h2>{lesson.title}</h2><p>{lesson.summary}</p></div>
      <span className="training-count"><Clock3 size={13} />{lesson.minutes} min</span>
    </div>
    <p className="lesson-content">{lesson.content}</p>
    <div className="lesson-keypoints"><h3><Target size={15} />Lo que te llevas</h3><ul>{lesson.key_points.map(point => <li key={point}>{point}</li>)}</ul></div>
    <section className="lesson-resources" aria-label={`Recursos de ${lesson.title}`}>
      <h3><Layers3 size={15} />Recursos a mano</h3>
      <div className="resource-grid">{lesson.resources.map(resource => <ResourceCard key={resource.id} resource={resource} moduleTitle={module.title} lessonTitle={lesson.title} />)}</div>
    </section>
    <section className="lesson-quiz" aria-label={`Test de ${lesson.title}`}>
      <div className="lesson-quiz-head"><div><span className="eyebrow">TEST DIDÁCTICO</span><h3>Comprueba lo que acabas de leer</h3><p>Feedback inmediato en cada pregunta. Puedes reintentar solo las falladas.</p></div>
        <span className="quiz-count">{result.correct}/{result.total} correctas</span></div>
      <ol className="quiz-list">{lesson.questions.map((question, index) => <QuestionCard key={question.id} question={question} index={index} answer={answers[question.id]} checked={Boolean(checked[question.id])} onAnswer={value => setAnswers(current => ({ ...current, [question.id]: value }))} />)}</ol>
      {notice && <p className="auth-note" role="status">{notice}</p>}
      <div className="quiz-actions">
        {!result.all && <button type="button" className="primary" onClick={() => {
          const pending = lesson.questions.find(question => !checked[question.id]);
          if (pending) check(pending);
        }}>Comprobar la siguiente</button>}
        {result.all && !result.passed && <><strong className="quiz-fail">Aún no: {result.correct}/{result.total}. {wrong === 1 ? 'Queda una pregunta' : `Quedan ${wrong} preguntas`} por consolidar.</strong><button type="button" className="primary" onClick={retryFailed}><RotateCcw size={14} />Reintentar las falladas</button></>}
        {result.passed && <div className="quiz-passed" role="status"><CheckCircle2 size={18} /><div><strong>Test superado · {result.correct}/{result.total}</strong><p>Lección completada. La actividad queda registrada en tu progreso si has entrado con tu cuenta.</p></div></div>}
        {result.answered > 0 && <button type="button" onClick={reset}>Reiniciar test</button>}
      </div>
    </section>
    {module.deep_dive && <p className="curriculum-deep"><button type="button" onClick={() => onOpenMethod(module.deep_dive!)}><GraduationCap size={15} />Ampliar con el módulo de método: {module.deep_dive}</button></p>}
    <div className="curriculum-next">
      {nextTitle && onNext ? <button type="button" className="primary" onClick={onNext}>Siguiente lección: {nextTitle}<ArrowRight size={15} /></button>
        : <a className="primary" href="/?tab=practica">Llevarlo a la sala de práctica<ArrowRight size={15} /></a>}
    </div>
  </section>;
}

export default function TrainingCurriculum({ onOpenMethod }: { onOpenMethod: (id: TrainingId) => void }) {
  const [curriculum, setCurriculum] = useState<Curriculum>(DEFAULT_CURRICULUM);
  const [source, setSource] = useState<'db' | 'defaults'>('defaults');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [openLesson, setOpenLesson] = useState<{ module: CurriculumModule; lesson: CurriculumLesson } | null>(null);
  const [completed, setCompleted] = useState<string[]>([]);
  const [results, setResults] = useState<Record<string, QuizResult>>({});
  const [streak, setStreak] = useState<number | null>(null);
  const [filterModule, setFilterModule] = useState('all');
  const [filterType, setFilterType] = useState<'all' | ResourceType>('all');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setCompleted(readArray(COMPLETED_KEY));
    setResults(readResults());
    fetch('/api/training', { cache: 'no-store' })
      .then(response => response.ok ? response.json() : Promise.reject(new Error('La ruta no se pudo cargar.')))
      .then((data: { curriculum?: Curriculum; source?: 'db' | 'defaults' }) => {
        if (data.curriculum) setCurriculum(data.curriculum);
        if (data.source) setSource(data.source);
      })
      .catch((error: Error) => setLoadError(error.message))
      .finally(() => setLoading(false));
    // Racha y lecciones ya sincronizadas: si no hay sesión, la ruta funciona igual y no se inventa un cero.
    fetch('/api/student/progress?days=7', { cache: 'no-store' })
      .then(response => response.ok ? response.json() : null)
      .then((data: { progress?: { streak?: { current?: number }; training?: { lessons?: unknown } } } | null) => {
        if (typeof data?.progress?.streak?.current === 'number') setStreak(data.progress.streak.current);
        const serverLessons = data?.progress?.training?.lessons;
        if (Array.isArray(serverLessons)) setCompleted(current => [...new Set([...current, ...serverLessons.filter((id): id is string => typeof id === 'string')])]);
      })
      .catch(() => { /* sin sesión: progreso local */ });
  }, []);

  const allLessons = useMemo(() => lessonsOf(curriculum), [curriculum]);
  const allResources = useMemo(() => resourcesOf(curriculum), [curriculum]);
  const completedSet = useMemo(() => new Set(completed), [completed]);
  const total = allLessons.length;
  const done = allLessons.filter(item => completedSet.has(item.lesson.id)).length;
  const filteredResources = allResources.filter(item => (filterModule === 'all' || item.module.id === filterModule) && (filterType === 'all' || item.resource.type === filterType));
  const types = [...new Set(allResources.map(item => item.resource.type))];

  function completeLesson(module: CurriculumModule, lesson: CurriculumLesson, result: QuizResult) {
    if (completedSet.has(lesson.id)) return;
    const next = [...completed, lesson.id];
    setCompleted(next); save(COMPLETED_KEY, next);
    const map = { ...results, [lesson.id]: result }; setResults(map); save(QUIZZES_KEY, map);
    setNotice(`«${lesson.title}» completada. ${next.length} de ${total} lecciones.`);
    void logActivity({ kind: 'training_review', ref: module.id, detail: { met: 1, total: 1, lesson: lesson.id } });
  }
  function open(item: { module: CurriculumModule; lesson: CurriculumLesson }) {
    setOpenLesson(item);
    window.setTimeout(() => document.querySelector('.curriculum-lesson')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 40);
  }
  const currentIndex = openLesson ? allLessons.findIndex(item => item.lesson.id === openLesson.lesson.id) : -1;
  const nextItem = currentIndex >= 0 ? allLessons[currentIndex + 1] ?? null : null;

  if (loading) return <p className="muted"><LoaderCircle size={14} className="spin" /> Cargando la ruta de formación…</p>;
  if (openLesson) {
    const module = curriculum.modules.find(item => item.id === openLesson.module.id) ?? openLesson.module;
    return <div className="curriculum">
      {notice && <div className="auth-note" role="status">{notice}</div>}
      <LessonView module={module} lesson={openLesson.lesson} completed={completedSet.has(openLesson.lesson.id)}
        onComplete={result => completeLesson(module, openLesson.lesson, result)}
        onBack={() => setOpenLesson(null)} onOpenMethod={id => onOpenMethod(id as TrainingId)}
        onNext={nextItem ? () => open(nextItem) : null} nextTitle={nextItem?.lesson.title ?? null} />
    </div>;
  }

  return <div className="curriculum">
    <DailyQuote compact />
    <div className="curriculum-head">
      <div><span className="eyebrow">TU RUTA DE FORMACIÓN</span><h2>De cero a tu primera candidatura, paso a paso.</h2>
        <p>Cuatro módulos cortos con guiones, plantillas y un test por lección. La ruta se guarda en tu progreso; los recursos están a mano para copiar.</p></div>
      <span className="curriculum-badge"><BookOpen size={24} /><b>{done}/{total}</b><small>lecciones</small></span>
    </div>
    {loadError && <p className="card-meta" role="status">No se pudo cargar la última versión ({loadError}); sigues viendo la ruta del repositorio.</p>}
    <div className="curriculum-stats">
      <ProgressBar value={done} max={total} label="Lecciones completadas" />
      <span><Trophy size={14} />{done === 0 ? 'Empieza por la primera lección: son 8 minutos.' : done === total ? 'Ruta completa. Ahora el hábito.' : `Te faltan ${total - done} lecciones para completar la ruta.`}</span>
      {streak !== null && <span><Sparkles size={14} />Racha actual: <b>{streak}</b> {streak === 1 ? 'día' : 'días'}</span>}
      <span className="curriculum-source">{source === 'db' ? 'Currículo importado desde Excel' : 'Currículo versionado en el repositorio'}</span>
    </div>
    {notice && <div className="auth-note" role="status">{notice}</div>}
    <div className="curriculum-modules">
      {[...curriculum.modules].sort((a, b) => a.position - b.position).map(module => {
        const moduleDone = module.lessons.filter(lesson => completedSet.has(lesson.id)).length;
        return <article className="curriculum-module" key={module.id}>
          <header>
            <span className="curriculum-module-index">{module.position}</span>
            <div><h3>{module.title}</h3><p>{module.description}</p></div>
            <span className="curriculum-module-count">{moduleDone}/{module.lessons.length}</span>
          </header>
          <ul className="curriculum-objectives">{module.objectives.map(objective => <li key={objective}>{objective}</li>)}</ul>
          <ProgressBar value={moduleDone} max={module.lessons.length} label={`Progreso de ${module.title}`} />
          <ol className="curriculum-lessons">
            {[...module.lessons].sort((a, b) => a.position - b.position).map(lesson => <li key={lesson.id}>
              <button type="button" className="curriculum-lesson-row" onClick={() => open({ module, lesson })} data-done={completedSet.has(lesson.id)}>
                <span className="curriculum-lesson-check">{completedSet.has(lesson.id) ? <Check size={13} /> : lesson.position}</span>
                <span className="curriculum-lesson-title"><strong>{lesson.title}</strong><small>{lesson.summary}</small></span>
                <span className="curriculum-lesson-meta">{lesson.resources.length} recursos · {lesson.minutes} min <ChevronDown size={14} /></span>
              </button>
            </li>)}
          </ol>
          {module.deep_dive && <button type="button" className="link-button" onClick={() => onOpenMethod(module.deep_dive as TrainingId)}>Ampliar el módulo de método <ArrowRight size={14} /></button>}
        </article>;
      })}
    </div>
    <section className="resources-hub" aria-label="Hub de recursos">
      <div className="resources-hub-head"><div><span className="eyebrow">HUB DE RECURSOS</span><h3>Guiones, plantillas y checklists, sin buscarlos por lección.</h3></div>
        <div className="resources-filters">
          <label>Módulo<select value={filterModule} onChange={event => setFilterModule(event.target.value)}><option value="all">Todos</option>{curriculum.modules.map(module => <option key={module.id} value={module.id}>{module.title}</option>)}</select></label>
          <label>Tipo<select value={filterType} onChange={event => setFilterType(event.target.value as 'all' | ResourceType)}><option value="all">Todos</option>{types.map(type => <option key={type} value={type}>{RESOURCE_LABELS[type]}</option>)}</select></label>
        </div></div>
      {filteredResources.length ? <div className="resource-grid">{filteredResources.map(item => <ResourceCard key={item.resource.id} resource={item.resource} moduleTitle={item.module.title} lessonTitle={item.lesson.title} />)}</div>
        : <p className="card-meta">— No hay recursos con esos filtros.</p>}
    </section>
    <p className="card-meta"><FileText size={13} /> Los recursos son textos del método: cópialos y adáptalos a tu caso. No incluyen cifras ni resultados inventados.</p>
  </div>;
}
