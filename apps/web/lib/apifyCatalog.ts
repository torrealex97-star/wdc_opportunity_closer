// Catálogo de «portales» y sus buscadores de repuesto. Quien administra la app elige PORTALES («Indeed», «InfoJobs»…);
// los nombres técnicos de los buscadores (actores de Apify) son un detalle interno: si uno falla, la app prueba el siguiente.
//
// Dos capas:
//  1. CURADOS: portales con texto escrito para el operador y, si hace falta, plantilla de entrada.
//  2. GENERADOS (`apifyPortals.ts`, escrito por `scripts/export_apify_portals.py`): una entrada por fuente del
//     catálogo que solo se puede conectar por pago y TIENE actores auditados en la tienda de Apify. No se
//     inventa ningún actor; lo que no está auditado no aparece y el panel lo declara «sin proveedor verificado».
//     Ya vienen en la forma de `Portal` (nombre, frase para el operador, campos que exige cada buscador): aquí
//     solo se suman a los curados y se les pone el aviso de las redes.
//
// IMPORTANTE (honestidad): los buscadores son CANDIDATOS con metadatos revisados; metadatos no es una extracción
// validada. Por eso la app no se fía de ninguno: valida la ficha y el esquema al lanzar, vigila el resultado de
// cada ejecución y pasa al siguiente si falla o devuelve 0 ofertas.
// Es un módulo TypeScript normal, sin atributo de importación: Next lo empaqueta y las pruebas también lo
// ejecutan en Node (`tests/apify-portals.mjs`), así que lo que se prueba es lo que ve el panel.
import { GENERATED_PORTALS } from './apifyPortals';

export type Recipe = {
  actor: string; name: string; needs?: string[];
  // Plantilla propia del buscador. Manda sobre la del portal: los repuestos de un mismo portal no
  // siempre comparten contrato (Workana: `query` + `locale` en uno, `searchQuery` en otro, `keyword`
  // + `language` en el tercero). Sin ella se usa la del portal.
  inputTemplate?: Record<string, unknown>;
};
export type Portal = {
  id: string; source: string; name: string; plain: string; caution?: string;
  maxItems: number; testItems: number; query?: string; sites?: string[]; recipes: Recipe[];
  // Términos por los que rota la búsqueda, uno por día UTC: una ejecución sigue siendo UNA búsqueda,
  // así que cubrir varios sinónimos no multiplica el gasto. `query` es el primero de la lista.
  queries?: string[];
  // Plantilla de entrada para los actores cuyo contrato no encaja con los sinónimos genéricos
  // (p. ej. Workana espera `country` como código ISO de 2 letras, no «España»). Se guarda en la
  // fila del actor y solo se rellenan los huecos {{query}}, {{max_items}}, etc.
  inputTemplate?: Record<string, unknown>;
};

