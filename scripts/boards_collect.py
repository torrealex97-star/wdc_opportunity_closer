"""Colector directo de tableros de empresas (ATS públicos) -> /api/ingest del panel (borradores).

Lee, empresa a empresa, el tablero público de Greenhouse, Ashby, SmartRecruiters, Recruitee y Teamtailor (RSS) de una lista propia
(`scripts/boards_seed.json`), se queda con los puestos de closer/setter/cold caller/SDR (vocabulario canónico de `apps/api/career/vocabulary.py`)
en mercados ES/LatAm o en español, y los envía como borradores: una fuente por ATS (`ats-greenhouse`, `ats-ashby`, …) para que el Control de
fuentes mida cada una por separado. Nunca se inventa nada: sin descripción o salario publicados el campo va vacío, y el panel descarta con su motivo.

Estado honesto: los contratos de cada API son los DOCUMENTADOS por cada ATS y NO se han verificado contra el servicio real (desde el entorno
de desarrollo esos hosts están bloqueados). La primera ejecución real se hace con `--dry-run` en Actions; lo que no cuadre queda en el informe
por tablero (`errors`), nunca oculto. Un tablero caído no detiene a los demás; si TODOS fallan, el informe lo declara y el proceso sale con 1.
Si el reloj se acaba se declara `truncated` y lo no leído se cuenta en `boards_skipped` (la siguiente ejecución lo repite; todo es idempotente).

Uso (.github/workflows/boards-collect.yml):
  INGEST_URL=... INGEST_TOKEN=... python scripts/boards_collect.py [--dry-run] [--only greenhouse] [--limit 20]
"""
import argparse
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from workable_collect import MARKETS, SPANISH_HINT, TAG, role_match, scrub  # noqa: E402
from career.vocabulary import fold  # noqa: E402,F401 - (workable_collect ya añade apps/api al path)

SEED = Path(__file__).resolve().parent / 'boards_seed.json'
BATCH = 100
WORKERS = 6
DEADLINE_SECONDS = 20 * 60
TIMEOUT = 25
PLACES = re.compile(r'\b(espana|spain|madrid|barcelona|valencia|sevilla|seville|bilbao|malaga|zaragoza|mexico|cdmx|colombia|bogota|medellin|argentina|buenos aires|chile|santiago de chile|peru|lima|uruguay|montevideo|ecuador|venezuela|costa rica|panama|republica dominicana|dominican republic|guatemala|bolivia|paraguay|el salvador|honduras|nicaragua|puerto rico|latam|latin america|latinoamerica|hispanoamerica|spanish[- ]speaking)\b')
ES_WORDS = frozenset('de la el en para con los las una un del por que ventas equipo experiencia cliente clientes trabajo puesto empresa oferta buscamos formacion comision'.split())
EN_WORDS = frozenset('the and for with you your our will team experience work role join are is of to in a'.split())
MAX_DESCRIPTION = 6000


class FetchError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def iso(text):
    """Fecha ISO 8601 (o RFC 2822) -> ISO UTC con Z; `None` si no se entiende (no se inventa)."""
    if not text:
        return None
    text = str(text).strip()
    try:
        dt = datetime.fromisoformat(text.replace('Z', '+00:00').replace(' UTC', '+00:00'))
    except ValueError:
        try:
            dt = parsedate_to_datetime(text)
        except (TypeError, ValueError):
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace('+00:00', 'Z')


def plain(text):
    """HTML (también el escapado de Greenhouse) -> texto sin correos ni teléfonos, acotado."""
    text = html.unescape(str(text or ''))
    return scrub(text if TAG.search(text) else f'<p>{text}</p>')


def spanish(text):
    words = re.findall(r'[a-záéíóúñ]+', fold(text or '').replace('n~', 'ñ'))
    es, en = sum(w in ES_WORDS for w in words), sum(w in EN_WORDS for w in words)
    return es >= 4 and es > en


def market_ok(country, title, location, description):
    return (str(country or '').upper() in MARKETS or bool(SPANISH_HINT.search(fold(title))) or bool(PLACES.search(fold(location or '')))
            or spanish(description))


def make(ats, slug, board_name, job_id, title, url, location, country, remote, posted, description, salary=None):
    """Candidato en el formato de /api/ingest, o `None` si no cumple (https, título, rol y mercado)."""
    url, title = str(url or ''), str(title or '').strip()
    if not url.startswith('https://') or not title or not role_match(title):
        return None
    description = plain(description)
    if not market_ok(country, title, location, description):
        return None
    where = ', '.join(p for p in (str(location or '').strip(),) if p)
    return {'external_id': f'{ats}:{slug}:{job_id}', 'title': title, 'company': board_name, 'location': ('Remoto, ' if remote and 'remot' not in where.lower() else '') + where or None,
            'url': url, 'salary': salary or None, 'posted_at': iso(posted), 'description': description,
            'raw': {'site': ats, 'ats': ats, 'board': slug, 'is_remote': bool(remote), 'country': str(country or '').upper() or None, 'provider': 'boards_collect'}}


