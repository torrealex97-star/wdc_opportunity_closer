# Lecciones y método: errores que no se pueden cometer y cómo trabajar para tener resultados

Escrito el 2026-11-24 a petición del propietario, a partir de errores reales de estas sesiones. Léelo junto con [AGENTS.md](../AGENTS.md) antes de empezar. Si cometes un error nuevo, añade una fila aquí **en la misma PR que lo arregla**.

## 0. La regla madre: lo que cuenta es el resultado medido, no el código

El objetivo del producto es que **todas las fuentes estén conectadas, recojan ofertas y den ofertas CUALIFICADAS de closer, setter o cold calling** (España, LatAm y EE. UU. en español; el freelance cuenta igual). Eso se mide en el **Resumen del admin** («Control de fuentes»).

- Una fuente solo está **hecha** si en los últimos 7 días dio al menos una oferta cualificada, **o** está bloqueada con una causa escrita y un dueño.
- Un code review, un test en verde o una PR fusionada **no** significan «hecho». Varias revisiones de código pasaron mientras 23 de 24 fuentes gratuitas aparecían en 0. Lo único que cierra un trabajo es la medida.
- No se para de ajustar (la fuente, la búsqueda, la comunicación, la extracción, el filtrado) hasta que funcione. Si no cualifica, se **busca por qué** y se corrige; si no se puede, se marca «a trabajar» con su causa y su dueño. Nunca se deja en silencio.
- Prohibido decir «ya funciona», «todo correcto» o «hecho» sin haber leído la medida real ese mismo día. Di lo que mediste y lo que no.

## 1. Errores que no se pueden cometer

| # | Error | Qué pasó (evidencia) | Regla |
|---|---|---|---|
| E1 | Dar algo por hecho porque el código y los tests pasan | La app decía «Conectada» y mostraba 0 en 23 gratuitas mientras el motor recogía cada día (24 nov 2026). Dos reviews de código no lo vieron | Antes de cerrar, mide con datos reales (consulta a la base o al informe del motor) y pega la cifra |
| E2 | Mostrar un dato falso como si fuera medido | El panel contaba `external_offers` de Supabase; las gratuitas del motor viven en otra base (D1). Salía 0 y era mentira | Un 0 se verifica contra la fuente real antes de concluir nada. Un hueco es «—» con su causa, nunca 0 |
| E3 | Estado de conexión sin resultado | «Conectada» solo decía «hay vía y clave» | Un estado debe reflejar el último resultado (fallo, 410, 429, catálogo vacío), no solo la configuración |
| E4 | Inventar contratos de APIs o actores | Plantillas de Apify con campos adivinados daban HTTP 400 o 0 (Computrabajo, Bumeran, Jooble…) | Lee el esquema público de entrada y la salida antes de escribir la plantilla. Lo que no puedas leer, márcalo «sin verificar» |
| E5 | Fusionar sin comprobar el cambio de API | La PR de Dependabot `read-excel-file` 5→9 quitaba `readSheetNames` y rompía la importación | Un salto mayor se prueba en un directorio aparte y con el test que lo usa; se adapta o se cierra con motivo |
| E6 | `git add -A && git commit` con un merge a medias | Se commiteó `docs/STATUS.md` con marcadores `<<<<<<<` (sesión del 24 nov) | Tras un merge con conflicto: resuelve, comprueba `grep -rn '^<<<<<<<\|^>>>>>>>' docs apps tests` y solo entonces commitea. Nunca encadenes `add -A` y `commit` tras un merge |
| E7 | `git add -A` dentro de un `git worktree` con `node_modules` enlazado | Se commitearon dos enlaces `node_modules` y al cambiar de rama git sustituyó los `node_modules` reales: dependencias rotas | No enlaces `node_modules` en un worktree ni uses `add -A` en él. Si necesitas otra rama, cambia de rama en el árbol principal. `.gitignore` ya cubre `node_modules` también como enlace |
| E8 | Fiarse de una suite que abortó | `run.sh` se detiene en el primer fallo: lo que va después no se ejecutó | «Verificado» exige ver la línea final `exit=0` y el recuento completo de pasos, no solo que un tramo pasó |
| E9 | Probar con un árbol o dependencias distintos del código | Rama con script antiguo y `node_modules` con la v9: fallo que no era de la rama | Tras cambiar de rama o de lock: `npm ci`. Antes de cada suite: `pkill -f next-server` y, en comandos separados, build y suite |
| E10 | Repetir hasta que pase | Un test de puertos (`gate.mjs`) falló una vez por un servidor rezagado | Un job se repite UNA vez. Si no es flaky demostrable, hay causa: encuéntrala. Nunca se salta, desactiva ni se quita un test |
| E11 | Prometer lo que el entorno no puede dar | Una tarea programada nació sin conectores de Supabase/Tavily y no podía medir | Antes de prometer una automatización, comprueba qué herramientas tendrá y dilo. Escribe en la propia tarea qué hacer si faltan |
| E12 | Proponer construir lo que ya existe | CSV de ofertas y salas de voz con dictado ya estaban hechos | Antes de responder «lo construyo», lee `docs/STATUS.md`, `docs/PLAN.md` y el código: di qué existe y qué falta de verdad |
| E13 | Aplicar DDL o cambiar secretos sin orden | Regla de AGENTS.md | Migración: prueba con `BEGIN … ROLLBACK`, avisos de seguridad después y **orden expresa del propietario** |
| E14 | Afirmar un nivel de evidencia que no se alcanzó | Todo con servidores simulados | *inspected* = leído; *tested* = ejecutado en entorno controlado o simulado; *verified* = confirmado contra el servicio real. Nunca más alto del alcanzado |
| E15 | Trabajar en un archivo compartido sin cuidado | `docs/STATUS.md` lo tocan varios | Antes de editarlo, parte del estado actual de `origin/main`; si hay trabajo de otro sin commitear, commitea solo tus bloques |
| E16 | Mezclar variables entre pruebas | Un 0 «real» frente a un hueco | En tests, cubre siempre el caso «no se pudo leer» además del feliz |
| E17 | Dejar trabajo suelto | Reglas de relevo | Nada de tests, mocks, STATUS o docs de código que no esté en la misma rama; al cerrar la sesión: `git status` limpio y rama subida; un claim por trabajo vivo y retirado al fusionar |

