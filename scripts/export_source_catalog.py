"""Exporta el catálogo de fuentes del panel a apps/web/lib/sourceCatalog.json.

El panel hospedado no tiene el backend local: muestra el catálogo completo desde este fichero y cruza
cada código con el estado real del motor cloud. Uso: PYTHONPATH=apps/api python scripts/export_source_catalog.py
tests/test_source_catalog_export.py comprueba que el fichero versionado sigue en sincronía.

**Qué manda**: el panel habla con el motor cloud (`sites/engine/worker.js`), no con este backend. Las dos
realidades han divergido y este script es el único sitio donde se declara la diferencia, para que el export
no vuelva a «des-verificar» lo medido en producción:

  · `CLOUD_OPERATIONAL`  fuentes que el cloud recoge hoy y el backend local no tiene en su REGISTRY, o cuyo
                         método y estado se verificaron después en el cloud (FreeHire, Freelancer, Jobgether,
                         JobToday, Get on Board, ProductHackers, openradar, Fever, Qonto).
  · `CLOUD_RETIRED`      tableros retirados del cloud por cero elegibles en dos mediciones (sesión 176) que
                         el backend todavía lista en su watchlist.
  · `CLOUD_CODE`         el código del backend local frente al que cruza el panel (`sourceFamilies.catalogCodeFor`).

`apps/api/career/sources.py` sigue describiendo el backend local (sus conectores y su watchlist) y **no se
toca** para esto. El JSON del panel es el resultado de este script: no se edita a mano; cualquier hecho
nuevo del cloud se escribe en las tablas de abajo y se regenera.
"""
import json
import os
import sys
import tempfile
from pathlib import Path

OUT = Path(__file__).resolve().parents[1] / 'apps/web/lib/sourceCatalog.json'
FIELDS = ('code', 'name', 'category', 'website', 'acquisition_method', 'validation_status', 'requires', 'note', 'upstream_filters')
ATS_NOTE = 'Tablero ATS público de la empresa, según la watchlist. La oferta se publica primero aquí; el enlace y la atribución son de la empresa.'

# Cambios de ficha medidos en el motor cloud: se aplican sobre lo que devuelve `source_infos`.
CLOUD_OPERATIONAL = {
    'freehire': {'acquisition_method': 'API v1 + ruta de datos', 'validation_status': 'Conector operativo'},
    'freelancer': {'requires': 'none', 'acquisition_method': 'API pública de proyectos', 'validation_status': 'Conector operativo',
                   'note': 'Encargos, no empleos: presupuesto del proyecto, sin salario. Se recoge por la API pública, sin clave.',
                   'upstream_filters': []},
    'jobgether': {'requires': 'none', 'acquisition_method': 'Feed público', 'validation_status': 'Conector operativo',
                  'note': 'Remoto con filtro por país: se recoge del feed público del motor, sin clave.', 'upstream_filters': []},
    'jobtoday-comercial': {'acquisition_method': 'Listado embebido (NEXT_DATA)', 'validation_status': 'Conector operativo', 'upstream_filters': []},
    'jobtoday-ventas': {'acquisition_method': 'Listado embebido (NEXT_DATA)', 'validation_status': 'Conector operativo', 'upstream_filters': []},
    'getonbrd-public': {'name': 'Get on Board', 'category': 'LATAM', 'website': 'https://www.getonbrd.com',
                        'requires': 'none', 'acquisition_method': 'API por categoría', 'validation_status': 'Conector operativo',
                        'upstream_filters': ['Categoría ventas'],
                        'note': 'API/feed público. Cobertura española variable; atribución y enlace original conservados.'},
    'ats-teamtailor-producthackers': {'name': 'ProductHackers · Teamtailor'},
}

# Conector propio que vive en el backend local y que el motor cloud todavía no recoge (ADR-018). Se declara
# para que el panel no anuncie una recogida que el cloud no hace: el método y la nota son reales, y el estado
# dice dónde funciona. Cuando se porte al Worker, se borra de aquí y el panel lo verá operativo de verdad.
BACKEND_ONLY = {
    'weremoto': {'requires': 'input',
                 'validation_status': 'Conector en el backend local · el motor cloud aún no lo recoge'},
}

