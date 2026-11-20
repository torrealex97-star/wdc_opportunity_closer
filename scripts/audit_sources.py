"""Read public Apify metadata only; never launch actors or read credentials.

Además audita los slugs JobToday contra el sitio real: detecta renombrados
(redirects 301/308) y rutas muertas antes de que rompan la recogida diaria.
"""
import asyncio
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
import httpx
from career.connectors import REGISTRY, JobToday
from career.sources import CATALOG
from career.source_strategy import actor_matches

QUERIES = {'laborum': 'bumeran', 'europe-language': 'europe language jobs',
           'linkedin-posts': 'linkedin posts', 'facebook': 'facebook posts',
           'company': 'greenhouse jobs', 'custom': 'structured jobs'}

# Barrido de repuesto (2026-11-20) para las fuentes que seguían sin buscador verificado: varias consultas por
# fuente, porque la tienda es difusa y una sola búsqueda por nombre se queda corta. Solo se leen metadatos
# públicos: aquí no se lanza ningún actor ni se gasta crédito.
SWEEP = {
    'trabajos': ['trabajos com bolsa de empleo'],
    'weremoto': ['weremoto remote jobs', 'we remote jobs latam', 'we remoto', 'trabajos remotos latam'],
    'remotoco': ['remoto co empleos latam', 'remoto.co jobs', 'remoto co', 'empleos remotos colombia'],
    'malt': ['malt job offers', 'malt missions freelance', 'malt freelance', 'malt missions spain'],
    'europe-language': ['europe language jobs scraper', 'european language jobs spain', 'europelanguagejobs'],
    'jobsqd': ['jobsqd jobs', 'jobsqd.com', 'jobsqd'],
    'tecnoempleo': ['tecnoempleo empleo informatica'],
    'talent': ['talent jobs scraper spain'],
    'milanuncios': ['milanuncios ofertas de empleo'],
    'primer-empleo': ['primer empleo ofertas', 'primerempleo.com', 'primerempleo', 'empleo jovenes espana'],
    'jobfluent': ['jobfluent jobs', 'jobfluent.com', 'jobfluent', 'job fluent'],
    'welcomejungle': ['wttj jobs spain'],
    'closers-avenue': ['closersavenue.com', 'closers avenue jobs', 'closers avenue', 'closersavenue', 'sales closer'],
    'google': ['serpapi google jobs'],
    'remotolist': ['remotolist.com empleo remoto', 'remotolist', 'remote list jobs'],
    'domestika': ['domestika empleo', 'domestika jobs'],
    'occ-mundial': ['occ mundial empleos'],
    'chiletrabajos': ['chiletrabajos ofertas'],
    'portal-empleo-mx': ['portal del empleo mexico ofertas', 'empleo.gob.mx', 'portal del empleo', 'empleo gob mx', 'vacantes gobierno mexico'],
}
STORE_LIMIT = 10     # antes 3: el barrido mira más resultados por consulta
MAX_CANDIDATES = 4    # igual que MAX_RECIPES del exportador: más intentos no caben en una búsqueda diaria
DISCARDED_KEEP = 40  # actores revisados que se descartan, guardados como prueba de por qué no entran

async def audit_jobtoday_slugs(client):
    """Check periódico de los slugs JobToday del REGISTRY: el destino real de cada
    ruta (redirect o 200) queda registrado como evidencia; un renombrado se detecta
    aquí antes de que la recogida falle. Nunca reescribe slugs: solo informa."""
    semaphore = asyncio.Semaphore(2)

    async def check(connector):
        async with semaphore:
            record = {'checked_at': datetime.now(timezone.utc).isoformat(), 'url': connector.url,
                      'status': 'ok', 'canonical_url': connector.url, 'http_status': None}
            try:
                response = await client.get(connector.url, follow_redirects=False,
                                            headers={'User-Agent': connector.BROWSER_UA})
                record['http_status'] = response.status_code
                if response.status_code in {301, 302, 303, 307, 308}:
                    location = response.headers.get('location', '').strip()
                    record['status'] = 'renamed'
                    record['canonical_url'] = str(response.url.join(location)) if location else connector.url
                    record['renamed_from'] = connector.url
                elif response.status_code == 410:
                    record['status'] = 'gone'
                elif response.status_code != 200:
                    record['status'] = 'unavailable'
            except httpx.HTTPError:
                record['status'] = 'unreachable'
            print(connector.code, record['status'], record['canonical_url'], flush=True)
            return connector.code, record

    return {'checked_at': datetime.now(timezone.utc).isoformat(),
            'slugs': dict(await asyncio.gather(*(check(c) for c in REGISTRY.values() if isinstance(c, JobToday))))}

