"""Colector de tableros de empresas (Greenhouse, Ashby, SmartRecruiters, Recruitee, Teamtailor) sin red.

Las respuestas de muestra siguen el contrato público documentado de cada ATS; NO son capturas reales (desde el entorno de desarrollo esas API
están bloqueadas): lo verificado aquí es la lógica propia (filtro de rol y mercado, un tablero caído no oculta a los demás, nada se inventa),
y el contrato real se verifica cuando el flujo corre en GitHub Actions."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))

import boards_collect as bc  # noqa: E402

GH = {'jobs': [
    {'id': 1, 'title': 'Closer de ventas', 'absolute_url': 'https://job-boards.greenhouse.io/acme/jobs/1', 'location': {'name': 'Madrid, Spain'}, 'updated_at': '2026-11-20T10:00:00-05:00',
     'content': '&lt;p&gt;Cierras llamadas con clientes. Escribe a rh@acme.com o al +34 600 111 222. Trabajo en equipo y experiencia en ventas para el equipo comercial.&lt;/p&gt;'},
    {'id': 2, 'title': 'Staff Software Engineer', 'absolute_url': 'https://job-boards.greenhouse.io/acme/jobs/2', 'location': {'name': 'Madrid, Spain'}, 'content': ''},
    {'id': 3, 'title': 'Sales Development Representative', 'absolute_url': 'https://job-boards.greenhouse.io/acme/jobs/3', 'location': {'name': 'San Francisco, CA'}, 'content': 'English only role in the US office.'},
    {'id': 4, 'title': 'SDR - LATAM', 'absolute_url': 'https://job-boards.greenhouse.io/acme/jobs/4', 'location': {'name': 'Remote - Mexico'}, 'content': '&lt;p&gt;Prospect and book meetings for our Latin America team.&lt;/p&gt;'},
]}
ASHBY = {'jobs': [
    {'id': 'a', 'title': 'Setter de citas', 'location': 'Barcelona', 'isRemote': False, 'isListed': True, 'publishedAt': '2026-11-18T09:00:00.000+00:00', 'jobUrl': 'https://jobs.ashbyhq.com/acme/a',
     'descriptionPlain': 'Agendas reuniones para el equipo de ventas. Experiencia previa en televenta y atención a clientes en España.', 'compensation': {'compensationTierSummary': '24.000 € – 30.000 € + variable'}},
    {'id': 'b', 'title': 'Closer', 'location': 'Remote', 'isRemote': True, 'isListed': False, 'jobUrl': 'https://jobs.ashbyhq.com/acme/b', 'descriptionPlain': 'x'},
    {'id': 'c', 'title': 'Account Executive', 'location': 'London', 'isRemote': False, 'isListed': True, 'jobUrl': 'https://jobs.ashbyhq.com/acme/c', 'descriptionPlain': 'x'},
]}
SR = {'content': [
    {'id': '7', 'name': 'Cold caller / Televenta', 'releasedDate': '2026-11-10T08:00:00.000Z', 'location': {'city': 'Sevilla', 'country': 'es', 'remote': False}, 'company': {'name': 'Acme'}},
    {'id': '8', 'name': 'Cold Caller', 'releasedDate': '2026-11-10T08:00:00.000Z', 'location': {'city': 'Berlin', 'country': 'de', 'remote': False}, 'company': {'name': 'Acme'}},
]}
REC = {'offers': [
    {'id': 9, 'title': 'Closer de ventas', 'careers_url': 'https://kodland.recruitee.com/o/closer', 'description': '<p>Cerrarás ventas por videollamada. Formación de ventas incluida y comisiones por cierre.</p>', 'requirements': '<p>Experiencia en ventas</p>',
     'location': 'Madrid, Spain', 'country_code': 'ES', 'remote': True, 'published_at': '2026-11-15 10:00:00 UTC'},
    {'id': 10, 'title': 'Teacher', 'careers_url': 'https://kodland.recruitee.com/o/teacher', 'description': '<p>x</p>', 'country_code': 'ES'},
]}
TT = '''<?xml version="1.0" encoding="UTF-8"?><rss version="2.0" xmlns:tt="https://teamtailor.com/locations"><channel>
<item><title>Closer de ventas high ticket 100% remoto</title><link>https://selectionbook.na.teamtailor.com/jobs/715018-closer</link><pubDate>Mon, 16 Nov 2026 10:00:00 +0000</pubDate>
<description>&lt;p&gt;Cierra llamadas con leads inbound. Experiencia en ventas y equipo comercial en España.&lt;/p&gt;</description><tt:locations><tt:location><tt:city>Madrid</tt:city><tt:country>Spain</tt:country></tt:location></tt:locations></item>
<item><title>Growth Specialist</title><link>https://selectionbook.na.teamtailor.com/jobs/1-growth</link><description>x</description></item></channel></rss>'''


def kept(candidates):
    return sorted(c['title'] for c in candidates)


def test_role_and_market_filters_per_ats():
    gh = bc.parse_greenhouse(GH, 'acme', 'Acme')
    assert kept(gh) == ['Closer de ventas', 'SDR - LATAM'], 'rol sí, ingeniero no, SDR de EE. UU. en inglés no, SDR de México sí'
    assert kept(bc.parse_ashby(ASHBY, 'acme', 'Acme')) == ['Setter de citas'], 'la oferta no listada y la de Londres se descartan'
    assert kept(bc.parse_smartrecruiters(SR, 'acme', 'Acme')) == ['Cold caller / Televenta']
    assert kept(bc.parse_recruitee(REC, 'kodland', 'Kodland')) == ['Closer de ventas']
    assert kept(bc.parse_teamtailor(TT, 'selectionbook.na', 'Selection Book')) == ['Closer de ventas high ticket 100% remoto']


def test_candidate_shape_never_invents_and_scrubs_contact_data():
    c = bc.parse_greenhouse(GH, 'acme', 'Acme')[0]
    assert c['url'] == 'https://job-boards.greenhouse.io/acme/jobs/1' and c['company'] == 'Acme' and c['external_id'] == 'greenhouse:acme:1'
    assert c['salary'] is None, 'Greenhouse no publica salario en este contrato: no se inventa'
    assert 'rh@acme.com' not in c['description'] and '600 111 222' not in c['description'] and '<p>' not in c['description']
    assert c['posted_at'].startswith('2026-11-20') and c['raw']['provider'] == 'boards_collect' and c['raw']['ats'] == 'greenhouse'
    a = bc.parse_ashby(ASHBY, 'acme', 'Acme')[0]
    assert a['salary'] == '24.000 € – 30.000 € + variable', 'solo la retribución que publica la empresa, tal cual'


def test_non_https_urls_and_missing_titles_are_dropped():
    bad = {'jobs': [{'id': 1, 'title': 'Closer', 'absolute_url': 'http://insegura.example.com/1', 'location': {'name': 'Madrid'}, 'content': 'x'}, {'id': 2, 'absolute_url': 'https://x.example.com/2'}]}
    assert bc.parse_greenhouse(bad, 'acme', 'Acme') == []


def test_one_dead_board_does_not_hide_the_working_ones():
    boards = [{'ats': 'greenhouse', 'slug': 'acme', 'name': 'Acme'}, {'ats': 'greenhouse', 'slug': 'muerta', 'name': 'Muerta'}, {'ats': 'ashby', 'slug': 'acme', 'name': 'Acme'}]

    def fetch(url):
        if 'muerta' in url:
            raise bc.FetchError(404, 'HTTP 404')
        return GH if 'greenhouse' in url else ASHBY

    report, by_source = bc.collect(boards, fetch=fetch, workers=1)
    assert report['boards_ok'] == 2 and report['boards_failed'] == 1 and report['errors'][0]['slug'] == 'muerta' and '404' in report['errors'][0]['error']
    assert sorted(by_source) == ['ats-greenhouse', 'ats-ashby'] or sorted(by_source) == ['ats-ashby', 'ats-greenhouse']
    assert len(by_source['ats-greenhouse']) == 2 and len(by_source['ats-ashby']) == 1


def test_all_boards_failing_is_declared_not_zero():
    report, by_source = bc.collect([{'ats': 'greenhouse', 'slug': 'acme', 'name': 'Acme'}], fetch=lambda url: (_ for _ in ()).throw(bc.FetchError(403, 'HTTP 403')), workers=1)
    assert report['boards_ok'] == 0 and report['boards_failed'] == 1 and by_source == {} and report['all_failed'] is True


def test_duplicate_urls_across_boards_are_sent_once():
    boards = [{'ats': 'greenhouse', 'slug': 'acme', 'name': 'Acme'}, {'ats': 'greenhouse', 'slug': 'acme', 'name': 'Acme'}]
    report, by_source = bc.collect(boards, fetch=lambda url: GH, workers=1)
    assert len(by_source['ats-greenhouse']) == 2


def test_deadline_cuts_and_declares_truncated():
    boards = [{'ats': 'greenhouse', 'slug': f'b{i}', 'name': 'B'} for i in range(5)]
    report, _ = bc.collect(boards, fetch=lambda url: GH, workers=1, deadline=0)
    assert report['truncated'] is True and report['boards_skipped'] == 5


def test_seed_is_valid_and_has_no_duplicates():
    seed = json.loads((Path(__file__).resolve().parents[1] / 'scripts' / 'boards_seed.json').read_text(encoding='utf-8'))
    boards = seed['boards']
    assert len(boards) >= 50 and all(b['ats'] in bc.ADAPTERS and b['slug'] for b in boards)
    keys = [(b['ats'], b['slug']) for b in boards]
    assert len(keys) == len(set(keys))
    assert all(__import__('re').fullmatch(r'[a-z0-9._-]+', b['slug']) for b in boards), 'los identificadores van a una URL: solo caracteres seguros'


def test_post_batches_by_source_and_reports_failures():
    sent = []

    def post(source, items, note):
        if source == 'ats-ashby':
            raise RuntimeError('HTTP 503')
        sent.append((source, len(items)))

    by_source = {'ats-greenhouse': [{'a': i} for i in range(250)], 'ats-ashby': [{'a': 1}]}
    result = bc.send(by_source, post, {'boards_ok': 2})
    assert sent == [('ats-greenhouse', 100), ('ats-greenhouse', 100), ('ats-greenhouse', 50)]
    assert result['sent'] == 250 and result['send_failed'][0]['source'] == 'ats-ashby'
