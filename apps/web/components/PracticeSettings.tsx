'use client';

import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, CircleAlert, History, LoaderCircle, Plus, RotateCcw, Save, SlidersHorizontal, Trash2 } from 'lucide-react';
import {
  BANT_LABELS, DEFAULT_BANT, DEFAULT_PRIORITIES, DEFAULT_RUBRICS, ROOMS,
  type BantConfig, type BantLetter, type PracticeRoom, type RoomRubrics, type RubricAxis,
} from '../lib/practiceRubrics';

// Criterios de la sala y del análisis de llamadas. Edita lo que el servidor aplica al puntuar:
// rúbricas por sala (nombre, peso y guía), orden de la corrección prioritaria y qué salas exigen BANT.
// Guardar valida el conjunto entero en el servidor; si la tabla no está migrada, se declara y se
// siguen usando los valores por defecto (nunca se finge que el cambio está aplicado).

type Config = { rubrics: RoomRubrics; priorities: string[]; bant: BantConfig };
type Version = { version: number; at: string; by: string; note?: string; config: Config };
type RoomMeta = { id: PracticeRoom; label: string; note: string };
type Meta = {
  backend: 'supabase' | 'local';
  source: 'db' | 'defaults';
  reason: string | null;
  updated_at: string | null;
  updated_by: string | null;
  version: number;
  history: Version[];
};
type Payload = { config: Config; defaults: Config; rooms: RoomMeta[] } & Meta;

const clone = (value: Config): Config => JSON.parse(JSON.stringify(value)) as Config;

