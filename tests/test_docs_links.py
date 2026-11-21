"""Ningún enlace relativo de la documentación puede quedar roto.

Un `docs/` grande tiende a escribir rutas del repositorio (`apps/web/…`, `sites/engine/…`) como si colgaran
de `docs/`, y así se acumularon decenas de enlaces muertos en `docs/STATUS.md`. Lo mismo puede pasar en los
`README.md` de la raíz y de `apps/`. Esta prueba recorre toda esa documentación y exige que cada enlace
relativo resuelva desde el fichero que lo contiene. Cuando falla, dice qué arreglar y recuerda el arreglador:
`python scripts/fix_docs_links.py`.
"""
import importlib.util
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / 'docs'


def _fixer():
    spec = importlib.util.spec_from_file_location('fix_docs_links', ROOT / 'scripts' / 'fix_docs_links.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_docs_relative_links_resolve():
    fixer = _fixer()
    broken = []
    files = fixer.doc_files()
    assert files, 'no se encontró documentación que revisar'
    assert ROOT / 'README.md' in files, 'el README de la raíz debe revisarse'
    for path in files:
        _, changes = fixer.fix(path.read_text(encoding='utf-8'), path.parent)
        broken.extend(f'{path.relative_to(ROOT)} → {old}' for old, _ in changes)
    assert not broken, (
        f'{len(broken)} enlace(s) relativo(s) roto(s) en la documentación:\n  '
        + '\n  '.join(broken[:40])
        + ('\n  …' if len(broken) > 40 else '')
        + '\nArréglalos con `.venv/bin/python scripts/fix_docs_links.py` (no reescribe el texto).'
    )


def test_los_readme_de_la_raiz_y_de_apps_estan_cubiertos(tmp_path):
    fixer = _fixer()
    (tmp_path / 'docs').mkdir()
    (tmp_path / 'docs' / 'PLAN.md').write_text('# plan\n', encoding='utf-8')
    (tmp_path / 'apps' / 'web').mkdir(parents=True)
    (tmp_path / 'README.md').write_text('# raíz\n', encoding='utf-8')
    (tmp_path / 'apps' / 'web' / 'README.md').write_text('# web\n', encoding='utf-8')
    (tmp_path / 'apps' / 'web' / 'NOTAS.md').write_text('# notas\n', encoding='utf-8')
    (tmp_path / 'apps' / 'web' / 'node_modules' / 'paquete').mkdir(parents=True)
    (tmp_path / 'apps' / 'web' / 'node_modules' / 'paquete' / 'README.md').write_text('# dep\n', encoding='utf-8')
    assert fixer.doc_files(tmp_path) == [
        tmp_path / 'README.md',
        tmp_path / 'apps' / 'web' / 'README.md',
        tmp_path / 'docs' / 'PLAN.md',
    ]


def test_fixer_arregla_rutas_del_repo_escritas_en_un_readme_de_apps(tmp_path):
    fixer = _fixer()
    (tmp_path / 'docs').mkdir()
    (tmp_path / 'docs' / 'PLAN.md').write_text('# plan\n', encoding='utf-8')
    base = tmp_path / 'apps' / 'web'
    base.mkdir(parents=True)
    fixed, changes = fixer.fix('[plan](docs/PLAN.md)', base, root=tmp_path)
    assert fixed == '[plan](../../docs/PLAN.md)' and changes == [('docs/PLAN.md', '../../docs/PLAN.md')]


def test_fixer_leaves_absolute_and_anchor_links_alone():
    fixer = _fixer()
    text = ('[web](https://ejemplo.com/x) [correo](mailto:a@b.c) [ancla](#estado) '
            '[ruta del sitio](/privacidad) [doc](../docs/STATUS.md)')
    fixed, changes = fixer.fix(text, DOCS)
    assert fixed == text and not changes


def test_fixer_repoints_repo_paths_written_inside_docs():
    fixer = _fixer()
    fixed, changes = fixer.fix('[worker](sites/engine/worker.js)', DOCS)
    assert fixed == '[worker](../sites/engine/worker.js)' and changes == [('sites/engine/worker.js', '../sites/engine/worker.js')]
