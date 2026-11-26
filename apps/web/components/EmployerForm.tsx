'use client';
import { useState } from 'react';
import { LoaderCircle, Send } from 'lucide-react';

// Formulario público de empleadores. Una empresa describe su oferta de closer, setter, cold calling o SDR; entra como borrador y una persona
// del equipo la revisa antes de que la vean las alumnas. El campo «hp» es una trampa para bots: queda fuera de la vista y de la tabulación.
const ROLES: Array<[string, string]> = [['closer', 'Closer de ventas'], ['setter', 'Setter de ventas'], ['cold_calling', 'Cold calling'], ['sdr', 'SDR']];
const CONTRACTS: Array<[string, string]> = [['fijo', 'Contrato fijo'], ['fijo_variable', 'Fijo + variable'], ['solo_comision', 'Solo comisión'], ['freelance', 'Freelance']];
const MARKETS: Array<[string, string]> = [['ES', 'España'], ['LATAM', 'Latinoamérica'], ['US_ES', 'Estados Unidos (en español)']];
const EMPTY = { company: '', website: '', contact_name: '', contact_email: '', role: '', contract: '', market: '', pay: '', description: '', offer_url: '', hp: '' };

export default function EmployerForm({ terms }: { terms: readonly string[] }) {
  const [v, setV] = useState(EMPTY);
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const [error, setError] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const set = (key: keyof typeof EMPTY) => (e: { target: { value: string } }) => setV(x => ({ ...x, [key]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(''); setFields({});
    try {
      const r = await fetch('/api/employers/offer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...v, accepted_terms: accepted }) });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { setDone(typeof d.message === 'string' ? d.message : 'Recibida.'); setV(EMPTY); setAccepted(false); return; }
      setError(typeof d.detail === 'string' ? d.detail : 'No se pudo enviar la oferta.');
      if (d.fields && typeof d.fields === 'object') setFields(d.fields as Record<string, string>);
    } catch { setError('No se pudo contactar con el servidor: la oferta no se envió.'); }
    finally { setBusy(false); }
  }

  const err = (key: string) => fields[key] ? <p className="field-error" role="alert" id={`err-${key}`}>{fields[key]}</p> : null;
  const aria = (key: string) => fields[key] ? { 'aria-invalid': true, 'aria-describedby': `err-${key}` } : {};
  if (done) return <div className="alert" role="status" data-testid="employer-done"><span>{done}</span></div>;
  return <form onSubmit={submit} noValidate data-testid="employer-form" style={{ display: 'grid', gap: 14 }}>
    <label>Empresa<input value={v.company} onChange={set('company')} maxLength={120} autoComplete="organization" required {...aria('company')} />{err('company')}</label>
    <label>Web de la empresa (https)<input value={v.website} onChange={set('website')} inputMode="url" placeholder="https://tuempresa.com" autoComplete="url" required {...aria('website')} />{err('website')}</label>
    <label>Tu nombre<input value={v.contact_name} onChange={set('contact_name')} maxLength={80} autoComplete="name" required {...aria('contact_name')} />{err('contact_name')}</label>
    <label>Tu email de contacto<input type="email" value={v.contact_email} onChange={set('contact_email')} maxLength={120} autoComplete="email" required {...aria('contact_email')} /><span className="card-meta">Solo lo vemos nosotras; no se enseña a las alumnas.</span>{err('contact_email')}</label>
    <label>Puesto<select value={v.role} onChange={set('role')} required {...aria('role')}><option value="">Elige…</option>{ROLES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>{err('role')}</label>
    <label>Tipo de contrato<select value={v.contract} onChange={set('contract')} required {...aria('contract')}><option value="">Elige…</option>{CONTRACTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>{err('contract')}</label>
    <label>Mercado<select value={v.market} onChange={set('market')} required {...aria('market')}><option value="">Elige…</option>{MARKETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>{err('market')}</label>
    <label>Pago (opcional)<input value={v.pay} onChange={set('pay')} maxLength={200} placeholder="Ej.: 1.200 € fijos + 8 % por cierre" {...aria('pay')} /><span className="card-meta">Escribe solo lo que sea cierto: lo mostramos tal cual. Si no lo indicas, aparece como «no publicado».</span>{err('pay')}</label>
    <label>Descripción del puesto<textarea value={v.description} onChange={set('description')} rows={7} maxLength={4000} required {...aria('description')} /><span className="card-meta">Qué haría la persona, con qué leads trabaja, horario y cómo se forma. Mínimo 60 caracteres.</span>{err('description')}</label>
    <label>Enlace de la oferta (https)<input value={v.offer_url} onChange={set('offer_url')} inputMode="url" placeholder="https://tuempresa.com/empleo/closer" required {...aria('offer_url')} /><span className="card-meta">La página donde la candidata aplica. No valen acortadores (bit.ly…) ni enlaces de WhatsApp o Telegram.</span>{err('offer_url')}</label>
    <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}><label>No rellenes este campo<input tabIndex={-1} autoComplete="off" value={v.hp} onChange={set('hp')} name="hp" /></label></div>
    <fieldset style={{ border: '1px solid var(--line)', borderRadius: 8, padding: '12px 14px' }}>
      <legend className="eyebrow">Términos <span className="card-meta">(borrador pendiente de revisión legal)</span></legend>
      <ul style={{ paddingLeft: 18, margin: '4px 0 10px', display: 'grid', gap: 6 }}>{terms.map(t => <li key={t} style={{ fontSize: 13 }}>{t}</li>)}</ul>
      <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}><input type="checkbox" checked={accepted} onChange={e => setAccepted(e.target.checked)} /> <span>Acepto estos términos y la <a href="/privacidad">política de privacidad</a>.</span></label>{err('accepted_terms')}
    </fieldset>
    {error && <div className="alert error" role="alert"><span>{error}</span></div>}
    <button type="submit" disabled={busy}>{busy ? <LoaderCircle size={15} className="spin" /> : <Send size={15} />} Enviar la oferta</button>
  </form>;
}
