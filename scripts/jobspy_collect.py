"""Recolector programado de ofertas en España con JobSpy (open source, MIT) -> /api/ingest del panel.

Qué hace: busca ofertas de closer/setter/comercial en Indeed, LinkedIn, Glassdoor y Google Jobs con volumen bajo y pausas,
y envía los candidatos como BORRADORES. Una alumna solo ve lo que un operador apruebe en el panel.
Decisión de riesgo: estas webs prohíben el scraping en sus condiciones de uso; el operador lo asume (ADR-011).
No guarda datos de contacto: se descartan los correos que JobSpy encuentra y se limpian teléfonos del texto.

Uso (lo lanza .github/workflows/jobspy-collect.yml):
  INGEST_URL=https://app.../api/ingest INGEST_TOKEN=... python scripts/jobspy_collect.py [--dry-run] [--sites indeed,linkedin,glassdoor,google]
"""
import argparse
import json
import math
import os
import sys
import time
import urllib.request

QUERIES = ['closer de ventas', 'closer high ticket', 'setter de ventas', 'televenta', 'asesor comercial', 'ejecutivo comercial', 'cold caller']
SITES = ('indeed', 'linkedin', 'glassdoor', 'google')   # el código de la fuente en el panel coincide con el nombre del sitio
RESULTS_WANTED = 20
HOURS_OLD = 240           # 10 días: la ventana del catálogo
PAUSE_SECONDS = 10        # pausa entre búsquedas para no castigar a los sitios
BATCH = 100
LOCATIONS = {'indeed': 'España', 'linkedin': 'Spain', 'glassdoor': 'España', 'google': 'España'}   # LinkedIn resuelve mejor el nombre en inglés


def clean(value):
    """NaN/None/'' de pandas -> None; el resto como cadena sin espacios sobrantes."""
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return None
    text = str(value).strip()
    return text or None


def salary(row):
    low, high, cur, interval = (clean(row.get(k)) for k in ('min_amount', 'max_amount', 'currency', 'interval'))
    if not (low or high):
        return None
    fmt = lambda v: f'{float(v):,.0f}'.replace(',', '.')  # noqa: E731
    amount = f'{fmt(low)}–{fmt(high)}' if low and high else fmt(low or high)
    unit = {'yearly': 'año', 'monthly': 'mes', 'weekly': 'semana', 'daily': 'día', 'hourly': 'hora'}.get(interval or '', interval)
    return ' '.join(p for p in (amount, cur or '€', f'/ {unit}' if unit else None) if p)


def map_row(row, site):
    """Fila de JobSpy -> candidato del contrato de /api/ingest. Sin correos ni contactos."""
    url = clean(row.get('job_url_direct')) or clean(row.get('job_url'))
    title = clean(row.get('title'))
    external_id = clean(row.get('id')) or url
    if not (url and title and external_id) or not url.startswith(('http://', 'https://')):
        return None
    return {
        'external_id': external_id, 'title': title, 'company': clean(row.get('company')), 'location': clean(row.get('location')),
        'url': url, 'salary': salary(row), 'posted_at': clean(row.get('date_posted')), 'description': clean(row.get('description')),
        'raw': {k: v for k, v in {'site': site, 'job_type': clean(row.get('job_type')), 'is_remote': row.get('is_remote') if isinstance(row.get('is_remote'), bool) else None,
                                  'job_level': clean(row.get('job_level')), 'listing_type': clean(row.get('listing_type'))}.items() if v is not None},
    }


def map_rows(rows, site):
    seen, out = set(), []
    for row in rows:
        candidate = map_row(row, site)
        if candidate and candidate['external_id'] not in seen:
            seen.add(candidate['external_id'])
            out.append(candidate)
    return out


def post(url, token, source, candidates, note=None):
    body = json.dumps({'source': source, 'via': 'jobspy', 'candidates': candidates, 'note': note}).encode()
    request = urllib.request.Request(url, data=body, method='POST', headers={'Content-Type': 'application/json', 'Authorization': f'Bearer {token}'})
    with urllib.request.urlopen(request, timeout=60) as response:  # noqa: S310 - URL fijada por el operador
        return json.loads(response.read())


