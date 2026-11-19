// Etiquetas de los ejes de la sala. Viven aquí (y no en un componente) para que «Mi progreso» y la
// recomendación de práctica nombren igual la misma competencia, sin duplicar textos. El panel puede
// renombrar un criterio: `/api/practice` devuelve el mapa vigente y la alumna ve el mismo nombre.
export const AXIS_LABELS: Record<string, string> = {
  apertura: 'Apertura y agenda',
  descubrimiento: 'Clarify, label y pain cycle',
  pitch: 'Pitch en dos minutos',
  control: 'Control con preguntas',
  objecion: 'Objeciones y cierre',
  siguiente: 'Handshake y siguiente paso',
  etica: 'Rapport y ética',
  cualificacion: 'BANT y cualificación',
  agenda: 'Edificación y agenda',
  traspaso: 'Traspaso al closer',
  marco: 'Marco',
  cierre: 'Cierre',
  seguimiento: 'Seguimiento',
  confianza: 'Confianza y autoridad',
  claridad: 'Claridad y estructura',
  evidencia: 'Evidencia y cifras',
  criterio: 'Criterio comercial',
  encaje: 'Encaje',
  iniciativa: 'Cierre e iniciativa',
};
