# Fuentes y búsquedas para WDC

Actualizado: 2026-11-20. Los recuentos de esta cabecera y de la sección «Estado real» están **medidos** contra el código (`sites/engine/worker.js`, `apps/web/lib/sourceCatalog.json`) y contra los servicios; los recuentos de las secciones antiguas (33, 38, «quince conectores») se conservan como contexto histórico y **no son el estado actual**. La revisión de métodos, filtros y 51 referencias del Excel sigue en [SOURCE_ACQUISITION](SOURCE_ACQUISITION.md). Integración local, independiente de Scalix.

## Qué catálogo manda

Hay dos listas y no son la misma cosa:

- **`apps/api/career/sources.py`** describe lo que puede recoger el **backend local** (`apps/api`): su `REGISTRY`, su watchlist de empresas y el catálogo de portales pendientes. No se toca para reflejar el cloud.
- **El motor cloud** (`sites/engine/worker.js`) es lo que sirve al panel en producción. Su realidad se declara en [`scripts/export_source_catalog.py`](../scripts/export_source_catalog.py), en tablas explícitas: `CLOUD_OPERATIONAL` (método y estado verificados en el cloud, o fuentes que el cloud recoge y el backend local no tiene), `CLOUD_RETIRED` (tableros retirados del cloud por cero elegibles) y `CLOUD_CODE` (el código del backend frente al que cruza el panel, p. ej. `getonbrd` → `getonbrd-public`).
- **`apps/web/lib/sourceCatalog.json` es el export, no una fuente**: no se edita a mano. Cualquier hecho nuevo se escribe en `sources.py` si es del backend local, o en las tablas del export si es del cloud, y se regenera con `PYTHONPATH=apps/api python scripts/export_source_catalog.py`.
- La prueba [`tests/test_source_catalog_export.py`](../tests/test_source_catalog_export.py) falla si el JSON deja de coincidir con su generador, si vuelve un tablero retirado o si una fuente que el cloud recoge se queda en «pendiente».

## Estado real — medido el 2026-11-20

- **Catálogo del panel: 69 entradas.** De ellas, **39** están marcadas `requires: input` («Requiere configurar») y **30** no piden configuración (28 recogidas y 2 libres sin conector).
- **Motor cloud: 40 conectores** (`SOURCES`). Una pasada completa declara **126 subrequests de fetch** (tope 1.000 con Workers de pago; 50 en el plan gratuito, donde el planificador aplaza fuentes en vez de romper). El salto desde 79 es el plan B de FreeHire: tres páginas de datos por término cuando su API responde 429; los últimos son Workable (2 conectores × 2 términos × 2 intentos) y SmartRecruiters (búsqueda con un reintento + 4 detalles sin reintento). El coste declarado cuenta los reintentos de `fetchText`: un 429/503 puede pedir la misma URL dos veces.
- **28 entradas del catálogo tienen recogida ahora.** Las 40 fuentes del motor se agrupan por portal, así que las cifras no coinciden: JobToday son 13 conectores, FreeHire 4 y Workable 2; el panel los suma en una fila.
- **Sin duplicados engañosos**: el motor cloud emite `getonbrd` y el panel lo cruza con `getonbrd-public` (`ALIAS` de [sourceFamilies.ts](../apps/web/lib/sourceFamilies.ts)). El catálogo lista **`getonbrd-public`, una sola vez**: el export renombra la fila del backend local en vez de añadir una segunda. `freelancer` y `jobgether` se recogían mientras su ficha decía «Adaptador pendiente / Sin proveedor verificado»: ahora dicen «Conector operativo», y eso se declara en el export (2026-11-18). Un test (`tests/engine/catalog.mjs`) falla si vuelve a haber dos entradas para el mismo portal.
- **2 entradas gratuitas sin conector hoy**: dos feeds muertos, Remote.jobs (301) y Remote First Jobs (404).
- **Cinco tableros ATS retirados el 2026-11-13** por cero elegibles en dos mediciones independientes: Holded · Recruitee, Monest Capital · Teamtailor, Typeform · Greenhouse, Wallapop · Greenhouse y Livestorm · Recruitee (23 ofertas entre los cinco, ninguna publicable nunca). Responden 200 y cuestan una petición, así que volver a conectarlos es re-añadir su fila; el criterio de retirada está en STATUS (sesión 172).

### Gratis y conectadas (39 conectores, coste cero)

