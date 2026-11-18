// Qué le falta a cada fuente del catálogo que NO es un conector del motor, en pasos concretos.
// El panel decía «Requiere configurar» y ahí se acababa: el operador no sabía si necesitaba una
// clave, un actor de pago o simplemente un enlace. Esto lo responde por fuente, sin inventar
// requisitos ni endpoints que el proveedor no publique: lo que no se ha verificado se dice.
export type Setup = {
  requirement: string;
  steps: string[];
  /** Enlace al portal o a la documentación oficial del proveedor. */
  docs?: { href: string; label: string };
  /** Proveedor de `Panel → APIs` donde se pega la clave, si la hay. */
  provider?: string;
  /** Coste o compromiso, en una línea, para que nadie configure creyendo que es gratis. */
  cost?: string;
};

const APIFY_TOKEN = { href: 'https://console.apify.com/account/integrations', label: 'Copiar tu token de Apify' };
const APIFY_STORE = { href: 'https://apify.com/store', label: 'Buscar un actor en Apify' };

const apify = (name: string, hint: string, docs?: Setup['docs']): Setup => ({
  requirement: `${name} no ofrece una API pública verificada: se conecta con un Actor de Apify (la app ya sabe ejecutarlos con presupuesto y confirmación).`,
  steps: [
    'Abre tu cuenta de Apify y copia el token de API desde Settings → Integrations.',
    `Busca un actor de ${name} en la tienda de Apify y copia su Actor ID. ${hint}`,
    'En Búsqueda automática (o en «Añadir fuente»): pega el token, el Actor ID y las URLs de búsqueda, una por línea.',
    'Pulsa «Comprobar»: verifica el dataset sin gastar crédito. «Ejecutar scraper» sí gasta y te pide confirmación antes.',
    'Revisa la primera muestra: si la empresa o el título vienen vacíos, ajusta el mapeo antes de dejarlo activado.',
  ],
  docs: docs ?? APIFY_STORE,
  cost: 'Coste por resultado del actor de Apify; cada ejecución se autoriza aparte y queda en el marcador de gasto.',
});

