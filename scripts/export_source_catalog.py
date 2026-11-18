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
    'getonbrd': {'requires': 'none', 'acquisition_method': 'API por categoría', 'validation_status': 'Conector operativo',
                 'upstream_filters': ['Categoría ventas'],
                 'note': 'No admite todos los filtros WDC en origen; idioma y modalidad se comprueban al importar.'},
    'ats-teamtailor-producthackers': {'name': 'ProductHackers · Teamtailor'},
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
]

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
    catalog = [{k: r.get(k) for k in FIELDS} for r in rows if r.get('code') not in CLOUD_RETIRED]
    by_code = {row['code']: row for row in catalog}
    for code, facts in CLOUD_OPERATIONAL.items():
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