| Portal | Conectores | Cómo se lee | Coste por pasada |
|---|---|---|---|
| Workable (España · LATAM) | 2 | API pública de su bolsa (`jobs.workable.com/api/v1/jobs`): `query` por término y `location` por país, sin clave. Dos términos por conector y país por país (México, Colombia, Argentina) | 4 + 4 |
| SmartRecruiters (global) | 1 | Búsqueda pública (`jobs.smartrecruiters.com/sr-jobs/search`): `keyword` filtra y `location` no, así que el mercado lo decide la ubicación. El detalle público de cada oferta trae el cuerpo | 2 + 4 |
| JobToday (ES) | 13 | `__NEXT_DATA__` de `/es/trabajos-<slug>`: 7 búsquedas nacionales, 2 barridos por ciudad y 4 slugs reintroducidos el 2026-11-12 (telemarketing, ventas-remoto, ventas, comercial) | 11 + rutas de ciudad |
| FreeHire (ES/LATAM/global) | 4 | API v1 pública (`/api/v1/jobs/search`) y, si esa responde 429, la ruta de datos de su web (`/jobs/__data.json`, formato `devalue`): el límite es **por IP**, no por clave | 14/6/26/22 (declara reintentos y tres páginas de plan B) |
| Himalayas | 1 | consultas por alias (`q`) | 1 |
| Get on Board | 1 | API pública, categoría Sales | 2 |
| Remotive · Jobicy · Working Nomads · Jobspresso · RemotoJOB · We Work Remotely · Remote OK · Arbeitnow · Virtual Vocations | 9 | RSS o JSON públicos | 1 cada uno |
| openradar.fun | 1 | API pública sin clave (OpenAPI 3.1): vacantes y encargos con el texto completo; `q` por término, 3 términos por pasada | 3 |
| Freelancer.com | 1 | API pública de proyectos (encargos, no empleos) | 1 |
| Jobgether | 1 | feed público | 1 |
| ATS por empresa | 6 | Greenhouse (Fever, Stripe, Cabify), Ashby (Qonto, Pennylane), Teamtailor (ProductHackers) | 1 cada uno |

FreeHire necesita una nota aparte porque es la mayor fuente de volumen y la más frágil: su API limita **por IP de origen** (2.000 peticiones, `retry-after` que llegó a 62.740 s) y el Worker sale por las IPs de egreso compartidas de Cloudflare. Cuando ese pozo común se agota, la API devuelve 429 durante horas aunque su web siga viva: por eso el conector pide la ruta de datos de la web (200, 20 ofertas por página, con descripción y país) y lo declara en la nota del run. Medido el 2026-11-13: **237 filas** recuperadas en una pasada y **149 publicables** en la activación en seco.

Ninguno de estos 41 pide clave, cuenta ni pago. Los ATS se amplían con un slug **verificado** (`boards-api.greenhouse.io/v1/boards/<slug>/jobs` debe devolver 200); un 401/404 no se adivina, se descarta.

### Gratis pero fuera del motor hoy (2)

| Entrada | Estado medido el 2026-11-13 | Qué falta |
|---|---|---|
| `remotejobs` | 301 sin `Location` útil; `/rss` no devuelve feed | feed inexistente: solo Actor de pago |
| `remotefirstjobs` | 404 en `/feed` | feed inexistente: solo Actor de pago |

### Exige clave o acuerdo (2)

| Entrada | Requisito | Por qué no está conectada |
|---|---|---|
| `infojobs` | acuerdo de agregación con InfoJobs (API solo para agregadores) | sin acuerdo la API responde 405/403 al Worker; no hay clave que pedir en el panel |
| `jooble` | clave gratuita por email (`jooble.org/api/about`) | además su endpoint responde 403 al Worker desde 2026-09-23 (Cloudflare): la clave no basta |

Adzuna (app_id/app_key, gratis con registro) y Careerjet/Opcionempleo (affid) se documentaron como rutas de clave en 2026-09-23, pero **no están en el catálogo actual**; si se añaden, entran por esta misma vía.

### WeRemoto ya no es de pago: conector propio (2026-11-20)

`weremoto` sale de esta lista porque tiene **conector propio gratuito en el backend local**
(`WeRemoto` en [`connectors.py`](../apps/api/career/connectors.py)): lee la portada pública, se queda con las
tarjetas de venta y completa cada una con el `JobPosting` en JSON-LD de su ficha. Lo medido ese día: la portada
sirve **30 tarjetas fijas** y **no admite búsqueda ni paginación por parámetros** (`?search=`, `?query=` y `?page=`
devuelven las mismas 30), así que el descarte por perfil es local y la cobertura diaria es la que quepa en esas 30;
la ficha no publica países, y por eso la oferta llega al filtro de mercado como «por confirmar» en vez de suponer
LATAM. Su prueba con fixture real está en [`tests/test_weremoto.py`](../tests/test_weremoto.py). **Límite**: el motor
cloud todavía no lo recoge, y el catálogo del panel lo declara así (`validation_status`) hasta que se porte al Worker.

### De pago: Actor de Apify (opt-in, 33 entradas)

Bloqueados por anti-bot, login o HTML sin feed; cada uno necesita un Actor con token propio y gasta crédito por resultado:
`simplyhired`, `computrabajo`, `workana`, `linkedin`, `indeed`, `infoempleo`, `trabajos`, `torre`, `remotoco`, `laborum`, `elempleo`, `upwork`, `malt`, `eures`, `europe-language`, `jobsqd`, `facebook`, `linkedin-posts`, `skool`, `telegram`, `reddit`, `company`, `custom`, `tecnoempleo`, `talent`, `milanuncios`, `primer-empleo`, `jobfluent`, `welcomejungle`, `closers-avenue`, `google`, `remotolist`, `domestika`.

