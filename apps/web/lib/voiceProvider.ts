// Proveedores candidatos de voz continua (ADR-015, fase B). Este módulo NO llama a ninguno: es el catálogo que el panel muestra y la
// calculadora de coste que aplica los topes. Elegir uno y firmar su retención cero es decisión del propietario (ADR-013).
// Precios: leídos de páginas públicas el 2026-11-24 (*inspected*); son ESTIMACIONES por minuto de conversación, no una factura.

export type VoiceProviderId = 'openai_realtime_mini' | 'deepgram_agent' | 'elevenlabs_agents' | 'openai_realtime';
export type VoiceProviderInfo = {
  id: VoiceProviderId; label: string;
  /** Rango estimado en US$ por minuto de conversación (mín–máx). */
  usdPerMinute: { low: number; high: number };
  zeroRetention: string; note: string; source: string;
};

export const VOICE_PROVIDERS: VoiceProviderInfo[] = [
  { id: 'openai_realtime_mini', label: 'OpenAI Realtime (mini)', usdPerMinute: { low: 0.02, high: 0.05 },
    zeroRetention: 'Retención cero solo con aprobación de OpenAI para la organización (por confirmar).',
    note: 'La opción más barata de las tres; el coste sube si la conversación es larga y no hay caché de contexto.', source: 'https://openai.com/api/pricing' },
  { id: 'deepgram_agent', label: 'Deepgram Voice Agent', usdPerMinute: { low: 0.05, high: 0.075 },
    zeroRetention: 'Por confirmar con Deepgram por escrito (no leído en su página pública).',
    note: 'Precio fijo por minuto de conexión (voz a texto, modelo y voz incluidos); fácil de presupuestar.', source: 'https://deepgram.com/pricing' },
  { id: 'elevenlabs_agents', label: 'ElevenLabs Agents', usdPerMinute: { low: 0.08, high: 0.16 },
    zeroRetention: 'Modo de retención cero por agente (documentado); su disponibilidad por plan está por confirmar.',
    note: '0,08 US$/min de plataforma más el modelo de lenguaje a coste; 0,16 si se supera la concurrencia. Mejor calidad de voz.', source: 'https://elevenlabs.io/pricing/agents' },
  { id: 'openai_realtime', label: 'OpenAI Realtime (completo)', usdPerMinute: { low: 0.06, high: 0.11 },
    zeroRetention: 'Igual que el mini: solo con aprobación (por confirmar).', note: 'Más calidad de razonamiento que el mini, a más del doble de precio.', source: 'https://openai.com/api/pricing' },
];

export const providerById = (id: string) => VOICE_PROVIDERS.find(p => p.id === id);
/** Coste estimado en el PEOR caso del rango. Los topes se aplican con esto: mejor frenar de más que gastar de más. */
export const estimateUsd = (id: string, seconds: number): number | null => {
  const p = providerById(id); if (!p || !Number.isFinite(seconds) || seconds < 0) return null;
  return Math.round((seconds / 60) * p.usdPerMinute.high * 10_000) / 10_000;
};