## 2. Cómo se trabaja para tener resultados (el bucle)

1. **Medir.** Empieza por la realidad, no por el código.
   - Motor gratuito: `GET https://closer-engine.women-digital-closers.workers.dev/api/funnel` (por fuente: `catalogo`, `revisadas`, `elegible`, `seleccionada`, `run_status`, causa).
   - Resto de fuentes (solo lectura, base `jzchuizybyubtkownhlw`): por fuente y últimos 7 días, `count(*)`, las aprobadas o publicadas, las retiradas o en excepción con su motivo (`auto_review->>'why'`) y los borradores. Consulta de partida:
     ```sql
     select source, count(*) as vistas,
       count(*) filter (where editorial_status in ('approved','published')) as aprobadas,
       count(*) filter (where editorial_status = 'draft') as borradores
     from external_offers where first_seen_at >= now() - interval '7 days'
     group by source order by vistas desc;
     ```
2. **Clasificar** cada fuente: da cualificadas · recoge sin cualificar · conectada sin recoger · rota · necesita un dato del propietario · sin vía. El Resumen ya lo hace; si discrepa de la realidad, **primero se arregla la medida**.
3. **Diagnosticar por qué no cualifica**, mirando el motivo de descarte dominante (`sin_perfil`, `sin_mercado`, `idioma_dudoso`, `score_bajo`, `sin_descripcion`, `enlace_cerrado`, `no_es_oferta`) y la muestra cruda. Cada motivo tiene su arreglo: búsqueda (términos y negativos), filtro de país o idioma en origen, extracción (campos y descripción), ventana de fechas o enriquecimiento de la ficha.
4. **Arreglar una causa cada vez**, acotada, con su test (rojo sin el arreglo, verde con él), contrato leído del esquema real, y sin bajar la barra de calidad (`MIN_SCORE`, cupo diario) para «hacer números».
5. **Volver a medir al día siguiente** (el cron de las 06:00 UTC y la tarea diaria). Si no mejoró, la hipótesis era falsa: vuelve al paso 3.
6. **Escribir** en `docs/STATUS.md` qué se midió, qué se cambió y con qué nivel de evidencia, y qué le toca al propietario («Te toca a ti» con la acción exacta).

## 3. Lista de comprobación antes de decir «hecho»

