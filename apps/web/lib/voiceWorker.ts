import { timingSafeEqual } from 'node:crypto';

// Autenticación del SERVICIO de voz (no del navegador): `Authorization: Bearer VOICE_WORKER_TOKEN`, de al menos 24 caracteres.
export const workerConfigured = () => (process.env.VOICE_WORKER_TOKEN ?? '').length >= 24;
export function workerAuthorized(request: { headers: { get(name: string): string | null } }) {
  const expected = Buffer.from(process.env.VOICE_WORKER_TOKEN ?? '');
  const given = Buffer.from((request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, ''));
  return expected.length >= 24 && given.length === expected.length && timingSafeEqual(given, expected);
}
