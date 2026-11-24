"""Recolector del feed público XML de Workable -> /api/ingest del panel (borradores).

Workable publica UN XML con las ofertas de todos sus clientes (se reconstruye cada hora; documentado para bolsas de empleo en
https://help.workable.com/hc/en-us/articles/4420464031767). No hace falta lista de empresas. El feed pesa cientos de MB (gzip), así
que se descarga UNA vez a disco y se lee en streaming (`iterparse`); un segundo intento dentro de la hora devuelve HTTP 429.

Formato del feed (*inspected* en el código del agregador de referencia, no contra el feed real: workable.com está bloqueado desde el
entorno de desarrollo): <source><job> con title, company, date, referencenumber, url, city, state, country (ISO), remote. NO trae descripción.

Qué hace: se queda solo con los puestos de closer/setter/cold caller/SDR (vocabulario canónico de `apps/api/career/vocabulary.py`) en
mercados ES/LatAm, o en otros países si el título está en español; un registro por URL (el feed repite la oferta por ubicación).
Como el feed no trae descripción, cada candidato conservado se enriquece con la API pública de la ficha (best-effort, tope MAX_ENRICH);
si falla se envía SIN descripción y el panel lo descartará con su motivo, nunca se inventa. No guarda correos ni teléfonos.
La URL de la oferta se envía intacta (Workable la usa para atribuir candidatos). Si el feed se corta se declara `truncated` y no se envía nada parcial.

Uso (.github/workflows/workable-collect.yml):
  INGEST_URL=... INGEST_TOKEN=... python scripts/workable_collect.py [--dry-run] [--file feed.xml.gz]
"""
import argparse
import gzip
import html
import json
import os
import re
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'apps' / 'api'))
from career.vocabulary import ROLE_FAMILIES, fold  # noqa: E402

FEED_URL = 'https://www.workable.com/boards/workable.xml'
SOURCE = 'workable'
FAMILIES = ('closer', 'setter', 'cold_caller', 'sdr')
MARKETS = {'ES', 'MX', 'CO', 'AR', 'CL', 'PE', 'UY', 'EC', 'VE', 'CR', 'PA', 'DO', 'GT', 'BO', 'PY', 'SV', 'HN', 'NI', 'PR'}
SPANISH_HINT = re.compile(r'\b(ventas?|asesor[a]?|comerciales?|cerrador[a]?|agendador[a]?|televenta|captador[a]?|ejecutiv[oa]|representante|consultor[a]?)\b')
BATCH = 100
MAX_ENRICH = 60
MAX_DESCRIPTION = 6000
PAUSE_SECONDS = 1.0
TIMEOUT = (30, 300)


def _role_pattern():
    terms = sorted({fold(t) for fam in FAMILIES for t in ROLE_FAMILIES[fam]}, key=len, reverse=True)
    return re.compile(r'(?<![a-z0-9])(?:' + '|'.join(re.escape(t) for t in terms) + r')(?![a-z0-9])')


ROLE = _role_pattern()
EMAIL = re.compile(r'[\w.+-]+@[\w-]+(?:\.[\w-]+)+')
PHONE = re.compile(r'(?<!\w)\+?\d[\d ()./-]{7,}\d')
TAG = re.compile(r'<[^>]+>')


def role_match(title):
    return bool(ROLE.search(fold(title)))


def market_ok(country, title):
    return country.upper() in MARKETS or bool(SPANISH_HINT.search(fold(title)))


def parse_date(text):
    try:
        dt = parsedate_to_datetime(text) if text else None
    except (TypeError, ValueError):
        return None
    return dt.isoformat().replace('+00:00', 'Z') if dt else None


def scrub(text):
    """HTML -> texto plano, sin correos ni teléfonos, acotado."""
    plain = html.unescape(TAG.sub(' ', text or ''))
    plain = PHONE.sub('[teléfono]', EMAIL.sub('[correo]', plain))
    return re.sub(r'\s+', ' ', plain).strip()[:MAX_DESCRIPTION] or None


def parse_feed(stream):
    """Lee el XML en streaming y devuelve (candidatos, estadísticas). Lanza ET.ParseError si el documento está cortado:
    nunca se devuelve un feed parcial."""
    by_url, root, seen = {}, None, 0
    for event, elem in ET.iterparse(stream, events=('start', 'end')):
        if event == 'start':
            if root is None:
                if elem.tag != 'source':
                    raise ET.ParseError(f'raíz inesperada <{elem.tag}>')
                root = elem
            continue
        if elem.tag != 'job':
            continue
        f = {child.tag: (child.text or '').strip() for child in elem}
        elem.clear()
        root.remove(elem)
        seen += 1
        url, title, company = f.get('url', ''), f.get('title', ''), f.get('company', '')
        if not url.startswith('https://') or not title or not company or not role_match(title) or not market_ok(f.get('country', ''), title):
            continue
        row = by_url.setdefault(url, {'rows': []})
        row['rows'].append(f)
    candidates = []
    for url, entry in by_url.items():
        rows = sorted(entry['rows'], key=lambda r: parse_date(r.get('date')) or '9999')
        first = rows[0]
        places = []
        for r in rows:
            place = ', '.join(p for p in (r.get('city'), r.get('state'), r.get('country', '').upper()) if p)
            if place and place not in places:
                places.append(place)
        remote = any(r.get('remote', '').lower() == 'true' for r in rows)
        candidates.append({
            'external_id': first.get('referencenumber') or url, 'title': first['title'], 'company': first['company'],
            'location': ('Remoto, ' if remote else '') + ('; '.join(places[:3]) or '') or None,
            'url': url, 'salary': None, 'posted_at': parse_date(first.get('date')), 'description': None,
            'raw': {'site': 'workable', 'is_remote': remote, 'country': first.get('country', '').upper(), 'provider': 'workable_feed'},
        })
    return candidates, {'jobs_in_feed': seen, 'kept': len(candidates)}


