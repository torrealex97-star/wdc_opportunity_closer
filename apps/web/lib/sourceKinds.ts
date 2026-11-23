import { hasFreeOperationalRoute, type CatalogLite, type SourceRoute } from './sourceRoutes';

// Tipo de fuente para el Motor de fuentes: Empresas (ATS y páginas propias), Gratuitas (feed o API sin coste por petición) y de Pago (solo se
// consiguen pagando: Apify, Google Jobs de pago…). Una sola regla pura, probada, para que el panel y los recuentos no discrepen.
export type SourceKind = 'pago' | 'gratuitas' | 'empresas';
export const KIND_LABEL: Record<SourceKind, string> = { pago: 'De pago', gratuitas: 'Gratuitas', empresas: 'Empresas y ATS' };

export function kindOf(entry: Pick<CatalogLite, 'code' | 'category'>, routes: SourceRoute[]): SourceKind {
  if (entry.category === 'Empresas' || entry.code.startsWith('ats-') || entry.code === 'company') return 'empresas';
  return hasFreeOperationalRoute(routes) || routes.some(route => route.provider === 'official') ? 'gratuitas' : 'pago';
}
