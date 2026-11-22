# Plan: ser la academia que más y mejores ofertas de closer da a sus alumnas

> Redactado el 2026-11-22 (sesión de Claude con el dueño) para repartir el trabajo entre **Claude** y **Codebuff** (`buffy-*` en las fichas). Es un plan, **no un hecho**: cada paquete está sin empezar salvo donde se dice. Reglas de relevo: [docs/handoff/README.md](../handoff/README.md). Reglas del producto: `AGENTS.md` y `docs/spec/15_PRODUCT_VISION_AND_BOUNDARIES.md`.

## Decisión del dueño que condiciona todo (2026-11-22)

**No se pausa ni se deja de pagar ninguna fuente** (en concreto LinkedIn y Workana vía Apify) **hasta haber recogido al menos 1.000 ofertas de cada una con las búsquedas bien hechas** (palabras clave y semántica de «closer»). Hoy la muestra es de **104 ofertas de LinkedIn (1 aprobada)** y **35 de Workana (0 aprobadas)** en 30 días: *no es muestra suficiente* y puede que la búsqueda fuera la equivocada. Hasta llegar a 1.000 cada una, el dato correcto es «**sin conclusión**», no «rinde mal». Ningún agente recorta, pausa ni baja el tope de esas dos fuentes por su cuenta.

## Dónde estamos (leído de la base real el 2026-11-22; *inspected*)

| Dato | Valor |
| --- | --- |
| Ofertas aprobadas y vigentes | **301** (274 en España, 26 en LatAm o EE. UU. hispano) |
| Aprobadas al día, últimos 10 días | ~32 de media (días de 4 a 100) frente al objetivo de 60 |
| Por puesto | account executive 117 · closer 114 · setter 24 · cold caller 16 |
| Con sueldo visible | 95 de 301 (32 %) |
| Fuentes (30 días, vistas → aprobadas) | google-jobs 400 → 298 · jooble 300 → 102 · apify-infojobs 200 → 70 · apify-linkedin 104 → 1 · apify-workana 35 → 0 |
| Cifras redondas (400, 300, 200) | Sospecha, **sin verificar**: `MAX_CANDIDATES = 300` en `apps/web/lib/external.ts` corta cada ingesta a 300 candidatos |

## Reglas para todos los paquetes

- Una ficha por trabajo en `docs/handoff/claims/` (`claude-<tema>.md` o `buffy-<tema>.md`), un `in_progress` por agente, `touches` sin solapes, `npm run handoff` en verde.
- No inventar ofertas, sueldos, fechas ni conectores: contrato leído en la documentación pública o en la respuesta real. Un hueco no es un cero («—» y la causa).
- **Gasto de pago** (Apify, Bright Data, etc.): estimar el coste antes de lanzar (precio por resultado × cantidad); avisar por encima de 5 USD y pedir confirmación expresa por encima de 20 USD; leer el esquema de entrada del actor en vez de adivinarlo. Gasto nuevo = orden del dueño.
- **Datos de alumnas: nunca a un LLM**; el emparejamiento sigue siendo determinista.
- **Migraciones/DDL en la base real y secretos: solo con orden expresa del dueño**; cada migración con su prueba `BEGIN … ROLLBACK` en `tests/db/` y asesores de Supabase después.
- Nada de envío automático de mensajes ni candidaturas.
- Evidencia en `docs/STATUS.md` con las palabras *inspected* / *tested* / *verified*; nunca más alto de lo alcanzado. Tests, STATUS y código viajan en la misma rama.
- Panel y vistas de alumna: leer `.agents/skills/dashboard-design/SKILL.md` y `docs/DESIGN.md` antes; colores solo de los tokens (`npm run design`).

## Paquetes

Cada paquete: **qué**, **hecho cuando**, **toca**, **depende de**. `🔒` = parte que solo puede hacer el dueño.

### A. Medir bien antes de recortar (condición del dueño)