def detail_url(url):
    """https://apply.workable.com/<cuenta>/j/<CÓDIGO>/ -> API pública de la ficha. Contrato NO verificado contra el servicio real."""
    parts = urllib.parse.urlparse(url)
    m = re.match(r'^/([^/]+)/j/([A-Za-z0-9]+)/?', parts.path)
    if parts.netloc != 'apply.workable.com' or not m:
        return None
    return f'https://apply.workable.com/api/v2/accounts/{m.group(1)}/jobs/{m.group(2)}'


def fetch_detail(url):
    request = urllib.request.Request(url, headers={'Accept': 'application/json', 'User-Agent': 'WDC-workable/1.0'})
    with urllib.request.urlopen(request, timeout=20) as response:  # noqa: S310 - host fijado por detail_url
        return json.loads(response.read())


def enrich(candidates, fetch=fetch_detail, sleep=time.sleep, pause=PAUSE_SECONDS, limit=MAX_ENRICH):
    """Añade la descripción a los primeros `limit` candidatos. Devuelve (hechos, fallos, sin_tope): lo que no se enriquece sale sin descripción."""
    done, failed = 0, []
    for candidate in candidates[:limit]:
        api = detail_url(candidate['url'])
        if not api:
            failed.append(f"{candidate['url']}: URL sin patrón conocido")
            continue
        try:
            data = fetch(api)
            text = scrub(' '.join(str(data.get(k) or '') for k in ('description', 'requirements', 'benefits')))
            if text:
                candidate['description'] = text
                done += 1
            else:
                failed.append(f'{api}: sin texto en la respuesta')
        except Exception as error:  # noqa: BLE001 - cada ficha falla a su manera
            failed.append(f'{api}: {type(error).__name__}')
        sleep(pause)
    return done, failed, max(0, len(candidates) - limit)


def download(url=FEED_URL):
    """Descarga a un fichero temporal (no se lee del socket mientras se parsea). Devuelve el fichero abierto, o lanza con el motivo."""
    handle = tempfile.TemporaryFile()
    request = urllib.request.Request(url, headers={'User-Agent': 'WDC-workable/1.0', 'Accept-Encoding': 'gzip'})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT[1]) as response:  # noqa: S310 - URL fija
            while chunk := response.read(1 << 20):
                handle.write(chunk)
    except Exception:
        handle.close()
        raise
    handle.seek(0)
    return handle


def open_feed(handle):
    head = handle.read(2)
    handle.seek(0)
    return gzip.GzipFile(fileobj=handle) if head == b'\x1f\x8b' else handle


def run(handle, dry_run, post=None, enrich_fn=enrich):
    """Parsea, enriquece y envía. Devuelve el informe; un feed cortado no envía nada y se declara."""
    report = {'truncated': False}
    try:
        candidates, stats = parse_feed(open_feed(handle))
    except (ET.ParseError, EOFError, OSError) as error:
        report.update(truncated=True, error=f'feed cortado o no válido: {type(error).__name__}: {error}'[:200])
        return report
    report.update(stats)
    done, failed, skipped = enrich_fn(candidates)
    report.update(enriched=done, enrich_failed=len(failed), enrich_skipped=skipped, enrich_errors=failed[:5])
    note = f"feed Workable: {stats['jobs_in_feed']} puestos, {stats['kept']} de rol; descripción {done}/{len(candidates)} (resto sin descripción, ficha sin verificar)"[:300]
    if post and not dry_run:
        for i in range(0, len(candidates), BATCH):
            post(candidates[i:i + BATCH], note)
    return report


def post_ingest(url, token, candidates, note):
    body = json.dumps({'source': SOURCE, 'via': 'workable', 'candidates': candidates, 'note': note}).encode()
    request = urllib.request.Request(url, data=body, method='POST', headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {token}'})
    with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310 - URL fijada por el operador
        return json.loads(response.read())


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--file', help='feed local (xml o xml.gz) en lugar de descargarlo')
    args = parser.parse_args(argv)
    url, token = os.environ.get('INGEST_URL'), os.environ.get('INGEST_TOKEN')
    if not args.dry_run and not (url and token):
        sys.exit('Faltan INGEST_URL e INGEST_TOKEN (secretos del repositorio).')
    try:
        handle = open(args.file, 'rb') if args.file else download()
    except Exception as error:  # noqa: BLE001 - 429, red, bloqueo: se declara, no se oculta
        print(json.dumps({'truncated': True, 'error': f'descarga fallida: {type(error).__name__}: {error}'[:200]}, ensure_ascii=False))
        return 1
    with handle:
        report = run(handle, args.dry_run, post=lambda items, note: print(' ->', post_ingest(url, token, items, note), flush=True))
    print(json.dumps(report, ensure_ascii=False), flush=True)
    return 1 if report.get('truncated') else 0


if __name__ == '__main__':
    sys.exit(main())
