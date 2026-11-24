# Referencias de scrapers y agentes de empleo (lista del propietario, leída el 2026-11-24)

**Qué es este documento.** El registro honesto de cada herramienta que pasó el propietario: qué es, con qué licencia (¿se puede usar en una academia con ánimo de lucro?), qué aporta, **qué está aplicado en la app y qué no**, y la tarea con dueño. Si una fila no dice «aplicado» con su evidencia, **no está hecho**.

**Cómo se leyó** (*inspected*): README y `LICENSE` de cada repositorio, bajados de GitHub el 2026-11-24. Estrellas y fechas salen de la búsqueda de GitHub de ese día y cambian. **No se ejecutó ninguna herramienta ajena** y desde este entorno no se alcanzan `workable.com` ni `storage.stapply.ai` (el proxy devuelve 403): lo que dependa de ellos solo se prueba en GitHub Actions.

**Regla del propietario (2026-11-24):** de las fuentes que citan esos repos, conectar **directo** en la app todas las que se pueda; usar la herramienta intermedia (JobSpy, dataset de ats-scrapers, Apify) solo cuando no haya conexión directa. Conectar no es «hecho»: una fuente solo está hecha cuando el Control de fuentes (Resumen) mide ≥1 oferta cualificada en 7 días, o está bloqueada con causa y dueño.

## 1. Herramienta por herramienta

Licencia: «uso comercial» = ¿podemos usar su código o su dato en WDC? Código MIT/Apache/ISC sí; datos CC BY-NC no.

