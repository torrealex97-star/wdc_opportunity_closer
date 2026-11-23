// GENERADO por `scripts/export_apify_portals.py` desde la auditoría de la tienda de Apify. No editar a mano.
//
// Una entrada por fuente del catálogo que solo se puede conectar pagando y TIENE actores auditados: la primera
// receta se intenta y las demás son los repuestos que la app prueba sola si falla o vuelve sin ofertas. Lo que
// no está auditado no aparece; el panel lo declara «sin proveedor verificado» en vez de fingir un buscador.
import type { Portal } from './apifyCatalog';

export const GENERATED_PORTALS: Portal[] = [
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
    id: 'trabajos', source: 'apify-trabajos', name: 'Trabajos.com',
    plain: 'Portal generalista: configurar búsquedas de comercial remoto.', maxItems: 100, testItems: 10,
    recipes: [
      { actor: 'bibian/trabajos-jobs-scraper', name: 'Trabajos.com Jobs Scraper · No Login' },
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
  {
    id: 'tecnoempleo', source: 'apify-tecnoempleo', name: 'Tecnoempleo',
    plain: 'IT España; útil para SDR y AE de SaaS. Sin RSS localizado; HTML por validar.', maxItems: 100, testItems: 10,
    recipes: [
      { actor: 'solidcode/tecnoempleo-scraper', name: 'Tecnoempleo Scraper' },
      { actor: 'blackfalcondata/tecnoempleo-scraper', name: 'Tecnoempleo Scraper — Spain IT Job Listings' },
      { actor: 'nomad-agent/tecnoempleo-scraper', name: 'Tecnoempleo Jobs Scraper: Spain IT Jobs + Only New', needs: ['schemaVersion'] },
      { actor: 'kalirobot/tecnoempleo-scraper', name: 'Tecnoempleo Scraper: Extract Tech Jobs', needs: ['max_items'] },
    ],
  },
  {
    id: 'talent', source: 'apify-talent', name: 'Talent.com',
    plain: 'Agregador con penetración ES/LATAM; feed partner sin verificar.', maxItems: 100, testItems: 10,
    recipes: [
      { actor: 'blackfalcondata/talent-com-jobs-scraper', name: 'Talent.com Job Scraper [Just 💰$1.5] — Jobs across 42 Markets' },
      { actor: 'solidcode/talent-com-scraper', name: 'Talent.com Jobs Scraper' },
      { actor: 'scrapers_lat/talent-jobs-scraper', name: 'Talent.com Jobs Scraper & API - Salary, Company, No API Key' },
      { actor: 'agentx/talent-jobs-scraper', name: 'Talent Jobs Scraper: Talent.com Salary, Remote', needs: ['max_results', 'keyword', 'country'] },
    ],
  },
  {
    id: 'milanuncios', source: 'apify-milanuncios', name: 'Milanuncios Empleo',
    plain: 'Volumen de comercial autónomo; HTML con anti-bot por validar.', maxItems: 100, testItems: 10,
    inputTemplate: { query: '{{query}}', category: 'ofertas-de-empleo', maxResults: '{{max_items}}' },
    recipes: [
      { actor: 'blackfalcondata/milanuncios-scraper', name: 'Milanuncios Scraper [Just 💰$1.5] — Cars, Homes & All Ads' },
    ],
  },
  {
    id: 'welcomejungle', source: 'apify-welcomejungle', name: 'Welcome to the Jungle ES',
    plain: 'Backend Algolia; requiere adaptador específico de su API interna.', maxItems: 100, testItems: 10,
    recipes: [
      { actor: 'silentflow/welcome-to-the-jungle-scraper-ppe', name: 'Welcome to the Jungle Job Scraper' },
      { actor: 'silentflow/welcome-to-the-jungle-scraper', name: 'Welcome to the Jungle Scraper | Jobs and Company Data' },
      { actor: 'dltik/welcome-to-the-jungle-scraper', name: 'Welcome to the Jungle Scraper: WTJ Tech Jobs FR/EU + Salaries' },
      { actor: 'saswave/welcome-to-the-jungle-scraper', name: 'Welcome to the jungle scraper' },
    ],
  },
  {
    id: 'occ-mundial', source: 'apify-occ-mundial', name: 'OCC Mundial',
    plain: 'Su API interna responde 403 «abuse» desde fuera del navegador (medido 2026-11-20): sin feed público; se conecta con un Actor de Apify opt-in.', maxItems: 100, testItems: 10,
    recipes: [
      { actor: 'normdata/occ-scraper', name: 'OCC Mundial Jobs Scraper' },
      { actor: 'corvuslab/occ-mundial-jobs-scraper', name: 'OCC Mundial Jobs Scraper — Full Details, Salary & Alerts' },
      { actor: 'automatic/occ-mx-scraper', name: 'OCC Mundial Scraper: Mexico Jobs, Salaries & Companies' },
      { actor: 'gio21/occmundial-jobs-scraper', name: 'OCC Mundial Jobs Scraper - Full Details, $0.005/Job', needs: ['keyword'] },
    ],
  },
  {
    id: 'chiletrabajos', source: 'apify-chiletrabajos', name: 'Chiletrabajos',
    plain: 'Su /rss/ redirige a la portada (200 HTML, sin feed) el 2026-11-20: requiere Actor de Apify o acceso autorizado.', maxItems: 100, testItems: 10,
    recipes: [
      { actor: 'santamaria-automations/chiletrabajos-jobs-scraper', name: 'Chiletrabajos Jobs Scraper: Chile Job Listings' },
      { actor: 'fabrikit/chiletrabajos-scraper', name: 'Chiletrabajos Scraper - Chile Job Listings' },
      { actor: 'hipersoft/chiletrabajos-scraper', name: 'Chiletrabajos Scraper — Chile Job Listings' },
      { actor: 'rainminer/chiletrabajos-scraper', name: 'ChileTrabajos Job Scraper', needs: ['startUrls'] },
    ],
  },
];
