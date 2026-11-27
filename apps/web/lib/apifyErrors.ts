// Motivo REAL cuando Apify rechaza lanzar una ejecución. Antes cualquier 401 o 403 se contaba como «rechazó la clave»; un 403 también es el
// límite mensual de uso, el saldo o un permiso, y con la clave bien guardada eso escondía la causa (cron del 2026-11-27: 14 portales sin arrancar).
// Módulo puro: solo texto. Nunca se inventa una causa: sin cuerpo legible se dice «sin detalle».
const oneLine = (value: unknown, max: number) => typeof value === 'string'
  ? value.replace(/<[^>]*>/g, ' ').replace(/apify_api_[A-Za-z0-9]+/g, '[clave]').replace(/\s+/g, ' ').trim().slice(0, max) : '';

export function apifyRejection(status: number, body: unknown): string {
  const error = body && typeof body === 'object' ? (body as { error?: { type?: unknown; message?: unknown } }).error : undefined;
  const type = oneLine(error?.type, 60), message = oneLine(error?.message, 110);
  if (status === 401) return `Apify rechazó la clave (HTTP 401${type ? `: ${type}` : ''}).`;
  if (status === 403) return `Apify rechazó la ejecución (HTTP 403: ${type || message ? [type, message].filter(Boolean).join(' · ') : 'sin detalle en la respuesta'}).`;
  return `Apify respondió HTTP ${status}.`;
}