- [ ] He leído la medida real de hoy (cifra pegada) y no solo los tests.
- [ ] Ninguna cifra es un 0 inventado: lo que no se pudo leer sale «—» con su causa.
- [ ] El contrato de cada API/actor está leído del esquema o marcado «sin verificar».
- [ ] La suite completa terminó con `exit=0` y el recuento íntegro; `tsc`, `npm run design`, `npm run handoff`, `python3 -m pytest`.
- [ ] No hay marcadores de conflicto ni enlaces simbólicos colados (`git diff --check`, `git ls-files | grep node_modules`).
- [ ] Evidencia con el nivel correcto (*inspected* / *tested* / *verified*).
- [ ] Lo que depende del propietario está escrito con la acción exacta.
- [ ] Si el Resumen sigue mostrando fuentes sin cualificar sin causa ni dueño, **no está hecho**.

## 4. Skills y herramientas que se usan, y cuándo (obligatorio donde se dice «antes de»)

Las skills no sustituyen a la medida: sirven para **no cometer los errores de la sección 1** y para cerrar el bucle de la sección 2. Se invocan con la herramienta de skills; si una aplica, se usa **antes** de actuar.

| Momento del bucle | Skill / herramienta | Para qué en este proyecto |
|---|---|---|
| **Antes de decir «hecho», commitear o abrir PR** | `superpowers:verification-before-completion` | Evidencia antes que afirmaciones: ejecutar el comando completo, leer la salida y el código de salida; sin «debería funcionar». Es la barrera contra E1, E8 y E14 |
| **Una fuente no cualifica o algo falla** | `superpowers:systematic-debugging` | Causa raíz antes de tocar nada: reproducir, mirar el motivo de descarte dominante y la muestra cruda, una hipótesis cada vez. Prohíbe «probar cosas» |
| **Escribir o arreglar código** | `superpowers:test-driven-development` | Rojo sin el arreglo, verde con él (ya exigido). Cubrir siempre el caso «no se pudo leer» |
| **Antes de construir algo nuevo** | `superpowers:brainstorming`, `superpowers:writing-plans`, `superpowers:executing-plans` | Aclarar el resultado esperado y dividir en incrementos acotados; comprobar primero que no existe ya (E12) |
| **Antes de fusionar** | `code-review` (con el nivel que toque), `superpowers:requesting-code-review`, `superpowers:receiving-code-review` | Revisar el diff completo buscando fallos de comportamiento, no solo estilo; tratar cada hallazgo con criterio y verificarlo antes de aplicarlo |
| **Tras el review** | `simplify`, `security-review` | Quitar duplicación y revisar rutas con secretos, tokens y datos de alumnas |
| **Cerrar una rama** | `superpowers:finishing-a-development-branch` | Checklist de cierre: tests, PR, fusión, limpieza |
| **Separar trabajo en otra rama** | `superpowers:using-git-worktrees` | **Con cuidado (E7):** nunca enlazar `node_modules` ni `git add -A` dentro; si no es imprescindible, cambia de rama en el árbol principal |
| **Tocar un panel, KPI, gráfico o tabla** | `dashboard-design` (+ `data-visualization-pro`; alumnas: `design-taste-frontend`) | **Antes de** cambiarlo, como pide AGENTS.md: un hueco no es un cero, el color no es la única señal, tabla alternativa |
| **Integrar un actor de Apify** | `apify-ultimate-scraper` (+ `apify:apify-actor-development` si hay que crear uno) | Leer el esquema de entrada y salida y los fallos conocidos antes de escribir la plantilla (E4) |
| **Bright Data** | `brightdata-plugin:data-feeds`, `search`, `scrape`, `discover-api`, `scraper-builder`, `bright-data-best-practices` | Feeds estructurados, parámetros correctos de SERP, contratos y buenas prácticas |
| **Tocar la base** | `supabase`, `supabase-postgres-best-practices` y las herramientas de Supabase | Migración con `BEGIN … ROLLBACK`, avisos de seguridad después y orden expresa del propietario; lecturas con `execute_sql` solo de lectura |
| **Analizar números de fuentes** | `data:explore-data`, `data:analyze`, `data:validate-data`, `data:write-query`, `data:statistical-analysis` | Medir por fuente, validar que la cifra tiene sentido antes de actuar y no concluir con muestras pequeñas (umbral de 1.000 en las de pago) |
| **App web** | `nextjs-app-router-patterns`, `vercel:nextjs`, `vercel:verification`, `vercel:deployments-cicd` | Patrones del App Router, verificación y despliegue |
| **Comprobar la app en el navegador** | `run`, `browser-testing-with-devtools`, `integration-testing` | Ver el cambio funcionando en la app real, no solo en tests; pruebas de integración entre componentes |
| **Buscar una capacidad que falta** | `find-skills`, `anthropic-skills:deep-research` | Descubrir skills e investigar con fuentes antes de inventar |
| **Estado y riesgos** | `operations:status-report`, `operations:risk-assessment`, `operations:runbook`, `operations:process-optimization`, `project-review:review` | Informes de estado honestos, registro de riesgos y runbooks de lo que se repite |
| **Seguir algo en el tiempo** | `loop` y tareas programadas | Repetir la medida a diario; comprobar antes qué herramientas tendrá la sesión (E11) |