| # | Herramienta (repo, estrellas) | Licencia | Qué es | Aporta a WDC | Estado en la app |
|---|---|---|---|---|---|
| 1 | Artículo Scrapfly | — | Recomienda JobSpy, ats-scrapers y Levergreen; descarta JobFunnel (archivado) | Orden de prioridad: ATS directo antes que portales | Leído. Sus módulos `scrapfly-scrapers` son **NPOSL-3.0** (no comercial) y exigen su clave de pago: **no se usan** |
| 2 | Claude Cowork Job Seeker Plugin ([andrew-shwetzer/career-ops-plugin…](https://github.com/andrew-shwetzer/career-ops-plugin-do-not-fork-currently-updating-v2-), 513★) | MIT | Plugin de Cowork para una candidata: evaluar oferta, CV, tracker, mensajes | Material para formar a las alumnas; no es fuente | **No aplicado.** Idea: kit de búsqueda para alumnas (fuera de producto) |
| 3 | Career-Ops ([santifer/career-ops](https://github.com/santifer/career-ops)) | MIT | Escáner de 180+ empresas (`portals.yml`), 55+ módulos de ATS/feeds, puntuación A-F, CV a medida | **Lista de empresas** y la idea de comprobar caducadas | Lista sin usar (tarea T2). Candidaturas automáticas: fuera (ADR-012) |
| 4 | Remote In Tech ([remoteintech/remote-jobs](https://github.com/remoteintech/remote-jobs), 41k★) | ISC | Directorio de empresas tech remotas (un `.md` por empresa) | Semillas de empresas; casi todo tech, poco closer | **No aplicado**; baja prioridad (T2) |
| 5 | JobSpy ([speedyapply/JobSpy](https://github.com/speedyapply/JobSpy), ~4k★) | MIT | LinkedIn, Indeed, Glassdoor, Google, ZipRecruiter, Bayt, Naukri, SEEK… en un DataFrame; MCP incluido | Portales sin API pública | **Aplicado**: `scripts/jobspy_collect.py` + workflow (solo corre con proxies sanos) y el actor `aakash19/jobspy` en Apify. Sin medición propia hoy |
| 6 | ats-scrapers ([kalil0321/ats-scrapers](https://github.com/kalil0321/ats-scrapers), 125★) | MIT (código) | 50+ ATS y dataset alojado (4,2 M de ofertas, 63 000 empresas; campos con `description`, `country_iso`, `language`, `engagement_type`) | Cobertura de ATS sin conector propio (Workday, iCIMS, Personio…) y de Get on Board/Pandapé | **No aplicado** (T1b). Licencia del **dato** no declarada en el README: verificar antes de usarlo |
| 7 | jobseek ([colophon-group/jobseek](https://github.com/colophon-group/jobseek), 234★) | Código MIT; **datos CC BY-NC 4.0** | Buscador de páginas de empleo, API REST pública y servidor MCP, `companies.csv` | Registro de empresas | **No usar su dato** (no comercial). Código/ideas sí |
| 8 | Jobscout-AI | — | Hay 3 repos con ese nombre (GPL-3.0, sin licencia, sin licencia) | — | **No identificado con certeza y README no leído.** Pregunta abierta (§5) |
| 9 | ScrapeGraphAI ([ScrapeGraphAI/Scrapegraph-ai](https://github.com/ScrapeGraphAI/Scrapegraph-ai)) | MIT | Extrae datos de cualquier web con un LLM (coste en tokens) | Páginas sin API (publicaciones de Facebook/Telegram, webs de empresa) | **No aplicado.** Solo con un LLM que no reciba datos de alumnas (regla del repo) |
| 10 | job-board-aggregator ([Riley-Dorrington](https://github.com/Riley-Dorrington/job-board-aggregator)) | Código MIT; **listas de empresas CC BY-NC 4.0** | ETL diario de 1 M de ofertas de 9 ATS + feed XML de Workable | La idea del feed de Workable | **Aplicado** solo Workable (`scripts/workable_collect.py`, #176; probado con XML de muestra, **no verificado** contra el feed real). Sus listas de empresas: no comercial, **no se usan** |
| 11 | OpenPostings ([Masterjx9/OpenPostings](https://github.com/Masterjx9/OpenPostings)) | **Sin licencia declarada** | Agregador local de 80+ ATS («110 000 empresas»), extensión de Chrome para sembrar empresas, servidor MCP | Lista larga de ATS y la extensión de «guardar empresa» | **No aplicado; sin licencia no se copia código ni datos** |
| 12 | job-radar ([maccydee/job-radar](https://github.com/maccydee/job-radar), 43★) | MIT | Lee **17 560 tableros de empleadores** de 24 plataformas ATS, con una semilla descargable (`seed-latest`) y reglas «mostrar menos» | **Semilla de tableros** para el colector directo | Semilla sin usar (T2); licencia de la semilla (`docs/SEED.md`) sin comprobar |
| 13 | job-hunter-agent ([Insideofcub](https://github.com/Insideofcub/job-hunter-agent), 3★) | MIT | Google Jobs/LinkedIn/Indeed/Naukri, ventana de 24 h–30 d, repostados aparte, avisos por Telegram | Patrón de ventana y de repostados | Identificación probable (hay homónimos). No aplicado |
| 14 | job-search-pipeline ([dome317](https://github.com/dome317/job-search-pipeline)) | MIT | JobSpy + StepStone + Arbeitsagentur, puntuación en dos etapas, **descubre la web de empleo de la empresa y detecta 18+ ATS**, Telegram | Detección de ATS por empresa (T3) | No aplicado |
| 15 | Bert ([emnl51/bert](https://github.com/emnl51/bert), 3★) | Apache-2.0 | Búsquedas programadas, idioma del anuncio, duplicados entre fuentes conservando cada enlace | Patrón de pruebas de precisión/recall del rol | **Parcial**: nuestro `fingerprint`/`also_seen` y `role-audit` ya hacen algo equivalente |
| 16 | JobNavigator ([vesaias/JobNavigator](https://github.com/vesaias/JobNavigator), 197★) | MIT | Playwright con 13 manejadores de ATS + JobSpy, puntuación con LLM, Telegram, Gmail | Lista de 13 ATS a soportar | No aplicado |
| 17 | JobMiner ([beingvirus/JobMiner](https://github.com/beingvirus/JobMiner), 20★) | MIT | Toolkit genérico (límite de velocidad, CSV/SQLite) | Nada que no tengan el motor y Apify | No aplicado (nada que aplicar) |
| 18 | job_search_tool ([fedorchenko-juli](https://github.com/fedorchenko-juli/job_search_tool)) | MIT | `companies.yaml` por API de ATS (Greenhouse, Ashby, Workable, Lever, SmartRecruiters) + Adzuna/Remotive, deduplicación en SQLite | Confirma el modelo «lista de empresas + API de ATS» | **Aplicado en parte**: el motor ya lee Greenhouse, Ashby, Workable, SmartRecruiters |
| 19 | ts-jobspy ([alpharomercoma](https://github.com/alpharomercoma/ts-jobspy), 18★) | MIT | JobSpy en TypeScript; informa **el estado de cada sitio sin ocultar fallos** | El patrón de estado honesto por sitio | **Aplicado como principio** en el Control de fuentes («—» con causa) |
| 20 | career-site-jobs-scraper ([unbrowse-ai](https://github.com/unbrowse-ai/career-site-jobs-scraper)) | MIT (hay 2 homónimos sin licencia) | Todas las vacantes de un tablero Greenhouse/Lever/Ashby; acepta la URL del tablero | Detectar el ATS desde la URL (T3) | No aplicado |
| 21 | freehire ([strelov1/freehire](https://github.com/strelov1/freehire), 3,7k★) | MIT | 5 M de ofertas de 437 fuentes (incluye canales de Telegram), API, CLI y MCP; centrado en **empleo tech**; Pro 5 USD/mes | Fuente gratuita | **Aplicado**: el motor tiene 4 conectores `freehire` (el `/api/funnel` del 2026-11-24 dio 265 elegibles de 271) |
| 22 | JobSentinel ([cboyd0319](https://github.com/cboyd0319/JobSentinel)) | MIT | App local en Rust: señales de **oferta fantasma** (antigua, repostada, sin sueldo) | Regla determinista contra ofertas muertas | **No aplicado** (T4) |
| 23 | JobForge ([KunalScriptz/jobforgex](https://github.com/KunalScriptz/jobforgex), 8★) | MIT | Tablero Kanban de candidaturas, extensión de Chrome para guardar ofertas, CV en LaTeX | Tablero y extensión para alumnas | **No aplicado.** Identificación **probable**: confirmar el enlace (§5). El tablero de candidaturas de las alumnas ya existe; la extensión no |
| 24 | jobsparser ([FranciscoMoretti](https://github.com/FranciscoMoretti/jobsparser), 68★) | MIT | CLI que envuelve JobSpy | Nada nuevo sobre JobSpy | No aplicado (nada que aplicar) |
| 25 | linkedin-mcp-server ([stickerdaniel](https://github.com/stickerdaniel/linkedin-mcp-server)) | Apache-2.0 | Usa **tu propia sesión de navegador** de LinkedIn para leer ofertas, perfiles y mensajes | — | **No se adopta**: ata una cuenta real al scraping (riesgo de bloqueo y de términos) |
| 26 | Scraper-InfoJobs-Python ([DevJuanCR](https://github.com/DevJuanCR/Scraper-InfoJobs-Python), 3★) | MIT | Selenium para InfoJobs España | Campos de InfoJobs | **README no accesible: no leído.** La vía buena es la API oficial |
| 27 | InfojobsScraper ([ander-elkoroaristizabal](https://github.com/ander-elkoroaristizabal/InfojobsScraper)) | **CC BY-NC-SA 4.0**, «fines educativos, no comerciales» | Selenium para InfoJobs | — | **No se puede usar** (no comercial) |
| + | Levergreen ([adgramigna/job-board-scraper](https://github.com/adgramigna/job-board-scraper)) | MIT | Scrapy para Greenhouse y Lever, caché S3, dbt; ~30 USD/año | Arquitectura de referencia | No aplicado |
| + | py-linkedin-jobs-scraper ([spinlud](https://github.com/spinlud/py-linkedin-jobs-scraper), 491★) | MIT | Solo LinkedIn | — | No aplicado |
| + | JobFunnel | — | **Archivado** desde dic. 2025 | — | Descartado |

**Tabla de tipos de proveedor del propietario:** Google Jobs vía proveedor de SERP (aplicado: SerpApi/Bright Data), scraping de Indeed (aplicado: actor de Apify), Monster (no hay conector), Upwork y Freelancer (aplicado: Apify; Freelancer también en el motor), Playwright/Selenium (no usado: el motor usa `fetch`), herramientas sin código Apify/Make/n8n (Apify aplicado; Make y n8n no están en el repositorio).

## 2. Fuentes que citan esos repos y cómo conectarlas

Preferencia: **conexión directa** (endpoint público del propio ATS o portal, sin intermediario). «Motor» = `sites/engine/worker.js`, inspeccionado el 2026-11-24.

| Fuente | Citada en | Conexión directa | En la app hoy |
|---|---|---|---|
| Greenhouse, Ashby, SmartRecruiters, Recruitee, Teamtailor, Workable (búsqueda) | 3, 6, 10, 12, 14, 16, 18, 20 | Sí: API/RSS públicos por empresa | **Motor** (listas fijas de empresas; no escala a miles) |
| **Lever** | 3, 6, 10, 12, 16, 18, 20 | Sí: `api.lever.co/v0/postings/<empresa>?mode=json` (*conocido, no verificado desde aquí*) | **Falta en el motor** (T3) |
| **Personio, BambooHR, JOIN** | 6, 10, 12, 16 | Sí por empresa (`<empresa>.jobs.personio.de/xml`, `<empresa>.bamboohr.com/careers/list`; *no verificados*). JOIN pide id por empresa | **Faltan** (T3) |
| Workday, iCIMS, Jobvite, Breezy, Rippling, Gem, Dayforce… | 6, 10, 11, 12, 16 | Por empresa y con formatos distintos; iCIMS solo trae título | Solo por el dataset de ats-scrapers (T1b) |
| Workable (todas las empresas) | 10 | Sí: feed XML público | **Aplicado** (#176, sin verificar contra el feed real) |
| Remotive, RemoteOK, Jobicy, Himalayas, Arbeitnow, Get on Board, Working Nomads, Jobspresso, JobToday, FreeHire | 14, 16, 18, 21 | Sí | **Motor** (ya conectadas; rendimiento medido: 9 de 40 conectores con elegibles) |
| InfoJobs, Adzuna, Jooble | 18, 26, 27 | Sí, **con clave oficial** | Claves soportadas en `integrations.ts`; InfoJobs y Jooble medidos con aprobadas (166 y 124 en 7 días, 2026-11-24) |
| Indeed, LinkedIn, Glassdoor, ZipRecruiter, Google Jobs | 5, 13, 14, 16, 19, 24 | **No hay API pública** | JobSpy (con proxies), Apify y SERP (aplicados) |
| Computrabajo, OCC, Bumeran, Elempleo, Talent.com | (no citados; mercado LatAm) | No | Apify (#169, #175; Elempleo y Talent llegan sin descripción) |
| StepStone, Arbeitsagentur, EURES, Wellfound, Welcome to the Jungle, SEEK, Naukri, HelloWork, Bayt, Gupy, Pandapé | 6, 13, 14 | Algunas (Arbeitsagentur, EURES) | **No aplicado**: fuera del mercado ES/LatAm/EE. UU. en español, salvo Pandapé (LatAm; solo por el dataset) |
| Canales de Telegram, grupos de Facebook, comunidades de Skool | 21 | No directo (requieren sesión o URL concreta) | Actores de Apify; **faltan las direcciones** (rama `direcciones-vigilar`) |

**Escala:** el motor es un Worker con tope de subpeticiones; no puede recorrer 17 560 tableros. La conexión directa a esa escala corre como colector en GitHub Actions (como Workable), con las semillas de la tarea T2.

## 3. Tareas (estado real)

Dueño `C` = lo hace Claude; `P` = lo decide o aporta el propietario. Marcado `[x]` solo con evidencia.

- [x] **T0** Leer las herramientas y escribir este documento (2026-11-24).
- [ ] **T1** Colector directo en Actions sobre los tableros de empleadores (semilla de T2), con Greenhouse, Ashby, SmartRecruiters, Recruitee y Teamtailor primero; filtra por el vocabulario closer/setter/cold calling/SDR y por mercado, y envía borradores con su descripción (C).
- [ ] **T1b** Respaldo: colector del dataset de ats-scrapers para los ATS sin conector (Workday, iCIMS…) y Get on Board/Pandapé, filtrando con DuckDB. Antes, comprobar la licencia del dato y leer su esquema real en Actions (C; bloqueo: red de este entorno).
- [ ] **T2** Semillas de empresas: semilla de job-radar (MIT; licencia de la semilla por comprobar), `portals.yml` de career-ops (MIT) y el directorio de Remote In Tech (ISC). Se descartan las listas CC BY-NC (C).
- [ ] **T3** Conectores directos nuevos en el motor y el colector: **Lever**, Personio, BambooHR y la detección del ATS desde la web de una empresa (patrón de career-site-jobs-scraper y job-search-pipeline). Verificar cada endpoint contra el servicio real antes de darlo por bueno (C).
- [ ] **T4** Regla determinista de oferta fantasma (JobSentinel + comprobación de caducadas de career-ops): antigua, repostada, sin sueldo, enlace caído (C).
- [ ] **T5** Alerta de fuente muerta: «3 ciclos seguidos sin ofertas brutas» como en JobRadar de liliamkezia (en 58 días tres fuentes pararon **sin un solo error**) y aviso cuando una API responde lista vacía por límite de velocidad (job-radar) (C).
- [ ] **T6** Avisos rápidos a alumnas (email primero; Telegram como opción) — rama `avisos-rapidos` (C; el envío real lo activa P).
- [ ] **T7** Extensión de Chrome para guardar ofertas y tablero Kanban de la alumna (JobForge/OpenPostings). El envío automático de candidaturas **no** (ADR-012) (P decide).
- [ ] **T8** Pandapé/Get on Board/EURES: leer su contrato real antes de decidir (C).
- [ ] **T9** Reevaluar ScrapeGraphAI solo para páginas sin API y sin datos de alumnas (P decide, con coste en tokens).

## 4. Descartes con motivo

| Herramienta | Motivo |
|---|---|
| scrapfly-scrapers | Licencia NPOSL-3.0 (no comercial) y clave de pago |
| jobseek (datos), job-board-aggregator (listas), InfojobsScraper | CC BY-NC / CC BY-NC-SA: uso no comercial |
| OpenPostings | Sin licencia declarada |
| linkedin-mcp-server | Usa una cuenta real de LinkedIn: riesgo de bloqueo y de términos |
| JobFunnel | Archivado |
| JobMiner, jobsparser, ts-jobspy, Levergreen | No aportan nada que no cubran el motor, Apify o JobSpy (solo patrones) |

## 5. Preguntas abiertas para el propietario

1. **JobForge:** ¿es [KunalScriptz/jobforgex](https://github.com/KunalScriptz/jobforgex)? Es la única coincidencia que encontré (MIT, 8★) y hay que confirmarla.
2. **Jobscout-AI:** hay tres repos con ese nombre; ¿cuál es el tuyo?
3. **job-radar** y **career-site-jobs-scraper:** he leído `maccydee/job-radar` y `unbrowse-ai/career-site-jobs-scraper` por coincidir con la descripción; confirma que son los tuyos.
4. **Scraper-InfoJobs-Python:** su README no se pudo bajar; si es importante, pásame el enlace o el contenido.
5. **Dataset de ats-scrapers:** ¿te parece bien que lo consultemos desde Actions? El código es MIT, pero el README no declara licencia para el dato.
