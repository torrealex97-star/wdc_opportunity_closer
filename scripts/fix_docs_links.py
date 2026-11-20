"""Arregla enlaces relativos de la documentación sin tocar el texto.

Qué hace, por enlace: si ya resuelve, no lo toca; si el destino existe tal cual **desde la raíz del repo**
(caso típico: `apps/web/x.ts` escrito dentro de `docs/`), le pone `../`; si es un `.json` renombrado a
`.ts`, apunta al que existe; si el destino tiene corchetes de ruta catch-all, los escribe con `<...>`; y si
el fichero ya no está en el repositorio, quita el enlace y deja el mismo texto (una referencia histórica a
un fichero borrado no se puede «arreglar» apuntando a otro). Imprime cada cambio.

Uso: `.venv/bin/python scripts/fix_docs_links.py [--check] [rutas...]`
"""
import argparse
import pathlib
import re
import sys
from urllib.parse import unquote

LINK = re.compile(r'(!?)\[([^\]]*)\]\((<[^>]*>|[^)\s]+)\)')
ROOT = pathlib.Path(__file__).resolve().parents[1]


def target_exists(base: pathlib.Path, target: str) -> bool:
    path = target.split('#')[0].strip('<>')
    if not path:
        return True  # solo ancla
    return (base / path).exists()


def resolve(base: pathlib.Path, target: str) -> str | None:
    """Nuevo destino para un enlace roto, o None si ya resolvía."""
    # `http`, anclas y rutas absolutas del sitio (`/privacidad`): no son ficheros del repositorio.
    if target.startswith(('http://', 'https://', 'mailto:', '#', '/')):
        return None
    path, _, anchor = target.partition('#')
    path = path.strip('<>')
    if not path or (base / path).exists():
        return None
    anchor = f'#{anchor}' if anchor else ''
    # 1. Ruta del repo escrita como si estuviera dentro de docs/: se sube hasta la raíz y se vuelve a bajar.
    depth = len(base.resolve().relative_to(ROOT).parts)
    cleaned = path.lstrip('./')
    for levels in (depth, 1):
        prefixed = '../' * levels + cleaned
        if (base / prefixed).exists():
            return prefixed + anchor
    # 2. Artefacto renombrado (export de JSON a módulo TS, por ejemplo).
    for old, new in (('.json', '.ts'), ('.js', '.ts')):
        if path.endswith(old):
            renamed = path[: -len(old)] + new
            for levels in (0, 1, 2, 3):
                candidate = '../' * levels + renamed.lstrip('./')
                if (base / candidate).exists():
                    return candidate + anchor
    # 3. Ruta con corchetes (catch-all de Next): se escribe entre `<>` para que el Markdown la acepte.
    decoded = unquote(path)
    if decoded != path:
        for levels in (depth, 1, 0):
            candidate = '../' * levels + decoded.lstrip('./')
            if (base / candidate).exists():
                return f'<{candidate}{anchor}>'
    return None


def fix(text: str, base: pathlib.Path, dry: bool) -> tuple[str, list[tuple[str, str | None]]]:
    changes: list[tuple[str, str | None]] = []

    def replace(match: re.Match) -> str:
        bang, label, target = match.group(1), match.group(2), match.group(3)
        fixed = resolve(base, target)
        if fixed is not None:
            changes.append((target, fixed))
            return f'{bang}[{label}]({fixed})'
        if target.startswith(('http://', 'https://', 'mailto:', '#', '/')) or target_exists(base, target):
            return match.group(0)
        # Fichero que ya no existe: se conserva el texto y se retira el enlace (no se inventa un destino).
        changes.append((target, None))
        return f'{bang}{label}'
    return LINK.sub(replace, text), changes


def main() -> int:
    parser = argparse.ArgumentParser(description='Arregla enlaces relativos de docs/ sin cambiar el texto.')
    parser.add_argument('--check', action='store_true', help='solo informa; sale con 1 si hay enlaces rotos')
    parser.add_argument('paths', nargs='*', help='ficheros a revisar (por defecto, docs/**/*.md)')
    args = parser.parse_args()
    files = [pathlib.Path(p) for p in args.paths] or sorted((ROOT / 'docs').rglob('*.md'))
    total = 0
    for path in files:
        original = path.read_text(encoding='utf-8')
        text, changes = fix(original, path.parent, args.check)
        if not changes:
            continue
        total += len(changes)
        print(f'{path}:')
        for old, new in changes:
            print(f'   {"→ " + new if new else "sin destino: se retira el enlace"}   ({old})')
        if not args.check and text != original:
            path.write_text(text, encoding='utf-8')
    print(f'\n{total} enlace(s) revisado(s) en {len(files)} fichero(s)')
    return 1 if args.check and total else 0


if __name__ == '__main__':
    sys.exit(main())
