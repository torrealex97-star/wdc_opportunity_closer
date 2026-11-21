// Empresas que se vigilan una a una: feed ATS (automático), página de empleo propia (con extractor
// JSON-LD/RSS) y «solo LinkedIn» (vía Google Jobs, sin rastrear la red).
//
// Los datos salen de los seeds del backend (`apps/api/career/migrations.py`) y del catálogo cloud. No se
// añade ninguna empresa nueva aquí: una alta exige una URL pública comprobada (200 + ofertas) y eso se
// hace en el motor, no en el panel. Las que solo tienen LinkedIn no se rastrean: se enlazan a la búsqueda.

export type CompanyKind = 'ats' | 'careers' | 'linkedin';

export type CompanyWatch = {
  /** Código estable; las de ATS coinciden con su fuente del catálogo. */
  code: string;
  name: string;
  kind: CompanyKind;
  /** Página o feed que se lee en «Revisar ahora». `null` en las que solo tienen LinkedIn o las gestiona el motor. */
  url: string | null;
  source: string;
  note: string;
  ats?: 'greenhouse' | 'ashby' | 'teamtailor' | 'recruitee' | 'lever' | 'smartrecruiters';
};

export const COMPANY_WATCHLIST: CompanyWatch[] = [
  { code: 'ats-greenhouse-feverup', name: 'Fever', kind: 'ats', url: 'https://boards-api.greenhouse.io/v1/boards/feverup/jobs?content=false', source: 'ats-greenhouse-feverup', note: 'Feed ATS público: lo recoge el motor en cada pasada, sin clave.', ats: 'greenhouse' },
  { code: 'ats-greenhouse-cabify', name: 'Cabify', kind: 'ats', url: 'https://boards-api.greenhouse.io/v1/boards/cabify/jobs?content=false', source: 'ats-greenhouse-cabify', note: 'Feed ATS público: lo recoge el motor en cada pasada, sin clave.', ats: 'greenhouse' },
  { code: 'ats-greenhouse-stripe', name: 'Stripe', kind: 'ats', url: 'https://boards-api.greenhouse.io/v1/boards/stripe/jobs?content=false', source: 'ats-greenhouse-stripe', note: 'Feed ATS público: lo recoge el motor en cada pasada, sin clave.', ats: 'greenhouse' },
  { code: 'ats-ashby-qonto', name: 'Qonto', kind: 'ats', url: 'https://api.ashbyhq.com/posting-api/job-board/qonto', source: 'ats-ashby-qonto', note: 'Feed ATS público: lo recoge el motor en cada pasada, sin clave.', ats: 'ashby' },
  { code: 'ats-ashby-pennylane', name: 'Pennylane', kind: 'ats', url: 'https://api.ashbyhq.com/posting-api/job-board/pennylane', source: 'ats-ashby-pennylane', note: 'Feed ATS público: lo recoge el motor en cada pasada, sin clave.', ats: 'ashby' },
  { code: 'ats-teamtailor-producthackers', name: 'ProductHackers', kind: 'ats', url: null, source: 'ats-teamtailor-producthackers', note: 'Feed Teamtailor del motor; sin URL de feed guardada aquí, se revisa desde Fuentes.', ats: 'teamtailor' },
  { code: 'monest-capital', name: 'Inversor PRO · Monest Capital', kind: 'careers', url: 'https://careers.monestcapital.com/jobs.rss', source: 'company', note: 'Feed Teamtailor del seed local; se retiró del cloud por 0 elegibles. Se puede revisar sin clave.' },
  { code: 'bastida-farina', name: 'Bastida Farina', kind: 'careers', url: 'https://www.bastidafarina.com/equipo/posiciones-abiertas', source: 'company', note: 'Página de empleo propia con extractor JSON-LD; si no publica JobPosting, se declara sin ofertas.' },
  { code: 'conquista-tu-maternidad', name: 'Conquista tu Maternidad', kind: 'linkedin', url: null, source: 'company', note: 'Solo LinkedIn: no se rastrea la red; se busca en Google Jobs con el dork de la empresa.' },
  { code: 'autopublicacion', name: 'Autopublicación', kind: 'linkedin', url: null, source: 'company', note: 'Solo LinkedIn: no se rastrea la red; se busca en Google Jobs con el dork de la empresa.' },
  { code: 'gold-waves-group', name: 'Gold Waves Group', kind: 'linkedin', url: null, source: 'company', note: 'Solo LinkedIn: no se rastrea la red; se busca en Google Jobs con el dork de la empresa.' },
  { code: 'novacliniq-ai', name: 'Novacliniq AI', kind: 'linkedin', url: null, source: 'company', note: 'Solo LinkedIn: no se rastrea la red; se busca en Google Jobs con el dork de la empresa.' },
  { code: 'webifly-es', name: 'Webifly ES', kind: 'linkedin', url: null, source: 'company', note: 'Solo LinkedIn: no se rastrea la red; se busca en Google Jobs con el dork de la empresa.' },
  { code: 'sales-beast-group', name: 'Sales Beast Group', kind: 'linkedin', url: null, source: 'company', note: 'Solo LinkedIn: no se rastrea la red; se busca en Google Jobs con el dork de la empresa.' },
  { code: 'talent', name: 'Talent', kind: 'linkedin', url: null, source: 'company', note: 'Solo LinkedIn: no se rastrea la red; se busca en Google Jobs con el dork de la empresa.' },
  { code: 'talent-search', name: 'Talent Search', kind: 'linkedin', url: null, source: 'company', note: 'Solo LinkedIn: no se rastrea la red; se busca en Google Jobs con el dork de la empresa.' },
];

export const COMPANY_KIND_LABEL: Record<CompanyKind, string> = {
  ats: 'Feed ATS (automático)',
  careers: 'Página de empleo propia',
  linkedin: 'Solo LinkedIn',
};

export const linkedinSearch = (name: string) =>
  `https://www.google.com/search?q=${encodeURIComponent(`site:linkedin.com/jobs "${name}"`)}`;

/** Códigos de las fuentes de empresa cuya ficha ya está en el motor, para contar lo revisado. */
export const companySourceCodes = () => [...new Set(COMPANY_WATCHLIST.map(company => company.source))];