**Barrido propio del 2026-11-20** (solo API pública de la tienda, sin token y sin ejecutar actores): de las fuentes que solo se conectan pagando, **siete se sumaron** a las que ya tenían buscador. Se sumaron **Tecnoempleo** (4), **Talent.com** (4), **Welcome to the Jungle** (4), **OCC Mundial** (4), **Chiletrabajos** (4), **Trabajos.com** (1) y **Milanuncios** (1, con `category: ofertas-de-empleo` fijada porque el actor descarga coches por defecto); el catálogo del panel pasa a **27 portales y 70 buscadores**. **Siguen sin actor compatible, con lo revisado**: WeRemoto (22), Remoto.co (11, todos de Remote.co de EE. UU., que es otro portal), Malt (17, solo perfiles), Europe Language Jobs (25; su consulta propia devuelve 0), Jobsqd (16, todos de JobsDB de Asia), Primer Empleo (10), Domestika (15; correos y cursos), RemotoList (4), Jobfluent (0 resultados), ClosersAvenue (0), Portal del Empleo MX (0) y «otra web» (8 genéricos multi-portal). **Segundo barrido, más profundo (2026-11-20, solo API pública)**: 50 páginas de la tienda con consultas nuevas por marca (`we remoto`, `remoto co`, `portal del empleo`, `empleo.gob.mx`, `primerempleo`, `closersavenue`, `malt missions`, `europelanguagejobs`, `remotolist`, `jobfluent`, `jobsqd`) → **608 actores distintos revisados y ninguna de las doce fuentes tiene actor con su marca**. La lista se parte en dos para no volver a perseguirlas sin una pista nueva: **(A) relevantes para closers de España y LatAm, sin actor disponible** — Remoto.co (solo hay actores de Remote.co de EE. UU., otro portal), Portal del Empleo MX, Primer Empleo, ClosersAvenue (su bolsa sigue sin actor y su web no es un listado público) y **Malt**, donde sí hay actores pero todos leen **perfiles de freelance** (nombre, tarifa, skills), no misiones de empresas: usarlos como ofertas devolvería a personas ofreciéndose, no a quien contrata; **(B) fuera del alcance de una agencia de closers** — Jobsqd (Asia), Domestika (cursos, no ofertas), Jobfluent y RemotoList (sin resultados ni marca en la tienda) y Europe Language Jobs (idiomas, señal marginal). Las de (B) no se vuelven a barrer.

**Google se queda fuera a propósito**: sus actores buscan por palabra clave en Google Jobs y esta fuente son dorks con `site:` (ADR-009). Cada consulta y cada actor descartado están en `apps/api/career/source_audit.json` (`sweep`); cómo se regenera, en [EXTERNAL_SOURCES](EXTERNAL_SOURCES.md) §6.

Con evidencia de bloqueo o cierre, no solo «sin conector»: Workana 403 de Cloudflare, Talent y Tecnoempleo 404, Milanuncios 403, Infoempleo 403, EURES sin endpoint público estable (404), ClosersAvenue 500 en su bolsa, Welcome to the Jungle exige Algolia, RemotoList sin feed y LinkedIn/Indeed con login o captcha. Google for Jobs se cubre con SerpApi/JSearch (de pago), no con scraping propio. El gasto de Apify es opt-in: estimación antes de ejecutar, aviso por encima de 5 USD y confirmación explícita por encima de 20 USD.

**Criterio**: solo entra en el motor lo verificado en vivo, gratis y con datos reales ese día; todo lo demás queda en el catálogo con su requisito escrito, y el panel dice qué falta y cómo se conecta. Un estado de bloqueo medido ayer no se copia: se vuelve a medir antes de documentarlo como operativo.

## Uso

## Uso

La búsqueda inicial usa «Closers, setters y comercial online», evidencia de español y modalidad remota o híbrida. Incluye bilingües con español mencionado. Europa es una opción de mercado; no se presupone que remoto permita trabajar desde cualquier país. La casilla de datos desconocidos no elimina el requisito explícito de español ni de modalidad.

Desde el 2026-11-13 también entran los **anuncios escritos en inglés que exigen español** («Spanish speaker», «Spanish speaking», «bilingual Spanish», «fluent in Spanish», «español requerido»). Se aceptan con etiqueta explícita en la tarjeta —«Anuncio en inglés · exige español»— para que nadie lea un anuncio en inglés creyendo que es en español. No basta con que aparezca «Spanish» suelto junto al nombre de la empresa o de la oficina: la palabra tiene que ir con una exigencia a menos de 30 caracteres. Un anuncio en portugués no entra nunca, ni pidiendo español.

Además hay una watchlist de empresas objetivo consultable a diario (migración 5, tablas `company_watchlist`/`watchlist_targets`); ampliarla exige un slug verificado, no se adivinan URLs. Un enlace a un Actor es referencia de integración, no una garantía de calidad o mantenimiento.

## Lote de APIs evaluado — 2026-11-18

Revisión del listado de APIs propuesto (sin autorización y con clave) contra lo que ya recoge el repo. **No se añadió un
sistema de conectores paralelo**: el motor (`sites/engine/worker.js`, 37 fuentes) ya es el registro de fuentes gratuitas,
con dedupe, descarte por rol/idioma/mercado y presupuesto de subrequests; las APIs con clave viven en
`apps/web/lib/collectors.ts` (InfoJobs, Adzuna, Jooble) con la clave cifrada en **Panel → APIs**. Lo medido aquí es qué
queda por conectar de esa lista y con qué evidencia.

### Sin clave

