"""La lista de páginas de empleo del cron sale de la semilla del motor y no se queda desfasada.

1. `apps/web/lib/companyPagesSeed.ts` está regenerado con `scripts/export_company_pages.py`.
2. Solo hay páginas HTTPS públicas, sin repetir URL, con seguimiento de página propia, ATS o feed.
3. Cada página existe en la semilla del motor: ninguna se inventa.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))

from export_company_pages import OUT, SEED, WATCHED, build, public_https, render  # noqa: E402


def test_module_is_regenerated():
    assert OUT.read_text(encoding='utf-8') == render(build()), 'regenera con scripts/export_company_pages.py'


def test_only_public_watched_pages_without_repeats():
    rows = build()
    assert len(rows) >= 10, 'la semilla trae al menos una decena de páginas de empleo'
    urls = [row['url'] for row in rows]
    assert len(urls) == len(set(urls))
    for row in rows:
        assert public_https(row['url']), row['url']
        assert row['monitoring'] in WATCHED


def test_every_page_comes_from_the_seed():
    data = json.loads(SEED.read_text(encoding='utf-8'))
    targets = data if isinstance(data, list) else data.get('targets', [])
    by_slug = {t['slug']: t for t in targets}
    for row in build():
        assert row['slug'] in by_slug and by_slug[row['slug']]['careers_url'].strip() == row['url']


def test_manual_and_linkedin_only_companies_are_left_out():
    data = json.loads(SEED.read_text(encoding='utf-8'))
    targets = data if isinstance(data, list) else data.get('targets', [])
    left_out = {t['slug'] for t in targets if t.get('monitoring') not in WATCHED}
    assert left_out and not left_out & {row['slug'] for row in build()}