def collect(sites, scrape, sleep=time.sleep, pause=PAUSE_SECONDS):
    """Una búsqueda por (sitio, consulta). Un fallo (p. ej. 429 de LinkedIn) no detiene el resto."""
    found, errors = {site: [] for site in sites}, []
    for site in sites:
        for query in QUERIES:
            try:
                result = scrape(site, query)
                rows, notes = result if isinstance(result, tuple) else (result, [])
                errors.extend(f'{site}/{query}: {note}' for note in notes)
                found[site].extend(map_rows(rows, site))
            except Exception as error:  # noqa: BLE001 - cada sitio falla a su manera
                errors.append(f'{site}/{query}: {type(error).__name__}')
            sleep(pause)
    # Las mismas ofertas salen en varias consultas: se quedan una vez por sitio.
    return {site: list({c['external_id']: c for c in items}.values()) for site, items in found.items()}, errors


def query_for(site, query):
    """Indeed busca también en la descripción y devuelve roles ajenos: la frase exacta entre comillas lo evita (FAQ de JobSpy)."""
    return f'"{query}"' if site == 'indeed' else query


def validate_proxies(raw, timeout=8.0, opener=None):
    """Valida la lista antes de lanzar nada: una petición por proxy, 200 y menos de 8 s.

    Devuelve (sanos, fallos) con la latencia medida y el motivo del fallo. Sin esta validación, un proxy
    muerto quema el runner y JobSpy parece «caído» cuando el problema es el proxy.
    """
    healthy, failed = [], []
    build = opener or (lambda proxy: urllib.request.build_opener(urllib.request.ProxyHandler({'http': proxy, 'https': proxy})))
    for proxy in raw:
        start = time.monotonic()
        try:
            request = urllib.request.Request('https://api.ipify.org?format=json', headers={'User-Agent': 'WDC-jobspy/1.0'})
            with build(proxy).open(request, timeout=timeout) as response:  # noqa: S310 - destino fijo
                elapsed = time.monotonic() - start
                if response.status == 200 and elapsed < 8:
                    healthy.append({'proxy': proxy, 'ms': round(elapsed * 1000)})
                else:
                    failed.append({'proxy': proxy, 'reason': f'HTTP {response.status} en {elapsed:.1f}s'})
        except Exception as error:  # noqa: BLE001 - cada proxy falla a su manera
            failed.append({'proxy': proxy, 'reason': f'{type(error).__name__}: {error}'[:160]})
    return healthy, failed


def build_kwargs(site, query, env=None, proxies=None):
    """Argumentos de scrape_jobs verificados contra la firma de JobSpy 1.3.0 (tests/test_jobspy_collect.py los comprueba)."""
    env = os.environ if env is None else env
    kwargs = dict(
        site_name=[site], search_term=query_for(site, query), results_wanted=RESULTS_WANTED, hours_old=HOURS_OLD,
        # OJO: el parámetro se llama country_indeed (JobSpy ignora los desconocidos y buscaría en EE. UU.). Aplica a Indeed y Glassdoor.
        country_indeed='Spain',
        location=LOCATIONS.get(site, 'España'),
        description_format='plain',    # sin Markdown ni HTML en el texto que verá el panel
        verbose=0,
    )
    if site == 'linkedin' and env.get('LINKEDIN_FETCH_DESCRIPTION', '1') != '0':
        # Sin descripción no se puede comprobar idioma ni perfil: cuesta una petición extra por oferta.
        kwargs['fetch_description'] = True
    if site == 'google':
        kwargs['google_search_term'] = f'{query} empleo en España en los últimos 10 días'
    if proxies is None:
        proxies = [p.strip() for p in env.get('JOBSPY_PROXIES', '').split(',') if p.strip()]
    if proxies:
        kwargs['proxies'] = [proxies] if isinstance(proxies, str) else proxies    # los runners de GitHub a veces son bloqueados
    return kwargs


