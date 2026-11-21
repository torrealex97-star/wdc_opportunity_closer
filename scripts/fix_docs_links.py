"""Arregla enlaces relativos de la documentación sin tocar el texto.

Por enlace: si ya resuelve, no se toca; si el destino existe tal cual **desde la raíz del repositorio**
(caso típico: `apps/web/x.ts` escrito dentro de `docs/`), se le antepone el `../` que falte; y si el
fichero ya no está, se quita el enlace y se conserva el texto (una referencia histórica a un fichero
borrado no se arregla apuntando a otro). Imprime cada cambio.

Por defecto revisa `docs/**/*.md`, el `README.md` de la raíz y los `README.md` de `apps/`.

Uso: `.venv/bin/python scripts/fix_docs_links.py [--check] [rutas...]`
"""
import argparse
import pathlib
import re
import sys

LINK = re.compile(r'\[([^\]]*)\]\((<[^>]*>|[^)\s]+)\)')
ROOT = pathlib.Path(__file__).resolve().parents[1]
DOC_GLOBS = ('docs/**/*.md', 'README.md', 'apps/**/README.md')
# Dependencias y artefactos de build: sus README no son documentación del repositorio.
SKIP_PARTS = {'node_modules', '.next', '.open-next'}


def doc_files(root: pathlib.Path = ROOT) -> list[pathlib.Path]:
    """Documentación revisada por defecto: docs/ y los README de la raíz y de apps/."""
    return sorted(
        path
        for path in {path for pattern in DOC_GLOBS for path in root.glob(pattern)}
        if not SKIP_PARTS.intersection(path.relative_to(root).parts)
    )


def local_path(target: str) -> tuple[str, str] | None:
    """Ruta y ancla del destino si apunta a un fichero del repositorio; None para web, ancla o ruta del sitio."""
    if target.startswith(('http://', 'https://', 'mailto:', '#', '/')):
        return None
    path, sep, anchor = target.partition('#')
    path = path.strip('<>')
    return (path, f'{sep}{anchor}') if path else None


def resolve(base: pathlib.Path, target: str, root: pathlib.Path = ROOT) -> str | None:
    """Destino corregido, o None si no hay nada que arreglar (ya resuelve o no es un fichero del repositorio)."""
    local = local_path(target)
    if local is None:
        return None
    path, anchor = local
    if (base / path).exists():
        return None
    # Ruta escrita desde la raíz del repositorio: desde el fichero se sube hasta la raíz y se vuelve a bajar.
    depth = len(base.resolve().relative_to(root.resolve()).parts)
    cleaned = path.lstrip('./')
    for levels in range(depth + 1):
        candidate = '../' * levels + cleaned
        if (base / candidate).exists():
            return candidate + anchor
    return None


def fix(text: str, base: pathlib.Path, root: pathlib.Path = ROOT) -> tuple[str, list[tuple[str, str | None]]]:
    changes: list[tuple[str, str | None]] = []

    def replace(match: re.Match) -> str:
        label, target = match.group(1), match.group(2)
        fixed = resolve(base, target, root)
        if fixed is not None:
            changes.append((target, fixed))
            return f'[{label}]({fixed})'
        local = local_path(target)
        if local is None or (base / local[0]).exists():
            return match.group(0)
        # Fichero que ya no existe: se conserva el texto y se retira el enlace (no se inventa un destino).
        changes.append((target, None))
        return label
    return LINK.sub(replace, text), changes


def main() -> int:
    parser = argparse.ArgumentParser(
        description='Arregla enlaces relativos de la documentación (docs/ y README de la raíz y apps/) sin cambiar el texto.')
    parser.add_argument('--check', action='store_true', help='solo informa; sale con 1 si hay enlaces rotos')
    parser.add_argument('paths', nargs='*', help='ficheros a revisar (por defecto, docs/**/*.md, README.md y apps/**/README.md)')
    args = parser.parse_args()
    files = [pathlib.Path(p) for p in args.paths] or doc_files()
    total = 0
    for path in files:
        original = path.read_text(encoding='utf-8')
        text, changes = fix(original, path.parent)
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
