'use client';
import { useEffect, useMemo } from 'react';
import { PartyPopper, X } from 'lucide-react';

// Celebración al registrar una candidatura enviada. El confeti es decorativo (aria-hidden), no captura
// clics y se apaga con `prefers-reduced-motion`; el mensaje y los CTAs siguen siendo accesibles.
const COLORS = ['var(--accent)', 'var(--sage)', 'var(--warning)', 'var(--ink)'] as const;
const PIECES = 26;

export type CelebrationProps = {
  title: string;
  detail: string;
  applications: number;
  week: number;
  nextMilestone: number | null;
  onClose: () => void;
};

export default function Celebration({ title, detail, applications, week, nextMilestone, onClose }: CelebrationProps) {
  useEffect(() => {
    const timer = window.setTimeout(onClose, 9000);
    return () => window.clearTimeout(timer);
  }, [onClose]);
  const pieces = useMemo(() => Array.from({ length: PIECES }, (_, i) => ({
    left: `${(i * 37) % 100}%`,
    delay: `${(i % 9) * 0.12}s`,
    duration: `${2.4 + (i % 5) * 0.25}s`,
    rotate: `${(i * 53) % 360}deg`,
    color: COLORS[i % COLORS.length],
    wide: i % 3 === 0,
  })), []);
  return <div className="celebration" role="status" aria-live="polite">
    <div className="confetti" aria-hidden="true">{pieces.map((piece, i) => <span key={i} style={{ left: piece.left, animationDelay: piece.delay, animationDuration: piece.duration, transform: `rotate(${piece.rotate})`, background: piece.color, width: piece.wide ? 10 : 6 }} />)}</div>
    <div className="celebration-card">
      <button type="button" className="icon-button" aria-label="Cerrar la celebración" onClick={onClose}><X size={18} /></button>
      <span className="celebration-icon"><PartyPopper size={22} /></span>
      <h2>{title}</h2>
      <p>{detail}</p>
      <dl className="celebration-stats">
        <div><dt>Enviadas en total</dt><dd>{applications}</dd></div>
        <div><dt>Esta semana</dt><dd>{week}</dd></div>
        {nextMilestone !== null && <div><dt>Próximo hito</dt><dd>{applications}/{nextMilestone}</dd></div>}
      </dl>
      <div className="celebration-actions">
        <a className="primary" href="/">Aplicar a otra oferta</a>
        <a href="/?tab=formacion">Hacer un test rápido</a>
      </div>
    </div>
  </div>;
}