| API | Resultado medido (2026-11-18) | Decisión |
|---|---|---|
| **Jobicy** | 200; ya conectada (`jobicy-marketing`, 1 fetch). `industry=sales` no es un slug válido de su API. | Sin cambios |
| **Himalayas** | 200; ya conectada con términos (`himalayas-closer`, 4 por pasada). | Sin cambios |
| **Arbeitnow** | 200; ya conectada (`arbeitnow`, 1 fetch). | Sin cambios |
| **openradar** | 200 y OpenAPI 3.1 en `/openapi.json`. 10 términos → **317 leads únicos**, 75 con perfil comercial y, entre ellos, closers y setters **en español** (SDR telefónico para pymes españolas, setter telefónico, closer B2C de admisiones). Texto completo incluido. | **Conectado** (`openradar`, 3 términos por pasada) |
| **YubHub** | 200 y API sin clave (`/search`, feeds `.json`). Pero el filtro `country` no acota (`country=Spain` devuelve UK/US), sus facetas de país solo tienen US, UK, Canadá, Alemania, Australia, Francia y Nueva Zelanda, `feeds.yubhub.co/facet/country/spain.json` responde **404** y el feed `category/sales.json` (100 vacantes, todas con descripción) trae **0 de España o LATAM**. Su `/search` sí devuelve títulos en español de LATAM, pero sin cuerpo. | **No se conecta**: gastaría peticiones y no pasaría el gate de idioma/mercado |
| **Parlel** | 200; `roles?q=closer`, `q=comercial` y `q=ventas` devuelven `items: []`. | **Desactivada, sin resultados útiles** |
| **openradar (encargos)** | Los `type: gig` entran como encargos, sin salario (el importe va en `raw.rawSalary`), igual que Freelancer.com. | Incluido en el conector |
| **JobYap** | Sin respuesta desde este entorno (tres intentos, 000/timeout). | **Desactivada**: no verificable |

### Con clave

No se implementan conectores nuevos sin una clave ni una cuenta con la que probarlos. Los tres que ya están escritos se
activan solos al guardar la clave en **Panel → APIs** y su paso a paso está en [EXTERNAL_SOURCES](EXTERNAL_SOURCES.md) y
[OWNER_GUIDE](OWNER_GUIDE.md): **InfoJobs** (app de desarrollador, `client_id:client_secret`), **Adzuna**
(`app_id:app_key`) y **Jooble** (clave **de España**: la de `jooble.org` solo trae EE. UU.).

El resto del lote queda como propuesta, no como código: Careerjet y WhatJobs exigen afiliación o acuerdo de partner;
TheirStack, Fantastic.jobs, Techmap y Jobspipe son de pago; JOA, Jobven, jobdata, Hiring Index, Worklittle, Reqbeat y
Findwork no tienen cobertura española verificada; Upwork exige OAuth con revisión de la app. Documentar un paso a paso
inventado para conseguir esas claves sería peor que no tenerlo.

## Expansión de fuentes solicitada por WDC — 2026-09-23

Se evaluó una lista de ~108 sitios propuesta por WDC (con muchos duplicados y sitios ya integrados). Triaje con verificación en vivo: tres fuentes nuevas con feed público gratuito entraron como conectores; Remote Work Hub se descarta como conector (su /rss solo publica artículos del blog, no ofertas) y GitHub Jobs, Stack Overflow Jobs y AngelList están cerrados. Jobgether, Tecnoempleo, Chumijobs, Glassdoor, Monster, Dice, FlexJobs, Jobrack y OnlyMarketingJobs están vivos pero sin feed público utilizable (Cloudflare o HTML); quedan como rutas Apify opt-in en el catálogo, sin scraping general en el motor.

## Conectar una fuente

1. Fuentes → Conectar o Añadir fuente. Puedes crear varias conexiones para un portal, país o comunidad.
2. Introduce un token de Apify y un Actor ID, o un dataset existente. No se ejecuta nada al guardar.
3. Añade URLs de búsquedas, páginas o comunidades, una por línea. Selecciona el nombre de campo y formato que acepta el Actor. El formato de un solo enlace usa el primero.
4. El Input JSON contiene los criterios de captación: términos, país, remoto y límites según el Actor. La plantilla InfoJobs precarga los términos de WDC y el filtro de teletrabajo según su documentación. Los otros Actors requieren revisar Input/Output; no tienen esquemas intercambiables.
5. Adapta el mapeo de campos con una muestra de salida. Admite rutas como `company.name`. Para posts sin título omite `title`, mapea `description` al texto y `source_url` al permalink. La búsqueda requiere contratación explícita si el perfil solo aparece en la descripción.
6. Guardar → Comprobar para verificar acceso al dataset. Si necesitas nuevos datos, «Ejecutar scraper · puede generar coste» inicia exactamente una llamada POST. Comprobar actualiza el estado y recoge el dataset al terminar.
7. Oportunidades consulta el dataset guardado y aplica los filtros actuales. **Buscar no ejecuta un scraper nuevo.** No modifica dinámicamente el Input guardado del Actor.

Una respuesta incierta bloquea nuevos lanzamientos. Revisa la consola de Apify y después usa «Ya revisé Apify: desbloquear»; la app no reintenta POST de pago. Se envían límites de 90 segundos, resultados y `maxTotalChargeUsd`; la cobertura de este último depende del modelo de cargos del Actor. Los cargos reales se muestran si Apify los devuelve.

## Cobertura y límites

