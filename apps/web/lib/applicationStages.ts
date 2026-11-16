// Estados del seguimiento de una candidatura y su traducción al tablero (kanban). Vive aparte de
// `applications.ts` porque ese fichero habla con Supabase (solo servidor) y el tablero se pinta en el
// navegador: una sola lista de estados evita que la columna y el servidor digan cosas distintas.
export const STATUSES = ['draft', 'opened', 'applied', 'discarded', 'responded', 'interview', 'offer', 'rejected'] as const;
export const OUTCOMES = ['responded', 'interview', 'offer', 'rejected'] as const;
export const SENT = ['applied', ...OUTCOMES] as const;
export type AppStatus = (typeof STATUSES)[number];

// Transiciones permitidas (la alumna decide; el servidor solo evita saltos incoherentes).
export const NEXT: Record<AppStatus, AppStatus[]> = {
  draft: ['opened', 'applied', 'discarded'],
  opened: ['draft', 'applied', 'discarded'],
  applied: ['responded', 'interview', 'offer', 'rejected', 'discarded'],
  discarded: ['draft'],
  responded: ['interview', 'offer', 'rejected', 'discarded'],
  interview: ['offer', 'rejected', 'discarded'],
  offer: ['discarded'],
  rejected: ['discarded'],
};
export const canMove = (from: AppStatus, to: AppStatus) => from === to || NEXT[from].includes(to);

// Cada estado tiene su nombre; el tablero agrupa estados en columnas con el nombre del paso real.
export const LABELS: Record<AppStatus, string> = {
  draft: 'Borrador',
  opened: 'Anuncio abierto',
  applied: 'Enviada por ti',
  discarded: 'Descartada',
  responded: 'La empresa ha respondido',
  interview: 'Entrevista',
  offer: 'Oferta recibida',
  rejected: 'Respuesta negativa',
};

export type Stage = { id: string; title: string; hint: string; statuses: AppStatus[] };
// Orden del proceso real: del interés a la decisión. «Sin respuesta» es seguimiento, no descarte:
// una candidatura enviada y callada sigue viva y es la que hay que empujar.
export const STAGES: Stage[] = [
  { id: 'interested', title: 'Me interesa', hint: 'Guardadas y borradores', statuses: ['draft', 'opened'] },
  { id: 'applied', title: 'Enviada', hint: 'Ya la has mandado tú', statuses: ['applied'] },
  { id: 'follow_up', title: 'Seguimiento', hint: 'Han contestado, sin fecha aún', statuses: ['responded'] },
  { id: 'interview', title: 'Entrevista', hint: 'Te han citado', statuses: ['interview'] },
  { id: 'offer', title: 'Oferta', hint: 'Te han hecho una oferta', statuses: ['offer'] },
  { id: 'closed', title: 'Descartadas', hint: 'Tú o la empresa', statuses: ['discarded', 'rejected'] },
];
export const stageOf = (status: AppStatus): Stage => STAGES.find(stage => stage.statuses.includes(status)) ?? STAGES[0];

// Motivos de cada movimiento, con el texto de la empresa/alumna: el botón dice lo que va a pasar.
export const MOVE_LABELS: Record<AppStatus, string> = {
  draft: 'Volver a borrador',
  opened: 'Marcar anuncio abierto',
  applied: 'Ya la he enviado',
  discarded: 'Descartar',
  responded: 'Han respondido',
  interview: 'Me han citado a entrevista',
  offer: 'Me han hecho una oferta',
  rejected: 'Me han dicho que no',
};
