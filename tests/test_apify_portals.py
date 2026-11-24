"""Los buscadores de Apify del panel salen de la auditoría, con repuestos y sin actores inventados.

Qué fija este archivo (reglas, no solo el texto generado):

1. `apps/web/lib/apifyPortals.ts` está regenerado con `scripts/export_apify_portals.py`.
2. Cada receta existe en la auditoría de ese mismo código: ningún actor se inventa ni se copia de otro portal.
3. Los cinco portales curados (Indeed, InfoJobs, LinkedIn, Workana, multi-portal) no se duplican ni cambian:
   van primero, en su orden, con sus buscadores.
4. Si la tienda ofrecía varios candidatos, están los repuestos (hasta `MAX_RECIPES`): la app puede pasar al
   siguiente si el primero falla o vuelve sin ofertas.
5. Una fuente sin candidatos auditados no aparece: el panel sigue diciendo «sin proveedor verificado» en vez
   de fingir un buscador que no existe.
6. Las redes y comunidades conservan el aviso de condiciones de uso (ADR-011).

La vista que se comprueba es la del panel: se ejecuta `lib/apifyCatalog.ts` en Node, no se lee el módulo
generado. Que el fichero esté bien no basta si el catálogo no lo suma.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))

from export_apify_portals import ACTOR_RE, CURATED, EXCLUDED, MAX_RECIPES, OUT, TEMPLATES, build, render  # noqa: E402

AUDIT = ROOT / 'apps/api/career/source_audit.json'
CATALOG = ROOT / 'apps/web/lib/sourceCatalog.json'
CURATED_IDS = ['indeed', 'infojobs', 'linkedin', 'workana', 'upwork', 'infoempleo', 'simplyhired', 'jooble', 'multi']
# Actores añadidos a mano delante del catálogo generado (2026-11-24, *inspected*): existen, su ficha pública y su página de entrada se
# leyeron (campos y precios) y su plantilla está en `OVERRIDES` de apifyCatalog.ts. La auditoría automática (`audit_sources.py`) necesita
# la red de la tienda de Apify, que este entorno no alcanza, así que no los lista; la prueba real de 10 resultados los valida.
ADDED = {'abotapi/computrabajo-jobs-scraper', 'reventadata/computrabajo-scraper', 'bibian/latam-jobs-bumeran-scraper', 'unfenced-group/occ-com-mx-scraper'}
SOCIAL = {'facebook', 'telegram', 'reddit', 'skool', 'linkedin-posts'}


def panel():
    """`PORTALS` de lib/apifyCatalog.ts, ejecutado en Node: lo que de verdad ve quien administra."""
    run = subprocess.run(['node', '--experimental-strip-types', '--no-warnings', '--import', './tests/admin-auth/ts-resolve.mjs',
                          'tests/apify-portals.mjs'], cwd=ROOT, capture_output=True, text=True, timeout=60, check=True)
    return json.loads(run.stdout)


def audit():
    return json.loads(AUDIT.read_text(encoding='utf-8')).get('apify', {})


def catalog():
    return json.loads(CATALOG.read_text(encoding='utf-8'))


def generated():
    return [p for p in panel() if p['id'] not in CURATED_IDS]


def test_exported_module_is_up_to_date():
    up_to_date = render(build())
    assert OUT.read_text(encoding='utf-8') == up_to_date, 'Regenera: .venv/bin/python scripts/export_apify_portals.py'


def test_every_recipe_exists_in_the_audit_of_its_own_source():
    audited = audit()
    for portal in generated():
        known = {c['actor'] for c in audited.get(portal['id'], {}).get('candidates', [])}
        for recipe in portal['recipes']:
            if recipe['actor'] in ADDED: continue
            assert recipe['actor'] in known, f'{portal["id"]}: {recipe["actor"]} no está en la auditoría'


def test_actors_are_well_formed_and_unique_per_portal():
    for portal in panel():
        actors = [r['actor'] for r in portal['recipes']]
        assert len(actors) == len(set(actors)), f'{portal["id"]} repite actor'
        for actor in actors:
            assert ACTOR_RE.match(actor), f'{actor} no tiene forma propietario/nombre'


def test_curated_portals_lead_in_their_order_with_their_own_recipes():
    portals = panel()
    assert [p['id'] for p in portals[:len(CURATED_IDS)]] == CURATED_IDS
    curated = {p['id']: p for p in portals[:len(CURATED_IDS)]}
    # Los buscadores escritos a mano no cambian por generar el resto de portales.
    assert [len(curated[i]['recipes']) for i in CURATED_IDS] == [3, 1, 5, 3, 2, 1, 2, 2, 1]
    assert curated['indeed']['source'] == 'apify-indeed' and curated['multi']['source'] == 'apify-jobspy'
    assert curated['workana']['query'] == 'closer de ventas' and curated['workana']['inputTemplate']['locale'] == 'es'
    # Búsquedas por término: cubrir sinónimos sin multiplicar ejecuciones (una al día, rotando).
    for code in ('linkedin', 'workana'):
        queries = curated[code]['queries']
        assert len(queries) >= 6 and len(set(queries)) == len(queries)
        assert queries[0] == curated[code]['query']
    # Los repuestos de Workana no comparten esquema: cada uno lleva su plantilla.
    templates = {r['actor']: r.get('inputTemplate') for r in curated['workana']['recipes']}
    assert templates['getdataforme/workana-job-scraper']['searchQuery'] == '{{query}}'
    assert templates['gio21/workana-scraper']['keyword'] == '{{query}}'
    ids = [p['id'] for p in portals]
    assert len(ids) == len(set(ids)), 'el panel tiene dos portales con el mismo id'
    assert not (set(p['id'] for p in generated()) & CURATED), 'un portal curado se generó también'


def test_reconnected_portals_use_only_audited_actors_with_their_own_templates_and_no_credentials():
    # Fase 2 (2026-11-23): Indeed, Upwork, Infoempleo, SimplyHired y Jooble se reconectan con actores auditados y la plantilla
    # exacta de cada uno (leída en su página pública de entrada). Nada de cookies ni tokens de sesión (ADR-011).
    portals = {p['id']: p for p in panel()}
    audited = audit()
    for code in ('indeed', 'upwork', 'infoempleo', 'simplyhired', 'jooble'):
        known = {c['actor'] for c in audited[code]['candidates']}
        for recipe in portals[code]['recipes']:
            assert recipe['actor'] in known, f'{code}: {recipe["actor"]} no está auditado'
            template = recipe.get('inputTemplate')
            assert template, f'{code}: {recipe["actor"]} sin plantilla propia'
            assert '{{query}}' in json.dumps(template), f'{code}: {recipe["actor"]} no rellena la búsqueda'
            assert not {'cookies', 'sessionToken'} & set(template), f'{code}: credenciales de cuentas en la plantilla'
    assert {r['actor'] for r in portals['indeed']['recipes']} == {'misceres/indeed-scraper', 'kaix/indeed-scraper', 'borderline/indeed-scraper'}
    # Freelancer sigue sin proveedor verificado: no se inventa.
    assert audited['freelancer']['candidates'] == [] and 'freelancer' not in portals


def test_fallbacks_exist_whenever_the_store_offered_them():
    audited = audit()
    for portal in generated():
        available = len(audited.get(portal['id'], {}).get('candidates', []))
        if portal['id'] in TEMPLATES:  # solo los actores que aceptan la plantilla documentada
            actors = {r['actor'] for r in portal['recipes']} - ADDED
            assert actors == TEMPLATES[portal['id']]['actors'], f'{portal["id"]}: actores fuera de su plantilla'
            continue
        own = [r for r in portal['recipes'] if r['actor'] not in ADDED]
        assert len(own) == min(available, MAX_RECIPES), f'{portal["id"]}: faltan repuestos'
        assert len(own) <= MAX_RECIPES, f'{portal["id"]}: más de {MAX_RECIPES} intentos'


def test_templates_only_go_where_the_actor_accepts_them():
    # Los curados escriben la suya a mano (Workana); aquí se vigilan las que genera la auditoría.
    with_template = {p['id'] for p in generated() if p.get('inputTemplate')}
    assert with_template == set(TEMPLATES), f'plantillas inesperadas: {sorted(with_template ^ set(TEMPLATES))}'
    for code, template in TEMPLATES.items():
        filled = ' '.join(str(v) for v in template['input'].values())
        assert '{{query}}' in filled and '{{max_items}}' in filled, f'{code}: la plantilla no rellena nada'


def test_only_sources_that_need_a_paid_route_and_have_candidates_appear():
    audited, rows = audit(), catalog()
    needs_input = {r['code'] for r in rows if r.get('requires') == 'input'}
    codes = {p['id'] for p in generated()}
    assert codes <= needs_input, f'entra una fuente que no necesita proveedor: {sorted(codes - needs_input)}'
    expected = {c for c in needs_input - CURATED - set(EXCLUDED) if audited.get(c, {}).get('candidates')}
    assert codes == expected, f'faltan portales con buscador auditado: {sorted(expected - codes)}'
    # Una fuente excluida tiene actores auditados pero de otro contrato: se queda fuera y se dice por qué.
    for code in EXCLUDED:
        assert code not in codes and audited.get(code, {}).get('candidates'), f'{code}: exclusión sin motivo medido'


def test_every_portal_can_be_shown_to_the_operator():
    generated_ids = {p['id'] for p in generated()}
    for portal in panel():
        assert portal['recipes'], f'{portal["id"]} sin buscadores'
        assert portal['name'].strip() and portal['plain'].strip(), f'{portal["id"]} sin nombre o sin frase'
        assert portal['maxItems'] > portal['testItems'] > 0, f'{portal["id"]}: topes de prueba incoherentes'
        if portal['id'] in generated_ids:  # los curados eligen su propia fuente (p. ej. `apify-jobspy`)
            assert portal['source'] == f'apify-{portal["id"]}', f'{portal["id"]}: fuente inesperada {portal["source"]}'


def test_social_sources_keep_the_conditions_warning():
    for portal in panel():
        if portal['id'] in SOCIAL:
            assert portal.get('caution'), f'{portal["id"]}: las redes llevan aviso (ADR-011)'
        if portal['id'] in CURATED_IDS:  # su aviso está escrito a mano (LinkedIn, ADR-011) y no se reescribe
            continue
        assert bool(portal.get('caution')) == (portal['id'] in SOCIAL), f'{portal["id"]}: aviso de red inesperado'


def test_actor_pattern_matches_the_panel_validation():
    """El panel valida con `ACTOR_RE` de lib/apify.ts; si cambia allí, esta prueba avisa aquí."""
    from_ts = re.search(r'export const ACTOR_RE = (/[^\n]+/);', (ROOT / 'apps/web/lib/apify.ts').read_text(encoding='utf-8'))
    assert from_ts, 'no se encontró ACTOR_RE en lib/apify.ts'
    assert from_ts.group(1) == r'/^[A-Za-z0-9._-]+[/~][A-Za-z0-9._-]+$/'
