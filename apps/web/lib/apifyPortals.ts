// GENERADO por `scripts/export_apify_portals.py` desde la auditoría de la tienda de Apify. No editar a mano.
//
// Una entrada por fuente del catálogo que solo se puede conectar pagando y TIENE actores auditados: la primera
// receta se intenta y las demás son los repuestos que la app prueba sola si falla o vuelve sin ofertas. Lo que
// no está auditado no aparece; el panel lo declara «sin proveedor verificado» en vez de fingir un buscador.
import type { Portal } from './apifyCatalog';

export const GENERATED_PORTALS: Portal[] = [
  {
    id: 'jooble', source: 'apify-jooble', name: 'Jooble',
    plain: 'Búsqueda española aportada por WDC. Validar descripción, duplicados y scraper.', maxItems: 100, testItems: 10,
    recipes: [
      { actor: 'ahmed_jasarevic/jooble-scraper', name: 'Jooble Scraper [$1/1K] | Jobs & Salaries' },
      { actor: 'agentx/jooble-jobs-scraper', name: 'Jooble Jobs Scraper: Salary, Remote, 65 Countries', needs: ['max_results', 'keyword', 'country'] },
    ],
  },
  {
    id: 'simplyhired', source: 'apify-simplyhired', name: 'SimplyHired',
    plain: 'Búsqueda de closer y ventas aportada por WDC. Validar cobertura del proveedor.', maxItems: 100, testItems: 10,
    recipes: [
      { actor: 'shahidirfan/Simplyhired-Job-Scraper', name: 'SimplyHired Job Scraper' },
      { actor: 'memo23/simplyhired-jobs-scraper', name: 'SimplyHired Jobs Scraper [$0.9/1K 💰] Salaries & Companies' },
      { actor: 'easyapi/simplyhired-job-scraper', name: 'SimplyHired Job Scraper 🔍', needs: ['searchUrls'] },
    ],
  },
  {
    id: 'computrabajo', source: 'apify-computrabajo', name: 'Computrabajo',
    plain: 'Portales por país. Activar descripción completa y modalidad.', maxItems: 100, testItems: 10,
    recipes: [
      { actor: 'shahidirfan/Computrabajo-Jobs-Scraper', name: 'Computrabajo Jobs Scraper' },
      { actor: 'santamaria-automations/computrabajo-scraper', name: 'Computrabajo Jobs Scraper: Empleos, Salaries, 19 Countries' },
      { actor: 'haketa/computrabajo-scraper', name: 'Computrabajo Scraper — Latin America Jobs, Salary & Companies' },
    ],
  },
  {
    id: 'infoempleo', source: 'apify-infoempleo', name: 'Infoempleo',
    plain: 'Páginas públicas: necesita validar extracción y paginación.', maxItems: 100, testItems: 10,
    recipes: [
      { actor: 'bibian/infoempleo-jobs-scraper', name: 'Infoempleo Scraper: Spain Job Postings & Salaries' },
    ],
  },
  {
    id: 'torre', source: 'apify-torre', name: 'Torre',
    plain: 'Empleo y talento: validar páginas y campos de cada búsqueda.', maxItems: 100, testItems: 10,
    recipes: [
      { actor: 'scrapers_lat/torre-scraper', name: 'Torre Jobs, Skills & Compensation Scraper' },
    ],
  },
  {
    id: 'laborum', source: 'apify-laborum', name: 'Laborum / Bumeran',
    plain: 'Portales regionales; se requiere proveedor compatible con el país.', maxItems: 100, testItems: 10,
    recipes: [
      { actor: 'memo23/bumeran-job-scraper', name: 'Bumeran Job Scraper — Argentina Jobs to JSON/CSV' },
      { actor: 'shahidirfan/bumeran-jobs-scraper', name: 'Bumeran Jobs Scraper' },
      { actor: 'blackfalcondata/bumeran-scraper', name: 'Bumeran Scraper [Just 💰$1] — LATAM Jobs (7 Countries)' },
    ],
  },
  {
    id: 'elempleo', source: 'apify-elempleo', name: 'El Empleo',
    plain: 'Ventas regionales; exigir evidencia de remoto o híbrido.', maxItems: 100, testItems: 10,
    recipes: [
      { actor: 'logiover/elempleo-colombia-job-scraper', name: 'elempleo Colombia Job Scraper — Empleos, No Login' },
      { actor: 'corvuslab/elempleo-scraper', name: 'elempleo Job Scraper — Full Descriptions & COP Salaries' },
      { actor: 'scrapers_lat/elempleo-scraper', name: 'elempleo Scraper - Colombia Jobs, Salaries, Vacantes & Empleos' },
    ],
  },
  {
    id: 'upwork', source: 'apify-upwork', name: 'Upwork',
    plain: 'Proyectos de closer y setter; filtrar Spanish y requisitos del cliente.', maxItems: 100, testItems: 10,
    recipes: [
      { actor: 'neatrat/upwork-job-scraper', name: 'Upwork Job Scraper' },
      { actor: 'blackfalcondata/upwork-scraper', name: 'Upwork Job Scraper - Job Alerts with Client Intel' },
    ],
  },
  {
    id: 'eures', source: 'apify-eures', name: 'EURES',
    plain: 'Movilidad europea; español y trabajo a distancia deben constar en la oferta.', maxItems: 100, testItems: 10,
    recipes: [
      { actor: 'dadhalfdev/eures-jobs-scraper', name: 'EURES Jobs Scraper' },
      { actor: 'shahidirfan/eures-job-scraper', name: 'Eures Job Scraper' },
      { actor: 'easyapi/eures-job-scraper', name: 'EURES Job Scraper', needs: ['searchUrl'] },
    ],
  },
  {
    id: 'facebook', source: 'apify-facebook', name: 'Facebook · grupos y páginas',
    plain: 'Añadir URLs concretas. Grupos privados requieren acceso autorizado y proveedor compatible.', maxItems: 100, testItems: 10,
    recipes: [
      { actor: 'apify/facebook-groups-scraper', name: 'Facebook Groups Scraper', needs: ['startUrls'] },
      { actor: 'apify/facebook-posts-scraper', name: 'Facebook Posts Scraper', needs: ['startUrls'] },
      { actor: 'scraper_one/facebook-posts-search', name: 'Facebook Posts Search', needs: ['query'] },
    ],
  },
  {
    id: 'linkedin-posts', source: 'apify-linkedin-posts', name: 'LinkedIn · publicaciones',
    plain: 'Mapear texto y enlace del post; admitir solo contratación explícita.', maxItems: 100, testItems: 10,
    recipes: [
      { actor: 'harvestapi/linkedin-profile-posts', name: 'LinkedIn Profile Posts Scraper (No Cookies)' },
      { actor: 'harvestapi/linkedin-post-search', name: 'Linkedin Post Search Scraper (No Cookies)' },
    ],
  },
  {
    id: 'skool', source: 'apify-skool', name: 'Skool',
    plain: 'Comunidades concretas; el acceso de miembro no se presupone público.', maxItems: 100, testItems: 10,
    recipes: [
      { actor: 'memo23/skool-posts-with-comments-scraper', name: 'Skool Classroom Media/Video · Posts · Nested Comments', needs: ['startUrls', 'cookies'] },
    ],
  },
  {
    id: 'telegram', source: 'apify-telegram', name: 'Telegram · canales públicos',
    plain: 'Canales públicos de empleo; mapear texto, fecha y permalink.', maxItems: 100, testItems: 10,
    recipes: [
      { actor: 'lofomachines/telegram-keyword-search-scraper', name: 'Telegram Keyword Search Scraper', needs: ['mode'] },
      { actor: 'tri_angle/telegram-scraper', name: 'Telegram Scraper', needs: ['profiles'] },
    ],
  },
  {
    id: 'reddit', source: 'apify-reddit', name: 'Reddit',
    plain: 'Comunidades de trabajo remoto; evitar autopromoción y candidatos buscando empleo.', maxItems: 100, testItems: 10,
    recipes: [
      { actor: 'harshmaur/reddit-scraper', name: 'Reddit Scraper - Posts, Comments, Search & Subreddits' },
      { actor: 'trudax/reddit-scraper-lite', name: 'Reddit Scraper Lite' },
      { actor: 'fatihtahta/reddit-scraper-search-fast', name: 'Reddit Scraper | Enterprise Grade' },
    ],
  },
  {
    id: 'company', source: 'apify-company', name: 'Empresas · páginas de empleo / ATS',
    plain: 'Añadir webs de empresas, agencias, academias y sus bolsas ATS.', maxItems: 100, testItems: 10,
    recipes: [
      { actor: 'johnvc/greenhouse-job-board-api', name: 'Greenhouse Job Board API | Jobs, Companies & New Postings' },
      { actor: 'fantastic-jobs/greenhouse-jobs-api', name: 'Greenhouse Jobs API' },
      { actor: 'jobo.world/greenhouse-jobs-scraper-api', name: 'Greenhouse Jobs Scraper & API' },
    ],
  },
];
