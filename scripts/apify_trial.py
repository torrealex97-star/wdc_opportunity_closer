"""Ensayo en seco de una búsqueda de Apify: qué se ejecutaría, con qué entrada y cuánto cuesta.

Qué lee (todo público, sin token y sin gastar crédito):

- `apps/web/lib/apifyPortals.ts` → portales, primer buscador y repuestos, tope de elementos y plantilla.
- La API pública de Apify → ficha del actor (precio por evento y por resultado) y esquema de entrada
  (`/v2/acts/<actor>` y `/v2/acts/<actor>/builds/default`).

Qué imprime: la petición exacta que haría la app (`POST /v2/acts/<actor>/runs` con `maxItems`, `memory`,
`timeout` y `maxTotalChargeUsd`), la entrada ya adaptada con los mismos sinónimos que `adaptInput`, el coste
estimado por eventos y el tope declarado. **No lanza nada**: el POST se imprime, nunca se envía.

Uso: `.venv/bin/python scripts/apify_trial.py --portal infoempleo`
     `.venv/bin/python scripts/apify_trial.py --portal talent --items 10 --json`
"""
import argparse
import asyncio
import json
import os
import re
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
PORTALS_TS = ROOT / 'apps/web/lib/apifyPortals.ts'
# Mismos valores que `apps/web/lib/apify.ts` y `apifyAuto.ts`: si cambian allí, cambian aquí.
TEST_CAP_USD, MEMORY_MB, TIMEOUT_S = 0.5, 1024, 900
# Tope mensual declarado: el del panel (`paid_budget`) manda; sin él, la variable de entorno; sin ella, 10 USD.
DEFAULT_MONTHLY_USD = 10.0
# Misma consulta combinada que `varsFor`: una ejecución cubre todos los perfiles de la academia.
QUERIES = ['closer de ventas', 'closer high ticket', 'setter de ventas', 'televenta', 'asesor comercial',
           'ejecutivo comercial', 'cold caller']
VARS = {'query': ' OR '.join(f'"{q}"' for q in QUERIES), 'location': 'España', 'country': 'Spain',
        'hours_old': 240, 'sites': ['indeed', 'linkedin', 'glassdoor', 'google']}
# Mismos sinónimos que `SYNONYMS` de `lib/apify.ts`.
SYNONYMS = {
    'query': ['searchterm', 'searchterms', 'search', 'searchquery', 'query', 'keyword', 'keywords', 'jobtitle', 'jobtitles', 'position'],
    'location': ['location', 'locations', 'city', 'where'],
    'country': ['countryindeed', 'country', 'countrycode'],
    'max_items': ['resultswanted', 'maxitems', 'maxresults', 'maxjobs', 'limit', 'numberofresults', 'resultslimit'],
    'hours_old': ['hoursold', 'maxhoursold', 'hoursago'],
    'sites': ['sitename', 'sitenames', 'sites', 'jobboards', 'boards', 'platforms'],
}


def norm(value: str) -> str:
    return re.sub(r'[^a-z0-9]', '', value.lower())


def portals(path: Path = PORTALS_TS) -> list[dict]:
    """Lee los portales generados. El módulo es generado con forma fija; se comprueba el recuento para detectar deriva."""
    text = path.read_text(encoding='utf-8')
    out = []
    for block in re.finditer(r"id: '([^']+)', source: '([^']+)', name: '([^']+)',\n\s+plain: '.*?', maxItems: (\d+), testItems: (\d+),(.*?)recipes: \[(.*?)\n    \]", text, re.S):
        pid, source, name, max_items, test_items, extra, recipes = block.groups()
        template = re.search(r"inputTemplate: \{ (.*?) \},", extra)
        out.append({
            'id': pid, 'source': source, 'name': name, 'maxItems': int(max_items), 'testItems': int(test_items),
            'inputTemplate': template.group(1) if template else None,
            'recipes': [{'actor': a, 'name': n} for a, n in re.findall(r"actor: '([^']+)', name: '([^']+)'", recipes)],
        })
    return out


def coerce(value, prop_type):
    if prop_type == 'array':
        return value if isinstance(value, list) else [str(value)]
    if prop_type in {'integer', 'number'}:
        return int(value) if isinstance(value, list) else int(value)
    return ' OR '.join(value) if isinstance(value, list) else str(value)


def adapt_input(schema: dict, items: int) -> dict:
    """La entrada que enviaría `adaptInput`, con los valores de `varsFor` y el tope de esta prueba."""
    props = schema.get('properties') or {}
    by_norm = {norm(k): k for k in props}
    values = {**VARS, 'max_items': items}
    out = {}
    for name, synonyms in SYNONYMS.items():
        key = next((by_norm[s] for s in synonyms if s in by_norm), None)
        if key:
            out[key] = coerce(values[name], (props[key] or {}).get('type'))
    proxy = by_norm.get('proxyconfiguration')
    if proxy and (props[proxy] or {}).get('type') == 'object':
        out[proxy] = {'useApifyProxy': True}
    missing = [k for k in schema.get('required') or [] if k not in out and (props.get(k) or {}).get('default') is None]
    return {'input': out, 'missing': missing}


