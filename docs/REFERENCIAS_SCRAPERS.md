# Referencias de scrapers y agentes de empleo (aportadas por el propietario, 2026-11-24)

Lista de trabajo, **no** decisión: ninguna licencia ni mantenimiento está verificado (*inspected* solo la lista que pasó el propietario; no se ha leído ningún repositorio). Regla del repo: solo MIT/Apache-2.0/BSD (ADR-013) y nada que envíe candidaturas por su cuenta (AGENTS.md).

| Idea | Proyecto citado | Qué aporta a esta app | Siguiente paso |
|---|---|---|---|
| Feeds ATS públicos (Greenhouse, Lever, Ashby, Workable) sin proxy | job-board-aggregator, ats-scrapers, career-site-jobs-scraper, OpenPostings | Ofertas de empresa limpias y gratis; la app ya lee Greenhouse y la base de Fantastic.jobs entra por Apify | Leer licencia y última actividad; probar un conector ATS propio detrás de la interfaz de conectores (devuelven candidatas crudas, nunca escriben ofertas) |
| Ofertas fantasma | JobSentinel | Descartar anuncios muertos antes de puntuar | Regla determinista con fecha y reaparición; la comprobación semanal de caducadas ya está en el plan |
| Puntuar y alertar | job-hunter-agent, job-radar, Bert | Ya hay puntuación y revisión; faltarían avisos por Telegram | Solo con orden expresa (envío de mensajes) |
| Base de scraping limpia | JobMiner, ts-jobspy | Límite de velocidad y reintentos | Nada: los conectores y Apify ya cubren esto |
| InfoJobs/España | Scraper-InfoJobs-Python, InfojobsScraper | Campos de InfoJobs | Referencia de campos; la vía oficial (clave InfoJobs) es preferible |
| Agentes de candidatura | career-ops, JobForge | CV a medida y seguimiento | **Fuera de alcance**: aplicaciones automáticas requieren orden expresa (Fase 4, ADR-012) |
| Caveat del propio texto | — | Los scrapers pueden violar términos y bloquear IP/cuentas; nunca enviar candidaturas sin supervisión | Se mantiene |
