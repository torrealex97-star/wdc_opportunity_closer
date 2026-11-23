// Motivo por el que una oferta quedó en una cola o se retiró (`auto_review.why`), con el texto que ve quien administra. Un solo
// sitio: lo usan el embudo y la bandeja. Cada motivo de cola humana dice QUÉ tiene que mirar la persona, no solo la etiqueta.

export const WHY_LABEL: Record<string, string> = {
  sin_perfil: 'Sin perfil comercial', sin_mercado: 'Sin mercado', mercado_dudoso: 'Mercado dudoso', banderas_rojas: 'Banderas rojas', oferta_peligrosa: 'Oferta peligrosa',
  oferta_con_avisos: 'Oferta con avisos', cumplido_con_aviso: 'Con aviso', cumple_reglas: 'Cumple las reglas', cumple_reglas_con_aviso: 'Cumple con aviso',
  score_bajo: 'Puntuación baja', idioma_dudoso: 'Idioma dudoso', sin_descripcion: 'Sin descripción', confianza_baja: 'La IA no está segura',
  tope_diario: 'Tope diario', enlace_cerrado: 'Enlace cerrado', no_es_oferta: 'No es oferta',
};

/** Lo que debe comprobar la persona cuando la oferta llega a la cola humana. */
export const REVIEW_HINT: Record<string, string> = {
  mercado_dudoso: 'Parece de España pero el anuncio no lo confirma: decide si es para alumnas de España.',
  banderas_rojas: 'El anuncio trae señales de riesgo: lee las condiciones antes de publicarla.',
  oferta_peligrosa: 'Posible estafa o pago por entrar (inversión previa, multinivel, ingresos irreales): no se publica sola.',
  sin_descripcion: 'No trae descripción: no se puede juzgar el idioma ni las condiciones. Abre el anuncio y decide.',
  confianza_baja: 'La IA dudó (menos de 85 % de confianza): mira su motivo y decide.',
};

export const whyText = (why?: string | null) => (why ? WHY_LABEL[why] ?? why : null);