async def main(only=None):
    semaphore = asyncio.Semaphore(3)
    async with httpx.AsyncClient(timeout=25) as client:
        async def get(path, params=None):
            async with semaphore:
                response = await client.get('https://api.apify.com/v2/' + path, params=params)
                response.raise_for_status()
                return response.json()['data']
        async def audit(row):
            code, name, _, _, link, _ = row
            record = {'checked_at': datetime.now(timezone.utc).isoformat(), 'candidates': [], 'status': 'not_found'}
            try:
                base = QUERIES.get(code, name.split(' · ')[0].split(' / ')[0])
                queries = list(dict.fromkeys([base, *SWEEP.get(code, [])]))
                totals, actors = {}, []
                for query in queries:
                    try:
                        store = await get('store', {'search': query, 'limit': STORE_LIMIT})
                    except httpx.HTTPError:
                        totals[query] = None  # consulta caída: se anota, no se finge un vacío
                        continue
                    totals[query] = store.get('total')
                    actors += [f"{x['username']}/{x['name']}" for x in store.get('items', []) if x.get('username') and x.get('name')]
                actors = list(dict.fromkeys(actors))
                if code == 'facebook':
                    actors.insert(0, 'apify/facebook-groups-scraper')
                if code == 'torre':
                    actors.insert(0, 'scrapers_lat/torre-scraper')
                if link.startswith('https://apify.com/') and '/store' not in link:
                    actors.insert(0, link.removeprefix('https://apify.com/'))
                matched = [a for a in actors if actor_matches(code, a)]
                # Evidencia del barrido: qué se buscó, cuánto devolvió cada consulta y qué actores se descartaron
                # (queda escrito para que «no hay buscador» se pueda comprobar, no solo creer).
                record['sweep'] = {'queries': queries, 'totals': totals, 'reviewed': len(actors),
                                   'discarded': [a for a in actors if a not in set(matched)][:DISCARDED_KEEP]}
                for actor in matched[:MAX_CANDIDATES]:
                    try:
                        metadata, build = await asyncio.gather(get('acts/' + actor.replace('/', '~')), get('acts/' + actor.replace('/', '~') + '/builds/default'))
                        if metadata.get('isDeprecated') or build.get('status') != 'SUCCEEDED':
                            continue
                        schema = build.get('inputSchema') or build.get('actorDefinition', {}).get('input', {})
                        schema = json.loads(schema) if isinstance(schema, str) else schema
                        props = schema.get('properties', {})
                        # Metadata evidence, not a guarantee of extraction quality.
                        record['candidates'].append({'actor': actor, 'title': metadata.get('title', actor),
                            'url': 'https://apify.com/' + actor, 'build': build.get('buildNumber'),
                            'fields': list(props), 'required': schema.get('required', []),
                            'pricing_models': sorted({p.get('pricingModel', 'UNKNOWN') for p in metadata.get('pricingInfos', [])})})
                    except (httpx.HTTPError, ValueError, KeyError, TypeError):
                        continue
                record['status'] = 'metadata_checked' if record['candidates'] else 'not_found'
            except (httpx.HTTPError, ValueError, KeyError, TypeError):
                record['status'] = 'lookup_failed'
            print(code, record['status'], [x['actor'] for x in record['candidates']], flush=True)
            return code, record
        rows = [row for row in CATALOG if not only or row[0] in only]
        results = dict(await asyncio.gather(*(audit(row) for row in rows)))
        jobtoday = await audit_jobtoday_slugs(client) if not only else None
    path = Path('apps/api/career/source_audit.json')
    report = json.loads(path.read_text()) if only and path.exists() else {}
    report.setdefault('apify', {}).update(results)
    if jobtoday is not None:
        report['jobtoday_slugs'] = jobtoday
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2, default=str) + '\n')
    write_launchd_alert(report)


def slug_alerts(report):
    """Alertas por slug JobToday en estado renamed o gone (los demás estados
    son fallos transitorios de red, no requieren acción del operador)."""
    slugs = report.get('jobtoday_slugs', {}).get('slugs', {})
    return [
        {'code': code, 'status': record['status'], 'url': record.get('url'),
         'canonical_url': record.get('canonical_url'),
         'renamed_from': record.get('renamed_from'),
         'http_status': record.get('http_status'), 'checked_at': record.get('checked_at')}
        for code, record in slugs.items() if record['status'] in {'renamed', 'gone'}]


def write_launchd_alert(report, alert_dir='.local'):
    """Alerta para la tarea programada: persiste .local/source_audit_alert.json
    (estado para que el operador lo consulte sin abrir logs)."""
    alerts = slug_alerts(report)
    payload = {'has_alerts': bool(alerts), 'checked_at': report.get('jobtoday_slugs', {}).get('checked_at'), 'alerts': alerts}
    path = Path(alert_dir)
    path.mkdir(parents=True, exist_ok=True)
    (path / 'source_audit_alert.json').write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n')
    log_alert(payload)
    return payload


def log_alert(payload, stream=None):
    """Imprime el resultado y, si hay renamed/gone, emite una notificación macOS."""
    stream = stream or sys.stderr
    if not payload['has_alerts']:
        print('SLUG AUDIT OK: no renamed/gone', flush=True)
        return
    lines = [f"{a['code']}: {a['status']} -> {a.get('canonical_url')} (desde {a.get('renamed_from') or a.get('url')}, HTTP {a.get('http_status')})" for a in payload['alerts']]
    message = 'JobToday slug audit: ' + ' | '.join(lines)
    print(message, flush=True, file=stream)
    # Notificación de escritorio: el operador la vea sin abrir logs ni la UI.
    # Solo existe en macOS: en otros sistemas (CI, Linux) el aviso queda en el log, sin romper el audit.
    try:
        subprocess.run(['/usr/bin/osascript', '-e',
                        f'display notification "{message}" with title "WDC slug audit" sound name "Sosumi"'],
                       check=False, capture_output=True)
    except OSError:
        pass


# Solo al ejecutarlo (`python -m scripts.audit_sources`). Antes corría también al IMPORTARLO —y los tests
# importan `slug_alerts`/`write_launchd_alert`—, así que cada pasada de la suite lanzaba el audit real por
# red, reescribía `source_audit.json` a mitad de las pruebas y dejaba desfasado lo exportado desde él.
if __name__ == '__main__':
    # `--only trabajos,tecnoempleo` relee solo esas fuentes y conserva el resto del informe: es el modo de un
    # barrido de repuesto, para no reescribir la evidencia de las demás.
    only = {c for arg in sys.argv[1:] if not arg.startswith('-') for c in arg.split(',')}
    asyncio.run(main(only or None))