def _clean(items):
    return [c for c in items if c]


def parse_greenhouse(data, slug, name):
    out = []
    for j in (data or {}).get('jobs') or []:
        loc = (j.get('location') or {}).get('name')
        out.append(make('greenhouse', slug, name, j.get('id'), j.get('title'), j.get('absolute_url'), loc, None, bool(loc and 'remote' in loc.lower()), j.get('first_published') or j.get('updated_at'), j.get('content')))
    return _clean(out)


def parse_ashby(data, slug, name):
    out = []
    for j in (data or {}).get('jobs') or []:
        if j.get('isListed') is False:
            continue
        country = ((j.get('address') or {}).get('postalAddress') or {}).get('addressCountry')
        comp = ((j.get('compensation') or {}).get('compensationTierSummary')) or None
        out.append(make('ashby', slug, name, j.get('id'), j.get('title'), j.get('jobUrl'), j.get('location'), country, j.get('isRemote'), j.get('publishedAt'), j.get('descriptionPlain') or j.get('descriptionHtml'), comp))
    return _clean(out)


def parse_smartrecruiters(data, slug, name):
    out = []
    for j in (data or {}).get('content') or []:
        loc = j.get('location') or {}
        place = ', '.join(p for p in (loc.get('city'), loc.get('region')) if p)
        out.append(make('smartrecruiters', slug, ((j.get('company') or {}).get('name')) or name, j.get('id'), j.get('name'), f"https://jobs.smartrecruiters.com/{slug}/{j.get('id')}", place, loc.get('country'), loc.get('remote'), j.get('releasedDate'), None))
    return _clean(out)


def parse_recruitee(data, slug, name):
    out = []
    for j in (data or {}).get('offers') or []:
        out.append(make('recruitee', slug, name, j.get('id'), j.get('title'), j.get('careers_url'), j.get('location'), j.get('country_code'), j.get('remote'), j.get('published_at') or j.get('created_at'), f"{j.get('description') or ''} {j.get('requirements') or ''}"))
    return _clean(out)


def parse_teamtailor(text, slug, name):
    """RSS `https://<host>/jobs.rss`. La ubicación sale de los elementos `locations/location/{city,country}` si existen; si no, queda vacía."""
    root = ET.fromstring(text)
    out = []
    for item in root.iter('item'):
        def tag(el, suffix):
            return next(((c.text or '').strip() for c in el.iter() if c.tag.split('}')[-1] == suffix and (c.text or '').strip()), '')
        link = tag(item, 'link')
        job_id = (re.search(r'/jobs/(\d+)', link) or [None, link])[1]
        place = ', '.join(p for p in (tag(item, 'city'), tag(item, 'country')) if p)
        out.append(make('teamtailor', slug, name, job_id, tag(item, 'title'), link, place, None, 'remot' in fold(tag(item, 'title')), tag(item, 'pubDate'), tag(item, 'description')))
    return _clean(out)


ADAPTERS = {
    'greenhouse': (lambda s: f'https://boards-api.greenhouse.io/v1/boards/{s}/jobs?content=true', parse_greenhouse),
    'ashby': (lambda s: f'https://api.ashbyhq.com/posting-api/job-board/{s}?includeCompensation=true', parse_ashby),
    'smartrecruiters': (lambda s: f'https://api.smartrecruiters.com/v1/companies/{s}/postings?limit=100', parse_smartrecruiters),
    'recruitee': (lambda s: f'https://{s}.recruitee.com/api/offers/', parse_recruitee),
    'teamtailor': (lambda s: f'https://{s}.teamtailor.com/jobs.rss', parse_teamtailor),
}


def fetch_default(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'WDC-boards/1.0', 'Accept': 'application/json, application/rss+xml, */*'})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:  # noqa: S310 - hosts fijados por ADAPTERS
            body = response.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as error:
        raise FetchError(error.code, f'HTTP {error.code}') from error
    except Exception as error:  # noqa: BLE001 - red, DNS, TLS, tiempo: cada tablero falla a su manera
        raise FetchError(None, f'{type(error).__name__}: {error}'[:120]) from error
    return body if url.endswith('.rss') else json.loads(body)


def enrich_smartrecruiters(candidates, slug, fetch, limit=25):
    """El listado de SmartRecruiters no trae descripción: se pide la ficha de los primeros `limit` (best-effort; sin ella el panel descarta con su motivo)."""
    for c in candidates[:limit]:
        try:
            data = fetch(f"https://api.smartrecruiters.com/v1/companies/{slug}/postings/{c['external_id'].rsplit(':', 1)[-1]}")
            sections = ((data or {}).get('jobAd') or {}).get('sections') or {}
            text = plain(' '.join(str((sections.get(k) or {}).get('text') or '') for k in ('companyDescription', 'jobDescription', 'qualifications', 'additionalInformation')))
            c['description'] = text or c['description']
            comp = (data or {}).get('compensation')
            if comp and comp.get('min') and comp.get('max') and not c.get('salary'):
                c['salary'] = f"{comp['min']}–{comp['max']} {comp.get('currency') or ''}".strip()
        except Exception:  # noqa: BLE001 - la ficha falla a su manera; no se inventa
            continue


