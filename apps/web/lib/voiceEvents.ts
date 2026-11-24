import { ORG } from './external';
import { serviceRest } from './supabaseAuth';
import { listConnections, getSecret } from './integrations';
import { KEY_OF, planCascade, type KeyName, type VoiceEvent, type VoiceEventKind } from './voiceCascade';
import { providerById } from './voiceProvider';

// Incidencias de proveedor de voz (tabla `voice_provider_events`) y la decisión de cascada con los datos reales.
export async function readVoiceEvents(limit = 60): Promise<VoiceEvent[] | null> {
  const response = await serviceRest(`voice_provider_events?org_id=eq.${ORG}&select=provider,kind,created_at&order=created_at.desc&limit=${limit}`).catch(() => null);
  const rows = response?.ok ? await response.json().catch(() => null) : null;
  return Array.isArray(rows) ? rows as VoiceEvent[] : null;
}

export async function recordVoiceEvent(provider: string, kind: string, detail?: string): Promise<{ ok: true } | { ok: false; kind: 'invalid' | 'store'; error: string }> {
  if (!providerById(provider) || !['ok', 'error', 'payment', 'auth'].includes(kind)) return { ok: false, kind: 'invalid', error: 'Proveedor o tipo de incidencia no válidos.' };
  const response = await serviceRest('voice_provider_events', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ org_id: ORG, provider, kind: kind as VoiceEventKind, detail: detail ? detail.slice(0, 200) : null }) }).catch(() => null);
  if (response?.ok) return { ok: true };
  return { ok: false, kind: 'store', error: response?.status === 404 ? 'Falta aplicar la migración 20261124_voice_providers.sql.' : 'No se pudo anotar la incidencia.' };
}

/** Cascada con las claves y las incidencias reales. Si las claves o las incidencias no se pueden leer, no se elige a ciegas: `sin_leer`. */
export async function currentCascade(now = new Date()) {
  const [connections, events] = await Promise.all([listConnections().catch(() => null), readVoiceEvents()]);
  const configured = connections === null || events === null ? null : new Set(connections.map(c => c.provider as string));
  const keyUpdatedAt: Partial<Record<KeyName, string | null>> = {};
  for (const c of connections ?? []) if (c.provider === 'openai' || c.provider === 'deepgram' || c.provider === 'elevenlabs') keyUpdatedAt[c.provider] = c.updated_at;
  return { ...planCascade({ configured, keyUpdatedAt, events: events ?? [], now }), events: events ?? [], readable: configured !== null };
}
export const secretFor = (provider: keyof typeof KEY_OF) => getSecret(KEY_OF[provider]);
