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
  /** Otras vías con lo que pide cada una; Apify es una opción, no la única. */
  alternatives?: Alternative[];
  /** Cuánto se tarda, con qué cuenta y si hace falta tarjeta. */
  minutes?: string;
  account?: string;
  card?: boolean;
  /** Cómo saber que funciona de verdad (no solo que la clave se guardó). */
  worksWhen?: string;
  /** Tres fallos típicos y qué hacer con cada uno. */
  failures?: string[];
  /** Fecha de la última comprobación de la documentación o del portal. */
  checkedAt?: string;
  /** Solo si el vídeo existe y se ha verificado; nunca se inventa un enlace. */
  video?: { href: string; label: string };
};

/** Vía alternativa a la receta principal, con lo que pide para que nadie la dé por gratis. */
export type Alternative = { route: string; detail: string; href?: string };

const APIFY_TOKEN = { href: 'https://console.apify.com/account/integrations', label: 'Copiar tu token de Apify' };
const APIFY_STORE = { href: 'https://apify.com/store', label: 'Buscar un actor en Apify' };

// Rutas que valen para casi cualquier portal: se ofrecen antes que un actor de pago.
const BRIGHTDATA_JOBS: Alternative = {
  route: 'Google Jobs (Bright Data) · primera opción de pago',
  detail: 'Si el portal sale en Google, una búsqueda con `ibp=htl;jobs` cuesta 0,0015 USD (1/16 que SerpApi) y comparte 5.000 créditos gratis al mes. Necesita API key:zona SERP.',
  href: 'https://docs.brightdata.com/scraping-automation/serp-api/introduction',
};
const GOOGLE_JOBS: Alternative = {
  route: 'Google Jobs (SerpApi) · respaldo',
  detail: 'Si no hay Bright Data, los dorks ya preparados se piden a SerpApi: unas 0,025 USD por búsqueda y sin actor.',
  href: 'https://serpapi.com/manage-api-key',
};
const OWN_FEED: Alternative = {
  route: 'API, RSS o JSON-LD del propio portal',
  detail: 'Si lo publica, entra por el conector «custom» del motor (gratis, sin clave de scraping); antes hay que comprobar que responde 200 y trae título y enlace.',
};

