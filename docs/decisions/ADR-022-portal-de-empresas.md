# ADR-022 — Portal para empresas: publicar ofertas de closer gratis, con moderación (propuesta)

Estado: **propuesta, no aceptada** · Fecha: 2026-11-22 · Evidencia: *inspected* (estado real de la base y de las fuentes ese día). Nada de esto está construido ni probado. Paquete C3 de `docs/plans/OFERTAS_CLOSER_MEJORAS.md`.

## Contexto
Hoy las ofertas que ven las alumnas salen de portales y buscadores (Google Jobs, Jooble, InfoJobs, Apify…). Medido el 2026-11-22: 301 ofertas aprobadas y vigentes, de las que solo 26 son de LatAm o del mercado hispano de EE. UU.; **ninguna es exclusiva**: cualquier otra academia o la propia alumna puede encontrarlas en los mismos portales. Muchas de las mejores ofertas de closer (infoproductos, agencias, coaches, SaaS) no pasan por un portal: se contratan por LinkedIn, por Instagram, en comunidades o por recomendación.

La ventaja que ninguna otra academia puede copiar es **tener ofertas que solo existen aquí**: empresas que publican directamente en WDC porque quieren closers formadas.

## Propuesta
1. **Formulario público de alta de oferta** (sin cuenta de empresa al principio): empresa, web, persona de contacto, puesto (closer, setter, cold caller), modalidad y país, modelo de pago (fijo, comisión, mixto) con **porcentaje de comisión, OTE y ticket del producto** si los dan, enlace de candidatura o correo al que escribir, y una frase de qué vende. Todos los campos de pago son opcionales y se muestran tal cual los escribe la empresa.
2. **Cola de moderación humana obligatoria** antes de publicar. Nada se publica solo. La revisión usa las banderas de riesgo que ya existen (comisión pura, «libertad financiera», promesas de ingresos, dominio reciente, sin web verificable) y el detector de ofertas (#38).
3. **Verificación mínima** de la empresa: dominio propio y correo del mismo dominio, página web que responda 200, y una pista pública (perfil de LinkedIn o anuncios) comprobada por una persona. Sin eso queda en «pendiente».
4. **Caducidad**: cada oferta vive 30 días y la empresa debe confirmarla con un enlace del correo para renovarla (evita ofertas muertas, que es lo que más daña la confianza de la alumna).
5. **Origen visible**: la alumna ve «Publicada directamente por la empresa en WDC» frente a «Encontrada en un portal», con la fecha de verificación. Es la etiqueta que da valor a la exclusividad.
6. **Se guarda como una fuente más** (`source = wdc-empresas`), con la misma tabla de ofertas y el mismo flujo editorial; no se crea un circuito aparte. Las métricas por fuente (muestra, aprobadas, contrataciones) valen sin cambios.

## Lo que NO se hace
- **No se envían candidaturas ni mensajes por la alumna** ni se comparten datos de alumnas con la empresa. La alumna decide a quién escribe, como hoy.
- **No hay perfil de alumna compartible** en esta fase (ver la fila 8 de las próximas fases de `docs/ACTIVE_HANDOFF.md`: exige consentimiento y revisión legal).
- **No se cobra a las empresas** en esta fase.
- **Ningún dato de alumnas va a un modelo de lenguaje.**

## Riesgos y cómo se contienen
| Riesgo | Contención |
| --- | --- |
| Spam y estafas (comisión pura que esconde un pago por entrar, «libertad financiera») | Moderación humana siempre, banderas de riesgo, lista de dominios bloqueados, límite de altas por dominio y por día |
| Datos personales de la empresa (contacto) | Solo se guarda lo necesario; el correo de contacto no se muestra a la alumna; texto en `/privacidad` |
| Abuso del formulario público (bots) | Límite de peticiones, comprobación de origen y un reto antiabuso sin cookies de terceros; decidir el proveedor aparte |
| Ofertas falsas que dañen la reputación de la academia | Origen visible, caducidad, botón «avisar de un problema» que retira la oferta a la cola |
| Responsabilidad legal de publicar ofertas de terceros | Revisión legal de los términos de publicación antes de abrir el formulario (tarea del dueño) |

## Qué hace falta del dueño antes de construir
1. Aprobar o rechazar esta propuesta y el nombre del canal.
2. **Migración**: una tabla de altas pendientes (empresa, contacto, estado, caducidad) o reutilizar `external_offers` con un estado previo. Aplicarla en la base real exige su orden expresa y su prueba `BEGIN … ROLLBACK`.
3. Términos de publicación y texto legal revisados por un profesional.
4. Decidir si el correo de verificación sale por Resend (ya elegido en ADR-014) y desde qué dominio.

## Primer incremento si se aprueba
Formulario + cola de moderación + publicación como fuente `wdc-empresas`, **sin** renovación automática ni cuentas de empresa. Criterio de éxito medible: ofertas exclusivas vigentes y, a medio plazo, contrataciones atribuidas a esa fuente (paquete E1).

## Alternativas descartadas por ahora
- **Esperar a que las empresas lleguen solas**: sin una lista propia de empresas objetivo (paquete C2) no hay a quién pedírselo; se plantea junto con ella.
- **Aceptar ofertas sin moderación**: descartado, es el camino al spam y a las estafas, que es justo lo que el detector de ofertas existe para evitar.
- **Un buscador de ofertas de terceros ya hecho** (Apify u otro): sirve para cobertura, no da exclusividad.