// Recetas por código del catálogo. Solo datos que el portal publica o que el repo ya comprobó.
const RECIPES: Record<string, Setup> = {
  infojobs: {
    requirement: 'InfoJobs tiene API oficial, pero solo para cuentas de desarrollador con acceso aprobado; la app ya habla su formato.',
    steps: [
      'Entra en developers.infojobs.net con tu cuenta y crea una aplicación.',
      'Pide acceso a la API de ofertas (la aprobación no es automática: puede tardar días).',
      'Cuando la tengas, copia el client_id y el client_secret.',
      'En Panel → APIs, guarda la clave de InfoJobs con el formato client_id:client_secret y pulsa «Probar».',
      'No hace falta tocar nada más: el motor la usa en la siguiente pasada con los filtros de teletrabajo y provincias ya puestos.',
    ],
    docs: { href: 'https://developers.infojobs.net', label: 'Documentación de la API de InfoJobs' },
    provider: 'infojobs',
    cost: 'Gratis dentro de la cuota de la API. Si tu cuenta no recibe aprobación, la alternativa es un actor de Apify (de pago).',
  },
  adzuna: {
    requirement: 'Adzuna da clave gratuita con registro; la app la usa para España y el resto de mercados.',
    steps: [
      'Crea una cuenta en developer.adzuna.com.',
      'En «API Access Details» copia el app_id y el app_key.',
      'En Panel → APIs, guarda la clave de Adzuna con el formato app_id:app_key y pulsa «Probar».',
      'Se activa sola en la siguiente pasada: no hay que configurar búsquedas ni provincias.',
    ],
    docs: { href: 'https://developer.adzuna.com', label: 'Documentación de Adzuna' },
    provider: 'adzuna',
    cost: 'Gratis dentro del límite mensual del plan de desarrollador.',
  },
  jooble: {
    requirement: 'Jooble da una clave gratuita por correo, distinta para cada país: la de jooble.org solo trae ofertas de EE. UU.',
    steps: [
      'Entra en es.jooble.org/api/about (la versión española) y pide la clave.',
      'Te llega por email; cópiala.',
      'En Panel → APIs, guarda la clave de Jooble y pulsa «Probar».',
      'Si la prueba devuelve 403, Jooble está bloqueando la IP del servidor: no se arregla cambiando la clave.',
    ],
    docs: { href: 'https://es.jooble.org/api/about', label: 'Pedir la clave española de Jooble' },
    provider: 'jooble',
    cost: 'Gratis con la clave de partner.',
  },
  google: {
    requirement: 'Google Jobs no tiene API abierta: se consulta con SerpApi, que cobra por búsqueda.',
    steps: [
      'Crea una cuenta en serpapi.com y copia tu clave desde «Your API key».',
      'En Panel → APIs, guarda la clave de SerpApi y pulsa «Probar».',
      'Los dorks del vocabulario ya están preparados: se ejecutan desde Búsqueda automática o Fuentes.',
      'Cada ejecución gasta búsquedas de tu plan; el presupuesto diario de la app las frena.',
    ],
    docs: { href: 'https://serpapi.com/manage-api-key', label: 'Tu clave de SerpApi' },
    provider: 'serpapi',
    cost: 'Unas 0,025 USD por búsqueda; el panel enseña el importe antes de ejecutar.',
  },
  simplyhired: apify('SimplyHired', 'Comprueba que el actor devuelve empresa, ubicación y descripción, no solo el título.', { href: 'https://www.simplyhired.es', label: 'Ver SimplyHired' }),
  computrabajo: apify('Computrabajo', 'Hay un actor por país (España, Colombia, Perú, México): usa el que corresponda a tu búsqueda.', { href: 'https://www.computrabajo.com', label: 'Ver Computrabajo' }),
  workana: apify('Workana', 'Los proyectos freelance traen presupuesto, no salario: revisa que el mapeo no lo guarde como sueldo.', { href: 'https://www.workana.com/es', label: 'Ver Workana' }),
  linkedin: {
    requirement: 'LinkedIn no ofrece búsqueda pública de empleo a terceros. La vía ya medida es Google Jobs (SerpApi) y, si se necesita el detalle, un actor de Apify.',
    steps: [
      'La vía sin coste de configuración es Google Jobs: guarda la clave de SerpApi en Panel → APIs (receta de Google).',
      'Los dorks de LinkedIn ya están preparados en el catálogo; se ejecutan desde Búsqueda automática.',
      'Si necesitas leer la ficha completa, conecta un actor de Apify de LinkedIn y limita las URLs a búsquedas concretas.',
      'LinkedIn restringe el uso automatizado en sus condiciones: poco volumen y decisión tuya, nunca a gran escala.',
    ],
    docs: { href: 'https://www.linkedin.com/jobs', label: 'Ver LinkedIn Empleos' },
    cost: 'Google Jobs: ~0,025 USD por búsqueda. Apify: coste por resultado del actor.',
  },
  indeed: apify('Indeed', 'Indeed cerró su API pública a nuevos clientes: sin actor o sin Google Jobs no hay vía estable.', { href: 'https://es.indeed.com', label: 'Ver Indeed España' }),
  infoempleo: apify('Infoempleo', 'Las páginas públicas piden paginación: comprueba que el actor recorre más de la primera página.', { href: 'https://www.infoempleo.com', label: 'Ver Infoempleo' }),
  trabajos: apify('Trabajos.com', 'Portal generalista: limita la búsqueda a comercial y teletrabajo para no traer ruido.', { href: 'https://www.trabajos.com', label: 'Ver Trabajos.com' }),
  torre: apify('Torre', 'Torre devuelve proyectos y pruebas; valida que la oferta tenga empresa y modalidad antes de activarla.', { href: 'https://torre.ai', label: 'Ver Torre' }),
  weremoto: apify('WeRemoto', 'Bolsas remotas hispanas: el actor tiene que devolver la descripción, no solo el enlace.', { href: 'https://weremoto.com', label: 'Ver WeRemoto' }),
  remotoco: apify('Remoto.co', 'Comprueba que los enlaces siguen vivos: muchas ofertas de bolsas pequeñas caducan sin avisar.', { href: 'https://remoto.co', label: 'Ver Remoto.co' }),
  laborum: apify('Laborum / Bumeran', 'Elige el actor del país que te interese; el portal cambia el dominio por mercado.', { href: 'https://www.laborum.com', label: 'Ver Laborum' }),
  elempleo: apify('El Empleo', 'Ventas regionales: exige que el actor traiga la modalidad para no publicar presenciales como remotas.', { href: 'https://www.elempleo.com', label: 'Ver El Empleo' }),
  upwork: {
    requirement: 'Upwork exige OAuth con una app registrada y revisión; no hay clave simple que pegar en el panel.',
    steps: [
      'Registra una app en la sección de desarrolladores de Upwork y espera su revisión.',
      'Con la app aprobada se obtiene el token OAuth del propietario de la cuenta.',
      'Mientras no esté aprobada, la vía práctica es un actor de Apify de Upwork con búsquedas concretas.',
      'Filtra por «Spanish» y por presupuesto: los proyectos de closer suelen pagarse por hora o por hito.',
    ],
    docs: { href: 'https://www.upwork.com/developer', label: 'Portal de desarrolladores de Upwork' },
    cost: 'OAuth: gratis. Apify: coste por resultado del actor.',
  },
  freelancer: {
    requirement: 'Freelancer.com ya entra por su API pública de proyectos: esta ficha es solo para ver el detalle.',
    steps: [
      'Comprueba el estado en Fuentes: si aparece «API pública activa», ya está recogiendo sin configurar nada.',
      'Los encargos entran sin salario (el presupuesto es del proyecto, no una nómina).',
      'Si quieres afinarlo, filtra por «closer», «setter» y «appointment setting» en el catálogo.',
      'No hay clave que guardar ni coste por ejecución.',
    ],
    docs: { href: 'https://www.freelancer.es', label: 'Ver Freelancer' },
    cost: 'Gratis: conector del motor.',
  },
  malt: apify('Malt', 'Muchas misiones exigen cuenta: solo se puede recoger contenido público autorizado.', { href: 'https://www.malt.es', label: 'Ver Malt' }),
  eures: {
    requirement: 'EURES publica ofertas europeas, pero su buscador no es una API estable para terceros.',
    steps: [
      'La vía verificada es un actor de Apify sobre el buscador de EURES.',
      'Filtra por España y por «teletrabajo» antes de ejecutarlo.',
      'Comprueba que el resultado traiga salario y país: sin país, la oferta no se puede clasificar por mercado.',
      'Si el actor no trae descripción, esas ofertas no pasarán el filtro de español y no merece la pena activarlo.',
    ],
    docs: { href: 'https://eures.europa.eu', label: 'Ver EURES' },
    cost: 'Coste por resultado del actor de Apify.',
  },
  company: {
    requirement: 'Los ATS públicos (Greenhouse, Ashby, Teamtailor, Recruitee, Lever) son gratis y no piden clave: se añade la empresa al motor.',
    steps: [
      'Identifica el ATS de la empresa mirando su página de empleo (suele ser <empresa>.greenhouse.io o jobs.ashbyhq.com/<empresa>).',
      'Comprueba el slug con la API pública: boards-api.greenhouse.io/v1/boards/<slug>/jobs devuelve 200 y ofertas.',
      'Añádelo al motor como fuente propia (una fila por empresa) y despliega: cuesta 1 petición por pasada.',
      'Si el board responde 401/404, el slug no es público: no se adivina, se descarta.',
    ],
    cost: 'Gratis: 1 petición por empresa y pasada.',
  },
  custom: {
    requirement: 'Cualquier feed RSS o JSON público se conecta sin clave.',
    steps: [
      'Comprueba que la URL responde 200 y devuelve <item> (RSS) o un JSON con título y enlace.',
      'Añádela al motor como fuente de tipo rss con su URL.',
      'Si el portal bloquea al servidor (403/405), no hay conector posible sin proxy o actor de pago.',
    ],
    cost: 'Gratis: 1 petición por pasada.',
  },
};

export function setupFor(entry: { code: string; name: string; acquisition_method?: string | null; website?: string | null }): Setup {
  const direct = RECIPES[entry.code];
  if (direct) return direct;
  const method = (entry.acquisition_method ?? '').toLowerCase();
  if (/rss|feed/.test(method)) return RECIPES.custom;
  const name = entry.name;
  const fallback = apify(name, 'Lee el esquema de entrada del actor antes de ejecutarlo.', entry.website ? { href: entry.website, label: `Ver ${name}` } : APIFY_STORE);
  return fallback;
}