const apify = (name: string, hint: string, docs?: Setup['docs'], extra: Alternative[] = []): Setup => ({
  requirement: `${name} no tiene hoy una vía que la app ya consuma, así que esta receta usa un Actor de Apify; no es la única: si el portal publica API o feed, o sale en Google Jobs, esas vías van antes y no gastan crédito de Apify.`,
  steps: [
    'Comprueba en Fuentes → Estado si ya entra sin configurar nada.',
    'Revisa las otras vías de esta ficha: API oficial, feed propio o Google Jobs. Si alguna sirve, configúrala antes que el actor.',
    'Si ninguna sirve, abre tu cuenta de Apify y copia el token de API desde Settings → Integrations.',
    `Busca un actor de ${name} en la tienda de Apify y copia su Actor ID. ${hint}`,
    'En Búsqueda automática (o en «Añadir fuente»): pega el token, el Actor ID y las URLs de búsqueda, una por línea.',
    'Pulsa «Comprobar»: verifica el dataset sin gastar crédito. «Ejecutar scraper» sí gasta y te pide confirmación antes.',
    'Revisa la primera muestra: si la empresa o el título vienen vacíos, ajusta el mapeo antes de dejarlo activado.',
  ],
  docs: docs ?? APIFY_STORE,
  alternatives: [...extra, BRIGHTDATA_JOBS, GOOGLE_JOBS, OWN_FEED],
  cost: 'Apify: coste por resultado del actor, autorizado aparte y anotado en el marcador. Las vías oficiales o por feed no gastan crédito de Apify.',
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
  torre: apify('Torre', 'Torre devuelve proyectos y pruebas; valida que la oferta tenga empresa y modalidad antes de activarla.', { href: 'https://torre.ai', label: 'Ver Torre' }, [
    { route: 'API de Torre', detail: 'api.torre.ai documenta la búsqueda de empleo, pero está en beta privada: hay que pedir acceso y usar una clave propia.', href: 'https://api.torre.ai/docs' },
  ]),
  weremoto: {
    requirement: 'WeRemoto ya se lee con un conector propio en el backend local (gratis): portada y JSON-LD de cada ficha. No pide clave ni actor.',
    steps: [
      'Comprueba en Fuentes → Estado: el conector vive en apps/api/career/connectors.py y el motor cloud aún no lo recoge.',
      'No hay clave que guardar: se lee la portada (30 tarjetas) y el JSON-LD de cada oferta.',
      'Las ofertas sin país en la ficha entran como «por confirmar»; no se supone LATAM.',
      'Solo si el portal bloqueara al servidor tendría sentido un actor de Apify, y hoy no hace falta.',
    ],
    docs: { href: 'https://www.weremoto.com', label: 'Ver WeRemoto' },
    cost: 'Gratis: conector del backend, sin coste por ejecución.',
  },
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
    requirement: 'EURES tiene API de vacantes propia (la que mueve su buscador) y, mientras la app no la consuma, también se puede leer con un actor de Apify.',
    steps: [
      'Comprueba en Fuentes → Estado: hoy la app no recoge EURES sin configurar nada.',
      'Vía oficial: la API de vacantes de EURES en europa.eu/eures/api (búsqueda JV, con autenticación y sujeta a los términos del portal).',
      'Mientras no haya conector: un actor de Apify sobre una URL de búsqueda de EURES, filtrada por España y teletrabajo.',
      'Comprueba que el resultado traiga salario y país: sin país, la oferta no se puede clasificar por mercado.',
      'Si el actor no trae descripción, esas ofertas no pasarán el filtro de español y no merece la pena activarlo.',
    ],
    docs: { href: 'https://europa.eu/eures/api', label: 'API de vacantes de EURES' },
    alternatives: [
      { route: 'Actor de Apify sobre la búsqueda de EURES', detail: 'Salida ya mapeada sin escribir código; se paga por resultado y cada ejecución se autoriza aparte.', href: 'https://apify.com/store' },
      GOOGLE_JOBS,
    ],
    cost: 'API de EURES: la del portal, según sus términos. Apify: coste por resultado del actor.',
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

// Lo que comparten todas las guías: tiempo, cómo se comprueba y tres fallos que se ven de verdad.
const GENERIC: Required<Pick<Setup, 'minutes' | 'account' | 'card' | 'worksWhen' | 'failures' | 'checkedAt'>> = {
  minutes: '10–15 min',
  account: 'La cuenta del portal o del proveedor; no hace falta crear otra.',
  card: false,
  worksWhen: 'La primera prueba termina sin error y deja al menos una oferta guardada. Si vuelve 0, se declara «vacía» y se prueba la siguiente vía; no se pinta «conectada».',
  failures: [
    'HTTP 401/403: la clave está mal o caducada. Vuelve a copiarla entera, sin espacios.',
    'HTTP 429: has llegado al límite del plan. Espera o sube de plan; reintentar en bucle no arregla nada.',
    'Responde 200 pero 0 ofertas: la búsqueda no tiene resultados o el portal cambió. No es «conectada»: revisa la consulta antes de dejarla activa.',
  ],
  checkedAt: '2026-11-21',
};

// Matices verificados por fuente. Sin fecha inventada: si no se comprobó, se usa la genérica.
const GUIDE_META: Record<string, Partial<Setup>> = {
  infojobs: {
    minutes: '10 min (la aprobación de la API puede tardar días)', account: 'Cuenta de desarrollador de InfoJobs con acceso aprobado.', card: false,
    worksWhen: '«Probar» devuelve 200 y al menos una oferta; si tu cuenta aún no está aprobada, responde 401/403 y se declara así.',
    failures: ['401: la app aún no tiene acceso a la API de ofertas (no es la contraseña de tu cuenta).', '403: el client_id no está autorizado para ese endpoint.', '0 ofertas: revisa provincia y teletrabajo; la cuota no se gasta por volver a probar.'], checkedAt: '2026-11-21',
  },
  adzuna: {
    minutes: '5 min', account: 'Cuenta gratuita de developer.adzuna.com.', card: false,
    worksWhen: 'La prueba devuelve 200 con `results` (aunque venga vacío) y la clave queda como válida.',
    failures: ['401: app_id o app_key mal copiados; van separados por dos puntos.', '429: límite mensual del plan gratuito.', '0 resultados: cambia el país o el término; Adzuna cubre más mercados que España.'], checkedAt: '2026-11-21',
  },
  jooble: {
    minutes: '5 min', account: 'Clave de partner de es.jooble.org (cada país tiene la suya).', card: false,
    worksWhen: 'La prueba devuelve 200 con `jobs`; si devuelve 403 desde el servidor, la IP está bloqueada y no se arregla con otra clave.',
    failures: ['403 desde el servidor: Jooble bloquea la IP; no insistas desde el mismo host.', 'La clave de jooble.org solo trae EE. UU.: pide la de es.jooble.org.', '0 ofertas: revisa `location` y `keywords`; el término «closer» no existe en todos los mercados.'], checkedAt: '2026-11-21',
  },
  google: {
    minutes: '5 min', account: 'Cuenta de Bright Data (recomendada por coste) o de SerpApi.', card: true,
    worksWhen: 'Una búsqueda de prueba devuelve `jobs.items[]` (Bright Data) o `jobs_results[]` (SerpApi) con título y enlace. El panel enseña el coste antes de lanzarla.',
    failures: ['401: API key o zona mal; en Bright Data el formato es API key:zona SERP.', '429/503: reintento una vez y luego se declara; no se insiste.', '200 con 0 resultados: la consulta es demasiado estrecha; cambia el dork, no la clave.'], checkedAt: '2026-11-21',
    alternatives: [BRIGHTDATA_JOBS],
  },
  linkedin: {
    minutes: '5 min', account: 'Cuenta de Bright Data o SerpApi para Google Jobs; no se inicia sesión en LinkedIn.', card: true,
    worksWhen: 'Google Jobs devuelve fichas con enlace al anuncio original de LinkedIn. Si solo vuelve el enlace de Google, no se publica como oferta.',
    failures: ['LinkedIn bloquea el rastreo directo: no se hace; usa Google Jobs.', 'El enlace es `google.com/search`: no es el anuncio original y se descarta.', '0 resultados: prueba el dork sin comillas y con `site:linkedin.com/jobs`.'], checkedAt: '2026-11-21',
  },
  indeed: {
    minutes: '15 min', account: 'Token de Apify y presupuesto con saldo; o proxies para JobSpy.', card: true,
    worksWhen: 'El actor devuelve empresa, ubicación y enlace directo (no solo el título). JobSpy solo cuenta si los proxies respondieron 200 en menos de 8 s.',
    failures: ['El actor devuelve 0: Indeed cambió el HTML; prueba el siguiente actor auditado.', 'Sin proxies sanos, JobSpy no se lanza: se declara y no se quema el runner.', 'Enlaces de seguimiento: se conserva el `job_url_direct` cuando existe.'], checkedAt: '2026-11-21',
  },
  company: {
    minutes: '5 min por empresa', account: 'Ninguna: la página es pública.', card: false,
    worksWhen: '«Revisar ahora» detecta al menos un `JobPosting` o un `<item>` RSS y enseña cuántas son nuevas. Si no publica ninguno, se declara sin ofertas.',
    failures: ['La página es una SPA sin JSON-LD: no hay extractor posible sin navegador; se declara.', 'El RSS está vacío o caducado: no se inventan ofertas.', 'La empresa cambió de ATS: actualiza el slug solo si el board nuevo responde 200 con ofertas.'], checkedAt: '2026-11-21',
  },
  weremoto: {
    minutes: '0 min (ya está en el backend)', account: 'Ninguna.', card: false,
    worksWhen: 'El conector local devuelve ofertas con enlace y país; las que no declaran país entran como «por confirmar».',
    failures: ['El motor cloud aún no lo recoge: no aparece en «recogidas» hasta portarlo.', 'Una ficha sin país no se supone LATAM.', 'Si el portal bloquea al servidor, se declara; no se activa un actor sin comprobarlo.'], checkedAt: '2026-11-21',
  },
};

export function setupFor(entry: { code: string; name: string; acquisition_method?: string | null; website?: string | null }): Setup {
  const direct = RECIPES[entry.code];
  const method = (entry.acquisition_method ?? '').toLowerCase();
  const base = direct ?? (/rss|feed/.test(method) ? RECIPES.custom
    : apify(entry.name, 'Lee el esquema de entrada del actor antes de ejecutarlo.', entry.website?.startsWith('https://') ? { href: entry.website, label: `Ver ${entry.name}` } : APIFY_STORE));
  const meta = GUIDE_META[entry.code] ?? {};
  const alternatives = [...(base.alternatives ?? []), ...(meta.alternatives ?? [])].filter((alt, index, list) => list.findIndex(item => item.route === alt.route) === index);
  return {
    ...GENERIC, ...base, ...meta,
    alternatives: alternatives.length ? alternatives : undefined,
    // Un enlace roto o sin HTTPS no se enseña como documentación oficial.
    docs: base.docs && /^https:\/\//.test(base.docs.href) ? base.docs : APIFY_STORE,
  };
}