def jobspy_scrape(site, query, proxies=None):
    from jobspy import scrape_jobs  # import tardío: solo hace falta al ejecutar el recolector
    frame = scrape_jobs(**build_kwargs(site, query, proxies=proxies))
    rows = frame.drop(columns=['emails', 'skills'], errors='ignore').to_dict('records')
    # JobSpy (>=1.3.0 en GitHub) informa de qué sitio falló o qué opción ignoró en frame.attrs: distingue «bloqueado» de «sin ofertas».
    attrs = getattr(frame, 'attrs', {}) or {}
    notes = [f'{name}: {message}' for name, message in (attrs.get('errors') or {}).items()]
    notes += [f'{name}: {w}' for name, ws in (attrs.get('warnings') or {}).items() for w in ws]
    return rows, notes


def _summary(report):
    """Resumen para el panel/workflow: qué proxy falló y por qué, sin un «falló» genérico."""
    path = os.environ.get('GITHUB_STEP_SUMMARY')
    text = f"JobSpy · modo {report.get('mode')}\n\n" + '\n'.join(
        [f"- OK {item['proxy']} ({item['ms']} ms)" for item in report.get('proxies_ok', [])] +
        [f"- FALLO {item['proxy']}: {item['reason']}" for item in report.get('proxies_failed', [])]) + '\n'
    if path:
        with open(path, 'a', encoding='utf-8') as handle:
            handle.write(text)
    print(text, flush=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--dry-run', action='store_true', help='busca y muestra, sin enviar')
    parser.add_argument('--sites', default=','.join(SITES))
    args = parser.parse_args(argv)
    sites = [s for s in args.sites.split(',') if s in SITES]
    url, token = os.environ.get('INGEST_URL'), os.environ.get('INGEST_TOKEN')
    if not args.dry_run and not (url and token):
        sys.exit('Faltan INGEST_URL e INGEST_TOKEN (secretos del repositorio).')
    raw_proxies = [p.strip() for p in os.environ.get('JOBSPY_PROXIES', '').split(',') if p.strip()]
    allow_direct = os.environ.get('JOBSPY_ALLOW_DIRECT') == '1'
    report = {'mode': 'skipped', 'proxies_ok': [], 'proxies_failed': []}
    site_proxies = {}
    if raw_proxies:
        healthy, failed = validate_proxies(raw_proxies)
        report = {'mode': 'proxies' if healthy else 'skipped', 'proxies_ok': healthy, 'proxies_failed': failed}
        print(json.dumps(report, ensure_ascii=False), flush=True)
        if not healthy and not allow_direct:
            print('JobSpy: sin proxies sanos; no se intentó. Configura JOBSPY_PROXIES o activa JOBSPY_ALLOW_DIRECT=1 asumiendo el riesgo de bloqueo.', file=sys.stderr)
            _summary(report)
            return 0
        if not healthy:
            report['mode'] = 'direct'
            print('JobSpy: ningún proxy sano; se usa el modo directo porque JOBSPY_ALLOW_DIRECT=1 (riesgo de bloqueo).', file=sys.stderr)
        site_proxies = {site: healthy[i % len(healthy)]['proxy'] for i, site in enumerate(sites)} if healthy else {}
    elif not allow_direct:
        print('JobSpy: JOBSPY_PROXIES vacío; no se intentó (el modo directo se activa con JOBSPY_ALLOW_DIRECT=1 y riesgo de bloqueo).', file=sys.stderr)
        _summary(report)
        return 0
    else:
        report['mode'] = 'direct'
        print('JobSpy: modo directo activado a propósito; los runners de GitHub pueden estar bloqueados.', file=sys.stderr)
    results, errors = collect(sites, lambda site, query: jobspy_scrape(site, query, proxies=site_proxies.get(site)))
    report['sites'] = {site: len(items) for site, items in results.items()}
    _summary(report)
    for site, items in results.items():
        print(f'{site}: {len(items)} candidatos', flush=True)
        if args.dry_run or not items:
            continue
        for i in range(0, len(items), BATCH):
            print(' ->', post(url, token, site, items[i:i + BATCH], note='; '.join(errors)[:300] or None), flush=True)
    for error in errors:
        print('aviso:', error, file=sys.stderr)
    return 0


if __name__ == '__main__':
    main()
