import { VOICE_PROVIDERS, type VoiceProviderId } from './voiceProvider';

// Cascada de proveedores de voz: se usa el MÁS BARATO que tenga clave y esté sano; si falla por pago, clave o errores, se sigue con el
// siguiente. Función pura: decide con las claves guardadas y las incidencias que le dan; no llama a ningún proveedor.
export type VoiceEventKind = 'ok' | 'error' | 'payment' | 'auth';
export type VoiceEvent = { provider: string; kind: VoiceEventKind; created_at: string };
export type KeyName = 'openai' | 'deepgram' | 'elevenlabs';
/** Qué clave del panel de APIs usa cada proveedor (los dos modelos de OpenAI comparten la suya). */
export const KEY_OF: Record<VoiceProviderId, KeyName> = { openai_realtime_mini: 'openai', openai_realtime: 'openai', deepgram_agent: 'deepgram', elevenlabs_agents: 'elevenlabs' };

export const KEY_PAUSE_MS = 24 * 3_600_000;   // pago o clave rechazada: se vuelve a probar al día siguiente (o antes si se guarda otra clave)
export const ERROR_PAUSE_MS = 15 * 60_000;    // dos fallos seguidos: se aparta 15 minutos
export type CascadeState = 'activo' | 'sin_clave' | 'pausado_pago' | 'pausado_clave' | 'pausado_error' | 'sin_leer';
export type CascadeEntry = { id: VoiceProviderId; label: string; key: KeyName; state: CascadeState; until: string | null; reason: string };

const REASON: Record<CascadeState, string> = {
  activo: 'Con clave y sano.', sin_clave: 'Falta la clave en APIs.', pausado_pago: 'Pausado: el proveedor rechazó el pago o no hay saldo.',
  pausado_clave: 'Pausado: el proveedor rechazó la clave.', pausado_error: 'Pausado: dos errores seguidos.', sin_leer: 'No se pudieron leer las claves guardadas.',
};
const mid = (id: VoiceProviderId) => { const p = VOICE_PROVIDERS.find(x => x.id === id)!; return (p.usdPerMinute.low + p.usdPerMinute.high) / 2; };
/** Del más barato al más caro (punto medio del rango estimado). */
export const cascadeOrder = (): VoiceProviderId[] => VOICE_PROVIDERS.map(p => p.id).sort((a, b) => mid(a) - mid(b));

/** `configured` = proveedores de clave guardados (`null` = no se pudo leer). `keyUpdatedAt`: una clave guardada DESPUÉS de una incidencia la anula. */
export function planCascade(input: { configured: ReadonlySet<string> | null; keyUpdatedAt?: Partial<Record<KeyName, string | null>>; events: VoiceEvent[]; now?: Date }): { chosen: VoiceProviderId | null; order: CascadeEntry[] } {
  const now = (input.now ?? new Date()).getTime();
  const events = input.events.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
  const order = cascadeOrder().map((id): CascadeEntry => {
    const key = KEY_OF[id], label = VOICE_PROVIDERS.find(p => p.id === id)!.label;
    const entry = (state: CascadeState, until: number | null = null): CascadeEntry => ({ id, label, key, state, until: until === null ? null : new Date(until).toISOString(), reason: REASON[state] });
    if (input.configured === null) return entry('sin_leer');
    if (!input.configured.has(key)) return entry('sin_clave');
    const saved = input.keyUpdatedAt?.[key] ?? null;
    // Pago o clave: vale la incidencia más reciente de CUALQUIER proveedor que comparta la clave, si no hay un «ok» posterior ni una clave nueva.
    const sameKey = events.filter(e => KEY_OF[e.provider as VoiceProviderId] === key);
    const last = sameKey[0];
    if (last && (last.kind === 'payment' || last.kind === 'auth') && !(saved && saved > last.created_at)) {
      const until = Date.parse(last.created_at) + KEY_PAUSE_MS;
      if (until > now) return entry(last.kind === 'payment' ? 'pausado_pago' : 'pausado_clave', until);
    }
    const own = events.filter(e => e.provider === id);
    if (own.length >= 2 && own[0].kind === 'error' && own[1].kind === 'error') {
      const until = Date.parse(own[0].created_at) + ERROR_PAUSE_MS;
      if (until > now) return entry('pausado_error', until);
    }
    return entry('activo');
  });
  return { chosen: order.find(e => e.state === 'activo')?.id ?? null, order };
}