def collect(boards, fetch=fetch_default, workers=WORKERS, deadline=DEADLINE_SECONDS):
    """Lee cada tablero (en paralelo) y devuelve (informe, {fuente: [candidatos]}). Un tablero caído se informa y no detiene a los demás."""
    end = time.monotonic() + deadline
    errors, per_board, by_source, skipped = [], [], {}, 0

    def one(board):
        if time.monotonic() >= end:
            return board, 'skipped', None, None
        build, parse = ADAPTERS[board['ats']]
        try:
            data = fetch(build(board['slug']))
            found = parse(data, board['slug'], board.get('name') or board['slug'])
            if board['ats'] == 'smartrecruiters':
                enrich_smartrecruiters(found, board['slug'], fetch)
            return board, 'ok', found, None
        except FetchError as error:
            return board, 'error', None, f'{error}'
        except Exception as error:  # noqa: BLE001 - un contrato que no cuadra se declara con su tipo, no se traga
            return board, 'error', None, f'respuesta no válida ({type(error).__name__})'

    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        for board, status, found, error in pool.map(one, boards):
            if status == 'skipped':
                skipped += 1
            elif status == 'error':
                errors.append({'ats': board['ats'], 'slug': board['slug'], 'error': error})
            else:
                per_board.append({'ats': board['ats'], 'slug': board['slug'], 'kept': len(found)})
                seen = {c['url'] for c in by_source.get(f"ats-{board['ats']}", [])}
                for c in found:
                    if c['url'] not in seen:
                        by_source.setdefault(f"ats-{board['ats']}", []).append(c)
                        seen.add(c['url'])
    report = {'boards_total': len(boards), 'boards_ok': len(per_board), 'boards_failed': len(errors), 'boards_skipped': skipped, 'truncated': skipped > 0,
              'all_failed': bool(boards) and not per_board and skipped == 0, 'kept_by_source': {k: len(v) for k, v in by_source.items()}, 'errors': errors[:25],
              'boards_with_roles': [b for b in per_board if b['kept']][:40]}
    return report, by_source


def send(by_source, post, report):
    """Envía por fuente en lotes. Un envío fallido se informa y no impide los demás."""
    sent, failed = 0, []
    for source, items in by_source.items():
        note = f"tableros de empresas ({source[4:]}): {len(items)} de rol; {report.get('boards_ok')} tableros leídos, {report.get('boards_failed', 0)} con error"[:300]
        for i in range(0, len(items), BATCH):
            try:
                post(source, items[i:i + BATCH], note)
                sent += len(items[i:i + BATCH])
            except Exception as error:  # noqa: BLE001 - se informa, no se traga
                failed.append({'source': source, 'error': f'{type(error).__name__}: {error}'[:120]})
                break
    return {'sent': sent, 'send_failed': failed}


def post_ingest(url, token, source, candidates, note):
    body = json.dumps({'source': source, 'via': 'boards-collect', 'candidates': candidates, 'note': note}).encode()
    request = urllib.request.Request(url, data=body, method='POST', headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {token}'})
    with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310 - URL fijada por el operador
        return json.loads(response.read())


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--dry-run', action='store_true')
    parser.add_argument('--only', choices=sorted(ADAPTERS), help='solo un ATS')
    parser.add_argument('--limit', type=int, help='solo los primeros N tableros (primera prueba)')
    parser.add_argument('--seed', default=str(SEED))
    args = parser.parse_args(argv)
    url, token = os.environ.get('INGEST_URL'), os.environ.get('INGEST_TOKEN')
    if not args.dry_run and not (url and token):
        sys.exit('Faltan INGEST_URL e INGEST_TOKEN (secretos del repositorio).')
    boards = [b for b in json.loads(Path(args.seed).read_text(encoding='utf-8'))['boards'] if not args.only or b['ats'] == args.only]
    boards = boards[:args.limit] if args.limit else boards
    report, by_source = collect(boards)
    if args.dry_run:
        for source, items in by_source.items():
            print(f'[{source}] {len(items)}', *[f"  - {c['company']}: {c['title']} ({c['location']}) desc={'sí' if c['description'] else 'NO'}" for c in items[:15]], sep='\n', flush=True)
    else:
        report.update(send(by_source, lambda source, items, note: print(' ->', source, post_ingest(url, token, source, items, note), flush=True), report))
    print(json.dumps(report, ensure_ascii=False), flush=True)
    return 1 if report['all_failed'] or report.get('send_failed') else 0


if __name__ == '__main__':
    sys.exit(main())
