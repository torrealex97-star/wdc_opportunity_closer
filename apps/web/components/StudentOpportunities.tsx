'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Bookmark, BriefcaseBusiness, ChevronRight, Clock3, Compass, FileText, Globe2, GraduationCap, HeartHandshake, Inbox, Languages, Laptop, LoaderCircle, MapPin, MessageSquare, PhoneOutgoing, Search, ShieldAlert, TrendingUp, Users, X } from 'lucide-react';
import OpportunityRadar from './OpportunityRadar';
import StudentPractice from './StudentPractice';
import type { PracticeTrack } from './practiceScenarios';
import StudentProgress from './StudentProgress';
import StudentTraining from './StudentTraining';
import DailyQuote from './DailyQuote';
import { hasPay } from './offerFacts';
import { ROLE_EVAL_ORDER, ROLE_LABELS, ROLE_OPTIONS } from '../lib/vocabulary';
import { request } from './client';
import type { components } from '../../../packages/contracts/api';

// `caution` no es contrato del motor: lo añade `externalSurface.toOpportunity` a las ofertas externas que las
// reglas aprobaron con avisos. Opcional a propósito para que las ofertas del motor sigan encajando.
type Caution = { title: string; flags: string[]; note: string };
type Offer = components['schemas']['Opportunity'] & { caution?: Caution | null };
type Query = components['schemas']['OpportunityQuery'];
// `degraded` solo lo añade el proxy web cuando el motor no responde y sirve las
// externas aprobadas a solas: no forma parte del contrato del motor.
type Results = components['schemas']['OpportunityList'] & { degraded?: 'motor' };
// El inglés se ofrece por defecto (decisión del propietario, 2026-11-18): la casilla de abajo lo
// apaga si la alumna solo quiere castellano, así que el filtro sigue siendo suyo y está a la vista.
const defaults: Query = { role: null, market: 'any', days: 10, include_bilingual: true, starred_only: false, include_extra_roles: false, modality: 'any', sales_motion: 'any' };
// Una sola lista de familias y etiquetas (lib/vocabulary): el desplegable y la frase no pueden
// decir cosas distintas de lo que filtra el motor.
const ROLES = ROLE_EVAL_ORDER;
const label = (role: NonNullable<Query['role']>): string => `las del perfil ${ROLE_LABELS[role]}`;
const MARKETS = ['any', 'ES', 'EU', 'LATAM', 'US'] as const;
// Idioma, modalidad y prospección se eligen por separado: la modalidad la declara el anuncio y la
// prospección solo consta cuando el anuncio la menciona, así que ninguna se supone.
const MODALITIES = ['any', 'remote', 'hybrid', 'onsite'] as const;
const MOTIONS = ['any', 'outbound', 'inbound'] as const;
// El catálogo se recorre por páginas reales: con la lista entera en una tirada, «cuántas hay» no se ve.
// Doce caben en dos columnas sin que la página pese de más y el recuento («Mostrando 1–12 de N») dice la verdad.
const PAGE_SIZE = 12;
function pageNumbers(current: number, count: number): Array<number | 'gap'> {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const keep = new Set([1, count, current - 1, current, current + 1].filter(n => n >= 1 && n <= count));
  const out: Array<number | 'gap'> = [];
  for (let n = 1; n <= count; n += 1) {
    if (keep.has(n)) out.push(n);
    else if (out[out.length - 1] !== 'gap') out.push('gap');
  }
  return out;
}
// Modalidad y prospección se marcan como el bilingüe: una casilla por opción, sin desplegable.
// Son excluyentes porque el motor filtra por un valor; desmarcar la activa vuelve a «cualquiera».
function Ticks({ legend, hint, value, options, onChange }: { legend: string; hint?: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return <fieldset className="tick-field">
    <legend>{legend}</legend>
    <div className="tick-row">{options.map(option => <label key={option.value} className="check-label">
      <input type="checkbox" checked={value === option.value} onChange={event => onChange(event.target.checked ? option.value : 'any')} />{option.label}
    </label>)}</div>
    <small>{hint ?? 'Sin marcar: cualquiera.'}</small>
  </fieldset>;
}
// La alumna conserva su contexto: los filtros aplicados viven en la URL (compartible/recargable),
// validados contra las opciones reales del desplegable para no inventar estados.
function queryFromUrl(): Query | null {
  if (typeof window === 'undefined') return null;
  const params = new URLSearchParams(window.location.search);
  if (![...params.keys()].length) return null;
  const role = params.get('role') ?? '';
  const market = params.get('market') ?? 'any';
  const days = Number(params.get('days'));
  const modality = params.get('modality') ?? 'any';
  const motion = params.get('motion') ?? 'any';
  return {
    role: ROLES.includes(role as typeof ROLES[number]) ? role as Query['role'] : null,
    market: MARKETS.includes(market as typeof MARKETS[number]) ? market as Query['market'] : 'any',
    days: [1, 3, 7, 10].includes(days) ? days : 10,
    include_bilingual: params.get('bilingual') !== '0',
    starred_only: false,
    include_extra_roles: true,
    modality: MODALITIES.includes(modality as (typeof MODALITIES)[number]) ? modality as Query['modality'] : 'any',
    sales_motion: MOTIONS.includes(motion as (typeof MOTIONS)[number]) ? motion as Query['sales_motion'] : 'any',
  };
}
function urlFromQuery(query: Query): string {
  const params = new URLSearchParams();
  if (query.role) params.set('role', query.role);
  if (query.market !== 'any') params.set('market', query.market);
  if (query.days !== 10) params.set('days', String(query.days));
  params.set('bilingual', query.include_bilingual ? '1' : '0');
  if (query.modality !== 'any') params.set('modality', query.modality);
  if (query.sales_motion !== 'any') params.set('motion', query.sales_motion);
  const qs = params.toString();
  return qs ? `?${qs}` : window.location.pathname;
}

const date = (value: string | null) => value ? new Intl.DateTimeFormat('es', { day: 'numeric', month: 'short' }).format(new Date(value)) : 'Fecha no indicada';
// Frescura relativa: es lo primero que se mira en un portal de empleo. Sin fecha no se inventa
// («Fecha no indicada»), y a partir de 7 días se dice la fecha exacta para no dar aire de nueva.
const freshness = (value: string | null) => {
  if (!value) return 'Fecha no indicada';
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
  if (!Number.isFinite(days) || days < 0) return 'Fecha no indicada';
  if (days === 0) return 'Publicada hoy';
  if (days === 1) return 'Publicada ayer';
  if (days < 7) return `Hace ${days} días`;
  return `Publicada el ${date(value)}`;
};
// Un «no especificado» no es un dato: tres filas de «no especificado» ocupan media tarjeta y no
// dicen nada. Se enseña lo que el anuncio sí cuenta y, si no cuenta nada, se dice una vez.
const UNKNOWN_FACT = /no (especificad|indicad)[oa]s?\b/i;
function knownFacts(offer: Offer) {
  return [{ label: 'Idioma', value: offer.language }, { label: 'Jornada', value: offer.schedule },
    { label: 'Experiencia', value: offer.experience }, { label: 'Contrato', value: offer.contract }]
    .filter(f => f.value && !UNKNOWN_FACT.test(f.value));
}
// Insignia de modalidad: el motor ya la declara (Presencial/Remoto/Híbrido) y, si el anuncio no lo
// dice, se muestra «Sin indicar» en vez de suponer. Misma palabra que la verdad del dato.
const modalityBadge = (modality: string) => {
  if (modality === 'Remoto') return { text: 'Remoto', tone: 'is-remote' };
  if (modality === 'Presencial') return { text: 'Presencial', tone: 'is-onsite' };
  if (modality === 'Híbrido') return { text: 'Híbrido', tone: '' };
  return { text: 'Sin indicar', tone: '' };
};
const rank = (offer: Offer) => offer.is_selected && offer.excellence_rank && offer.excellence_rank <= 3 ? String(offer.excellence_rank) : '';
// Prospección: la palabra que se enseña es la del anuncio, no una clasificación nuestra.
const motionText = (motion: Offer['sales_motion']) => motion === 'outbound' ? 'Prospección en frío' : motion === 'inbound' ? 'Leads entrantes' : '';
// El titular de la tarjeta es el PUESTO que anuncia la empresa, no la familia de rol:
// 'Teleoperador comercial (H/M/X)' dice qué buscan; 'Setter' solo dice cómo lo clasificamos.
const jobTitle = (offer: Offer) => (offer.original_title ?? '').trim() || 'Puesto no especificado en el anuncio';
const initials = (company: string) => company.slice(0, 2).toUpperCase();
// Dominio que se enseña junto al botón de aplicar: dice a dónde va antes de pulsar.
const hostOf = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'el anuncio'; } };
const applyTo = (offer: Offer) => offer.apply_url || offer.source_url;
// El importe es el dato que más pesa al comparar: se enseña como cifra grande cuando la empresa lo
// publica y, cuando no, se dice con la misma claridad en vez de dejar un hueco.
function PayBlock({ offer, note = true }: { offer: Offer; note?: boolean }) {
  return <div className={`opportunity-pay ${hasPay(offer) ? 'is-paid' : 'is-unpublished'}`}>
    <span className="pay-label">{hasPay(offer) ? 'Salario publicado' : 'Compensación'}</span>
    <p className="pay-value">{hasPay(offer) ? offer.compensation : 'La empresa no publica importe'}</p>
    {hasPay(offer) ? (note && <p className="pay-note">{offer.compensation_note}</p>)
      : <p className="pay-note">Pregunta por el fijo y las comisiones antes de avanzar.</p>}
  </div>;
}