export default function PracticeSettings({ onSessionLost }: { onSessionLost: () => void }) {
  const [config, setConfig] = useState<Config>({ rubrics: DEFAULT_RUBRICS, priorities: DEFAULT_PRIORITIES, bant: DEFAULT_BANT });
  const [meta, setMeta] = useState<Meta>({ backend: 'supabase', source: 'defaults', reason: null, updated_at: null, updated_by: null, version: 0, history: [] });
  const [rooms, setRooms] = useState<RoomMeta[]>(ROOMS);
  const [room, setRoom] = useState<PracticeRoom>('venta');
  const [busy, setBusy] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(() => {
    setBusy(true); setError('');
    fetch('/api/admin/practice?fresh=1', { cache: 'no-store' })
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'No se pudo leer la configuración.');
        return data as Payload;
      })
      .then(data => {
        setConfig(clone(data.config));
        setMeta({ backend: data.backend, source: data.source, reason: data.reason, updated_at: data.updated_at, updated_by: data.updated_by, version: data.version ?? 0, history: data.history ?? [] });
        if (data.rooms?.length) setRooms(data.rooms);
        setDirty(false);
      })
      .catch(err => { if ((err as Error).message.includes('Sesión')) onSessionLost(); setError((err as Error).message); })
      .finally(() => setBusy(false));
  }, [onSessionLost]);

  useEffect(load, [load]);

  const axes = config.rubrics[room];
  const activeAxes = axes.filter(axis => axis.enabled);
  const weight = activeAxes.reduce((sum, axis) => sum + axis.weight, 0);

  function edit(next: Config) { setConfig(next); setDirty(true); setNotice(''); }
  function patchAxis(id: string, patch: Partial<RubricAxis>) {
    edit({ ...config, rubrics: { ...config.rubrics, [room]: axes.map(axis => axis.id === id ? { ...axis, ...patch } : axis) } });
  }
  function removeAxis(id: string) {
    const target = axes.find(axis => axis.id === id);
    if (!target || (target.enabled && activeAxes.length <= 3)) return;
    edit({ ...config, rubrics: { ...config.rubrics, [room]: axes.filter(axis => axis.id !== id) } });
  }
  function setPriority(index: number, value: string) {
    edit({ ...config, priorities: config.priorities.map((item, i) => i === index ? value : item) });
  }
  function movePriority(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= config.priorities.length) return;
    const next = [...config.priorities];
    [next[index], next[target]] = [next[target], next[index]];
    edit({ ...config, priorities: next });
  }
  function addPriority() {
    if (config.priorities.length >= 8) return;
    edit({ ...config, priorities: [...config.priorities, 'Nueva regla de prioridad.'] });
  }
  function removePriority(index: number) {
    if (config.priorities.length <= 1) return;
    edit({ ...config, priorities: config.priorities.filter((_, i) => i !== index) });
  }

  async function save() {
    setSaving(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/admin/practice', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'No se pudo guardar.');
      if (data.config) setConfig(clone(data.config));
      setMeta({ backend: data.backend, source: data.source, reason: data.reason, updated_at: data.updated_at, updated_by: data.updated_by, version: data.version ?? 0, history: data.history ?? [] });
      setDirty(false);
      setNotice('Criterios guardados. La próxima práctica y el próximo feedback ya los usan.');
    } catch (err) { setError((err as Error).message); }
    finally { setSaving(false); }
  }

  async function reset() {
    if (!window.confirm('¿Restaurar los criterios de las skills? Se borra lo guardado en el panel.')) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/admin/practice', { method: 'DELETE' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'No se pudo restaurar.');
      setConfig(clone(data.config));
      setMeta({ backend: data.backend, source: data.source, reason: data.reason, updated_at: data.updated_at, updated_by: data.updated_by, version: 0, history: [] });
      setDirty(false);
      setNotice('Restaurados los criterios por defecto (los de las skills).');
    } catch (err) { setError((err as Error).message); }
    finally { setSaving(false); }
  }

  async function restore(version: number) {
    if (!window.confirm(`¿Restaurar la versión ${version}? Se guarda como una versión nueva; el historial no se reescribe.`)) return;
    setSaving(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/admin/practice', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restore_version: version }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : 'No se pudo restaurar la versión.');
      if (data.config) setConfig(clone(data.config));
      setMeta({ backend: data.backend, source: data.source, reason: data.reason, updated_at: data.updated_at, updated_by: data.updated_by, version: data.version ?? 0, history: data.history ?? [] });
      setDirty(false);
      setNotice(`Versión ${version} restaurada como versión ${data.version ?? ''}.`);
    } catch (err) { setError((err as Error).message); }
    finally { setSaving(false); }
  }

  if (busy) return <p className="muted"><LoaderCircle size={14} className="spin" /> Leyendo los criterios…</p>;

  const where = meta.backend === 'local' ? 'la base local de desarrollo' : 'la base de datos';
  const saved = meta.source === 'db'
    ? `Guardados en ${where}${meta.updated_by ? ` por ${meta.updated_by}` : ''}${meta.updated_at ? ` el ${new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(meta.updated_at))}` : ''}.`
    : meta.reason ?? 'Sin cambios guardados: se aplican los criterios por defecto de las skills.';
  const backendNote = meta.backend === 'local'
    ? 'Base local de desarrollo (SQLite). En producción se usa Supabase; este aviso no aparece allí.'
    : null;

  return <section aria-label="Criterios de práctica">
    {error && <div className="alert error" role="alert"><span>{error}</span></div>}
    {notice && <div className="auth-note" role="status" style={{ marginBottom: 20 }}>{notice}</div>}

    <div className="stat-strip">
      <span><strong>{rooms.length}</strong>rúbricas por sala</span>
      <span><strong>{activeAxes.length}/{axes.length}</strong>criterios activos en esta sala</span>
      <span><strong>{weight}</strong>peso activo (se normaliza)</span>
      <span><strong>{meta.version || '—'}</strong>versión guardada</span>
    </div>
    <p className="card-meta" style={{ marginBottom: backendNote ? 4 : 20 }}>{saved}</p>
    {backendNote && <p className="card-meta" style={{ marginBottom: 20 }}>{backendNote}</p>}

    <div className="rubric-room-tabs" role="tablist" aria-label="Sala">
      {rooms.map(item => <button key={item.id} type="button" role="tab" aria-selected={room === item.id}
        className={room === item.id ? 'is-active' : ''} onClick={() => setRoom(item.id)}>{item.label}</button>)}
    </div>
    <p className="card-meta">{rooms.find(item => item.id === room)?.note}</p>

    <div className="table-wrap" style={{ marginTop: 16 }}>
      <table className="data-table rubric-table">
        <thead><tr><th scope="col">Activo</th><th scope="col">Criterio</th><th scope="col" className="num">Peso</th><th scope="col">Qué debe demostrar (lo lee la IA)</th><th scope="col">Fuente en la skill</th><th scope="col"><span className="sr-only">Acciones</span></th></tr></thead>
        <tbody>{axes.map(axis => <tr key={axis.id}>
          <td>
            <label className="check-label" title={axis.enabled ? 'Se puntúa y se envía a la IA' : 'No se puntúa ni se envía a la IA'}>
              <input type="checkbox" checked={axis.enabled} onChange={event => patchAxis(axis.id, { enabled: event.target.checked })} aria-label={`Activar ${axis.label}`} />
            </label>
          </td>
          <td className="primary-cell">
            <label htmlFor={`axis-${axis.id}`} className="sr-only">Nombre del criterio {axis.id}</label>
            <input id={`axis-${axis.id}`} value={axis.label} maxLength={60} onChange={event => patchAxis(axis.id, { label: event.target.value })} />
            <span className="rubric-id">{axis.id}</span>
          </td>
          <td className="num">
            <label htmlFor={`weight-${axis.id}`} className="sr-only">Peso de {axis.label}</label>
            <input id={`weight-${axis.id}`} className="rubric-weight" type="number" min={1} max={100} value={axis.weight}
              onChange={event => patchAxis(axis.id, { weight: Number(event.target.value) })} />
          </td>
          <td>
            <label htmlFor={`guide-${axis.id}`} className="sr-only">Guía de {axis.label}</label>
            <textarea id={`guide-${axis.id}`} rows={Math.min(9, Math.max(3, Math.ceil(axis.guide.length / 42)))} maxLength={400} value={axis.guide}
              onChange={event => patchAxis(axis.id, { guide: event.target.value })} />
          </td>
          <td>
            <label htmlFor={`source-${axis.id}`} className="sr-only">Skill de {axis.label}</label>
            <select id={`source-${axis.id}`} value={axis.source} onChange={event => patchAxis(axis.id, { source: event.target.value as RubricAxis['source'] })}>
              <option value="analisis-llamadas-ventas">analisis-llamadas-ventas</option>
              <option value="scalix-ventas">scalix-ventas</option>
            </select>
            <label htmlFor={`ref-${axis.id}`} className="sr-only">Sección de la skill de {axis.label}</label>
            <input id={`ref-${axis.id}`} className="rubric-id" value={axis.source_ref} maxLength={160} onChange={event => patchAxis(axis.id, { source_ref: event.target.value })} />
          </td>
          <td style={{ textAlign: 'right' }}>
            <button type="button" onClick={() => removeAxis(axis.id)} disabled={axis.enabled && activeAxes.length <= 3} aria-label={`Quitar ${axis.label}`} title={axis.enabled && activeAxes.length <= 3 ? 'Cada rúbrica necesita al menos 3 criterios activos' : 'Quitar'}><Trash2 size={14} /></button>
          </td>
        </tr>)}</tbody>
      </table>
    </div>
    <div className="rubric-actions">
      <span className="card-meta">Los criterios no se crean desde el panel: cada uno declara la skill y la sección de donde sale. Puedes editar, ponderar, activar/desactivar y restaurar versiones. {weight !== 100 ? `Los pesos activos suman ${weight}; la nota se normaliza igual.` : 'Los pesos activos suman 100: la nota se lee como la de la skill.'}</span>
    </div>

    <h2 className="section-title">Cualificación BANT</h2>
    <p className="card-meta" style={{ marginBottom: 12 }}>En las salas marcadas, el feedback incluye el estado de las cuatro letras con su cita y la decisión (avanzó, paró, debió parar). La entrevista no se audita con BANT: no es una llamada de venta.</p>
    <div className="rubric-bant">
      {rooms.map(item => <label key={item.id} className="check-label">
        <input type="checkbox" checked={config.bant[item.id]} onChange={event => edit({ ...config, bant: { ...config.bant, [item.id]: event.target.checked } })} />
        {item.label}
      </label>)}
    </div>
    <p className="card-meta" style={{ marginTop: 8 }}>{(['budget', 'authority', 'need', 'timing'] as BantLetter[]).map(letter => BANT_LABELS[letter]).join(' · ')}</p>

    <h2 className="section-title">Corrección prioritaria</h2>
    <p className="card-meta" style={{ marginBottom: 12 }}>El feedback elige UNA corrección con este orden de impacto. Arriba = manda antes. Si hay un fallo de adherencia al método o de lead, ese manda sobre la lista.</p>
    <ol className="rubric-priorities">{config.priorities.map((priority, index) => <li key={index} className="rubric-priority">
      <span className="rubric-priority-index">{index + 1}</span>
      <label htmlFor={`priority-${index}`} className="sr-only">Prioridad {index + 1}</label>
      <textarea id={`priority-${index}`} rows={Math.min(5, Math.max(2, Math.ceil(priority.length / 60)))} maxLength={200} value={priority} onChange={event => setPriority(index, event.target.value)} />
      <span className="rubric-priority-actions">
        <button type="button" onClick={() => movePriority(index, -1)} disabled={index === 0} aria-label={`Subir la prioridad ${index + 1}`}><ArrowUp size={14} /></button>
        <button type="button" onClick={() => movePriority(index, 1)} disabled={index === config.priorities.length - 1} aria-label={`Bajar la prioridad ${index + 1}`}><ArrowDown size={14} /></button>
        <button type="button" onClick={() => removePriority(index)} disabled={config.priorities.length <= 1} aria-label={`Quitar la prioridad ${index + 1}`}><Trash2 size={14} /></button>
      </span>
    </li>)}</ol>
    <div className="rubric-actions">
      <button type="button" onClick={addPriority} disabled={config.priorities.length >= 8}><Plus size={15} /> Añadir regla</button>
    </div>

    <div className="rubric-actions rubric-save">
      <button className="primary" type="button" onClick={() => void save()} disabled={!dirty || saving}>
        {saving ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />} Guardar criterios
      </button>
      <button type="button" onClick={() => void reset()} disabled={saving}><RotateCcw size={16} /> Restaurar los de las skills</button>
      {dirty && <span className="status"><CircleAlert size={14} /> Cambios sin guardar</span>}
      <span className="card-meta"><SlidersHorizontal size={14} /> Se aplica a la próxima réplica y al próximo feedback.</span>
    </div>

    <h2 className="section-title">Versiones guardadas</h2>
    <p className="card-meta" style={{ marginBottom: 12 }}>Cada guardado crea una versión con la rúbrica completa. Restaurar una versión la guarda como una versión nueva: el historial no se reescribe. Se conservan las últimas 20.</p>
    {meta.history.length === 0 ? <p className="card-meta">— Todavía no hay versiones: la configuración activa son los criterios por defecto de las skills.</p> : <ul className="rubric-versions">
      {[...meta.history].reverse().map(item => <li key={item.version}>
        <span className="rubric-version-id"><History size={14} /> v{item.version}</span>
        <span>{item.note ?? 'Guardado'} · {item.by || 'operador'} · {item.at ? new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(item.at)) : 'sin fecha'}</span>
        <button type="button" onClick={() => void restore(item.version)} disabled={saving}>Restaurar</button>
      </li>)}
    </ul>}
  </section>;
}
