# Fixtures de las APIs oficiales

Cuerpos con la **forma** que define la documentación vigente, para que un cambio de respuesta se vea en las
pruebas en vez de entrar como «0 ofertas». Los valores están adaptados a España (importes en €, ubicaciones
españolas); la estructura y los nombres de campo son los de la doc.

| Fichero | Fuente | Qué se copia de la doc |
|---|---|---|
| `infojobs-offers.json` | [GET /api/9/offer](https://developer.infojobs.net/documentation/operation/offer-list-9.xhtml) | `offers[]` con `id`, `title`, `province.value`, `city`, `link`, `category.value`, `salaryMin/Max/Period`.value, `teleworking.value`, `published/updated`, `author.name`; la oferta del camarero es la del ejemplo oficial. |
| `infojobs-detail.json` | [GET /api/9/offer/{id}](https://developer.infojobs.net/documentation/operation/offer-get-9.xhtml) | `description`, `minRequirements`, `salaryMin/Max` con `amount`/`amountValue`, `periodValue`, `teleworking`. |
| `adzuna-search.json` | [Search ads](https://developer.adzuna.com/docs/search) | `results[]` con `id`, `title`, `company.display_name`, `location.display_name`, `redirect_url`, `salary_min/max`, `created`, `description`, `category.label`. |
| `jooble-search.json` | [REST API](https://help.jooble.org/en/support/solutions/articles/60001448238-rest-api-documentation) | `totalCount` + `jobs[]` con `id` numérico, `title`, `location`, `snippet`, `salary`, `source`, `type`, `link` **sin esquema** y `updated` con 7 decimales, tal como los enseña la doc. |

Se leen desde `tests/admin-auth/api-shapes.mjs`. No se llaman las APIs reales: son cuerpos guardados.
