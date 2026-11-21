# ADR-021 · Cascada de rutas por fuente y Bright Data como vía de Google Jobs

- **Estado:** aceptado e implementado (2026-11-21). Sin despliegue y sin migración aplicada.
- **Sustituye en parte:** ADR-009 (coste) y ADR-011 (fuentes externas y condiciones de uso), sin revocarlos.
- **Ámbito:** panel de Fuentes, proveedores de búsqueda, JobSpy y páginas de empresa.

## Contexto

El catálogo tiene 69 fuentes. 39 necesitan configuración y 30 no se recogen hoy (28 reales y 2 feeds
caídos). El panel decía «Requiere configurar» sin decir qué faltaba, y cada fuente se asociaba a un solo
proveedor: si ese fallaba, la fuente desaparecía de la pasada. Además, Google Jobs se pedía siempre a
SerpApi a 0,025 USD/búsqueda, aunque Bright Data ofrece la misma búsqueda a 0,0015 USD.

La regla del propietario es explícita: cada fuente debe tener varias formas de conectarse y, si una falla,
la app debe probar la siguiente sola; JobSpy va al final y solo con proxies.

## Decisión

### 1. Modelo de rutas, no de «proveedor único»

`apps/web/lib/sourceRoutes.ts` genera, para cada fuente del catálogo, todas sus vías posibles con coste,
requisito y evidencia. El orden es por coste real, no por marca:

| # | Vía | Coste | Cuándo |
|---|---|---|---|
| 1 | API/feed oficial gratis (motor, backend, ATS) | 0 | Siempre primero |
| 2 | API oficial con clave (InfoJobs, Adzuna, Jooble) | 0 con cuota | Si hay clave |
| 3 | Google Jobs vía Bright Data SERP | 0,0015 USD/búsqueda | Si hay clave; antes que SerpApi |
| 4 | Google Jobs vía SerpApi | 0,025 USD/búsqueda | Respaldo |
| 5 | Apify | pago por resultado | Portales sin API ni extractor |
| 6 | JobSpy | 0, con proxies | **Última**; sin proxies sanos no se lanza |
| 7 | Web Unlocker / ZenRows / ScrapingBee | ~0,0015–0,002 USD/página | Solo con extractor JSON-LD/RSS |
| 8 | Hermes/Manus | — | No disponibles (ADR-009); insignia, sin estado fingido |

Una fuente sin clave no está «conectada»: `routeReadiness` devuelve el motivo («Sin clave de brightdata»,
«Tope mensual agotado», «Sin proxies sanos») y el panel lo pinta. Agrupar por «Directo gratis · Tus APIs ·
Google Jobs · Apify · Otros · Multi-vía · Sin proveedor verificado» es solo presentación; las rutas son las
mismas para todas.

### 2. Bright Data: contrato construido, no supuesto

`apps/web/lib/providers/brightdata.ts` implementa:

- `POST https://api.brightdata.com/request` con `Authorization: Bearer`, cuerpo `{zone, url, format}`.
- Google Jobs con `ibp=htl%3Bjobs`; parsea `jobs.items[]` (`title`, `company`, `location`, `source`,
  `description`, `link`, `tags`) y descarta lo que no tenga título o enlace verificable.
- Reintento **una** vez en 429/5xx; 401/403 se declaran sin reintentar. Error tipado con estado.
- `unlockHtml` para la zona Web Unlocker; devuelve HTML y el coste de la petición.

La clave se guarda como `API key:zona SERP[:zona Unlocker]`, cifrada como las demás. «Guardar» no gasta;
«Probar» hace una petición real, comprueba el tope, anota `proveedor=brightdata · coste_usd=…` y falla
cerrada si no puede anotarlo. Esa prueba también es solo del propietario. Una clave con solo zona SERP no
marca lista la vía Unlocker: hace falta la segunda zona o una clave de ZenRows/ScrapingBee. La prueba del
Unlocker pide la URL pública con JSON-LD/RSS; no usa la web genérica del catálogo.

**Precio y tope:** 1,50 USD por 1.000 peticiones correctas y 5.000 créditos gratis al mes compartidos entre
sus APIs. Mientras no exista tabla, el tope es `BRIGHTDATA_MONTHLY_USD` (5 USD por defecto). Cada gasto se
anota en `external_ingest_runs` con `proveedor=brightdata · coste_usd=…` y el panel suma **todas** las
ejecuciones desde el día 1 del mes paginando hasta el final (sin tope artificial de 10.000); si una página
falla, no autoriza gasto. La
migración [`20261121_provider_budget.sql`](../../supabase/migrations/20261121_provider_budget.sql) queda
**escrita y sin aplicar**: el DDL requiere orden explícita.

### 3. Cascada

