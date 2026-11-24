"""Recolector del feed de Workable sin red: filtro de rol y mercado, un registro por URL, feed cortado, enriquecimiento y datos de contacto."""
import gzip
import io
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))

import workable_collect as wc  # noqa: E402


def job(title, url, country='ES', company='Acme', ref='r1', city='Madrid', remote='false', date='Wed, 28 Jul 2021 10:24:17 UTC'):
    return (f'<job><title>{title}</title><date>{date}</date><referencenumber>{ref}</referencenumber><url>{url}</url><company>{company}</company>'
            f'<city>{city}</city><state></state><country>{country}</country><remote>{remote}</remote></job>')


def feed(*jobs):
    return ('<?xml version="1.0"?><source>' + ''.join(jobs) + '</source>').encode()


U = 'https://apply.workable.com/acme/j/ABC123/'


def test_keeps_only_target_roles_in_target_markets():
    xml = feed(job('Closer de ventas', U, ref='1'), job('Bed Setter', 'https://apply.workable.com/a/j/B/', ref='2', country='US'),
               job('Software Engineer', 'https://apply.workable.com/a/j/C/', ref='3'), job('Appointment Setter', 'https://apply.workable.com/a/j/D/', ref='4', country='DE'),
               job('Setter de citas comerciales', 'https://apply.workable.com/a/j/E/', ref='5', country='US'))
    out, stats = wc.parse_feed(io.BytesIO(xml))
    titles = sorted(c['title'] for c in out)
    assert titles == ['Closer de ventas', 'Setter de citas comerciales'], titles   # «Bed Setter» no es el rol; DE sin título en español queda fuera
    assert stats == {'jobs_in_feed': 5, 'kept': 2}


def test_one_record_per_url_with_all_locations_and_untouched_url():
    xml = feed(job('Closer', U, ref='1', city='Madrid'), job('Closer', U, ref='1', city='Barcelona', remote='true'))
    out, _ = wc.parse_feed(io.BytesIO(xml))
    assert len(out) == 1 and out[0]['url'] == U and 'Madrid' in out[0]['location'] and 'Barcelona' in out[0]['location']
    assert out[0]['raw']['is_remote'] is True and out[0]['posted_at'] and out[0]['description'] is None


def test_non_https_and_missing_fields_are_dropped():
    xml = feed(job('Closer', 'http://apply.workable.com/a/j/X/'), job('Closer', U, company=''))
    assert wc.parse_feed(io.BytesIO(xml))[0] == []


def test_truncated_feed_raises_instead_of_returning_a_partial_result():
    cut = feed(job('Closer', U))[:-30]
    try:
        wc.parse_feed(io.BytesIO(cut))
        raise AssertionError('debía fallar')
    except ET.ParseError:
        pass
    report = wc.run(io.BytesIO(cut), dry_run=False, post=lambda *a: (_ for _ in ()).throw(AssertionError('no debe enviar')))
    assert report['truncated'] is True and 'error' in report


def test_gzip_feed_is_read_and_posts_in_batches_with_note():
    jobs = [job('Closer', f'https://apply.workable.com/a/j/J{i}/', ref=str(i)) for i in range(120)]
    sent = []
    report = wc.run(io.BytesIO(gzip.compress(feed(*jobs))), dry_run=False, post=lambda items, note: sent.append((len(items), note)),
                    enrich_fn=lambda cands: (0, [], 0))
    assert [n for n, _ in sent] == [100, 20] and report['kept'] == 120 and report['truncated'] is False
    assert 'sin verificar' in sent[0][1] and len(sent[0][1]) <= 300


def test_dry_run_sends_nothing():
    sent = []
    wc.run(io.BytesIO(feed(job('Closer', U))), dry_run=True, post=lambda *a: sent.append(a), enrich_fn=lambda c: (0, [], 0))
    assert sent == []


def test_detail_url_only_for_known_pattern():
    assert wc.detail_url(U) == 'https://apply.workable.com/api/v2/accounts/acme/jobs/ABC123'
    assert wc.detail_url('https://evil.example/acme/j/ABC123/') is None and wc.detail_url('https://apply.workable.com/acme/') is None


def test_enrich_strips_html_contacts_and_reports_failures_without_inventing():
    cands = [{'url': U, 'description': None}, {'url': 'https://apply.workable.com/b/j/Z9/', 'description': None}, {'url': 'https://otro.com/x', 'description': None}]

    def fetch(api):
        if '/b/' in api:
            raise TimeoutError()
        return {'description': '<p>Vende por teléfono. Escribe a rrhh@acme.com o llama al +34 600 123 456.</p>', 'requirements': '<li>Experiencia</li>'}

    done, failed, skipped = wc.enrich(cands, fetch=fetch, sleep=lambda s: None)
    assert done == 1 and len(failed) == 2 and skipped == 0
    text = cands[0]['description']
    assert 'rrhh@acme.com' not in text and '600 123' not in text and '<p>' not in text and 'Vende por teléfono' in text
    assert cands[1]['description'] is None and cands[2]['description'] is None


def test_enrich_respects_the_cap():
    cands = [{'url': f'https://apply.workable.com/a/j/K{i}/', 'description': None} for i in range(5)]
    done, failed, skipped = wc.enrich(cands, fetch=lambda api: {'description': 'texto'}, sleep=lambda s: None, limit=3)
    assert done == 3 and skipped == 2 and cands[4]['description'] is None
