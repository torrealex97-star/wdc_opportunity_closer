# ADR-019 — Los roleplays y el feedback se puntúan con las skills de ventas, y el panel puede afinarlos

Estado: aceptada · Fecha: 2026-11-19 (actualizada en la sesión 235) · Evidencia: *inspeccionado* (skills leídas), *probado* (pruebas unitarias y E2E con servicios simulados) y *verificado* en Chromium local (panel real, roleplay real y evaluación de llamada real contra el servidor, consola sin errores). Las migraciones de Supabase están **preparadas y sin aplicar** (aplicar DDL exige orden expresa del propietario); el desarrollo local persiste en SQLite con migraciones versionadas.

## Contexto
El propietario pidió revisar los criterios de todos los roleplays, de la revisión de llamadas y de la puntuación con las skills `/scalix-ventas` y `/analisis-llamadas-ventas` de Claude Code, cambiar lo que no estuviera acorde y dejar un panel de administración para ajustarlo.

Antes, la sala puntuaba con cuatro ejes genéricos sin pesos (apertura, descubrimiento, objeción, cierre), una rúbrica de entrevista de cuatro ejes y una WDC de seis con pesos. El feedback citaba evidencia y calculaba la media, pero no aplicaba la rúbrica de la skill: no distinguía fases como pitch o control de la conversación, no auditaba BANT, no separaba ejecución de resultado y no forzaba UNA sola corrección prioritaria.

## Decisión
1. **La fuente de verdad son las skills**, copiadas al repo en `.agents/skills/scalix-ventas` y `.agents/skills/analisis-llamadas-ventas` (enlazadas en `.claude/skills`):
   - Closer: Apertura y agenda 10 · Clarify/label/pain cycle 25 · Pitch 10 · Control con preguntas 15 · Objeciones y cierre 30 · Handshake 5 · Rapport y ética 5.
   - Setter: Primer mensaje 15 · BANT 30 · Edificación y agenda 25 · Control 15 · Traspaso al closer 10 · Ética 5.
   - Frío: Apertura y gancho 35 · Control 15 · Paso a cita 30 · Primer no 15 · Ética 5.
   - Entrevista: criterios de contratación de `scalix-ventas` §7: las tres P 30, inteligencia (velocidad de aprendizaje) 25, ética de trabajo 25 y humildad 20. La antigua rúbrica WDC de seis criterios **se elimina** porque no era rastreable a ninguna de las dos skills; los cuatro escenarios que la usaban pasan a esta rúbrica de contratación.
2. **Escala 0-100 por eje con las bandas de la skill** (0-40 ausente o dañino, 41-60 parcial, 61-80 correcto, 81-100 sólido) y **media ponderada normalizada** calculada en servidor. El modelo nunca devuelve la nota global.
3. **Auditoría BANT obligatoria en las tres salas de venta**: estado ✓/~/✗/? por letra, cita literal del interlocutor y decisión (correcto avanzar, avanzó sin cualificar, no debió avanzar, correcto parar, paró demasiado pronto). Una entrevista no se audita con BANT. El servidor rechaza estados fuera de la tabla, decisiones inventadas o la ausencia del bloque.
4. **Una sola corrección prioritaria**, elegida con el orden de impacto de la skill; el prompt lo exige y el panel puede reordenar esa lista.
5. **Señales deterministas nuevas**: ratio de habla (la vendedora no debe acaparar) y precio antes de descubrir. Siguen siendo observaciones sin IA, con cita literal.
6. **Configuración editable y versionada en base de datos** (`practice_rubrics`, una fila por organización): rúbricas por sala, orden de prioridades y qué salas exigen BANT. Se valida el conjunto entero antes de escribir; si la tabla no existe o el JSON guardado no es válido, se aplican los valores por defecto y se declara la causa (nunca se finge que el cambio está activo). Los valores por defecto viven en `apps/web/lib/practiceRubrics.ts`.
7. **Desarrollo local sin Supabase**: como no hay Supabase, Docker ni Postgres en el entorno local, el mismo store usa un backend SQLite de Node con migraciones versionadas en código (`practiceLocalMigrations.ts`), solo si no hay Supabase configurado y `NODE_ENV !== 'production'`; la API declara `backend: 'local'` y el panel lo dice. El operador local `local-dev@wdc` (propietario) solo se acepta por loopback y fuera de producción. No es autenticación hospedada ni se despliega: `next start` corre en producción. La tabla Postgres sigue siendo la de producción y su DDL no se aplica sin orden del propietario.
7. **El cambio no reescribe el historial**: las prácticas ya puntuadas conservan sus ejes y su nota. Los pesos nuevos se aplican a la siguiente réplica y al siguiente feedback.