const freshTone = (value: string | null) => {
  if (!value) return '';
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86400000);
  return Number.isFinite(days) && days >= 0 && days <= 3 ? 'is-fresh' : '';
};
const factIcon = (label: string) => label === 'Idioma' ? <Languages size={13} aria-hidden="true" />
  : label === 'Jornada' ? <Clock3 size={13} aria-hidden="true" />
  : label === 'Experiencia' ? <BriefcaseBusiness size={13} aria-hidden="true" />
  : <FileText size={13} aria-hidden="true" />;

// Ficha de la alumna: empresa y puesto primero, condiciones después, y un único siguiente paso.
// `compact` es el bloque ampliado (mismo diseño, sin la lista de datos para no repetir la ficha).
function OfferCard({ offer, starred, saving, onStar, onOpen, compact = false }: {
  offer: Offer; starred: boolean; saving: boolean; onStar: () => void; onOpen: () => void; compact?: boolean;
}) {
  const modality = modalityBadge(offer.modality);
  const facts = knownFacts(offer);
  // «Sin indicar» no es una condición: ocupaba una insignia en casi todas las tarjetas para decir
  // que no hay dato. Se omite, igual que los datos desconocidos de la ficha.
  const showModality = modality.text !== 'Sin indicar';
  // «Remoto» como ubicación y como modalidad es el mismo dato: no se dice dos veces.
  const showLocation = Boolean(offer.location) && (!showModality || offer.location.trim().toLowerCase() !== modality.text.toLowerCase());
  return <article className={`opportunity-card ${offer.is_selected ? 'is-pick' : ''}`}>
    <div className="opportunity-company">
      <div className="company-monogram" aria-hidden="true">{initials(offer.company)}</div>
      <div className="company-identity">
        <p className="company-name">{offer.company}</p>
        <div className="company-tags">
          <span className={`role-chip role-${offer.role}`}>{offer.role_label || label(offer.role)}</span>
          {offer.is_selected && <em className="pick-badge">Selección del día{rank(offer) ? ` · Nº ${rank(offer)}` : ''}</em>}
        </div>
      </div>
      <button className={`icon-button ${starred ? 'is-starred' : ''}`} disabled={saving}
        aria-label={`${starred ? 'Quitar de guardadas' : 'Guardar'} ${jobTitle(offer)} · ${offer.company}`} onClick={onStar}>
        <Bookmark size={19} fill={starred ? 'currentColor' : 'none'} />
      </button>
    </div>
    <h3 className={`opportunity-title ${compact ? 'is-compact' : ''}`}>{jobTitle(offer)}</h3>
    <div className="opp-badges">
      {showLocation && <span className="opp-badge"><MapPin size={12} aria-hidden="true" />{offer.location}</span>}
      {showModality && <span className={`opp-badge ${modality.tone}`}><Laptop size={12} aria-hidden="true" />{modality.text}</span>}
      {offer.sales_motion && <span className="opp-badge">{offer.sales_motion === 'outbound' ? <PhoneOutgoing size={12} aria-hidden="true" /> : <Inbox size={12} aria-hidden="true" />}{motionText(offer.sales_motion)}</span>}
      <span className={`opp-freshness ${freshTone(offer.published_at)}`}><Clock3 size={12} aria-hidden="true" />{freshness(offer.published_at)}</span>
    </div>
    {offer.caution && <p className="offer-caution" role="note"><ShieldAlert size={13} /><span><strong>{offer.caution.title}.</strong> {offer.caution.flags[0]} <button type="button" className="link-button" onClick={onOpen}>Ver por qué</button></span></p>}
    <PayBlock offer={offer} note={compact} />
    {!compact && <dl className="opportunity-facts">
      {facts.map(f => <div key={f.label}><dt>{factIcon(f.label)}{f.label}</dt><dd>{f.value}</dd></div>)}
      {facts.length <= 1 && <div><dt>{factIcon('Contrato')}Detalles del puesto</dt><dd>El anuncio no detalla jornada, experiencia ni contrato.</dd></div>}
    </dl>}
    <div className="opportunity-footer">
      <a className="opp-source" href={offer.source_url} target="_blank" rel="noopener noreferrer">Publicado en {offer.source_name}</a>
      <button className="primary" onClick={onOpen}>Ver oportunidad<ArrowUpRight size={16} /></button>
    </div>
  </article>;
}

