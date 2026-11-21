import { ORG } from './external';
import { capFromRow, PROVIDER_METERS, type Cap, type MeteredProvider } from './providerBudget';
import { serviceRest } from './supabaseAuth';

// Tope efectivo del panel: `provider_budget` manda por organización y el entorno es el respaldo.
//
// Una sola consulta da los cuatro topes, porque el panel y las rutas los necesitan juntos y pedirlos por
// separado sería cuatro veces la misma tabla. Si no se puede leer (sin migración, sin clave de servicio, un
// HTTP raro o una respuesta que no es una lista), cada proveedor cae a su variable de entorno y el motivo
// viaja en `error`: no se inventa un tope ni se confunde «no se pudo leer» con «cero».
export const METERED_PROVIDERS = Object.keys(PROVIDER_METERS) as MeteredProvider[];

export async function readCaps(orgId: string = ORG): Promise<Record<MeteredProvider, Cap>> {
  const response = await serviceRest(`provider_budget?org_id=eq.${encodeURIComponent(orgId)}&select=provider,monthly_usd,updated_by,updated_at`).catch(() => null);
  const rows = response?.ok ? await response.json().catch(() => null) : null;
  const error = !response
    ? 'No se pudo consultar provider_budget; se usa el tope del entorno.'
    : !response.ok
      ? `No se pudo leer provider_budget (HTTP ${response.status}); se usa el tope del entorno.`
      : !Array.isArray(rows)
        ? 'provider_budget no devolvió una lista; se usa el tope del entorno.'
        : null;
  const byProvider = new Map<string, { monthly_usd?: unknown; updated_by?: string | null; updated_at?: string | null }>();
  if (Array.isArray(rows)) {
    for (const row of rows as Array<{ provider?: unknown; monthly_usd?: unknown; updated_by?: string | null; updated_at?: string | null }>) {
      // Una fila sin `updated_by` es la semilla de la migración (5 USD para todos), no una decisión del
      // propietario: no pisa la variable de entorno que el operador ya tuviera. Solo manda lo guardado en el panel.
      if (typeof row.provider === 'string' && row.updated_by) byProvider.set(row.provider, row);
    }
  }
  const caps = {} as Record<MeteredProvider, Cap>;
  for (const provider of METERED_PROVIDERS) {
    const row = byProvider.get(provider) ?? null;
    const cap = capFromRow(provider, row);
    const withMeta = row && cap.source === 'tabla' ? { ...cap, updated_by: row.updated_by ?? null, updated_at: row.updated_at ?? null } : cap;
    caps[provider] = error ? { ...withMeta, error: withMeta.error ?? error } : withMeta;
  }
  return caps;
}

/** Tope efectivo de un proveedor (tabla → entorno → defecto), con su origen declarado. */
export const capForOrg = async (provider: MeteredProvider, orgId: string = ORG): Promise<Cap> =>
  (await readCaps(orgId))[provider];
