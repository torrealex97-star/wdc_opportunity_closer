'use client';
import { useEffect, useRef } from 'react';
import { ArrowUpRight, Check, KeyRound, X } from 'lucide-react';
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
      <div className="setup-guide-actions">
        {setup.docs && <a className="primary" href={setup.docs.href} target="_blank" rel="noopener noreferrer">{setup.docs.label}<ArrowUpRight size={15} /></a>}
        {setup.provider && onOpenApis && <button type="button" onClick={() => { dialog.current?.close(); onOpenApis(); }}><KeyRound size={15} /> Ir a Panel → APIs</button>}
        <button type="button" onClick={() => dialog.current?.close()}>Cerrar</button>
      </div>
      <p className="setup-guide-foot">Guardar una clave no gasta nada: el gasto empieza cuando se ejecuta una búsqueda o un actor, y queda en «Resultados por fuente».</p>
    </div>
  </dialog>;
}
