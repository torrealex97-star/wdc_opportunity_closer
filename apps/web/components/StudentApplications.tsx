'use client';
import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, Save } from 'lucide-react';

// Formulario base + candidaturas ASISTIDAS de la alumna. Ella revisa, copia y envía; la app nunca envía ni rellena nada.
type Opts = { work_authorization: Record<string, string>; levels: Record<string, string>; contracts: Record<string, string>; answers: Record<string, string> };
type AppProfile = { contact_email: string | null; phone: string | null; linkedin_url: string | null; cv_url: string | null; country_residence: string | null; work_authorization: string | null; language_levels: Record<string, string>; years_sales: number | null; years_high_ticket: number | null; sales_experience: string | null; tools: string[]; available_from: string | null; hours_per_week: number | null; contract_preferences: string[]; salary_expectation: string | null; notice_period: string | null; pitch: string | null; motivation: string | null; answers: Record<string, string>; autofill_consent_at: string | null };
type Form = { contact_email: string; phone: string; linkedin_url: string; cv_url: string; country_residence: string; work_authorization: string; language_levels: Record<string, string>; years_sales: string; years_high_ticket: string; sales_experience: string; tools: string; available_from: string; hours_per_week: string; contract_preferences: string[]; salary_expectation: string; notice_period: string; pitch: string; motivation: string; answers: Record<string, string>; autofill_consent: boolean };
const LANGS: Array<[string, string]> = [['es', 'Español'], ['en', 'Inglés'], ['pt', 'Portugués'], ['fr', 'Francés'], ['de', 'Alemán'], ['it', 'Italiano'], ['ca', 'Catalán']];
const EMPTY: Form = { contact_email: '', phone: '', linkedin_url: '', cv_url: '', country_residence: '', work_authorization: '', language_levels: {}, years_sales: '', years_high_ticket: '', sales_experience: '', tools: '', available_from: '', hours_per_week: '', contract_preferences: [], salary_expectation: '', notice_period: '', pitch: '', motivation: '', answers: {}, autofill_consent: false };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/student/${path}`, { headers: { 'Content-Type': 'application/json' }, ...init });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(typeof (data as { detail?: string }).detail === 'string' ? (data as { detail: string }).detail : 'La operación falló.'), { status: response.status });
  return data as T;
}
const toForm = (p: AppProfile | null): Form => !p ? EMPTY : { contact_email: p.contact_email ?? '', phone: p.phone ?? '', linkedin_url: p.linkedin_url ?? '', cv_url: p.cv_url ?? '', country_residence: p.country_residence ?? '', work_authorization: p.work_authorization ?? '', language_levels: p.language_levels ?? {}, years_sales: p.years_sales?.toString() ?? '', years_high_ticket: p.years_high_ticket?.toString() ?? '', sales_experience: p.sales_experience ?? '', tools: (p.tools ?? []).join(', '), available_from: p.available_from ?? '', hours_per_week: p.hours_per_week?.toString() ?? '', contract_preferences: p.contract_preferences ?? [], salary_expectation: p.salary_expectation ?? '', notice_period: p.notice_period ?? '', pitch: p.pitch ?? '', motivation: p.motivation ?? '', answers: p.answers ?? {}, autofill_consent: Boolean(p.autofill_consent_at) };

export function ApplicationForm({ onLost, onSaved }: { onLost: () => void; onSaved: () => void }) {
  const [f, setF] = useState<Form>(EMPTY); const [opts, setOpts] = useState<Opts | null>(null);
  const [comp, setComp] = useState<{ pct: number; missing: string[] }>({ pct: 0, missing: [] }); const [baseConsent, setBaseConsent] = useState(true);
  const [busy, setBusy] = useState(true); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const fail = useCallback((e: Error & { status?: number }) => { if (e.status === 401 || e.status === 403) onLost(); setError(e.message); }, [onLost]);
  useEffect(() => { api<{ profile: AppProfile | null; completeness: typeof comp; options: Opts; base_consent: boolean }>('application-profile').then(d => { setF(toForm(d.profile)); setComp(d.completeness); setOpts(d.options); setBaseConsent(d.base_consent); }).catch(fail).finally(() => setBusy(false)); }, [fail]);
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF(old => ({ ...old, [k]: v }));
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const body = { ...f, tools: f.tools.split(',').map(t => t.trim()).filter(Boolean), years_sales: f.years_sales === '' ? null : Number(f.years_sales), years_high_ticket: f.years_high_ticket === '' ? null : Number(f.years_high_ticket), hours_per_week: f.hours_per_week === '' ? null : Number(f.hours_per_week), available_from: f.available_from || null };
      const d = await api<{ completeness: typeof comp }>('application-profile', { method: 'PUT', body: JSON.stringify(body) });
      setComp(d.completeness); setNotice('Formulario guardado.'); onSaved();
    } catch (err) { fail(err as Error); } finally { setBusy(false); }
  }
  const text = (id: string, label: string, k: keyof Form, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => <label htmlFor={id}>{label}<input id={id} value={f[k] as string} onChange={e => set(k, e.target.value as never)} {...props} /></label>;
  return <details className="search-panel" data-testid="app-form"><summary><strong>Mi formulario base</strong> <span className="card-meta" style={{ margin: 0 }}>· completado al {comp.pct} %</span></summary>
    <p className="card-meta">Rellénalo una sola vez: aquí está todo lo que te piden la mayoría de formularios. Tú lo copias y envías; la app no envía nada por ti.</p>
    <div role="progressbar" aria-label="Formulario base completado" aria-valuemin={0} aria-valuemax={100} aria-valuenow={comp.pct} style={{ height: 6, background: 'var(--inset)', borderRadius: 3, margin: '8px 0' }}><div style={{ width: `${comp.pct}%`, height: '100%', background: 'var(--sage)', borderRadius: 3 }} /></div>
    {!!comp.missing.length && <p className="card-meta" data-testid="app-missing">Te falta: {comp.missing.join(' · ')}</p>}
    {!baseConsent && <div className="alert error" role="alert"><span>Guarda antes tu perfil y acepta el tratamiento de tus datos para poder guardar este formulario.</span></div>}
    <form onSubmit={save}>
      {text('af-email', 'Email de contacto', 'contact_email', { type: 'email', autoComplete: 'email' })}{text('af-phone', 'Teléfono', 'phone', { type: 'tel', autoComplete: 'tel' })}
      {text('af-linkedin', 'LinkedIn (enlace)', 'linkedin_url', { type: 'url', placeholder: 'https://www.linkedin.com/in/…' })}
      {text('af-cv', 'Tu CV (enlace a tu Drive)', 'cv_url', { type: 'url', placeholder: 'https://drive.google.com/…' })}
      {text('af-country', 'País de residencia', 'country_residence')}
      <label htmlFor="af-auth">Situación laboral / permiso<select id="af-auth" value={f.work_authorization} onChange={e => set('work_authorization', e.target.value)}><option value="">—</option>{Object.entries(opts?.work_authorization ?? {}).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <fieldset><legend>Idiomas y nivel</legend>{LANGS.map(([code, name]) => <label key={code} htmlFor={`af-lang-${code}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>{name}<select id={`af-lang-${code}`} value={f.language_levels[code] ?? ''} onChange={e => set('language_levels', { ...Object.fromEntries(Object.entries(f.language_levels).filter(([k]) => k !== code)), ...(e.target.value ? { [code]: e.target.value } : {}) })}><option value="">No</option>{Object.entries(opts?.levels ?? {}).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>)}</fieldset>
      {text('af-ys', 'Años de experiencia en ventas', 'years_sales', { type: 'number', min: 0, max: 60 })}{text('af-yh', 'Años en ventas high ticket', 'years_high_ticket', { type: 'number', min: 0, max: 60 })}
      <label htmlFor="af-exp">Experiencia en ventas<textarea id="af-exp" maxLength={1500} rows={4} value={f.sales_experience} onChange={e => set('sales_experience', e.target.value)} /></label>
      {text('af-tools', 'Herramientas / CRM (separadas por comas)', 'tools')}
      {text('af-from', 'Disponible desde', 'available_from', { type: 'date' })}{text('af-hours', 'Horas por semana', 'hours_per_week', { type: 'number', min: 1, max: 80 })}
      <fieldset><legend>Tipo de contrato que te interesa</legend>{Object.entries(opts?.contracts ?? {}).map(([k, l]) => <label key={k} className="check-label" style={{ flexDirection: 'row', alignItems: 'center' }}><input type="checkbox" checked={f.contract_preferences.includes(k)} onChange={() => set('contract_preferences', f.contract_preferences.includes(k) ? f.contract_preferences.filter(x => x !== k) : [...f.contract_preferences, k])} /> {l}</label>)}</fieldset>
      {text('af-salary', 'Expectativa salarial', 'salary_expectation')}{text('af-notice', 'Preaviso', 'notice_period')}
      <label htmlFor="af-pitch">Presentación breve (2-3 frases)<textarea id="af-pitch" maxLength={1200} rows={3} value={f.pitch} onChange={e => set('pitch', e.target.value)} /></label>
      <label htmlFor="af-mot">Motivación<textarea id="af-mot" maxLength={1200} rows={3} value={f.motivation} onChange={e => set('motivation', e.target.value)} /></label>
      <fieldset><legend>Respuestas que suelen pedir</legend>{Object.entries(opts?.answers ?? {}).map(([k, l]) => <label key={k} htmlFor={`af-a-${k}`}>{l}<textarea id={`af-a-${k}`} maxLength={800} rows={3} value={f.answers[k] ?? ''} onChange={e => set('answers', { ...f.answers, [k]: e.target.value })} /></label>)}</fieldset>
      <label className="check-label" style={{ flexDirection: 'row', alignItems: 'flex-start' }}><input type="checkbox" checked={f.autofill_consent} onChange={e => set('autofill_consent', e.target.checked)} /> <span>En el futuro, permito que la app use estos datos para rellenar formularios por mí. <strong>Hoy NO lo hace</strong>: tú copias y envías siempre, y antes de usarlo por primera vez se te pedirá un permiso nuevo. Puedes retirar este permiso cuando quieras (<a href="/privacidad" target="_blank" rel="noopener noreferrer">política de privacidad</a>). <em>(Texto provisional, pendiente de revisión legal.)</em></span></label>
      {error && <div className="alert error" role="alert"><span>{error}</span></div>}{notice && <div className="auth-note" role="status">{notice}</div>}
      <button className="primary" disabled={busy || !baseConsent}>{busy ? <LoaderCircle size={16} className="spin" /> : <Save size={16} />} Guardar formulario</button>
    </form></details>;
}