- Get on Board: categoría Sales, hasta tres páginas de 100. No hay nombre de empresa expandido en la respuesta consultada: se muestra «Empresa no indicada». No se infiere unidad/moneda de un importe.
- Remotive: feed cacheado seis horas conforme a su recomendación de pocas consultas al día. Ofertas retrasadas 24 horas por el proveedor; conservar atribución y enlace. Revisar sus condiciones antes de un portal público con login.
- Remote OK: ventana reciente del feed, sin historial completo.
- Arbeitnow: primera página, actualmente 250 registros; principalmente Europa, cobertura hispana variable.
- WWR: feed de ventas con hasta 100 registros medidos el 2026-11-12. Himalayas: consultas por alias con hasta tres páginas por término; no garantiza cobertura exhaustiva.
- Working Nomads: API JSON pública, ~60 registros globales por descarga; sin filtros upstream.
- Virtual Vocations: RSS general de **10** ofertas por pasada (medido el 2026-11-12), mayoritariamente en inglés (US); el filtro de español descarta la mayoría al importar.
- Remote.jobs: su `/rss` responde 301 sin feed útil y Remote First Jobs 404 (medido el 2026-11-13): no hay conector gratuito, quedan como Actor opt-in.
- Apify: hasta 500 registros de cada dataset por conexión; no es importación ilimitada. HTTP JSON de proveedores distintos de Apify, OAuth y acceso privado con cookies no tienen adaptador propio todavía.
- La detección de español y modalidad es determinista y conservadora. Puede perder ofertas escuetas o ambiguas; no equivale a clasificación semántica validada. Compartir palabras con portugués no basta para declarar español. Revisar residencia, inglés, experiencia, vigencia y condiciones antes de compartir.
- No se filtra por género. La audiencia WDC son mujeres hispanas; eso no convierte las ofertas en exclusivas para mujeres.
- Grupos privados, canales y comunidades solo con acceso autorizado y un proveedor compatible. Listar una comunidad no implica que pueda extraerse anónimamente.
- Los tokens se guardan fuera de SQLite en archivos locales 0600, directorio 0700, junto a la base activa. Nunca se devuelven por API ni se guardan en localStorage. No es cifrado en reposo ni solución multiusuario de producción.
- La configuración de conexión se usa al ejecutar una búsqueda; las capturas originales permanecen inmutables. Versionar configuraciones por búsqueda queda pendiente.

## Referencias verificadas

