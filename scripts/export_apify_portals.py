"""Exporta a `apps/web/lib/apifyPortals.json` los buscadores de Apify que el catálogo puede usar hoy.

Qué lee (nada se inventa):

- `apps/api/career/source_audit.json` → `apify[<código>]`: metadatos PÚBLICOS de la tienda de Apify
  (actor, título, build, campos requeridos y modelo de precio), recogidos por `scripts/audit_sources.py`.
- `apps/web/lib/sourceCatalog.json` → nombre, categoría y nota de cada fuente del panel.

Qué escribe: una entrada por fuente que (1) el catálogo marca `requires: input` —es decir, no se puede
conectar gratis— y (2) TIENE candidatos auditados. Cada entrada lleva sus recetas ordenadas y, como mucho,
`MAX_RECIPES`: la primera se intenta y las demás son los repuestos que la app prueba sola si falla.

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
OUT = ROOT / 'apps/web/lib/apifyPortals.json'

# Códigos que `apps/web/lib/apifyCatalog.ts` ya configura a mano (texto para el operador y plantilla de
# entrada). Aquí se excluyen para no tener dos tarjetas del mismo portal.
CURATED = {'indeed', 'infojobs', 'linkedin', 'workana'}
ACTOR_RE = re.compile(r'^[A-Za-z0-9._-]+[/~][A-Za-z0-9._-]+$')
# Cuatro intentos por portal: más repuestos no caben en una búsqueda diaria con presupuesto acotado.
MAX_RECIPES = 4


def build(audit_path: Path = AUDIT, catalog_path: Path = CATALOG) -> dict:
    audit = json.loads(audit_path.read_text(encoding='utf-8')).get('apify', {})
    catalog = json.loads(catalog_path.read_text(encoding='utf-8'))
    sources = []
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
        sources.append({
            'code': code,
            'name': row.get('name') or code,
            'category': row.get('category') or '',
            # El panel necesita una frase: si la ficha no trae nota, se dice lo que sí consta (categoría).
            'plain': row.get('note') or f"Fuente del catálogo ({row.get('category') or 'sin categoría'}); se busca con un proveedor de pago.",
            'checked_at': record.get('checked_at') or '',
            'recipes': [{
                'actor': c['actor'],
                'title': (c.get('title') or c['actor'])[:80],
                'build': c.get('build') or '',
                'required': list(c.get('required') or []),
                'pricing': list(c.get('pricing_models') or []),
            } for c in ordered[:MAX_RECIPES]],
        })
    return {'sources': sources}


def main() -> None:
    report = build()
    OUT.write_text(json.dumps(report, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'{len(report["sources"])} portales con buscador auditado → {OUT.relative_to(ROOT)}')
    print(f'{sum(len(s["recipes"]) for s in report["sources"])} recetas de Apify (primero + repuestos)')


if __name__ == '__main__':
    main()
