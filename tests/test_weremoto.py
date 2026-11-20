"""Conector propio de WeRemoto sobre HTML público: lista sus tarjetas, se queda con las de venta y lee la
ficha (JSON-LD) sin inventar nada. Fixtures reales del 2026-11-20; sin red."""
import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'apps/api'))

from career import connectors  # noqa: E402
from career.connectors import ProviderError, WeRemoto  # noqa: E402
from career.pipeline import normalize  # noqa: E402

FIXTURES = Path(__file__).parent / 'fixtures' / 'weremoto'
LISTA = (FIXTURES / 'lista.html').read_text(encoding='utf-8')
FICHA = (FIXTURES / 'ficha.html').read_text(encoding='utf-8')


def run(monkeypatch, listing, detail=''):
    """Sirve el fixture en lugar de la red y devuelve los candidatos del conector."""
    async def fake_fetch(url, params=None, ttl=900, user_agent=None):
        if url == 'https://www.weremoto.com':
            return listing
        if '/job-posts/' in url:
            return detail
        raise AssertionError(f'petición no prevista: {url}')

    monkeypatch.setattr(connectors, 'fetch', fake_fetch)

    async def collect():
        return [candidate async for batch in WeRemoto().batches(None) for candidate in batch]

    return asyncio.run(collect())


def test_solo_se_quedan_las_tarjetas_de_venta(monkeypatch):
    rows = run(monkeypatch, LISTA, FICHA)
    # Fixture real: seis tarjetas de la portada, de las que solo una es de venta.
    assert [r.payload['title'] for r in rows] == ['Sales / Account Executive - Talent Pool']
    assert 'Executive Assistant' not in ' '.join(r.payload['title'] for r in rows), 'las no comerciales se descartan'
    assert all(r.external_id.startswith('https://www.weremoto.com/job-posts/id-') for r in rows)


def test_la_ficha_aporta_descripcion_fecha_y_empresa(monkeypatch):
    rows = run(monkeypatch, LISTA, FICHA)
    first = rows[0].payload
    assert len(first['description']) > 200, 'la descripción sale del JobPosting, no de la tarjeta'
    assert first['posted_at'].startswith('2026-11-20')
    assert first['company'] == 'SOUTH'
    # El portal no publica países en su JSON-LD: la lista queda vacía y el pipeline lo dirá, no se supone LATAM.
    assert first['locations'] == []


def test_la_normalizacion_es_remota_y_sin_paises_inventados(monkeypatch):
    rows = run(monkeypatch, LISTA, FICHA)
    item = normalize('weremoto', rows[0].payload)
    assert item['work_mode'] == 'remote'
    assert item['title'] == 'Sales / Account Executive - Talent Pool'
    assert item['company'] == 'SOUTH'
    assert item['source_url'].startswith('https://www.weremoto.com/job-posts/id-')
    assert item['locations'] == []
    assert item['published_at'].startswith('2026-11-20')
    assert item['salary_min'] is None and item['salary_max'] is None, 'la ficha no publica salario'


def test_sin_tarjetas_se_declara_el_cambio_de_formato(monkeypatch):
    with pytest.raises(ProviderError, match='formato ha cambiado'):
        run(monkeypatch, '<html><body>Sin listado</body></html>')


def test_una_ficha_sin_jobposting_no_inventa_texto(monkeypatch):
    rows = run(monkeypatch, LISTA, '<html></html>')
    assert rows and all(r.payload.get('description') is None for r in rows)
