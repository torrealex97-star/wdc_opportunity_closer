# Aprendizajes de Growth Ops aplicables a Career Platform

Fecha: 2026-10-17 (añadidos propios de este repo en §7, 2026-11-20) · Origen: repositorio `growth-ops-app` del mismo propietario, **leído en solo lectura** (clon superficial; nada se ha escrito allí).
Este documento NO copia datos, tenants, personas ni credenciales de Growth Ops: solo reglas y procedimientos generales. `AGENTS.md` de este repo sigue mandando (independencia de otros proyectos: ni secretos, ni BD, ni despliegues).

## 1. Qué se leyó (y qué no)

**Leído entero o casi:** `CLAUDE.md`, `AGENTS.md`, `docs/plan/00-constitucion.md`, `02-seguridad-privacidad.md`, `03-operacion-fiabilidad.md`, `04-ia-agente.md`, `06-calidad-gobierno.md`, `docs/TENANT_ISOLATION_BATTERY.md`, `docs/SECURITY_PRIVACY.md`, la parte de cabecera de `docs/FREE_TIER_OPERATIONS.md`, `PROJECT_CONTEXT.md` §2 y §12-13, y las skills `supabase`, `supabase-postgres-best-practices` (seguridad/RLS), `apify-ultimate-scraper` (gotchas y flujo de empleo) y la estructura de `sales-engineering`.
**No leído (límite honesto):** el resto de `PROJECT_CONTEXT.md` (160 KB), `PENDIENTES.md`, `MEJORAS-DESDE-HOY.md`, `docs/plan/01`, `05`, `07`, `08`, `09`, `DEVELOPMENT_RULES_FULL.md`, los runbooks, y las skills de marketing, datos/gráficas y OAuth (no aplican hoy). Lo que no se leyó no se resume aquí.

## 2. Lo que Career Platform ya cumple (validado contra sus reglas)

| Regla de Growth Ops | Estado aquí |
| --- | --- |
| Código calcula, la IA explica / contenido externo = dato no confiable | Revisor IA: la puerta determinista decide; el texto de la oferta va delimitado y se sanea (`aiReview.ts`) |
| Ante la duda, encola a una persona | Puerta del revisor: todo lo dudoso → cola humana + 10 % de auditoría |
| Un hueco no es un cero | Métricas: sin ofertas buenas el coste es «—», no 0; minutos de revisión = «no se miden» |
| Efectos acotados y reversibles | Revisor en shadow por defecto, tope por ejecución, `ai_undo` |
| RLS con `(select auth.uid())`, `USING` + `WITH CHECK`, grants mínimos | `student_profiles`; grants públicos de `b2b_leads`/`weekly_reports` revocados |
| Migración probada con `BEGIN…ROLLBACK` y comportamiento, no solo DDL | `tests/db/student_rls.sql` (12 comprobaciones reales, con rollback) |
| `user_metadata` nunca en autorización | Autorización por tablas (`admin_users`, `students`), no por claims |
| Borrar un usuario no invalida su token | Cada petición comprueba la fila `students`/`admin_users` (caché ≤ 30 s) |
| Distinguir inspeccionado / probado / verificado | Ya se declara en STATUS; ver §4 para hacerlo sistemático |
| Una fase = una rama = un PR | Rama + PR por incremento desde la sesión 41 |

## 3. Reglas nuevas que conviene adoptar (con su acción aquí)

Ordenadas por riesgo real para este proyecto.

