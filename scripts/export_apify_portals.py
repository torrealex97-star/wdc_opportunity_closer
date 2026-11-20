"""Exporta a `apps/web/lib/apifyPortals.ts` los buscadores de Apify que el catálogo puede usar hoy.

Qué lee (nada se inventa):

- `apps/api/career/source_audit.json` → `apify[<código>]`: metadatos PÚBLICOS de la tienda de Apify
  (actor, título, build, campos requeridos y modelo de precio), recogidos por `scripts/audit_sources.py`.
- `apps/web/lib/sourceCatalog.json` → nombre, categoría y nota de cada fuente del panel.

Qué escribe: un módulo con una entrada por fuente que (1) el catálogo marca `requires: input` —es decir, no se
puede conectar gratis— y (2) TIENE candidatos auditados. Las entradas ya tienen la forma que usa el panel
(`Portal` de `apifyCatalog.ts`), así que allí solo se suman a los curados: no hay traducción en tiempo de
ejecución ni importación de JSON con atributo.

Qué NO hace: no inventa actores. Una fuente sin candidatos auditados no aparece aquí; el panel sigue
diciendo «Sin proveedor verificado» y ofrece la búsqueda en la tienda. Metadatos revisados no es una
extracción validada: la primera ejecución real de cada actor es la que lo confirma, y la app ya pasa al
siguiente si falla o vuelve sin ofertas.

Uso: `.venv/bin/python scripts/export_apify_portals.py`
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AUDIT = ROOT / 'apps/api/career/source_audit.json'
CATALOG = ROOT / 'apps/web/lib/sourceCatalog.json'
OUT = ROOT / 'apps/web/lib/apifyPortals.ts'

# Códigos que `apps/web/lib/apifyCatalog.ts` ya configura a mano (texto para el operador y plantilla de
# entrada). Aquí se excluyen para no tener dos tarjetas del mismo portal.
CURATED = {'indeed', 'infojobs', 'linkedin', 'workana', 'multi'}
ACTOR_RE = re.compile(r'^[A-Za-z0-9._-]+[/~][A-Za-z0-9._-]+$')
# Cuatro intentos por portal: más repuestos no caben en una búsqueda diaria con presupuesto acotado.
MAX_RECIPES = 4
MAX_ITEMS = 100
TEST_ITEMS = 10

HEADER = """// GENERADO por `scripts/export_apify_portals.py` desde la auditoría de la tienda de Apify. No editar a mano.
//
// Una entrada por fuente del catálogo que solo se puede conectar pagando y TIENE actores auditados: la primera
// receta se intenta y las demás son los repuestos que la app prueba sola si falla o vuelve sin ofertas. Lo que
// no está auditado no aparece; el panel lo declara «sin proveedor verificado» en vez de fingir un buscador.
import type { Portal } from './apifyCatalog';

export const GENERATED_PORTALS: Portal[] = [
"""


def quotes(text: str) -> str:
    """Cadena de TS con comillas simples, como el resto del módulo."""
    return "'" + str(text).replace('\\', '\\\\').replace("'", "\\'").replace('\n', ' ') + "'"


def build(audit_path: Path = AUDIT, catalog_path: Path = CATALOG) -> list:
    audit = json.loads(audit_path.read_text(encoding='utf-8')).get('apify', {})
    catalog = json.loads(catalog_path.read_text(encoding='utf-8'))
    portals = []
    for row in catalog:
        code = row['code']
        if row.get('requires') != 'input' or code in CURATED:
            continue
        record = audit.get(code) or {}
        candidates, seen = [], set()
        for candidate in record.get('candidates', []):
            actor = str(candidate.get('actor', ''))
            # Sin forma propietario/nombre no se puede lanzar, y repetido no es un repuesto: se descarta.
            if not ACTOR_RE.match(actor) or actor in seen:
                continue
            seen.add(actor)
            candidates.append(candidate)
        if not candidates:
            continue  # sin actor auditado no hay tarjeta: el panel lo declara sin proveedor verificado
        # Menos campos obligatorios = más probable que el esquema encaje con los sinónimos genéricos de la
        # app (`adaptInput`). El orden es una pista, no una promesa: si el actor exige algo que no sabemos
        # rellenar, el lanzamiento se anota y se pasa al siguiente.
        ordered = sorted(candidates, key=lambda c: (len(c.get('required') or []), str(c.get('title') or c['actor'])))
        portals.append({
            'id': code,
            'source': f'apify-{code}',
            'name': row.get('name') or code,
            # La tarjeta siempre tiene algo que decir de la fuente; nunca un hueco en blanco.
            'plain': row.get('note') or f"Fuente del catálogo ({row.get('category') or 'sin categoría'}); se busca con un proveedor de pago.",
            'maxItems': MAX_ITEMS,
            'testItems': TEST_ITEMS,
            'recipes': [{
                'actor': c['actor'],
                'name': (c.get('title') or c['actor'])[:80],
                'needs': list(c.get('required') or []),
            } for c in ordered[:MAX_RECIPES]],
        })
    return portals


def render(portals: list) -> str:
    lines = [HEADER.rstrip('\n')]
    for portal in portals:
        lines.append('  {')
        lines.append(f"    id: {quotes(portal['id'])}, source: {quotes(portal['source'])}, name: {quotes(portal['name'])},")
        lines.append(f"    plain: {quotes(portal['plain'])}, maxItems: {portal['maxItems']}, testItems: {portal['testItems']},")
        lines.append('    recipes: [')
        for recipe in portal['recipes']:
            needs = f", needs: [{', '.join(quotes(n) for n in recipe['needs'])}]" if recipe['needs'] else ''
            lines.append(f"      {{ actor: {quotes(recipe['actor'])}, name: {quotes(recipe['name'])}{needs} }},")
        lines.append('    ],')
        lines.append('  },')
    lines.append('];')
    return '\n'.join(lines) + '\n'


def main() -> None:
    portals = build()
    OUT.write_text(render(portals), encoding='utf-8')
    print(f'{len(portals)} portales con buscador auditado → {OUT.relative_to(ROOT)}')
    print(f'{sum(len(p["recipes"]) for p in portals)} recetas de Apify (primero + repuestos)')


if __name__ == '__main__':
    main()
