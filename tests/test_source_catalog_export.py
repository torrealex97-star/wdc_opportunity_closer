"""El catálogo que ve el panel hospedado (sourceCatalog.json) debe coincidir con el del backend."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))

from export_source_catalog import OUT, build  # noqa: E402


def test_hosted_source_catalog_matches_backend():
    assert json.loads(OUT.read_text(encoding='utf-8')) == build(), 'Regenera: PYTHONPATH=apps/api python scripts/export_source_catalog.py'


def test_panel_catalog_follows_cloud_engine_reality():
    """El panel describe lo que recoge el motor cloud (sites/engine), no lo que arranca el backend local.

    La diferencia se declara en scripts/export_source_catalog.py (CLOUD_OPERATIONAL / CLOUD_RETIRED);
    sin ella, el export volvía a etiquetar como «pendiente» fuentes que ya traen ofertas.
    """
    rows = {r['code']: r for r in json.loads(OUT.read_text(encoding='utf-8'))}
    # Tableros retirados del cloud por cero elegibles en dos mediciones (sesión 176): no vuelven al panel.
    for code in ('ats-greenhouse-typeform', 'ats-greenhouse-wallapop', 'ats-recruitee-livestorm', 'ats-teamtailor-monestcapital'):
        assert code not in rows, f'{code} está retirado en el motor cloud'
    # Fuentes que el cloud recoge hoy: operativas y sin pedir configuración.
    # `getonbrd-public` es el código que el panel cruza con el conector `getonbrd` del motor
    # (ALIAS de apps/web/lib/sourceFamilies.ts): una sola fila para el portal.
    for code in ('openradar', 'workable', 'smartrecruiters', 'ats-greenhouse-feverup', 'ats-ashby-qonto', 'getonbrd-public', 'freehire', 'freelancer', 'jobgether'):
        assert rows[code]['validation_status'] == 'Conector operativo', code
        assert rows[code]['requires'] == 'none', code


def test_catalog_has_all_sources_and_unique_codes():
    rows = json.loads(OUT.read_text(encoding='utf-8'))
    codes = [r['code'] for r in rows]
    assert len(codes) == len(set(codes)) and len(codes) >= 60
