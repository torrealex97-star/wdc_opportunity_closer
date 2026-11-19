# ADR-019 — Los roleplays y el feedback se puntúan con las skills de ventas, y el panel puede afinarlos

Estado: aceptada · Fecha: 2026-11-19 · Evidencia: *inspeccionado* (skills leídas) y *probado* (pruebas unitarias y de navegador con servicios simulados). La migración de persistencia está **preparada y sin aplicar** (aplicar DDL exige orden expresa del propietario).

## Contexto
El propietario pidió revisar los criterios de todos los roleplays, de la revisión de llamadas y de la puntuación con las skills `/scalix-ventas` y `/analisis-llamadas-ventas` de Claude Code, cambiar lo que no estuviera acorde y dejar un panel de administración para ajustarlo.

Antes, la sala puntuaba con cuatro ejes genéricos sin pesos (apertura, descubrimiento, objeción, cierre), una rúbrica de entrevista de cuatro ejes y una WDC de seis con pesos. El feedback citaba evidencia y calculaba la media, pero no aplicaba la rúbrica de la skill: no distinguía fases como pitch o control de la conversación, no auditaba BANT, no separaba ejecución de resultado y no forzaba UNA sola corrección prioritaria.

## Decisión
1. **La fuente de verdad son las skills**, copiadas al repo en `.agents/skills/scalix-ventas` y `.agents/skills/analisis-llamadas-ventas` (enlazadas en `.claude/skills`):
   - Closer: Apertura y agenda 10 · Clarify/label/pain cycle 25 · Pitch 10 · Control con preguntas 15 · Objeciones y cierre 30 · Handshake 5 · Rapport y ética 5.
   - Setter: Primer mensaje 15 · BANT 30 · Edificación y agenda 25 · Control 15 · Traspaso al closer 10 · Ética 5.
   - Frío: Apertura y gancho 35 · Control 15 · Paso a cita 30 · Primer no 15 · Ética 5.
   - Entrevista: criterios de contratación de `scalix-ventas` §7 (evidencia 25, criterio comercial 25, claridad 20, objeción/encaje 15, iniciativa 15); la variante WDC conserva sus seis criterios con peso.
2. **Escala 0-100 por eje con las bandas de la skill** (0-40 ausente o dañino, 41-60 parcial, 61-80 correcto, 81-100 sólido) y **media ponderada normalizada** calculada en servidor. El modelo nunca devuelve la nota global.
3. **Auditoría BANT obligatoria en las tres salas de venta**: estado ✓/~/✗/? por letra, cita literal del interlocutor y decisión (correcto avanzar, avanzó sin cualificar, no debió avanzar, correcto parar, paró demasiado pronto). Una entrevista no se audita con BANT. El servidor rechaza estados fuera de la tabla, decisiones inventadas o la ausencia del bloque.
4. **Una sola corrección prioritaria**, elegida con el orden de impacto de la skill; el prompt lo exige y el panel puede reordenar esa lista.
5. **Señales deterministas nuevas**: ratio de habla (la vendedora no debe acaparar) y precio antes de descubrir. Siguen siendo observaciones sin IA, con cita literal.
6. **Configuración editable y versionada en base de datos** (`practice_rubrics`, una fila por organización): rúbricas por sala, orden de prioridades y qué salas exigen BANT. Se valida el conjunto entero antes de escribir; si la tabla no existe o el JSON guardado no es válido, se aplican los valores por defecto y se declara la causa (nunca se finge que el cambio está activo). Los valores por defecto viven en `apps/web/lib/practiceRubrics.ts`.
7. **El cambio no reescribe el historial**: las prácticas ya puntuadas conservan sus ejes y su nota. Los pesos nuevos se aplican a la siguiente réplica y al siguiente feedback.

## Alternativas descartadas
- **Dejar la rúbrica en el código y editar por despliegue**: el propietario pidió ajustar desde el panel; un cambio de pesos exigiría un PR y un deploy.
- **Guardar la configuración en un fichero del repo**: en Vercel el sistema de ficheros es de solo lectura; no habría panel real.
- **Añadir un proveedor o una librería de evaluación**: no hacía falta; el análisis ya es determinista más una llamada al modelo con esquema estricto.
- **Puntuar entrevistas con la rúbrica de llamadas**: la propia skill dice que no analiza reuniones que no son de venta; se usan los criterios de contratación de `scalix-ventas`.

## Consecuencias
- Cambian los ids de eje de closer (aparecen `pitch`, `control`, `siguiente`, `etica`; desaparece `cierre` y `marco` en frío). «Mi progreso» agrupa por id: las prácticas nuevas se separan de las antiguas, y el panel puede renombrar etiquetas sin romper la serie.
- Las notas antiguas y nuevas no son estrictamente comparables; el historial no se migra ni se recalcula.
- La tabla nueva necesita una migración (`20261119_practice_rubrics.sql`). Mientras no se aplique, el panel muestra los criterios por defecto y declara que no puede guardar.
- El análisis de varias llamadas (modo multi-llamada de la skill) no se implementa aquí: la sala puntúa una conversación por sesión.
