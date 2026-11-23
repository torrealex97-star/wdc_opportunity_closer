"""El ensayo en seco de Apify no lanza nada: estas pruebas fijan que lee el catálogo real, adapta la entrada
con los mismos sinónimos que la app y calcula el coste con los eventos del actor. Sin red."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.apify_trial import adapt_input, events, launch_card, portals  # noqa: E402


def test_catalogo_real_se_lee_entero():
    rows = portals()
    # 18: Indeed, Upwork, Infoempleo, SimplyHired y Jooble pasaron a `apifyCatalog.ts` (curados, con plantilla propia por actor).
    assert len(rows) == 18, 'el módulo generado tiene 18 portales; si cambia, actualizar este recuento'
    assert sum(len(p['recipes']) for p in rows) == 49
    ids = [p['id'] for p in rows]
    assert len(ids) == len(set(ids)), 'un portal repetido rompería el reparto'
    assert all(r['actor'].count('/') == 1 for p in rows for r in p['recipes'])
    assert {p['testItems'] for p in rows} == {10}, 'la prueba de un portal es siempre de 10 ofertas'


def test_entrada_con_los_mismos_sinonimos_que_la_app():
    schema = {'properties': {'keywords': {'type': 'string'}, 'location': {'type': 'string'},
                             'maxItems': {'type': 'integer'}, 'proxyConfiguration': {'type': 'object'}},
              'required': []}
    out = adapt_input(schema, 10)
    assert out['input']['maxItems'] == 10
    assert out['input']['location'] == 'España'
    assert out['input']['keywords'].count(' OR ') == 6, 'siete consultas unidas por OR'
    assert out['input']['proxyConfiguration'] == {'useApifyProxy': True}
    assert out['missing'] == []


def test_campo_obligatorio_que_la_app_no_sabe_rellenar_se_declara():
    schema = {'properties': {'market': {'type': 'string'}, 'maxItems': {'type': 'integer'}}, 'required': ['market']}
    out = adapt_input(schema, 10)
    assert out['missing'] == ['market'], 'sin esto el lanzamiento fallaría y hay que decirlo antes'


def test_coste_por_eventos_incluye_arranque_y_tramos():
    pricing = [{'pricingModel': 'PAY_PER_EVENT', 'pricingPerEvent': {'actorChargeEvents': {
        'apify-actor-start': {'eventPriceUsd': 0.005, 'isOneTimeEvent': True},
        'result': {'eventTieredPricingUsd': {'FREE': {'tieredEventPriceUsd': 0.0014}}, 'isPrimaryEvent': True}}}}]
    price = events(pricing)
    assert price == {'start': 0.005, 'item': 0.0014, 'model': 'PAY_PER_EVENT', 'usage_paid_by_user': None}
    assert round(price['start'] + price['item'] * 10, 4) == 0.019


def test_la_ficha_declara_el_tope_y_que_no_se_lanzo_nada():
    card = launch_card({'portal': 'infoempleo', 'name': 'Infoempleo', 'items': 10, 'cap_usd': 0.5,
                        'memory_mb': 1024, 'timeout_s': 900, 'expected_usd': 0.0225, 'recipes': [
                            {'actor': 'bibian/infoempleo-jobs-scraper', 'build': 'SUCCEEDED', 'deprecated': False,
                             'estimate_usd': 0.0225, 'input': {'keywords': '"closer de ventas"'}, 'query_aware': True,
                             'missing_required': [], 'pricing': {'start': 0.0025, 'item': 0.002,
                                                                'model': 'PAY_PER_EVENT', 'usage_paid_by_user': None}}]})
    assert 'maxTotalChargeUsd=0.5' in card
    assert 'Tope de gasto declarado' in card
    assert 'no se ha enviado ninguna petición de ejecución' in card