1. **El presupuesto interno de un cron debe sumar MUY por debajo de `maxDuration`** (Growth Ops: 35+25 = 60 s murió con 504). **Riesgo detectado en este repo:** `/api/cron/collect` encadena `collectAll` (3 proveedores × 7 consultas, hasta 20 s cada una) + `refreshVigencia` (hasta 20 ofertas × 10 s) + `dailyApify` (25 s) + revisor IA (30 s) con `maxDuration = 60`. Con claves reales puede cortarse a mitad. *Acción propuesta (incremento 1.4):* presupuesto global con reloj compartido (p. ej. 40 s), orden por prioridad, cada llamada externa comprueba el reloj, y el corte se declara en la respuesta (`truncated`). Todo es idempotente, así que el siguiente día continúa.
2. **Efecto externo irreversible ⇒ «claim» atómico antes de ejecutarlo** (`UPDATE … SET status='sending' WHERE id=… AND status='draft'` y seguir solo si la fila es tuya). *Aplica al incremento 3.2 (candidatura asistida) y a la Fase 4*: dos pestañas o dos ejecuciones nunca deben enviar dos veces.
3. **`supabase-js`/REST no lanza: consume siempre `ok`/`error`.** Revisar escrituras que hoy se ignoran (`PATCH` de `ai_review`, `markApplied`, `verified_at`): una escritura fallida no debe contarse como hecha. *Acción:* auditoría corta de `lib/*.ts` con test de fallo de escritura.
4. **Lanzar Apify con estimación de coste:** modelo de precios (FREE / pago por evento / suscripción), estimar `precio × nº`, avisar > 5 USD y exigir confirmación > 20 USD; comprobar `isDeprecated`; leer el esquema de entrada en vez de adivinarlo; LinkedIn: lotes < 100 y separados ≥ 5 min. *Hallazgo útil para el 0.1:* sus notas citan `harvestapi/linkedin-job-search` (~0,001 USD/oferta, comunidad) como alternativa barata para LinkedIn; **precio y calidad sin verificar aquí** — compararlo con `aakash19/jobspy` en la prueba de 10 elementos.
5. **Redeploy tras tocar variables de entorno** (Vercel conserva el runtime antiguo y responde 401). *Aplica a `INGEST_TOKEN`, `CRON_SECRET`, `AI_REVIEW_*`.* Añadir al checklist de puesta en marcha.
6. **Un run «cancelled» no es un fallo** (CI con `cancel-in-progress`; Vercel salta builds intermedios): diagnosticar siempre por el último SHA.
7. **Advisors tras cada DDL.** Ejecutados hoy: 0 avisos críticos; 1 aviso real y 1 menor: *Leaked password protection desactivada* (acción tuya en Supabase → Authentication) y FK sin índice `apify_runs.actor_id` (volumen despreciable, se deja hasta medir). Las 10 tablas «RLS sin políticas» son intencionadas (solo service role).
8. **Datos y privacidad de alumnas:** la PII de la alumna vive en un único sitio (`student_profiles`); borrarla es un procedimiento (hoy: «borrar mi perfil» + baja que cascadea); **nunca se envían datos de alumnas a un LLM** sin acuerdo de tratamiento y retención cero (el matching actual es determinista, sin LLM). Pendiente: exportación de datos y plazos de retención.
9. **Integraciones con ciclo de vida explícito** (`not_configured → connected → degraded → error → disabled`) y un panel de **Data Health** que diga «fuente caída» distinto de «0 ofertas». Hoy el panel de fuentes mezcla parte de ello.
10. **Evals antes de pasar a `live`:** un conjunto dorado (~30 ofertas reales etiquetadas por una persona) con umbral de bloqueo, no «parece mejor». Es la puerta de salida real del shadow.
11. **Fechas «solo día» con helpers UTC**, nunca `new Date()` local + `toISOString()`; relevante para métricas por día (`metrics.ts` ya trabaja en UTC por ISO).
12. **Gobierno de agentes:** *mapa primero → buscar antes de leer → reutilizar antes de crear → cambio mínimo → verificar*; orden REUSE → EXTEND → EXTRACT → CREATE; sin sufijos `V2`/`final`; una rama viva; `git add` con rutas acotadas; ADRs ligeros en `docs/decisions/`.
13. **Repo con secretos:** su incidente (credenciales en historial) deja la regla «nada que identifique personas/tenants/credenciales en commits». Este repo es **privado**, pero ya contiene dominios de producción en docs; si algún día se hace público, pasar `gitleaks` y limpiar. *Acción propuesta:* añadir `gitleaks` al workflow `Quality`.

## 4. Vocabulario de evidencia (adoptado desde ya en STATUS)

- **Inspeccionado:** lo leí en el código.
- **Probado:** lo ejecuté (tests, navegador, SQL con rollback) en un entorno controlado/simulado.
- **Verificado:** lo confirmé en el entorno real (producción/staging con servicios reales).
Hasta hoy casi todo es *probado*; *verificado* solo existe para la BD (RLS y grants). Se irá marcando así.

## 5. Skills importadas a este repo

Copiadas a `.agents/skills/` con enlaces simbólicos en `.claude/skills/` (patrón de Growth Ops). Origen: skills del propio proyecto del propietario; `supabase` y las de Apify proceden de sus publicadores (conservan su cabecera/versión).

| Skill | Para qué sirve aquí |
| --- | --- |
| `supabase` | Lista de comprobación de seguridad (RLS, `SECURITY DEFINER`, vistas, tokens, almacenamiento) y flujo de migraciones |
| `supabase-postgres-best-practices` | Índices, RLS, bloqueos, paginación, upserts por lotes |
| `apify-ultimate-scraper` | Elección de actores, protocolo de coste, errores y flujos de empleo/leads |
| `integration-testing` | Pruebas de integración de APIs externas y BD |
| `nextjs-app-router-patterns` | Patrones del App Router (Next 16) |
| `browser-testing-with-devtools` | Verificación real en navegador |
| `sales-engineering` | Método comercial high-ticket (llamada, objeciones, KPIs): **material de formación para las alumnas closers**, no para el código |
| `find-skills` | Descubrir skills nuevas |
| `data-visualization-pro` | Teoría de gráficas: qué gráfico elegir, percepción, color, rendimiento (agnóstica de librería) |
| `design-taste-frontend` | Diseño anti-genérico para landings y superficie de alumna; **adaptada** (sección 12 reescrita para esta marca) |
| `dashboard-design` | **Propia de este repo:** reglas de dashboards/gráficas con los tokens reales, contrastes calculados y verificación (`npm run design`) |