const CURATED: Portal[] = [
  {
    // Indeed: las tres recetas están auditadas (`apps/api/career/source_audit.json`) y su esquema se leyó en la página pública de
    // entrada de cada actor (2026-11-23). Las anteriores (boncross, chuckling_hemp, ayeeyee) no estaban auditadas y fallaban con
    // «No se pudo leer el esquema». Cada una lleva su plantilla: los campos y el formato del país NO coinciden entre ellas.
    id: 'indeed', source: 'apify-indeed', name: 'Indeed (España)', maxItems: 200, testItems: 10, query: 'closer de ventas',
    queries: ['closer de ventas', 'setter de ventas', 'cold caller', 'televenta', 'closer high ticket', 'asesor comercial'],
    plain: 'Uno de los portales con más ofertas comerciales en España.',
    recipes: [
      { actor: 'misceres/indeed-scraper', name: 'Buscador de Indeed A',
        inputTemplate: { position: '{{query}}', country: 'ES', location: 'España', maxItemsPerSearch: '{{max_items}}' } },
      { actor: 'kaix/indeed-scraper', name: 'Buscador de Indeed B',
        inputTemplate: { keyword: '{{query}}', country: 'ES', location: 'España', maxItems: '{{max_items}}' } },
      { actor: 'borderline/indeed-scraper', name: 'Buscador de Indeed C',
        inputTemplate: { query: '{{query}}', country: 'es', location: 'España', maxRows: '{{max_items}}' } },
    ],
  },
  {
    // El esquema de `haketa/infojobs-scraper` no se pudo leer entero en su página pública (2026-11-23): se mantiene la
    // entrada genérica de la app y se rota el término (una búsqueda al día) para cubrir closer, setter y televenta.
    id: 'infojobs', source: 'apify-infojobs', name: 'InfoJobs', maxItems: 200, testItems: 10, query: 'closer ventas',
    queries: ['closer ventas', 'setter ventas', 'televenta', 'comercial a distancia', 'cold calling'],
    plain: 'El portal de empleo más usado en España. Si ya tienes la clave oficial de InfoJobs en la pestaña APIs, esa vía es gratuita y preferible.',
    recipes: [{ actor: 'haketa/infojobs-scraper', name: 'Buscador de InfoJobs' }],
  },
  {
    // LinkedIn: un término al día, rotando por el vocabulario canónico del motor (español e inglés).
    // La muestra de 104 ofertas con 1 aprobada no basta para concluir nada (decisión del dueño,
    // 2026-11-22): no se recorta la fuente, se busca mejor. `crawlworks/linkedin-job-scraper`
    // devolvía 404 en la API pública el 2026-11-22 y se sustituye por el candidato auditado
    // `cheap_scraper/linkedin-job-scraper` (campo `keyword` y `maxItems`, que la app sabe rellenar).
    id: 'linkedin', source: 'apify-linkedin', name: 'LinkedIn', maxItems: 100, testItems: 10, query: 'closer de ventas',
    queries: ['closer de ventas', 'high ticket closer', 'sales closer', 'setter de ventas', 'appointment setter', 'cold caller', 'closer remoto'],
    plain: 'Ofertas públicas de LinkedIn (sin cuentas personales ni datos de contacto).',
    caution: 'LinkedIn limita el uso automático en sus condiciones. Se busca poco volumen y es una decisión tuya (ADR-011). Viene apagado.',
    recipes: [
      { actor: 'curious_coder/linkedin-jobs-scraper', name: 'Buscador de LinkedIn A' },
      // Esquemas leídos en la página pública de entrada (2026-11-23). B: `keyword` y `locations` son listas (una búsqueda por
      // término y ubicación: España, LatAm y EE. UU., los tres mercados del producto, para que no mande solo EE. UU.);
      // `publishedAt` r604800 = última semana; sin agencias de reclutamiento ni prácticas/recepción/conductor; únicos para no pagar duplicados. C: `keywords` obligatorio y `location` por defecto
      // «United States» (por eso se fija). A y D: su esquema no se pudo leer; usan la entrada genérica de la app.
      { actor: 'cheap_scraper/linkedin-job-scraper', name: 'Buscador de LinkedIn B',
        inputTemplate: { keyword: ['{{query}}'], locations: ['España', 'México', 'Colombia', 'Argentina', 'Chile', 'Estados Unidos'], publishedAt: 'r604800', excludeRecruitingAgencies: true,
          jobTitleExclude: ['intern', 'internship', 'becario', 'prácticas', 'receptionist', 'recepcionista', 'driver', 'conductor'], saveOnlyUniqueItems: true, maxItems: '{{max_items}}' } },
      { actor: 'gopalakrishnan/linkedin-jobs', name: 'Buscador de LinkedIn C',
        inputTemplate: { keywords: '{{query}}', location: 'España', maxResults: '{{max_items}}' } },
      { actor: 'harvestapi/linkedin-job-search', name: 'Buscador de LinkedIn D' },
    ],
  },
  {
    // Workana: mercado de proyectos freelance de ventas en España y LatAm (P04B). «ventas» a secas
    // traía proyectos de cualquier cosa: se busca por términos de cierre, uno al día, con la categoría
    // de ventas del actor principal. NO se le pasa `country` (espera un código ISO de dos letras) ni se
    // infiere sueldo del presupuesto: un presupuesto por proyecto no es un salario.
    // Los esquemas leídos el 2026-11-22 no coinciden entre buscadores: A usa `query`/`locale`/`maxPages`,
    // B exige `searchQuery`/`maxRequestsPerCrawl` y C usa `keyword`/`language`. Por eso cada uno lleva
    // su plantilla; con la común, B no arrancaba (le faltaba su campo obligatorio) y C buscaba sin filtro.
    id: 'workana', source: 'apify-workana', name: 'Workana', maxItems: 100, testItems: 10, query: 'closer de ventas',
    queries: ['closer de ventas', 'setter de ventas', 'cold caller', 'cierre de ventas', 'closer high ticket', 'cerrador de ventas'],
    plain: 'Proyectos freelance de ventas en España y LatAm. El presupuesto es por proyecto, no un sueldo.',
    inputTemplate: { query: '{{query}}', category: 'sales-marketing', locale: 'es', maxItems: '{{max_items}}', maxPages: 5 },
    recipes: [
      { actor: 'automation-lab/workana-freelance-projects-scraper', name: 'Buscador de Workana A' },
      { actor: 'getdataforme/workana-job-scraper', name: 'Buscador de Workana B',
        inputTemplate: { searchQuery: '{{query}}', maxRequestsPerCrawl: 5 } },
      { actor: 'gio21/workana-scraper', name: 'Buscador de Workana C',
        inputTemplate: { keyword: '{{query}}', language: 'es', maxItems: '{{max_items}}' } },
    ],
  },
  {
    // Upwork: proyectos freelance de closer/setter/cold calling (cuentan igual que un empleo, decisión del dueño 2026-11-23). Una
    // ejecución = un término, rotando por día. `cookies` y `sessionToken` se dejan VACÍOS (ADR-011: nunca credenciales de cuentas).
    // El presupuesto de un proyecto no es un sueldo (P04B). Esquemas leídos en la página pública de entrada (2026-11-23).
    id: 'upwork', source: 'apify-upwork', name: 'Upwork', maxItems: 50, testItems: 10, query: 'sales closer',
    queries: ['sales closer', 'appointment setter', 'cold caller', 'high ticket closer', 'cold calling', 'setter'],
    plain: 'Proyectos freelance de closer, setter y cold calling en Upwork. El presupuesto es por proyecto, no un sueldo.',
    caution: 'Upwork limita el uso automático en sus condiciones. Se busca poco volumen y nunca con cuentas ni cookies (ADR-011).',
    recipes: [
      { actor: 'neatrat/upwork-job-scraper', name: 'Buscador de Upwork A',
        inputTemplate: { query: '{{query}}', pagesToScrape: 1, perPage: 20, maxJobAge: 7 } },
      { actor: 'blackfalcondata/upwork-scraper', name: 'Buscador de Upwork B',
        inputTemplate: { query: '{{query}}', maxResults: '{{max_items}}', compact: true, skipReposts: true } },
    ],
  },
  {
    id: 'infoempleo', source: 'apify-infoempleo', name: 'Infoempleo', maxItems: 100, testItems: 10, query: 'closer de ventas',
    queries: ['closer de ventas', 'setter de ventas', 'televenta', 'comercial a distancia'],
    plain: 'Portal de empleo en España: ofertas comerciales y de televenta.',
    recipes: [
      { actor: 'bibian/infoempleo-jobs-scraper', name: 'Buscador de Infoempleo',
        inputTemplate: { keywords: '{{query}}', location: 'España', maxItems: '{{max_items}}' } },
    ],
  },
  {
    id: 'simplyhired', source: 'apify-simplyhired', name: 'SimplyHired', maxItems: 100, testItems: 10, query: 'sales closer',
    queries: ['sales closer', 'appointment setter', 'cold caller', 'high ticket closer'],
    plain: 'Agregador de ofertas (sobre todo EE. UU., con trabajo remoto). Búsqueda de closer, setter y cold calling.',
    recipes: [
      { actor: 'memo23/simplyhired-jobs-scraper', name: 'Buscador de SimplyHired A',
        inputTemplate: { keyword: '{{query}}', location: 'Remote', maxItems: '{{max_items}}' } },
      { actor: 'shahidirfan/Simplyhired-Job-Scraper', name: 'Buscador de SimplyHired B',
        inputTemplate: { keyword: '{{query}}', location: 'Remote', results_wanted: '{{max_items}}', max_pages: 2 } },
    ],
  },
  {
    id: 'jooble', source: 'apify-jooble', name: 'Jooble', maxItems: 100, testItems: 10, query: 'closer de ventas',
    queries: ['closer de ventas', 'setter de ventas', 'televenta', 'cold caller'],
    plain: 'Agregador con cobertura en España y LatAm. Si tienes la clave oficial de Jooble, esa vía es gratuita y preferible.',
    recipes: [
      { actor: 'agentx/jooble-jobs-scraper', name: 'Buscador de Jooble A',
        inputTemplate: { keyword: '{{query}}', country: 'es', max_results: '{{max_items}}' } },
      { actor: 'ahmed_jasarevic/jooble-scraper', name: 'Buscador de Jooble B',
        inputTemplate: { searchQueries: ['{{query}}'], country: 'es', maxItems: '{{max_items}}' } },
    ],
  },
  {
    id: 'multi', source: 'apify-jobspy', name: 'Varios portales a la vez', maxItems: 650, testItems: 10,
    plain: 'Un solo buscador que mira Indeed, LinkedIn, Glassdoor y Google Jobs en una pasada.',
    recipes: [{ actor: 'aakash19/jobspy', name: 'Buscador multi-portal' }],
  },
];

