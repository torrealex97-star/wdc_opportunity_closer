// Datos del responsable del tratamiento: los pone el propietario por variables de entorno (Vercel). Mientras falten, la política
// los muestra como «pendiente de completar»: no se inventa ninguna razón social, CIF ni dirección.
const pending = '[pendiente de completar]';
export const legalEntity = () => ({
  name: process.env.LEGAL_ENTITY_NAME?.trim() || pending,
  taxId: process.env.LEGAL_ENTITY_TAX_ID?.trim() || pending,
  address: process.env.LEGAL_ENTITY_ADDRESS?.trim() || pending,
  email: process.env.LEGAL_PRIVACY_EMAIL?.trim() || pending,
});
export const POLICY_VERSION = 'v3-borrador', POLICY_DATE = '2026-10-25';
export const TERMS_VERSION = 'v1-borrador', TERMS_DATE = '2026-10-25';

// Texto del consentimiento de voz (se muestra y se acepta ANTES de la primera sesión de voz continua). BORRADOR: lo revisa un profesional
// antes de activar VOICE_ROLEPLAY; la versión guardada en student_voice_consent es VOICE_CONSENT_VERSION (lib/voice.ts).
export const VOICE_CONSENT_TEXT = [
  'Voy a practicar hablando con una voz de inteligencia artificial. Para ello, mi voz se envía en directo a un proveedor de voz que la convierte en texto y genera la respuesta hablada.',
  'No se guarda mi audio. Solo se conserva el texto de la conversación y la nota, para darme feedback y que yo pueda repasarlos. Puedo borrarlos desde mi perfil.',
  'Puedo practicar hasta 10 minutos al día. Al llegar al límite la sesión se corta y se me avisa.',
  'Puedo retirar este consentimiento cuando quiera desde mi perfil y seguir practicando por escrito, sin ninguna penalización.',
  'No hablaré de datos personales de terceros ni de información confidencial de mi empleo actual.',
] as const;
export const COOKIES_VERSION = 'v1-borrador', COOKIES_DATE = '2026-11-24';