`planCascade` ordena y separa lo listo de lo omitido con su motivo. `runCascade` ejecuta en orden y **para
en la primera ruta con ofertas** (o en la primera asíncrona lanzada, porque su resultado aún no se puede
contar). Los pasos posteriores se registran como «omitida: ya trajo ofertas». Un error en una ruta no
oculta lo que trajo otra. La ingesta es idempotente por huella y la atribución (`brightdata-google`,
`brightdata-<portal>`, p. ej. `brightdata-infojobs`) permite anotar «también en» contra SerpApi.

### 4. JobSpy al final y con proxies

`scripts/jobspy_collect.py` valida `JOBSPY_PROXIES` antes de importar JobSpy: una petición por proxy, HTTP
200 y menos de 8 s, con latencia y motivo del fallo en el resumen. Solo los sanos se usan, rotados por
sitio. Sin ninguno sano **no se lanza** y se declara «no se intentó»; el modo directo exige
`JOBSPY_ALLOW_DIRECT=1` y lleva su aviso de bloqueo. El workflow publica qué proxy falló y por qué en el
resumen del job (acciones fijadas por SHA, como el resto del repo).

### 5. Orden por fuente, con el coste como defecto

`orderRoutes` aplica un override de ids de ruta (`fuente:proveedor`) y deja el orden por `stage` cuando no
hay ninguno. JobSpy y el hueco agéntico quedan **siempre al final**, aunque el override intente adelantarlos.
El override se guarda en `source_settings.route_order` mediante `GET/PATCH /api/admin/source-routes`
(solo propietario); la migración [`20261121_source_route_order.sql`](../../supabase/migrations/20261121_source_route_order.sql)
está escrita y **sin aplicar**. Sin la columna, la lectura devuelve `null`, el panel declara que usa el orden
por coste y el guardado responde 503 en vez de fingir que se guardó.

### 6. Panel y Empresas

- KPIs: gratis operativas · con clave · de pago activas · con fallo · gasto del mes vs tope · aprobadas por
  dólar (esta última se calcula en «Resultados por fuente»; aquí se declara con «—»).
- Tarjeta por fuente: rutas en orden, coste, estado de cada paso, ruta activa «N de M», **Probar ruta**,
  **Cómo conectarla**, **Ver portal**. La tabla completa sigue debajo, por tandas de 25, para no perder el
  «¿esta fuente entra o no?».
- Guía: qué falta · tiempo/cuenta/tarjeta · pasos · otras vías · cómo saber que funciona · tres fallos
  típicos · documentación oficial · última comprobación. Sin vídeo: no hay ninguno verificado y no se
  inventa un enlace.
- **Empresas:** feed ATS (automático, solo lectura del motor) · página propia (extractor JSON-LD/RSS y
  diff por huella) · solo LinkedIn (enlace a Google Jobs, sin rastrear la red). Hermes/Manus quedan como
  hueco declarado.

## Consecuencias

- Añadir una vía no obliga a tocar el panel: el catálogo y `sourceRoutes.ts` la propagan.
- Sin clave o sin tope no hay llamada de pago; el panel no puede decir «conectada» por tener una clave
  guardada sin probar.
- El coste se puede auditar nota a nota y el tope se puede bajar por entorno sin desplegar código.
- La migración no aplicada no bloquea nada: el entorno es el tope efectivo hasta que se apruebe.

## Límites y verificación

- **No hay claves reales de Bright Data, ZenRows ni ScrapingBee en este entorno.** El cliente se prueba con
  `fetch` simulado y un fixture con la forma documentada: contrato, mapeo, 401 sin reintento, 429 con un
  reintento, 0 resultados y tope. El panel lo marca «documentada · sin probar» hasta la primera ejecución
  real con clave.
- No se ha desplegado, no se han aplicado las migraciones y no se ha lanzado ninguna ejecución de pago.
- El Unlocker se prueba con un HTML simulado que pasa por `extractJobPostings`; se atribuye a
  `brightdata-<portal>` y su nota de gasto se suma al mismo tope que SERP.
- Comprobado: `tests/admin-auth/source-routes.mjs` (rutas, dos fuentes con y sin Bright Data, caída a
  SerpApi, JobSpy sin proxies, Unlocker, override de orden, contrato, cascada, guías y empresas),
  `npm run typecheck`, `npx next build apps/web --webpack`, `npm run design`, `pytest
  tests/test_source_catalog_export.py` y `bash tests/admin-auth/run.sh`. Ver STATUS para el resultado de
  cada uno.

## Referencias

- Bright Data · SERP API: <https://docs.brightdata.com/scraping-automation/serp-api/introduction>
- Bright Data · Web Unlocker: <https://docs.brightdata.com/products/web-unlocker/quickstart>
- JobSpy (MIT): <https://github.com/speedyapply/JobSpy>
- ADR-009 (coste), ADR-011 (condiciones de uso), ADR-017 (forma de escritura del catálogo).