- **A1 · Búsquedas de closer correctas en LinkedIn y Workana.** Revisar los *inputs* de Apify de esas dos fuentes: palabras clave exactas y sinónimos (closer, high ticket closer, sales closer, setter, appointment setter, SDR, cold caller, closer remoto, closer de ventas, closer comisiones, infoproductos), con el vocabulario canónico del motor (`GET /v1/profile-terms`), países y variantes en español e inglés, y exclusiones (p. ej. «cerrajero»). Leer el esquema de entrada de cada actor en la tienda de Apify. *Hecho cuando:* inputs corregidos y probados con `max_items=10` (coste declarado y por debajo de 5 USD) y la muestra de prueba revisada a mano. **Toca:** `apps/web/lib/apifyPortals.ts`, `apps/web/lib/apifyCatalog.ts`, `scripts/export_apify_portals.py`. **Depende de:** nada. 🔒 gasto de las pruebas reales.
- **A2 · Contador de muestra por fuente.** En el panel, por fuente: ofertas recogidas **desde la fecha de la búsqueda corregida**, aprobadas, coste y aprobadas por dólar; con la etiqueta «muestra insuficiente (x de 1.000)» mientras no llegue a 1.000, y sin recomendar recortar nada hasta entonces. Sin conteo posible = «—» y la causa. *Hecho cuando:* test de interfaz y de lógica con una fuente a 999 y otra a 1.000. **Toca:** `apps/web/lib/spendPlan.ts`, `apps/web/lib/sourceScorecard.ts`, su componente del panel. **Depende de:** A1 (la fecha de corte).
- **A3 · ¿El tope de 300 por ingesta recorta el volumen?** Comprobar si `MAX_CANDIDATES` (300) o los límites por pasada explican las cifras redondas; si es así, proponer el nuevo valor con su efecto en coste y en tiempo del cron (el reloj compartido manda). *Hecho cuando:* medido y documentado (*tested*); cambio solo si lo justifican los datos. **Toca:** `apps/web/lib/external.ts`, `apps/web/lib/collectors.ts`. **Depende de:** nada.

### B. Más mercado: LatAm y EE. UU. hispano

- **B1 · Google Jobs por país.** Dorks de closer/setter por país (México, Colombia, Argentina, Chile, Perú, EE. UU. en español) con su `gl`/`hl`, dentro del tope diario de Google Jobs. *Hecho cuando:* tests de la lista de dorks y del reparto por país; mercado etiquetado en cada oferta. **Toca:** `apps/web/lib/googleJobs.ts`, `tests/admin-auth/googlejobs.mjs`. **Depende de:** nada.
- **B2 · Portales LatAm (Computrabajo, OCC, Bumerán).** Verificar el patrón de URL de oferta concreta de cada uno contra una respuesta real y medir cuántas ofertas dan por Bright Data y por SerpApi. Sin patrón comprobado, la fuente queda «sin proveedor verificado». **Toca:** `apps/web/lib/jobPortals.ts`, `tests/admin-auth/fallback.mjs`. **Depende de:** nada.

### C. El mercado que no está en los portales

