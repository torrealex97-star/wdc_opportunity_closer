"""Los buscadores de Apify del panel salen de la auditoría, con repuestos y sin actores inventados.

Qué fija este archivo (reglas, no solo el JSON):

1. `apps/web/lib/apifyPortals.json` está regenerado con `scripts/export_apify_portals.py`.
2. Cada receta existe en la auditoría de ese mismo código: ningún actor se inventa ni se copia de otro portal.
3. Los cuatro portales curados a mano (Indeed, InfoJobs, LinkedIn, Workana) no se duplican.
4. Si la tienda ofrecía varios candidatos, hay varios repuestos: la app puede pasar al siguiente si el primero
   falla o vuelve sin ofertas.
5. Una fuente sin candidatos auditados no aparece: el panel sigue diciendo «sin proveedor verificado» en vez
   de fingir un buscador que no existe.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))

from export_apify_portals import ACTOR_RE, CURATED, MAX_RECIPES, OUT, build  # noqa: E402

AUDIT = ROOT / 'apps/api/career/source_audit.json'
CATALOG = ROOT / 'apps/web/lib/sourceCatalog.json'


def exported():
    return json.loads(OUT.read_text(encoding='utf-8'))


def audit():
    return json.loads(AUDIT.read_text(encoding='utf-8')).get('apify', {})


def catalog():
    return json.loads(CATALOG.read_text(encoding='utf-8'))


def test_exported_file_is_up_to_date():
    assert exported() == build(), 'Regenera: .venv/bin/python scripts/export_apify_portals.py'


def test_every_recipe_exists_in_the_audit_of_its_own_source():
    audited = audit()
    for source in exported()['sources']:
        known = {c['actor'] for c in audited.get(source['code'], {}).get('candidates', [])}
        for recipe in source['recipes']:
            assert recipe['actor'] in known, f'{source["code"]}: {recipe["actor"]} no está en la auditoría'


def test_actors_are_well_formed_and_unique_per_portal():
    for source in exported()['sources']:
        actors = [r['actor'] for r in source['recipes']]
        assert len(actors) == len(set(actors)), f'{source["code"]} repite actor'
        for actor in actors:
            assert ACTOR_RE.match(actor), f'{actor} no tiene forma propietario/nombre'


def test_curated_portals_are_not_duplicated_and_codes_are_unique():
    codes = [s['code'] for s in exported()['sources']]
    assert len(codes) == len(set(codes)), 'hay dos entradas para el mismo código'
    assert not (set(codes) & CURATED), f'los portales curados no se generan: {sorted(set(codes) & CURATED)}'


def test_fallbacks_exist_whenever_the_store_offered_them():
    audited = audit()
    for source in exported()['sources']:
        available = len(audited.get(source['code'], {}).get('candidates', []))
        assert len(source['recipes']) == min(available, MAX_RECIPES), f'{source["code"]}: faltan repuestos'
        assert len(source['recipes']) <= MAX_RECIPES, f'{source["code"]}: más de {MAX_RECIPES} intentos'


def test_only_sources_that_need_a_paid_route_and_have_candidates_appear():
    audited, rows = audit(), catalog()
    needs_input = {r['code'] for r in rows if r.get('requires') == 'input'}
    codes = {s['code'] for s in exported()['sources']}
    assert codes <= needs_input, f'entra una fuente que no necesita proveedor: {sorted(codes - needs_input)}'
    expected = {c for c in needs_input - CURATED if audited.get(c, {}).get('candidates')}
    assert codes == expected, f'faltan portales con buscador auditado: {sorted(expected - codes)}'


def test_no_entry_carries_an_empty_recipe_list():
    for source in exported()['sources']:
        assert source['recipes'], f'{source["code"]} sin recetas'
        assert source['name'].strip(), f'{source["code"]} sin nombre para el panel'


def test_actor_pattern_matches_the_panel_validation():
    """El panel valida con `ACTOR_RE` de lib/apify.ts; si cambia allí, esta prueba avisa aquí."""
    from_ts = re.search(r'export const ACTOR_RE = (/[^\n]+/);', (ROOT / 'apps/web/lib/apify.ts').read_text(encoding='utf-8'))
    assert from_ts, 'no se encontró ACTOR_RE en lib/apify.ts'
    assert from_ts.group(1) == r'/^[A-Za-z0-9._-]+[/~][A-Za-z0-9._-]+$/'


def test_the_panel_catalog_exposes_every_exported_portal():
    """`PORTALS` de lib/apifyCatalog.ts (lo que ve el panel) contiene lo exportado, sin duplicados y curado aparte.

    Se ejecuta el módulo real en Node: que el JSON esté bien no basta si el catálogo del panel no lo lee.
    """
    run = subprocess.run(['node', '--experimental-strip-types', '--no-warnings', 'tests/apify-portals.mjs'], cwd=ROOT,
                         capture_output=True, text=True, timeout=60, check=True)
    portals = json.loads(run.stdout)
    ids = [p['id'] for p in portals]
    assert len(ids) == len(set(ids)), 'el panel tiene dos portales con el mismo id'
    exported_codes = {s['code'] for s in exported()['sources']}
    assert exported_codes <= set(ids), f'el panel no enseña: {sorted(exported_codes - set(ids))}'
    for portal in portals:
        if portal['id'] in exported_codes:
            assert portal['source'] == f'apify-{portal["id"]}'
            assert portal['recipes'], 'un portal generado sin buscadores'
    for code in CURATED:
        assert code in ids, f'falta el portal curado {code}'