- [API pública de Get on Board](https://www.getonbrd.com/user-manual/get-on-board-s-api)
- [Remotive: API y condiciones](https://github.com/remotive-com/remote-jobs-api)
- [Remote OK: feed y atribución](https://remoteok.com/faq)
- [Arbeitnow: API e integraciones](https://www.arbeitnow.com/blog/free-job-posting-integrations)
- [API de Apify](https://docs.apify.com/api/v2)
- [InfoJobs: Input y Output del Actor de referencia](https://apify.com/haketa/infojobs-scraper)
- [Computrabajo: Actor de referencia](https://apify.com/haketa/computrabajo-scraper)
- [LinkedIn: Actor de referencia](https://apify.com/curious_coder/linkedin-jobs-scraper)

Se verificaron públicamente los nueve feeds (los tres últimos el 2026-09-23). Los Actors de pago están documentados y probados con fixtures; no se han ejecutado con una cuenta real ni se han consumido créditos.

## Siguiente lote propuesto — investigación en vivo España, 2026-09-23

Sondeo real (HTTP + estructura de respuesta) de ~35 dominios candidatos para España, priorizando señal comercial (closer/setter/comercial/ventas). Resultado verificado, no suposición:

### Tanda 1 — conector propio coste cero (señal máxima España) · IMPLEMENTADA 2026-09-23

| Fuente | Estado | Resultado de la recogida real |
|---|---|---|
| **JobToday** | **Conector en REGISTRY** (3 rutas: `jobtoday` closer-venta, `jobtoday-telemarketing`, `jobtoday-remoto` ventas-remoto). Lee el `__NEXT_DATA__` embebido; salario/ubicación solo si `isValid`/address presentes; fecha de `createDate` (ms) o `postedSecondsAgo`. | 142 leídas, 2 aceptadas por el filtro WDC (Técnico/a Comercial en Venta Directa — Foro Soluciones S.L., Madrid; Business Development Manager — Nara k Skin, Las Rozas). Las demás son Marketing/RRHH/retail: el clasificador conservador no las convierte en ventas. La ruta `/trabajos-setter` devuelve **410 Gone**: sustituida por `telemarketing` (60 leídas). |
| **ClosersAvenue** | Entrada de catálogo informativa: su bolsa interna devuelve **500**; sin listado público extraíble. Requiere Actor opt-in o acceso autorizado. | — |
| **Greenhouse Cabify** | **Alta en watchlist (migración 7)**: board verificado con 14 ofertas de ventas en el sondeo. | 67 leídas en la recogida real; ninguna matchea perfiles WDC en español hoy (SaaS B2B en inglés/hibrido). El board queda vigilado a diario sin coste. |

### Tanda 2 — a confirmar en siguiente sondeo

- **RemotoList** (`remotolist.com`): HTML 200 con un User-Agent real (el probe `CareerPlatform` recibía 000/403); sin feed RSS localizado aún. Buscar su estructura de listado y categoría Ventas.
- **JobToday paginación**: la primera página trae ~18-83 ítems por ruta; paginar y añadir rutas (`comercial`, `ventas`, `appointment-setter`) si la señal lo justifica.
- **EuropeLanguageJobs**: HTML 200 con secciones de hispanohablantes; el RSS devolvió 1.4 KB sin `<item>` — revisar su feed real o listar HTML.
- **WelcometotheJungle ES**: HTML 200 sin `__NEXT_DATA__`; su backend Algolia exige más ingeniería (tier opt-in Apify).

### Descartados en esta pasada (evidencia en vivo, 2026-09-23)

- **Remoters.net**: 403 con UA propio y 200 con UA navegador pero Cloudflare y sin `<item>` en el feed — anti-bot activo; iría por Actor Apify.
- **Tecnoempleo / Infoempleo / Trabajos.com / Jobrapido / Jobgether / Milanuncios / PrimerEmpleo / GlobalRemoteHub**: 403/404 o sin feed público.
- **Trovit**: responde 200 pero devuelve HTML, no RSS; su API de partner requiere acuerdo.
- **EURES**: endpoint de búsqueda sin formato público estable (404 en ambas variantes).
- **Personio**: 307 a login incluso anónimo (Factorial ya no usa Personio); Ashby sin board público para las empresas probadas; SmartRecruiters sin postings para Adevinta/eDreams/Vueling/Glovo (SuccessFactors interno).
- **RankingCloser**: HTML con señal pero tras paywall; sin listado scrapeable gratuito.
- **Salehires**: conexión fallida (000) desde este entorno.
- **Jobicy**: la API existe (200 con 50 ofertas) pero `industry` exige su slug exacto (`sales` fue rechazado: `Invalid industry value`); probar slugs válidos de su lista antes de añadir un filtro en origen.
- **SmartRecruiters/Ashby/Lever**: sin slugs de empresas España con ofertas de ventas verificados; no añadir a la watchlist sin evidencia.

### Criterio aplicado (coherente con ADR-008/ADR-009)

Solo entra como conector coste cero lo verificado en vivo con datos reales. Todo lo bloqueado por anti-bot queda en el catálogo Apify opt-in con presupuesto diario; nada se conecta a ciegas. La integración de JobToday y las altas de watchlist con volumen (Fever, Cabify) siguen siendo el siguiente incremento de cobertura recomendado.


## Expansión documental US — 2026-09-22

La nueva investigación añade 17 fichas priorizadas en [18_US_HISPANIC_SOURCE_RESEARCH](spec/18_US_HISPANIC_SOURCE_RESEARCH.md). El catálogo ejecutable seguía con 33 entradas y seis conectores públicos **cuando se escribió esta sección (2026-09-22)**; los recuentos vigentes están en «Estado real — medido el 2026-11-20» (39 conectores, 68 entradas). Esta entrega no cambió los recuentos de entonces ni activó scrapers.

Prioridad: ATS por empresa (Greenhouse/Lever/Ashby), recruiters LATAM→US (Remote Latinos/HireLATAM/Near), boards hispanos (Hispanic-Jobs/iHispano/DiversityJobs) y fuentes remotas/ventas/comunidades. Acceso y bloqueos documentados por ficha; sin Actors nuevos declarados operativos.

Buscar ES/EN separando US como mercado de clientes de residencia permitida. Español requerido/preferido, inglés, oficina híbrida y autorización laboral son criterios independientes. Admin conserva source/provider/raw; alumna recibe proyección centrada en empresa y condiciones con atribución necesaria.

## Triaje del listado de portales del operador — 2026-11-20

El operador pasó un listado de unos 250 portales (ATS por empresa, bolsas nacionales y servicios públicos de empleo)
con dos instrucciones: añadir los que tengan **API pública gratuita** y llevar a un proveedor (Apify u otro) lo que
no la tenga y no sea difícil de conectar. Todo lo que sigue se sondeó **en vivo hoy** (HTTP desde el equipo del
propietario, `curl` con User-Agent de navegador); ninguna fuente entra por aparecer en la lista.

### Añadido hoy — gratis, sin clave

**Workable** (`workable-es`, `workable-latam`; una sola ficha en el catálogo). Su API de búsqueda global responde
200 sin clave ni cuenta y devuelve ofertas reales de sus empresas cliente, con empresa, ciudad/país, modalidad
estructurada (`workplace`), fecha y cuerpo completo:

| Búsqueda medida | Resultado |
|---|---|
| `closer` en España | 4 ofertas, las 4 de España; entre ellas «Account Executive - High Ticket Closer» (Huzzle) |
| `comercial` en España | 14 ofertas (Teleperformance Spain, EALDE Business School…) |
| `closer` en México / Colombia / Argentina / Chile | 16 / 11 / 11 / 1 |
| `closer` con «Latin America» | **no filtra**: 12 de las 20 primeras eran de EE. UU. → se pide país por país |

No trae salario estructurado (no se inventa) y cuesta 0 por resultado: 2 `fetch` por conector y pasada, 4 en total.

### Añadido también — SmartRecruiters (búsqueda global, sin clave)

**SmartRecruiters** (`smartrecruiters`). Su buscador público responde JSON sin clave, con una trampa medida:
`keyword` **sí** filtra (un término inexistente devuelve 0) y `location`/`country` **no** (mismo `totalFound`
con y sin `location=es`). Los términos en español traen solos el mercado:

| Búsqueda medida | Resultado |
|---|---|
| `closer` | 504 resultados, casi todos de EE. UU. y Australia |
| `comercial` | 221 resultados: 34 de España (METRO/MAKRO, Bosch Group), 13 de Colombia, 12 de México, 11 de Brasil, 7 de Portugal y 4 de Chile entre los 100 primeros |

El listado no trae descripción y sin cuerpo el gate de idioma no publica nada, así que se pide el detalle
público (`api.smartrecruiters.com/v1/companies/<empresa>/postings/<id>`, también sin clave) de hasta 4 ofertas
del perfil por pasada, priorizando los mercados que el motor ya reconoce (`LATAM_COUNTRIES` + España; sin
lista paralela). Coste declarado: 6 `fetch` (búsqueda con un reintento + 4 detalles sin reintento). Lo que no
cabe (`detalle_fuera_de_presupuesto`) o falla (`sin_detalle`) se cuenta, no se ingiere vacío.

**Verificado en workerd con D1 local** (2026-11-20, `wrangler dev --local --persist-to` fresco, techo de pago):
una pasada completa de 40 fuentes en 56 s; `workable-es` aceptó 5 (Teleperformance Spain, Workana «Appointment
Setter»), `workable-latam` 4 (Pavago, The Law Collective «Sales Closer / Intake Specialist») y `smartrecruiters` 2
con cuerpo real; en D1 se comprobó que descripción, ubicación («Spain · remoto», «Mexico City, Mexico»), fecha y
`salary: null` llegan al payload. `/api/status` publica `fetch_cost: 126`.

### Ya estaba conectado — no se duplica

Greenhouse y Ashby (Fever, Qonto, Stripe, Pennylane, Cabify) y Teamtailor (ProductHackers) ya se leen en el motor, y
Recruitee tiene extractor propio desde antes. Las entradas de ATS del listado son **tableros por empresa**, no
portales con inventario global.

### ATS por empresa: el listado no se puede «añadir entero»

De las ~90 entradas de ATS del listado (BambooHR, Personio, SmartRecruiters, iCIMS, Taleo, SAP SuccessFactors,
Oracle HCM, Dayforce, UKG, Paylocity, Jobvite, JazzHR, Breezy, Comeet, Loxo, Manatal, Vincere, JobAdder, Rexx,
softgarden, d.vinci, onlyfy, Talention, TalentLyft, Tribepad, Eploy, networx, Jobtrain, Jobylon, Pinpoint…)
**ninguna expone inventario global**: cada API pública vive en el subdominio de su cliente y exige un slug
verificado. Conectar «el ATS» no existe; se conecta una empresa. Lo que se añade es la **capacidad** (los
extractores de Greenhouse, Ashby, Teamtailor, Recruitee y Workable), y cada empresa nueva exige su slug comprobado
con ofertas comerciales. Sondeos de hoy sin tablero verificable: BambooHR (`lodgify.bamboohr.com/careers/list` →
302), Personio (`sennder.jobs.personio.de/xml` → 404), softgarden (`jobs.softgarden.io/jobs.json` → 404), Breezy
(`chispafy.breezy.hr/json` → 404) y SmartRecruiters (API 200 pero 0 postings para el tenant probado).

### Sin API ni feed utilizable — ruta Apify opt-in

Añadidas al catálogo con su bloqueo medido (no como conectores):

| Portal | Medición de hoy | Ficha |
|---|---|---|
| OCC Mundial (MX) | su API interna responde **403 «abuse»** | `occ-mundial` |
| Chiletrabajos (CL) | `/rss/` redirige a la portada: 200 HTML, sin feed | `chiletrabajos` |
| Portal del Empleo (MX) | **403 «Acceso no autorizado»** | `portal-empleo-mx` |

No se declara ningún Actor concreto para ellas: el panel abre la tienda de Apify con la búsqueda del portal y la
app valida ficha, esquema y resultado al lanzar. Nunca se inventa un Actor ID. Otras del listado ya tenían ficha:
Computrabajo, InfoJobs, Torre, Bumerán/Laborum, Welcome to the Jungle, Tecnoempleo, ClosersAvenue, LinkedIn, Indeed.

### Descartadas con evidencia (o por mercado)

| Fuente | Medición de hoy | Por qué no entra |
|---|---|---|
| EURES | **403** de su capa anti-bot | ya constaba como sin endpoint público estable |
| Torre | `search.torre.co` **404**, `torre.ai/api/...` **404** | sin API pública; su ficha Apify ya existe |
| Just Join IT | `/api/offers` **404** | sin API pública; mercado polaco |
| HeadHunter (HH) | `api.hh.ru` **403** sin clave | requiere registro; mercado ruso |
| JobTech Dev (Platsbanken, SE) | **200** y sin clave | mercado sueco: no aporta closers en español |
| NAV Arbeidsplassen (NO) | endpoint público **404** hoy | mercado noruego |
| MyCareersFuture (SG) | **200** y sin clave | mercado de Singapur, fuera del alcance WDC |
| Bolsa Nacional de Empleo (CL) | **404** | sin API pública |
| HelloWork | **404** en la ruta probada | sin ruta pública verificada |
| Bumerán | **403** | ya cubierta por Actor opt-in |
| Holded · Recruitee | **200**, 8 ofertas, solo un «Sales Data Analyst» | cero closers: seguiría dando 0 elegibles |

El resto del listado (CareerBuilder, Built In, Dice, SEEK, Reed, StepStone, Catho, Naukri, apna, JobKorea,
Saramin, Liepin, doda, ChinaHR, eFinancialCareers, GulfTalent, USAJOBS, Job Bank, NHS Jobs, VDAB, werk.nl,
France Travail, Arbeitsagentur…) **no se sondeó hoy** y no se declara nada sobre ellas: varias son de pago, de
afiliación o de mercados sin closers en español, y las que lo sean tendrían que entrar por la misma regla
—verificación en vivo con datos reales y coste declarado—, no por aparecer en una lista.

### Crawlers de código abierto y planes gratuitos: qué se reutiliza y qué no

Revisado el listado de resultados que pasó el operador (GitHub topics `job-crawler`, Scrapfly, WebScrapingAPI,
Kitsuno, jobspipe, CleanJobData, ZenRows, ScrapingBee, SocialCrawl, JobDataFeeds/Techmap):

| Fuente | Qué es | Decisión |
|---|---|---|
| **JobSpy** (MIT) | Librería de scraping de Indeed/LinkedIn/Glassdoor/Google Jobs | **Ya reutilizada**: el repo la ejecuta en GitHub Actions con un commit fijado (ver [EXTERNAL_SOURCES](EXTERNAL_SOURCES.md) §2) |
| **kitsuno-ai/agentic-job-search-eu** (MIT; datos CC-BY-SA) | Directorio YAML de 54 fuentes europeas con límites y rendimiento medidos | **No es código que copiar**: se usa como referencia. Su cobertura de España es adzuna, arbeitnow y tecnoempleo — las dos primeras ya están y la tercera responde 404 |
| Repos `job-crawler` de GitHub | Scrapers sueltos, muchos GPL/AGPL o sin licencia | **No se copian**: la licencia no es compatible con este repositorio y casi todos exigen proxies de pago. Se conectan sus endpoints públicos cuando existen (es lo que se hizo con Workable y SmartRecruiters) |
| **Apify** (plan gratuito con crédito mensual) | Actores alojados | Ya integrado como vía opt-in con tope de gasto; ninguna receta se declara operativa sin medirla |
| **Scrappa · InfoJobs** (500 créditos gratis/mes, sin tarjeta) | JSON estructurado de InfoJobs | **No implementado**: requiere clave y no hay ninguna con la que probar. Queda como ruta a evaluar; la API oficial de InfoJobs exige acuerdo de agregador |
| **ZenRows / ScrapingBee** (créditos gratis) | Proxies que devuelven HTML | **No implementado**: se paga por URL y devuelven HTML; habría que escribir un extractor por portal y no se puede probar sin clave |
| **okemprego** (API gratis sin clave) | Portugal, Brasil y Angola | Descartada: su inventario es en portugués y el gate lo rechaza por diseño |
| **CleanJobData, TheirStack, JobsPipe, Techmap, Fantastic.jobs** | APIs comerciales con prueba gratuita | Sin clave no se pueden verificar; no se implementa nada |

Criterio: de un crawler ajeno se reutiliza lo que tiene licencia compatible (JobSpy) o su API pública; no se
copian scrapers con licencia incompatible ni se escribe un conector que no se pueda probar con datos reales.

## Rutas por fuente (2026-11-21)

Cada fuente tiene varias formas de conectarse, ordenadas por coste real, no por marca. El modelo vive en
[`sourceRoutes.ts`](../apps/web/lib/sourceRoutes.ts) y el panel de Fuentes lo enseña tarjeta a tarjeta:

1. **Gratis primero:** API/feed público del motor, conector del backend o feed ATS. Sin clave.
2. **API oficial con clave:** InfoJobs, Adzuna, Jooble. Guardar la clave no gasta.
3. **Google Jobs · Bright Data SERP:** 0,0015 USD/búsqueda y 5.000 créditos gratis al mes compartidos.
   Requiere `API key:zona SERP` en Panel → APIs. Va antes que SerpApi por coste.
4. **Google Jobs · SerpApi:** 0,025 USD/búsqueda; respaldo si no hay Bright Data.
5. **Apify:** actor auditado, pago por resultado y presupuesto propio.
6. **JobSpy:** última vía; solo con proxies sanos (200 en <8 s). Sin proxies no se lanza.
7. **Web Unlocker / ZenRows / ScrapingBee:** solo donde hay extractor JSON-LD/RSS; nunca a ciegas.
8. **Hermes/Manus:** no disponibles (ADR-009); se muestran como hueco, no como conexión.

La cascada prueba las vías listas en orden, **para en la primera con ofertas** y registra cada intento y su
motivo. Un fallo no oculta lo que trajo otra vía. «Sin clave» y «sin tope» son estados distintos de
«conectada»: el panel nunca los confunde.

**Páginas de empresa:** hay una pestaña propia. Feed ATS (automático) · página de empleo propia (extractor
JSON-LD/RSS + diff por huella) · solo LinkedIn (enlace a Google Jobs, sin rastrear la red). No se añade una
empresa sin URL 200 con ofertas.

Detalle y límites en [ADR-021](decisions/ADR-021-cascada-de-rutas-por-fuente.md).
