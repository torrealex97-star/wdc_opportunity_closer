# Páginas de empleo que vigila el motor: lectura real — 2026-11-22

Generado por `scripts/probe_company_pages.mjs`. Mide la lectura **directa** (sin desbloqueador de pago,
sin navegador propio) con el mismo extractor del cron: JSON-LD `JobPosting`, RSS y, si no hay nada
estructurado, los enlaces del propio sitio. Una página vacía por JavaScript se declara como tal; no
se cuenta como «0 ofertas». No ingiere ni escribe en la base.

- **Páginas medidas:** 16 (2 del repo, 15 del motor antes de quitar repetidas)
- **Con ofertas:** 3 · **Bloqueadas (401/403/429/503):** 1 · **Sin respuesta:** 0 · **Vacías por JavaScript:** 0
- **Motor:** El motor respondió HTTP 404 («Ruta no disponible en modo hospedado»). 15 página(s) en la lista semilla del motor (no se pudo leer la base; puede haber cambiado).

| Empresa | Código | Página | HTTP | Vía | Ofertas | Enlaces | Bytes | Texto | Nota |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Inversor PRO · Monest Capital | monest-capital | https://careers.monestcapital.com/jobs.rss | 200 | rss | 2 | 0 | 11984 | 8528 | Lista verificada del repo. |
| Bastida Farina | bastida-farina | https://www.bastidafarina.com/equipo/posiciones-abiertas | 200 | — | 0 | 38 | 34248 | 828 | Respondió sin JobPosting, RSS ni enlaces de oferta: no hay nada que extraer. |
| Nuclio Digital School | nuclio-digital-school | https://nuclio.school/portal-de-empleo-nuclio/ | 200 | — | 0 | 109 | 94341 | 4491 | Respondió sin JobPosting, RSS ni enlaces de oferta: no hay nada que extraer. |
| KeepCoding | keepcoding | https://keepcoding.io/sobre-nosotros/trabaja-con-nosotros/ | 200 | — | 0 | 230 | 536996 | 9376 | Respondió sin JobPosting, RSS ni enlaces de oferta: no hay nada que extraer. |
| Product Hackers School | product-hackers-school | https://producthackers.teamtailor.com/jobs | 200 | anchors | 5 | 25 | 105194 | 4799 | Semilla del motor (teamtailor_feed). |
| MIOTI Tech & Business School | mioti-tech-business-school | https://mioti.factorial.es/ | 200 | — | 0 | 15 | 35279 | 3781 | Respondió sin JobPosting, RSS ni enlaces de oferta: no hay nada que extraer. |
| Ironhack | ironhack | https://jobs.ironhack.com/ | 404 | — | 0 | 1 | 837 | 143 | HTTP 404 |
| Le Wagon | le-wagon | https://join.com/companies/lewagon2 | 404 | — | 0 | 1 | 13677 | 80 | HTTP 404 |
| BIG school | big-school | https://thebigschool.com/carreras/ | 200 | — | 0 | 72 | 123959 | 4639 | Respondió sin JobPosting, RSS ni enlaces de oferta: no hay nada que extraer. |
| Insparya | insparya | https://insparya.com/es/es/por-que-insparya/empleo/ | 403 | — | 0 | 0 | 5631 | 58 | HTTP 403 (bloqueo) |
| Medical Hair | medical-hair | https://www.medicalhair.es/trabaja-con-nosotros/ | 200 | — | 0 | 130 | 361749 | 4998 | Respondió sin JobPosting, RSS ni enlaces de oferta: no hay nada que extraer. |
| HACK A BOSS | hack-a-boss | https://www.hackaboss.com/ofertas-empleo | 200 | — | 0 | 60 | 115607 | 4689 | Respondió sin JobPosting, RSS ni enlaces de oferta: no hay nada que extraer. |
| Adalab | adalab | https://www.infojobs.net/adalab/em-i10356555455554965100971018163596301058 | 200 | — | 0 | 78 | 38668 | 3064 | Respondió sin JobPosting, RSS ni enlaces de oferta: no hay nada que extraer. |
| TripleTen | tripleten | https://www.comeet.com/jobs/tripleten/98.008 | 200 | — | 0 | 6 | 2038430 | 1566 | Respondió sin JobPosting, RSS ni enlaces de oferta: no hay nada que extraer. |
| Conquer Blocks / ConquerX | conquer-blocks-conquerx | https://www.conquerx.com/en/unete-a-nosotros | 200 | jsonld | 1 | 35 | 32082 | 935 | Semilla del motor (careers_page). |
| Factoría F5 | factoria-f5 | https://www.tecnoempleo.com/factoria-f5/re-195355 | 200 | — | 0 | 89 | 62295 | 5606 | Respondió sin JobPosting, RSS ni enlaces de oferta: no hay nada que extraer. |

## Qué dice esto y qué no

- **Sí:** qué páginas responden a una lectura directa, cuáles bloquean, cuáles se pintan con JavaScript y cuántas ofertas saca el extractor de cada una.
- **No:** no se ha usado el desbloqueador de pago ni el navegador propio, así que una página bloqueada o vacía aquí puede leerse con esas vías (el cron lo intenta). Tampoco se ha aprobado ninguna oferta: lo extraído entraría como borrador.
