"""Exporta a `apps/web/lib/companyPagesSeed.ts` las páginas de empleo propias que el motor ya tiene dadas de alta.

Por qué existe: el cron de la web lee las páginas de empleo de las empresas vigiladas, y pedía la lista al motor
(`GET /v1/company-targets`). Esa ruta solo existe en el backend Python: en el Worker hospedado responde 404
(medido por el paquete C1, 2026-11-22), así que el cron solo leía las 2 páginas escritas a mano. En vez de inventar una
ruta nueva en el Worker, se emite aquí, con la forma que consume la app (un módulo tipado, sin JSON en tiempo de
ejecución), la lista semilla que el motor ya carga: `apps/api/career/data/company_targets.json`.

Qué lee (nada se inventa): las empresas con `monitoring` de página propia, ATS o feed (`careers_page`, `ats_page`,
`teamtailor_feed`) y una URL HTTPS en `careers_url`. Las `manual` y las de solo LinkedIn no entran.

Qué NO hace: no da de alta ninguna empresa nueva ni comprueba que la página siga viva (eso lo mide
`scripts/probe_company_pages.mjs`, que sí sale a internet); una página muerta se lee una vez al día, falla y se declara.

Uso: `python3 scripts/export_company_pages.py`
"""
import json
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
SEED = ROOT / 'apps/api/career/data/company_targets.json'
OUT = ROOT / 'apps/web/lib/companyPagesSeed.ts'
WATCHED = ('careers_page', 'ats_page', 'teamtailor_feed')


def public_https(value: str) -> bool:
    try:
        parsed = urlparse(value)
    except ValueError:
        return False
    host = (parsed.hostname or '').lower()
    return parsed.scheme == 'https' and '.' in host and not host.startswith(('localhost', '127.', '10.', '192.168.', '169.254.', '0.0.0.0'))


def build() -> list[dict]:
    data = json.loads(SEED.read_text(encoding='utf-8'))
    targets = data if isinstance(data, list) else data.get('targets', [])
    out, seen = [], set()
    for target in targets:
        url = (target.get('careers_url') or '').strip()
        if target.get('monitoring') not in WATCHED or not public_https(url) or url in seen:
            continue
        seen.add(url)
        out.append({'slug': str(target['slug']), 'name': str(target.get('name') or target['slug']), 'monitoring': target['monitoring'], 'url': url})
    return out


def render(rows: list[dict]) -> str:
    lines = [
        '// GENERADO por scripts/export_company_pages.py desde apps/api/career/data/company_targets.json. No editar a mano:',
        '// regenerar con `python3 scripts/export_company_pages.py`. Páginas de empleo propias, ATS y feeds que el motor ya vigila.',
        '',
        "export type CompanyPageSeed = { slug: string; name: string; monitoring: 'careers_page' | 'ats_page' | 'teamtailor_feed'; url: string };",
        '',
        'export const COMPANY_PAGES_SEED: readonly CompanyPageSeed[] = [',
    ]
    for row in rows:
        lines.append('  { slug: %s, name: %s, monitoring: %s, url: %s },' % tuple(json.dumps(row[k], ensure_ascii=False) for k in ('slug', 'name', 'monitoring', 'url')))
    lines += ['];', '']
    return '\n'.join(lines)


if __name__ == '__main__':
    OUT.write_text(render(build()), encoding='utf-8')
    print(f'{OUT.relative_to(ROOT)}: {len(build())} páginas')
