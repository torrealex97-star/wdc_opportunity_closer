'use client';
import { useEffect, useRef } from 'react';
import { AlertTriangle, ArrowUpRight, CalendarCheck, Check, Clock, CreditCard, KeyRound, X } from 'lucide-react';
import type { Setup } from '../lib/sourceSetup';

// Guía de puesta en marcha de una fuente que aún no recoge. Se abre con «Cómo conectarla» y reúne en un
// solo sitio el requisito, los pasos, el enlace oficial y el atajo a las claves: antes el operador tenía
// que adivinar si faltaba un token, un actor de pago o un enlace. No ejecuta nada ni guarda datos.
export default function SourceSetupGuide({ name, code, setup, onClose, onOpenApis }: {
  name: string; code: string; setup: Setup; onClose: () => void; onOpenApis?: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = dialog.current;
    if (el && !el.open) el.showModal();
  }, []);
  return <dialog ref={dialog} className="setup-guide" onClose={onClose}
    onClick={event => { if (event.target === dialog.current) dialog.current?.close(); }}>
    <div className="setup-guide-body">
      <div className="setup-guide-top">
        <span className="eyebrow">{code.toUpperCase()} · CÓMO CONECTARLA</span>
        <button type="button" className="icon-button" aria-label="Cerrar la guía" onClick={() => dialog.current?.close()}><X size={20} /></button>
      </div>
      <h2>{name}</h2>
      <p className="setup-guide-need"><strong>Qué falta.</strong> {setup.requirement}</p>
      <div className="setup-guide-needs">
        <span><Clock size={14} /> {setup.minutes ?? '10–15 min'}</span>
        <span><CreditCard size={14} /> {setup.card ? 'Tarjeta sí (verificación o pago por uso)' : 'Sin tarjeta'}</span>
        <span>{setup.account ?? 'La cuenta del portal o proveedor.'}</span>
      </div>
      <ol className="setup-guide-steps">
        {setup.steps.map((step, index) => <li key={step}><span className="setup-guide-num" aria-hidden="true">{index + 1}</span><span>{step}</span></li>)}
      </ol>
      {!!setup.alternatives?.length && <div className="setup-guide-alts">
        <p className="setup-guide-alts-title">Otras vías, antes de pagar por un actor</p>
        <ul>
          {setup.alternatives.map(alt => <li key={alt.route}><strong>{alt.route}.</strong> {alt.detail}{
            alt.href && <> <a href={alt.href} target="_blank" rel="noopener noreferrer">Ver<ArrowUpRight size={12} /></a></>
          }</li>)}
        </ul>
      </div>}
      {setup.cost && <p className="setup-guide-cost"><Check size={14} /><span>{setup.cost}</span></p>}
      {setup.worksWhen && <div className="setup-guide-check"><p><strong>Cómo saber que funciona.</strong> {setup.worksWhen}</p></div>}
      {!!setup.failures?.length && <div className="setup-guide-fails">
        <p><AlertTriangle size={14} /> <strong>Los tres fallos que verás</strong></p>
        <ul>{setup.failures.slice(0, 3).map(failure => <li key={failure}>{failure}</li>)}</ul>
      </div>}
      {setup.video && <p className="card-meta"><a href={setup.video.href} target="_blank" rel="noopener noreferrer">{setup.video.label}<ArrowUpRight size={12} /></a></p>}
      {setup.checkedAt && <p className="card-meta"><CalendarCheck size={12} /> Última comprobación: {setup.checkedAt}. Si el portal cambia, esta guía se actualiza con él; no se promete una fecha que no se haya verificado.</p>}
      <div className="setup-guide-actions">
        {setup.docs && <a className="primary" href={setup.docs.href} target="_blank" rel="noopener noreferrer">{setup.docs.label}<ArrowUpRight size={15} /></a>}
        {setup.provider && onOpenApis && <button type="button" onClick={() => { dialog.current?.close(); onOpenApis(); }}><KeyRound size={15} /> Ir a Panel → APIs</button>}
        <button type="button" onClick={() => dialog.current?.close()}>Cerrar</button>
      </div>
      <p className="setup-guide-foot">Guardar una clave no gasta nada: el gasto empieza cuando se ejecuta una búsqueda o un actor, y queda en «Resultados por fuente».</p>
    </div>
  </dialog>;
}