# Fuentes que el cloud recoge y el backend local no tiene: se añaden con su ficha completa.
CLOUD_ADDED = [
    {'code': 'openradar', 'name': 'openradar', 'category': 'Internacional', 'website': 'https://openradar.fun',
     'acquisition_method': 'API pública (OpenAPI 3.1)', 'validation_status': 'Conector operativo', 'requires': 'none',
     'note': 'Vacantes y encargos de boards, RSS y Telegram, con el texto completo y sin clave. `q` busca en título y texto; 3 términos por pasada, rotando por día. Medido el 2026-11-18: closers y setters en español entre los resultados.',
     'upstream_filters': ['Búsqueda por texto', 'Tipo vacante/encargo', 'Remoto o presencial']},
    {'code': 'ats-greenhouse-feverup', 'name': 'Fever · Greenhouse', 'category': 'Empresas',
     'website': 'https://boards-api.greenhouse.io/v1/boards/feverup/jobs', 'acquisition_method': 'ATS público por empresa',
     'validation_status': 'Conector operativo', 'requires': 'none', 'note': ATS_NOTE, 'upstream_filters': []},
    {'code': 'ats-ashby-qonto', 'name': 'Qonto · Ashby', 'category': 'Empresas',
     'website': 'https://api.ashbyhq.com/posting-api/job-board/qonto', 'acquisition_method': 'ATS público por empresa',
     'validation_status': 'Conector operativo', 'requires': 'none', 'note': ATS_NOTE, 'upstream_filters': []},
    {'code': 'workable', 'name': 'Workable', 'category': 'Internacional', 'website': 'https://jobs.workable.com',
     'acquisition_method': 'API pública de búsqueda global', 'validation_status': 'Conector operativo',
     'requires': 'none',
     'note': 'Bolsa pública del ATS, sin clave ni cuenta: `query` busca por término y `location` acota por país. Medido el 2026-11-20: «closer» 4 ofertas en España (una, «Account Executive - High Ticket Closer»), 16 en México, 11 en Colombia y 11 en Argentina; «comercial» 14 en España. No se paga por resultado.',
     'upstream_filters': ['Búsqueda por término', 'País']},
    {'code': 'smartrecruiters', 'name': 'SmartRecruiters · búsqueda global', 'category': 'Internacional',
     'website': 'https://jobs.smartrecruiters.com',
     'acquisition_method': 'Búsqueda pública + detalle por oferta', 'validation_status': 'Conector operativo',
     'requires': 'none',
     'note': 'Búsqueda global de su bolsa pública sin clave: `keyword` filtra y `location`/`country` no, así que el mercado lo decide la ubicación de cada oferta. Medido el 2026-11-20: «comercial» 221 resultados, con 34 de España (METRO/MAKRO, Bosch Group), 13 de Colombia, 12 de México y 4 de Chile entre los 100 primeros. El listado no trae descripción: se pide el detalle público de hasta 4 ofertas del perfil por pasada.',
     'upstream_filters': ['Búsqueda por término', 'País de la oferta (local)']},
]

# El backend local lo llama `getonbrd`; el motor cloud emite ese mismo código y el panel lo cruza con
# `getonbrd-public` (ALIAS de sourceFamilies.ts). Dos filas del mismo portal es justo el fallo que dejaba el
# portal como «fuera del cloud», así que el catálogo usa el código que el panel sabe cruzar, una sola vez.
CLOUD_CODE = {'getonbrd': 'getonbrd-public'}

# Retirados del cloud: 0 elegibles en dos mediciones (STATUS sesión 176). El backend local aún los lista.
CLOUD_RETIRED = {
    'ats-greenhouse-typeform', 'ats-greenhouse-wallapop', 'ats-recruitee-livestorm', 'ats-teamtailor-monestcapital',
}


def build():
    os.environ.setdefault('CAREER_DB', str(Path(tempfile.mkdtemp()) / 'catalog.sqlite3'))
    from career.db import initialize, org
    from career.sources import source_infos
    initialize()
    rows = [i if isinstance(i, dict) else i.model_dump() for i in source_infos(org())]
    catalog, by_code = [], {}
    for r in rows:
        if r.get('code') in CLOUD_RETIRED:
            continue
        row = {k: (CLOUD_CODE.get(r.get('code'), r.get('code')) if k == 'code' else r.get(k)) for k in FIELDS}
        seen = by_code.get(row['code'])
        if seen is None:
            by_code[row['code']] = row
            catalog.append(row)
            continue
        # Dos filas del mismo portal (REGISTRY y catálogo de pendientes): se funden en una, sin pisar
        # lo que ya está declarado.
        seen.update({k: v for k, v in row.items() if seen.get(k) in (None, '', [])})
    for code, facts in {**CLOUD_OPERATIONAL, **BACKEND_ONLY}.items():
        if code in by_code:
            by_code[code].update(facts)
    for row in CLOUD_ADDED:
        if row['code'] not in by_code:
            catalog.append({k: row.get(k) for k in FIELDS})
    return catalog


if __name__ == '__main__':
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'apps/api'))
    catalog = build()
    OUT.write_text(json.dumps(catalog, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'{len(catalog)} fuentes -> {OUT}')