def events(pricing: list[dict]) -> dict:
    """Precio de arranque y por resultado del actor, con el tramo FREE si el actor usa precios por tramos."""
    found = {'start': None, 'item': None, 'model': None, 'usage_paid_by_user': None}
    for info in pricing:
        found['model'] = info.get('pricingModel') or found['model']
        found['usage_paid_by_user'] = info.get('isPPEPlatformUsagePaidByUser', found['usage_paid_by_user'])
        for event in ((info.get('pricingPerEvent') or {}).get('actorChargeEvents') or {}).values():
            tiered = ((event.get('eventTieredPricingUsd') or {}).get('FREE') or {}).get('tieredEventPriceUsd')
            price = event.get('eventPriceUsd') if event.get('eventPriceUsd') is not None else tiered
            if price is None:
                continue
            if event.get('isOneTimeEvent'):
                found['start'] = price
            elif found['item'] is None or event.get('isPrimaryEvent'):
                found['item'] = price
    return found


async def act(client, actor: str) -> dict:
    path = 'acts/' + actor.replace('/', '~')
    meta, build = await asyncio.gather(client.get('https://api.apify.com/v2/' + path),
                                       client.get('https://api.apify.com/v2/' + path + '/builds/default'))
    meta.raise_for_status()
    build.raise_for_status()
    schema = build.json()['data'].get('inputSchema') or {}
    if isinstance(schema, str):
        schema = json.loads(schema)
    return {'meta': meta.json()['data'], 'build': build.json()['data'], 'schema': schema}


async def plan(portal: dict, items: int) -> dict:
    async with httpx.AsyncClient(timeout=30) as client:
        rows = []
        for recipe in portal['recipes']:
            data = await act(client, recipe['actor'])
            price = events(data['meta'].get('pricingInfos') or [])
            adapted = adapt_input(data['schema'], items)
            estimate = (price['start'] or 0) + (price['item'] or 0) * items
            query_keys = {norm(k) for k in adapted['input']} & set(SYNONYMS['query'])
            # Sin palabra clave en la entrada, el buscador devolvería lo que traiga por defecto: se avisa antes de gastar.
            rows.append({
                'actor': recipe['actor'], 'name': recipe['name'],
                'build': data['build'].get('status'), 'deprecated': bool(data['meta'].get('isDeprecated')),
                'pricing': price, 'items': items, 'estimate_usd': round(estimate, 4),
                'input': adapted['input'], 'missing_required': adapted['missing'],
                'query_aware': bool(query_keys) or bool(portal.get('inputTemplate')),
                'schema_fields': list((data['schema'].get('properties') or {}).keys())[:10],
            })
    return {'portal': portal['id'], 'name': portal['name'], 'source': portal['source'], 'items': items,
            'recipes': rows, 'cap_usd': TEST_CAP_USD, 'memory_mb': MEMORY_MB, 'timeout_s': TIMEOUT_S,
            'expected_usd': round(max((r['estimate_usd'] for r in rows), default=0), 4)}


def launch_card(plan_row: dict) -> str:
    lines = [f"Portal: {plan_row['name']} ({plan_row['portal']}) · prueba de {plan_row['items']} ofertas",
             f"Tope duro por ejecución que se pide a Apify: {plan_row['cap_usd']} USD · memoria {plan_row['memory_mb']} MB · timeout {plan_row['timeout_s']} s",
             f"Coste esperado por eventos (peor buscador de la lista): {plan_row['expected_usd']} USD", ""]
    for i, r in enumerate(plan_row['recipes'], 1):
        price = r['pricing']
        lines.append(f"{i}. {r['actor']}  [{r['build']}{' · DEPRECADO' if r['deprecated'] else ''}]  ~{r['estimate_usd']} USD")
        lines.append(f"   evento de arranque: {price['start']} · por resultado: {price['item']} · modelo {price['model']}"
                     f" · uso de plataforma {'a cargo del usuario' if price['usage_paid_by_user'] else 'incluido'}")
        body = json.dumps(r['input'], ensure_ascii=False)
        lines.append(f"   POST https://api.apify.com/v2/acts/{r['actor'].replace('/', '~')}/runs"
                     f"?memory={MEMORY_MB}&timeout={TIMEOUT_S}&maxItems={plan_row['items']}&maxTotalChargeUsd={plan_row['cap_usd']}")
        lines.append(f"   body: {body[:400]}")
        if r['missing_required']:
            lines.append(f"   AVISO: el actor exige campos que la app no sabe rellenar: {', '.join(r['missing_required'])}")
        if not r['query_aware']:
            lines.append("   AVISO: su esquema no acepta palabra clave; lanzarlo devolvería lo que traiga por defecto.")
        lines.append("")
    monthly = os.environ.get('APIFY_MONTHLY_BUDGET_USD')
    limit = f"{float(monthly):.0f} USD (variable APIFY_MONTHLY_BUDGET_USD)" if monthly else f"{DEFAULT_MONTHLY_USD:.0f} USD (valor por defecto)"
    lines.append(f"Tope de gasto declarado: {plan_row['cap_usd']} USD por ejecución · {limit} al mes (si el panel tiene uno guardado, manda el del panel)")
    lines.append("Esto es un ensayo: no se ha enviado ninguna petición de ejecución ni se ha gastado crédito.")
    return '\n'.join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description='Ensayo en seco de una búsqueda de Apify (no lanza nada).')
    parser.add_argument('--portal', required=True)
    parser.add_argument('--items', type=int, default=None)
    parser.add_argument('--json', action='store_true')
    args = parser.parse_args()
    found = {p['id']: p for p in portals()}
    if args.portal not in found:
        raise SystemExit(f"Portal desconocido: {args.portal}. Hay {len(found)}: {', '.join(sorted(found))}")
    portal = found[args.portal]
    items = args.items or portal['testItems']
    row = asyncio.run(plan(portal, items))
    if portal['inputTemplate']:
        row['input_template'] = portal['inputTemplate']
    print(json.dumps(row, ensure_ascii=False, indent=2) if args.json else launch_card(row))


if __name__ == '__main__':
    main()