## Alternativas descartadas
- **Dejar la rúbrica en el código y editar por despliegue**: el propietario pidió ajustar desde el panel; un cambio de pesos exigiría un PR y un deploy.
- **Guardar la configuración en un fichero del repo**: en Vercel el sistema de ficheros es de solo lectura; no habría panel real.
- **Añadir un proveedor o una librería de evaluación**: no hacía falta; el análisis ya es determinista más una llamada al modelo con esquema estricto.
- **Puntuar entrevistas con la rúbrica de llamadas**: la propia skill dice que no analiza reuniones que no son de venta; se usan los criterios de contratación de `scalix-ventas`.

## Consecuencias
- Cambian los ids de eje de closer (aparecen `pitch`, `control`, `siguiente`, `etica`; desaparece `cierre` y `marco` en frío). «Mi progreso» agrupa por id: las prácticas nuevas se separan de las antiguas, y el panel puede renombrar etiquetas sin romper la serie.
- Las notas antiguas y nuevas no son estrictamente comparables; el historial no se migra ni se recalcula.
- La tabla nueva necesita dos migraciones: `20261119_practice_rubrics.sql` (tabla) y `20261119_practice_rubrics_versions.sql` (`version` e `history`). Mientras no se apliquen en el Supabase real, en producción el panel muestra los criterios por defecto y declara que no puede guardar; en desarrollo local guarda en SQLite y lo declara.
- El backend local es una comodidad de desarrollo, no una segunda fuente de verdad: no se despliega, no se comparte y su base vive fuera del repo (`PRACTICE_DB_PATH` o `.local/`).
- Evidencia de la ida y vuelta: [practice-persistence.mjs](../tests/admin-auth/practice-persistence.mjs) (5/5) y [admin-practice.spec.ts](../tests/browser/admin-practice.spec.ts) (1/1 activa): peso 100 → nota 53 y etiqueta nueva en el feedback; restaurar → nota 10.
- El análisis de varias llamadas (modo multi-llamada de la skill) no se implementa aquí: la sala puntúa una conversación por sesión.

## Actualización sesión 235: activación, versiones y evaluación de llamadas

1. **Cada criterio declara su fuente.** `RubricAxis` añade `source` (`scalix-ventas` o `analisis-llamadas-ventas`) y `source_ref` (sección exacta de la skill). La validación rechaza un criterio sin fuente o sin sección; el panel ya no permite inventar criterios con «Añadir criterio». Las cinco rúbricas se siembran con su fuente y su referencia.
2. **Activar/desactivar sin borrar.** `enabled` queda en la fila. Un criterio desactivado no viaja al prompt ni al esquema, no se puntúa y su peso no entra en la media; el panel lo conserva para poder reactivarlo. El servidor exige entre 3 y 8 criterios y al menos 3 activos.
3. **Versiones dentro de `practice_rubrics`.** Cada guardado crea `version` y una entrada en `history` (últimas 20, con configuración completa, fecha, operador y nota). Restaurar una versión la guarda como versión nueva: el historial no se reescribe. Reset vuelve a los valores de las skills y borra el historial; el panel lo advierte antes de confirmar.
4. **Evaluación de llamadas separada del roleplay.** Nueva superficie «Revisar llamada» en la sala: se pega una transcripción etiquetada `VENDEDOR:`/`CLIENTE:`; `parseCallTranscript` rechaza líneas sin hablante, sin cliente, sin vendedor o demasiado largas. Reutiliza `POST /api/practice` con `mode: 'review'`, la rúbrica `llamada` (7 fases de `analisis-llamadas-ventas`), BANT obligatorio y el mismo `cleanDebrief`; solo cita intervenciones de la vendedora y no guarda la transcripción ni la registra en actividad.
5. **Verificación en navegador real** (sesión 235): el E2E arranca su propio `next dev`, SQLite temporal y un Groq simulado; cambia el peso de apertura del closer a 100 y el de la rúbrica de llamada a 100, guarda, recarga, desactiva/reactiva un criterio, ejecuta un roleplay y una evaluación de llamada desde la UI y comprueba que ambos puntúan 53 con las etiquetas editadas; después restaura la versión 1 y el reset. No se llamó a Groq real.