// Redes y comunidades: sus condiciones limitan el uso automático (ADR-011). La advertencia viaja en la tarjeta
// para que la decisión de activarlas sea explícita, igual que en LinkedIn.
const SOCIAL = new Set(['facebook', 'telegram', 'reddit', 'skool', 'linkedin-posts']);
const SOCIAL_CAUTION = 'Es una red o comunidad: sus condiciones limitan el uso automático. Se busca poco volumen y es una decisión tuya (ADR-011). Viene apagado.';
const CURATED_CODES = new Set(CURATED.map(p => p.id));

// Un portal curado manda: si el generador algún día repitiera uno, se queda el de arriba (su texto y su plantilla).
const GENERATED: Portal[] = GENERATED_PORTALS
  .filter(p => !CURATED_CODES.has(p.id))
  .map(p => (SOCIAL.has(p.id) ? { ...p, caution: SOCIAL_CAUTION } : p));

export const PORTALS: Portal[] = [...CURATED, ...GENERATED];

export const portalBySource = (source: string) => PORTALS.find(p => p.source === source);
export const portalById = (id: string) => PORTALS.find(p => p.id === id);

/** Día UTC desde la época: la rotación no depende de la hora ni del arranque del proceso. */
export const dayIndex = (now = Date.now()): number => Math.floor(now / 86_400_000);

/**
 * Búsqueda de hoy para el portal: rota por su lista de términos un día cada uno. Devuelve `undefined`
 * solo si el portal no declara ninguna búsqueda. Una ejecución = un término, así que el coste diario
 * no cambia y el resto de sinónimos se cubren a lo largo de la semana.
 */
export function queryForDay(portal: Pick<Portal, 'query' | 'queries'>, now = Date.now()): string | undefined {
  const list = portal.queries?.length ? portal.queries : portal.query ? [portal.query] : [];
  return list.length ? list[dayIndex(now) % list.length] : undefined;
}