// WDC student: compare companies and conditions, then choose her next step.
// Existing paper/terracotta tokens, quiet borders, 24px cards; pay is the focal fact.
export default function StudentOpportunities({ hosted = false }: { hosted?: boolean }) {
  const [query, setQuery] = useState<Query>(defaults);
  const [applied, setApplied] = useState<Query>(defaults);
  const [items, setItems] = useState<Offer[]>([]);
  const [wider, setWider] = useState<Offer[] | null>(null); // hueco ampliado cuando el filtro estrecho devuelve <10
  const [selectionTotal, setSelectionTotal] = useState(0);
  const [saved, setSaved] = useState(false);
  const [practice, setPractice] = useState<PracticeTrack | null>(null);
  const [training, setTraining] = useState(false);
  const [progress, setProgress] = useState(false);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [degraded, setDegraded] = useState(false);
  const [detail, setDetail] = useState<Offer | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  // Modo hospedado: guardar es un marcador de ESTE navegador (fix audit run-1
  // finding 2 — sin credencial individual todavía, la vista alumna no muta el
  // catálogo compartido del operador). El motor admin mantiene su marcador propio.
  const [localSaves, setLocalSaves] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const sequence = useRef(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  // Tras el montaje (nunca durante la hidratación): la URL restaura el contexto de la alumna.
  useEffect(() => {
    const fromUrl = queryFromUrl();
    if (fromUrl) { setQuery(fromUrl); setApplied(fromUrl); }
    // Enlaces directos del panel de la alumna: /?tab=formacion y /?tab=practica.
    const tab = new URLSearchParams(window.location.search).get('tab');
    if (tab === 'formacion') setTraining(true);
    else if (tab === 'practica') setPractice('closer');
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = JSON.parse(window.localStorage.getItem('wdc_saved_offers') ?? '[]');
      if (Array.isArray(stored)) setLocalSaves(stored.filter((id): id is string => typeof id === 'string'));
    } catch { /* marcador corrupto: sin guardadas, nunca se rompe la vista */ }
  }, []);
  useEffect(() => {
    let stopped = false;
    const id = ++sequence.current;
    setBusy(true); setError(''); setWider(null); setDegraded(false); setPage(1);
    // Hosted: Guardadas son las marcadas en Este navegador (filtrado en cliente);
    // el marcador starred_only del engine queda como curación del operador.
    request<Results>('opportunities/search', saved ? (hosted ? { role: null, market: 'any', days: 10, include_bilingual: true, starred_only: false, include_extra_roles: true } : { role: null, market: 'any', days: 10, include_bilingual: true, starred_only: true, include_extra_roles: true }) : applied)
      .then(result => {
        if (!stopped && sequence.current === id) { setItems(result.items); setSelectionTotal(result.selection_total ?? 0); setDegraded(result.degraded === 'motor'); }
        // Filtro estrecho con pocas ofertas: presentamos también el hueco más amplio
        // (mismo mercado y días, sin filtro de rol) rotulado como tal, con los mismos
        // datos reales del motor — la alumna compara sin creer que el catálogo se vació.
        if (!stopped && !saved && result.items.length < 10 && (applied.role || applied.market !== 'any')) {
          return new Promise<Results>((resolve, reject) => {
            // Se relaja SOLO el rol (y el marcador de guardadas): el mercado, los días y el idioma
            // siguen siendo los de la alumna. Encender bilingües aquí colaba anuncios en inglés
            // que nadie había pedido, así que el relleno nunca cambia el idioma.
            request<Results>('opportunities/search', { ...applied, role: null, starred_only: false })
              .then(resolve, reject);
          }).then(widerResult => {
            if (stopped || sequence.current !== id) return null;
            const seen = new Set(result.items.map(item => item.id));
            setWider(widerResult.items.filter(item => !seen.has(item.id)).slice(0, Math.max(0, 20 - result.items.length)));
            return null;
          });
        }
        return null;
      })
      .catch(e => { if (!stopped) setError(e.message); })
      .finally(() => { if (!stopped) setBusy(false); });
    return () => { stopped = true; };
  }, [applied, saved, hosted]);
  useEffect(() => {
    if (detail && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [detail]);
  // Una sola puerta de aplicación: el formulario y el radar escriben el mismo estado real.
  function applyQuery(next: Query) {
    setQuery(next); setApplied(next);
    history.replaceState(null, '', urlFromQuery(next));
  }
  const isStarred = (offer: Offer) => hosted ? localSaves.includes(offer.id) : offer.starred;
  async function star(offer: Offer) {
    setSaving(offer.id); setError('');
    try {
      if (hosted) {
        // Marcador local de la alumna: persiste en SU navegador y nunca toca el engine.
        const next = localSaves.includes(offer.id) ? localSaves.filter(id => id !== offer.id) : [...localSaves, offer.id];
        localStorage.setItem('wdc_saved_offers', JSON.stringify(next));
        setLocalSaves(next);
        const after = (item: Offer): Offer => ({ ...item, starred: next.includes(item.id) });
        setItems(old => old.map(after).filter(item => !saved || next.includes(item.id)));
        setDetail(old => old ? { ...old, starred: next.includes(old.id) } : old);
      } else {
        await request(`jobs/${offer.id}/star`, { starred: !offer.starred }, 'PATCH');
        setItems(old => old.map(item => item.id === offer.id ? { ...item, starred: !item.starred } : item).filter(item => !saved || item.starred));
        setDetail(old => old?.id === offer.id ? { ...old, starred: !old.starred } : old);
      }
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(null); }
  }
  // Guardadas en modo hospedado: el marcador vive en este navegador.
  const visible = saved && hosted ? items.filter(isStarred) : items;
  // Familias del relleno, en el orden en que aparecen: el rótulo del bloque y cada tarjeta las nombran.
  const widerFamilies = [...new Set((wider ?? []).map(offer => offer.role_label || label(offer.role)))];
  // Página actual, acotada al recuento real: un filtro que devuelve menos ofertas no deja la lista en blanco.
  const total = visible.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const start = (current - 1) * PAGE_SIZE;
  const paged = visible.slice(start, start + PAGE_SIZE);
  function goToPage(next: number) {
    setPage(Math.min(Math.max(next, 1), pageCount));
    resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  return <div className="shell student-shell">
    <aside className="sidebar">
      <a className="brand" href="/" aria-label="WDC · Inicio"><span className="brand-mark">w.</span><span>Women Digital<br /><strong>Closer</strong></span></a>
      <div className="workspace-label">TU SIGUIENTE PASO</div>
      <nav aria-label="Navegación principal"><button className={`nav ${!saved && !practice && !training && !progress ? 'active' : ''}`} aria-current={!saved && !practice && !training && !progress ? 'page' : undefined} onClick={() => { setSaved(false); setPractice(null); setTraining(false); setProgress(false); }}><Compass size={18} />Oportunidades</button><button className={`nav ${saved && !practice && !training ? 'active' : ''}`} aria-current={saved && !practice && !training ? 'page' : undefined} onClick={() => { setSaved(true); setPractice(null); setTraining(false); setProgress(false); }}><Bookmark size={18} />Guardadas</button><button className={`nav ${practice ? 'active' : ''}`} aria-current={practice ? 'page' : undefined} onClick={() => { setPractice(practice ?? 'closer'); setSaved(false); setTraining(false); setProgress(false); }}><MessageSquare size={18} />Sala de práctica</button><button className={`nav ${training ? 'active' : ''}`} aria-current={training ? 'page' : undefined} onClick={() => { setTraining(true); setSaved(false); setPractice(null); setProgress(false); }}><GraduationCap size={18} />Formación</button><button className={`nav ${progress ? 'active' : ''}`} aria-current={progress ? 'page' : undefined} onClick={() => { setProgress(true); setSaved(false); setPractice(null); setTraining(false); }}><TrendingUp size={18} />Mi progreso</button></nav>
      <div className="sidebar-note"><span className="eyebrow">TU TALENTO.<br />TU PRÓXIMA EMPRESA.</span><p>Has trabajado para llegar hasta aquí. Ahora elige dónde quieres dar tu siguiente paso.</p></div>
      <div className="local-user"><HeartHandshake size={22} /><div><strong>Comunidad WDC</strong><small>Te acompañamos en el camino</small></div></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div>Women Digital Closer <ChevronRight size={14} /><strong>{saved ? 'Tus guardadas' : practice ? 'Sala de práctica' : training ? 'Formación' : progress ? 'Tu progreso' : 'Oportunidades'}</strong></div><span className="student-tag">De la formación a tu próximo trabajo</span></header>
      <main>
        {progress ? <StudentProgress /> : training ? <StudentTraining /> : practice ? <StudentPractice track={practice} onTrackChange={setPractice} /> : <>
        {!saved && <DailyQuote />}
        <div className="page-heading"><div><span className="eyebrow">EMPRESAS QUE BUSCAN TALENTO COMERCIAL</span><h1>{saved ? 'Las que te interesan.' : 'Elige tu próxima oportunidad.'}</h1><p>{saved ? 'Vuelve a comparar sus condiciones y decide tu siguiente paso.' : 'WDC reúne oportunidades en español para que encuentres dónde quieres crecer.'}</p></div><span className="heading-icon"><Compass size={30} strokeWidth={1.2} /></span></div>
        {!saved && <div className="search-panel student-search">
          {/* Sin campo de frase: con pocas opciones reales, elegir en los desplegables es más rápido y no promete
              una comprensión que el catálogo no siempre puede cumplir. Los filtros son la única puerta. */}
          <form onSubmit={e => { e.preventDefault(); setApplied({ ...query }); history.replaceState(null, '', urlFromQuery(query)); }}>
          <div className="search-grid"><label>Perfil profesional<select value={query.role || ''} onChange={e => setQuery({ ...query, role: (e.target.value || null) as Query['role'] })}><option value="">Todos los perfiles</option>{ROLE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label><label>Desde dónde quieres trabajar<select value={query.market} onChange={e => setQuery({ ...query, market: e.target.value as Query['market'] })}><option value="any">Todos los mercados</option><option value="ES">España</option><option value="EU">Europa</option><option value="LATAM">Latinoamérica</option><option value="US">Estados Unidos</option></select></label><label>Publicación<select value={query.days} onChange={e => setQuery({ ...query, days: Number(e.target.value) })}><option value={1}>Últimas 24 horas</option><option value={3}>Últimos 3 días</option><option value={7}>Últimos 7 días</option><option value={10}>Últimos 10 días</option></select></label></div>
          <div className="student-preferences">
            <Ticks legend="Modalidad" value={query.modality} options={[{ value: 'remote', label: 'Remoto' }, { value: 'hybrid', label: 'Híbrido' }, { value: 'onsite', label: 'Presencial' }]} onChange={value => setQuery({ ...query, modality: value as Query['modality'] })} />
            <Ticks legend="Prospección" value={query.sales_motion} hint="Solo cuando el anuncio lo menciona. Sin marcar: cualquiera." options={[{ value: 'outbound', label: 'En frío (outbound)' }, { value: 'inbound', label: 'Leads entrantes (inbound)' }]} onChange={value => setQuery({ ...query, sales_motion: value as Query['sales_motion'] })} />
            <label className="check-label"><input type="checkbox" checked={query.include_bilingual} onChange={e => setQuery({ ...query, include_bilingual: e.target.checked })} />También oportunidades bilingües español / inglés</label>
            <button className="primary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <Search size={17} />}Ver oportunidades</button></div>
          </form>
        </div>}
        {error && <p className="alert error" role="alert">{error}</p>}
        {degraded && !busy && <p className="selection-note" role="status">El catálogo general no responde ahora mismo. Estas son las ofertas externas ya revisadas y aprobadas; el resto volverá cuando el buscador se recupere.</p>}
        {!saved && <OpportunityRadar offers={[...visible, ...(wider ?? [])]} busy={busy} role={applied.role ?? null} onRole={next => applyQuery({ ...applied, role: next })} />}
        <section className="student-results" aria-busy={busy} ref={resultsRef}><div className="results-heading"><h2>{saved ? 'Tus oportunidades guardadas' : 'Oportunidades para explorar'} <span>{busy ? '…' : visible.length + (wider?.length ?? 0)}</span></h2><span className="student-freshness">Actualización diaria</span></div>
          {!saved && !busy && selectionTotal > 0 && <p className="selection-note">Selección del día: las {selectionTotal} que mejor cumplen los requisitos van primero. Puedes explorar el resto del catálogo debajo.</p>}
          {busy ? <div className="opportunity-grid" aria-hidden="true"><div className="opportunity-card is-skeleton"><span className="shimmer-line wide" /><span className="shimmer-line" /><span className="shimmer-line" /><span className="shimmer-line short" /></div><div className="opportunity-card is-skeleton is-late"><span className="shimmer-line wide" /><span className="shimmer-line" /><span className="shimmer-line" /><span className="shimmer-line short" /></div></div> : !visible.length ? <div className="empty"><Compass size={32} strokeWidth={1.3} /><h3>{saved ? 'Guarda las que te hagan dar el siguiente paso.' : 'Aún no hay oportunidades con estos criterios.'}</h3><p>{saved ? 'Pulsa el marcador de una oferta para volver a verla aquí.' : applied.modality !== 'any' || applied.sales_motion !== 'any' ? 'Solo enseñamos las que declaran lo que pides. Quita la modalidad o la prospección para ver el catálogo completo, o elige otro perfil o mercado.' : 'Puedes elegir otro perfil o mercado. Seguimos buscando nuevas oportunidades en español.'}</p></div> :          <div className="opportunity-grid">{paged.map((offer, index) => <div key={offer.id} style={{ animationDelay: `${Math.min(index, 10) * 30}ms` }}><OfferCard offer={offer}
              starred={isStarred(offer)} saving={saving === offer.id}
              onStar={() => void star(offer)} onOpen={() => setDetail(offer)} /></div>)}</div>}
          {!busy && total > PAGE_SIZE && <nav className="pager" aria-label="Páginas de oportunidades">
            <button type="button" disabled={current === 1} onClick={() => goToPage(current - 1)}>Anterior</button>
            {pageNumbers(current, pageCount).map((n, i) => n === 'gap'
              ? <span key={`gap-${i}`} className="pager-gap" aria-hidden="true">…</span>
              : <button type="button" key={n} className={n === current ? 'is-current' : ''} aria-current={n === current ? 'page' : undefined} onClick={() => goToPage(n)}>{n}</button>)}
            <button type="button" disabled={current === pageCount} onClick={() => goToPage(current + 1)}>Siguiente</button>
            <span className="pager-count">Mostrando {start + 1}–{Math.min(start + PAGE_SIZE, total)} de {total}</span>
          </nav>}
          {!saved && !busy && wider?.length ? <div className="wider-bucket">
            <h3>{items.length} con tu filtro · {wider.length} más del catálogo {applied.market !== 'any' ? 'con tu mercado' : 'comercial en español'}</h3>
            <p>Con tu filtro de perfil no aparecían suficientes {applied.role ? `ofertas de ${label(applied.role)}` : 'ofertas en tu mercado'}; estas vienen del mismo catálogo real con el filtro ampliado, en {applied.include_bilingual ? 'español o inglés' : 'español'}{widerFamilies.length ? ` y de ${widerFamilies.join(', ')}` : ''}.</p>
            <div className="opportunity-grid">{wider.map(offer => <OfferCard key={offer.id} offer={offer} compact
                starred={isStarred(offer)} saving={saving === offer.id}
                onStar={() => void star(offer)} onOpen={() => setDetail(offer)} />)}</div>
          </div> : null}
        </section>
        <p className="footnote"><BriefcaseBusiness size={14} />Tú eliges dónde avanzar. Revisa las condiciones y presenta tu candidatura en el proceso de la empresa.</p>
        </>}
      </main>
    </div>
    <dialog ref={dialog} onClose={() => setDetail(null)} onClick={e => { if (e.target === dialog.current) dialog.current.close(); }}>{detail && <div className="detail"><div className="detail-top"><span className="eyebrow">TU SIGUIENTE PASO</span><button className="icon-button" aria-label="Cerrar oportunidad" onClick={() => dialog.current?.close()}><X size={20} /></button></div><p className="job-company">{detail.company}</p><h2>{jobTitle(detail)}</h2><p className="role-chip detail-role">{detail.role_label}</p>{detail.caution && <div className="offer-caution is-detail" role="note"><ShieldAlert size={16} /><div><strong>{detail.caution.title}</strong><ul>{detail.caution.flags.map(flag => <li key={flag}>{flag}</li>)}</ul><p>{detail.caution.note}</p></div></div>}<PayBlock offer={detail} /><p>{detail.modality} · {detail.location} · {detail.language}{detail.sales_motion ? ` · ${motionText(detail.sales_motion)}` : ''}</p><h3>Lo que cuenta la empresa</h3><div className="description">{detail.description}</div><div className="provenance"><span>Publicada: {date(detail.published_at)}</span><span>Publicación de {detail.source_name}. Confirma que el proceso siga abierto antes de enviar tu candidatura.</span></div><div className="detail-actions"><a className="primary" href={applyTo(detail)} target="_blank" rel="noopener noreferrer">Aplicar en {hostOf(applyTo(detail))}<ArrowUpRight size={16} /></a>{detail.company_url && <a className="link-button" href={detail.company_url} target="_blank" rel="noopener noreferrer">Web publicada en el anuncio ({hostOf(detail.company_url)})<ArrowUpRight size={14} /></a>}<button disabled={saving === detail.id} onClick={() => void star(detail)}><Bookmark size={16} />{isStarred(detail) ? 'Quitar de guardadas' : 'Guardar oportunidad'}</button></div>{(detail.contact?.emails?.length || detail.contact?.phones?.length) ? <div className="contact-published"><h3>Contacto publicado en el anuncio</h3>{!!detail.contact?.emails?.length && <p>Email: {detail.contact.emails.join(' · ')}</p>}{!!detail.contact?.phones?.length && <p>Teléfono: {detail.contact.phones.join(' · ')}</p>}<p className="inline-hint">Tal como lo publica la empresa en el anuncio. WDC no lo completa ni lo verifica.</p></div> : null}<p className="inline-hint">Abrir el enlace no envía tu candidatura: se envía en el portal o en la web de la empresa.</p></div>}</dialog>
  </div>;
}