**No importadas (a propósito):** `marketing-and-copywriting` (decisión del dueño), `data-visualization` (versión Python/matplotlib; aquí no aplica), `oauth-implementation`, `apify-actor-development/actorization/generate-output-schema/integration-development` (construir actores propios; hoy no se hace). Se pueden traer cuando haya necesidad.

## 6. Cambios propuestos a `AGENTS.md` (esperan tu OK; no se han tocado)

1. Cron: presupuesto interno ≪ `maxDuration`, reloj compartido, corte declarado y reanudable.
2. Efecto externo irreversible: claim atómico previo y consumo del resultado de cada escritura.
3. Apify: estimar coste antes de lanzar (aviso > 5 USD, confirmación > 20 USD).
4. Toda migración: prueba de comportamiento con `BEGIN … ROLLBACK` + advisors, guardada en `tests/db/`.
5. Datos de alumnas: nunca a un LLM sin acuerdo de tratamiento; el matching sigue siendo determinista.
6. Vocabulario inspeccionado / probado / verificado en STATUS.

## 7. Aprendizajes propios (sesiones 249-261, 2026-11-20)

Reglas que salieron de **medir en este repo**, no de Growth Ops. Las que ya están en el código y en `AGENTS.md` se anuncian allí; aquí queda el porqué.

1. **Cobertura de pago sin gastar crédito.** La tienda pública de Apify (`GET /v2/store?search=…`) y los metadatos de cada actor (`/v2/acts/<actor>` y `/builds/default`) son gratuitos y no piden token. Un barrido con **varias consultas por fuente** y metadatos validados (`isDeprecated`, build `SUCCEEDED`, esquema de entrada leído) es la forma honesta de subir cobertura sin ejecutar nada. Lo que no se pudo conectar se queda con su bloqueo **medido** —consultas, totales declarados y actores descartados— dentro de `source_audit.json`.
2. **Un actor con el nombre correcto puede ser de otro sitio.** `yogen48-owner/malta-jobs` (Malta, el país) pasaba el filtro de `malt` porque «malt» es subcadena de «malta»; los actores de **Remote.co** (EE. UU.) ganaban a **Remoto.co** (LATAM) por lo mismo. La marca se compara con el portal real y, cuando el contrato no encaja, se **excluye con motivo escrito** (lista `EXCLUDED` del exportador) en vez de rellenar el panel.
3. **Los actores traen valores por defecto que no son los tuyos.** El de Milanuncios descarga **coches** si no le dices categoría: sin plantilla «funciona» y devuelve lo que nadie pidió. Cuando el actor declara la categoría en su propia ficha, se fija con `inputTemplate` y el portal se limita a ese actor.
4. **Repartir dinero por lo recogido premia al ruidoso.** El plan mensual ordena por **ofertas aprobadas por dólar** (`approvedPerUsd`), no por recogidas, y numerador y coste salen de la **misma ventana** (`first_seen_at` desde la ejecución más antigua del historial). Sin recuento fiable no hay rendimiento: la ruta va al final **declarada**, nunca se le supone cero.
5. **Generar en la forma que se consume.** Un JSON generado obliga a un import con atributo (solo para el arnés de Node) y a traducirlo en tiempo de ejecución. Generar el módulo TypeScript con la forma del panel eliminó la traducción, el atributo y los campos que nadie leía.
6. **Dos procesos de Next sobre `.next` corrompen la caché** (`Failed to open database … invalid digit found in string`). No se compila mientras otra sesión tenga `next dev` vivo: `next build --webpack` usa otra caché y lo evita; borrar `.next` bajo sus pies sí rompe su sesión.
7. **Una prueba que fija una lista cerrada caduca a la primera ampliación.** La del panel exigía los cinco portales curados exactos y se puso roja al pasar a veinte; ahora fija el prefijo curado, la unicidad y que todo portal tenga buscador. Al ampliar un catálogo, la prueba protege el **invariante**, no el recuento de ayer.
8. **Con otra sesión en el mismo árbol**, `git add` de un documento compartido arrastra su trabajo sin commitear: se compone el commit desde `HEAD` + lo propio y su bloque se devuelve al árbol después (regla en `docs/handoff/README.md`).
9. **Un efecto lateral al importar un módulo puede enrojecer la suite según el orden** (`scripts/audit_sources.py` lanzaba el audit real por red al importarse y reescribía la evidencia a mitad de las pruebas). El trabajo pesado va bajo `if __name__ == '__main__'`, y las pruebas importan funciones, no el efecto.

## 8. Siguiente paso sugerido

Incremento **1.4: presupuesto de tiempo del cron y escrituras que no se ignoran** (puntos 1 y 3), antes de añadir más fuentes o activar el revisor en `live`.