Herramientas de datos (no son skills): consulta a la base de solo lectura (Supabase), lectura de páginas públicas con la extracción de Tavily (el proxy bloquea muchos hosts), GitHub para PR y CI, registros de ejecución de Vercel y, si se activa, Sentry para errores en producción.

**No usar en este repositorio:** las skills y herramientas de Scalix (`scalix-ventas`, `anthropic-skills:scalix-*` y el MCP de Scalix): es otro sistema (AGENTS.md: este repositorio es independiente). `metodo-wdc` y `analisis-llamadas-ventas` son material de formación y de revisión de llamadas, no el sistema de ventas del producto. No lances subagentes salvo que el propietario lo pida.

## 5. Revisar y corregir mi propio trabajo hasta lograr el resultado

El resultado esperado es el de la sección 0. Mientras no se mida, el trabajo sigue abierto. El bucle de autocorrección:

1. **Definir el resultado antes de empezar**, en una frase medible («la fuente X pasa de 0 a ≥ 1 cualificada en 7 días»), y la forma exacta de medirlo.
2. **Hacer el cambio mínimo** que ataca la causa medida, con su test en rojo y luego en verde (`superpowers:test-driven-development`).
3. **Intentar romper mi propia afirmación.** Antes de decir que funciona, busca el caso que la desmiente: ¿y si el dato no se pudo leer?, ¿y si la fuente devuelve 0?, ¿y si el motor está caído?, ¿y si el contrato real difiere del que supuse?
4. **Revisar el diff completo como lo haría otra persona** (`code-review`): comportamiento, contratos, casos límite, secretos, y que el test comprueba lo que dice (un test que pasa con y sin el arreglo no prueba nada).
5. **Verificar con evidencia fresca** (`superpowers:verification-before-completion`): comandos completos, salida leída, `exit=0` y recuento íntegro; no se reutiliza una ejecución anterior.
6. **Medir el resultado real** (sección 2, paso 1) y compararlo con el definido en el paso 1. Si no coincide, **el trabajo no está terminado**: volver al paso 2 con una hipótesis nueva sacada de la medida, no de la intuición.
7. **Registrar** en `docs/STATUS.md`: qué se midió, qué cambió, nivel de evidencia y qué le toca al propietario; y, si hubo un error nuevo, una fila nueva en la sección 1.
8. **Dejar la medición recurrente** (Resumen del admin y tarea diaria) para que la siguiente sesión empiece por la realidad.

Señales de alarma para parar y repensar: tres intentos seguidos sin mover la medida; un arreglo que necesita bajar la barra de calidad (`MIN_SCORE`, cupo diario) para «subir números»; una cifra que mejora solo en el panel pero no en la base; una explicación que cambia cada vez que se mide.

## 6. Datos de contexto que ahorran errores

- Las gratuitas del motor viven en la base D1 del Worker `closer-engine`; las vías de pago y Jooble entran por Supabase (`external_offers`). Son dos medidas distintas.
- Las ofertas nuevas esperan en borrador hasta la pasada automática del cron (06:00 UTC) o «Clasificar ahora»; la IA de revisión en `shadow` solo anota. Cambiarla a `live` es decisión del propietario.
- Facebook, Skool y Telegram necesitan direcciones de grupos o canales que solo tiene el propietario; Reddit devuelve publicaciones, no empleos.
- El proxy de este entorno bloquea muchos hosts (Apify, Workable, ATS); `raw.githubusercontent.com` y la extracción de Tavily sí funcionan para leer páginas públicas.
- Más: [STATUS](STATUS.md), [PLAN](PLAN.md), [referencias de scrapers](REFERENCIAS_SCRAPERS.md), [aprendizajes de crecimiento](LEARNINGS_GROWTH_OPS.md).