- **C1 · Probar las páginas de empleo que ya vigila el motor.** Script que lee `GET /v1/company-targets` (monitoring `careers_page`, `ats_page`, `teamtailor_feed`) y, para cada URL, informa: estado HTTP, si trae JSON-LD/RSS, cuántos enlaces de oferta saca el extractor y si es una página vacía por JavaScript. **Hay que ejecutarlo con salida a internet** (un GitHub Action manual, o el ordenador del dueño): el entorno de la sesión de Claude no alcanza esos dominios. Resultado en `docs/evidence/company-pages-AAAA-MM-DD.md`. *Hecho cuando:* informe real (*verified*) y la lista de las que dan ofertas. **Toca:** `scripts/probe_company_pages.mjs`, `.github/workflows/` (workflow manual), `docs/evidence/`. **Depende de:** nada (el extractor que prueba ya está en `main`, #132).
- **C2 · Ampliar la lista de empresas objetivo.** Infoproductores, agencias, coaches y SaaS que contratan closers. Fuentes de descubrimiento: anunciantes del nicho en la Biblioteca de anuncios de Meta, perfiles de LinkedIn de la empresa y la red del dueño. **Cada alta exige una URL pública comprobada (200 + ofertas o un perfil de empleo real)**; ninguna se añade de memoria. *Hecho cuando:* N empresas nuevas con su evidencia y tests del motor en verde. **Toca:** `apps/api/career/data/company_targets.json`, `apps/api/career/migrations.py`, `tests/test_engine.py`. **Depende de:** C1 (para saber cómo se leen las ya dadas de alta). 🔒 lista de empresas conocidas por el dueño.
- **C3 · Portal para empresas (publicar gratis ofertas exclusivas).** Primero **solo documentos**: ADR y especificación (qué datos pide, moderación, caducidad, consentimiento, privacidad, qué ve la alumna, cómo se evita el spam y la estafa). *Hecho cuando:* ADR y spec revisados por el dueño. **Toca:** `docs/decisions/`, `docs/spec/`. **Depende de:** nada. 🔒 aprobar el diseño; cualquier tabla nueva = migración con su orden.
- **C4 · «Avisa de una vacante» (alumnas colocadas).** Igual que C3: especificación primero. Requiere login de alumnas y consentimiento. **Toca:** `docs/spec/`. 🔒 activar el login (`STUDENT_LOGIN_REQUIRED`).

### D. Mejores ofertas, no solo más

Se hacen **en este orden y por un solo agente a la vez** (tocan los mismos ficheros).

- **D1 · Sueldo, comisión, OTE y ticket por reglas.** Extraer de la descripción con reglas deterministas (no IA), con ejemplos reales en `tests/fixtures/`; lo que no aparezca queda vacío. *Hecho cuando:* tests con casos buenos, ambiguos y falsos positivos. **Toca:** `apps/web/lib/salary.ts`, `apps/web/lib/offerTags.ts`. **Depende de:** nada.
- **D2 · Separar «closer high ticket» de «ventas SaaS / account executive».** Mejor clasificación de rol y un filtro visible para la alumna. **Toca:** `apps/web/lib/offerTags.ts`, `apps/web/lib/offerScore.ts`. **Depende de:** D1.
- **D3 · Puntuación de «oferta top» visible.** Componente explicable (sueldo declarado, ticket alto, remoto, reciente, empresa conocida) con la razón en texto; sin color como único canal. **Toca:** `apps/web/lib/offerScore.ts`, los componentes de oportunidades de alumna. **Depende de:** D1, D2. Leer `design-taste-frontend` y `docs/DESIGN.md`.

### E. Medir lo que demuestra que somos la mejor academia

- **E1 · Contrataciones por fuente.** Auditar lo que ya existe (`applicationStages.ts`, `funnel.ts`, atribución por cohorte) y conectar «aplicada → entrevista → contratada» con la fuente de la oferta. KPI principal: **alumnas contratadas por fuente y ofertas vigentes por alumna activa**. **Toca:** `apps/web/lib/applicationStages.ts`, `apps/web/lib/funnel.ts`. **Depende de:** nada. 🔒 si hace falta una tabla (migración).
- **E2 · Repartir el presupuesto por contrataciones.** Cuando haya muestra suficiente de contrataciones por fuente (umbral que fija el dueño), sustituye a «aprobadas por dólar». Hasta entonces manda la regla actual. **Toca:** `apps/web/lib/spendPlan.ts`. **Depende de:** E1, A2.

### F. Llevar la oferta a la alumna

- **F1 · Avisos por reglas fijas** (correo o WhatsApp) cuando entra una oferta que encaja con su perfil: primero solo el cálculo y la vista previa (ya existen en #39). **El envío real exige consentimiento de la alumna y orden expresa del dueño**; hoy no se envía nada solo. Enlaza con la fila 10 de `docs/ACTIVE_HANDOFF.md` §5.

### G. Infraestructura

- **G1 · 🔒 Activar el navegador en Cloudflare.** Crear un token con permiso «Browser Run - Edit» y poner `CF_BROWSER_ACCOUNT_ID` y `CF_BROWSER_TOKEN` como secretos del Worker `closer-web`. Después, tras la primera pasada del cron, leer `companyPages` en su respuesta (`by página: via, detected, error`). Hasta entonces no se declara PASS del navegador. Alternativa: Browserless alojado aparte (`BROWSERLESS_URL`; licencia SSPL-1.0).

## Reparto propuesto (confirmar con el dueño)

| Carril | Claude | Codebuff (`buffy`) |
| --- | --- | --- |
| Captación | A2, A3, B1 | A1, B2 |
| Empresas | C3, C4 (documentos) | C1, C2 |
| Calidad y medición | D1 → D2 → D3, E1 → E2 | — (revisar D1 con sus ejemplos reales) |

## Orden sugerido

1. **Ya:** G1 (dueño), A1 y A3 (arrancan solas), C1.
2. **Después:** A2, B1, B2, D1.
3. **Cuando A2 muestre 1.000 por fuente:** el dueño decide con datos si se recorta LinkedIn o Workana.
4. **Más adelante:** C2, C3, D2, D3, E1, E2, F1.

## No declarar PASS en

Navegador de Cloudflare o Browserless, Fetch API de Bright Data, lectura real de las páginas de empleo, ninguna fuente de LatAm, el rendimiento de LinkedIn y Workana (muestra insuficiente), ni avisos a alumnas.
