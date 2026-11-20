"""La formación del portal es la hoja del propietario, sin perder estructura.

Reglas que fija este archivo (el contenido se regenera con `scripts/export_training_courses.py`; el test no
descarga la hoja para no depender de la red en CI):

1. 12 cursos, 130 lecciones y 55 recursos: los totales que la hoja declara en su fila TOTAL.
2. Los identificadores de curso son estables (el avance guardado de la alumna vive en ellos) y las lecciones
   se numeran `curso.n` sin huecos ni repetidos.
3. Las carpetas de la hoja llegan al portal: solo «Clases Grupales» las tiene, y reparten sus 35 lecciones en
   9 + 15 + 4 + 7, contiguas y en el mismo orden que la hoja.
4. Cada recurso tiene nombre y un enlace http(s); ninguno se queda sin lección.
"""
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

EXPECTED_COURSES = [
    'onboarding',
    'fundamentos-del-high-ticket',
    'identidad-profesional-de-la-closer',
    'fundamentos-de-marketing',
    'psicologia-de-decision-del-cliente',
    'estructura-de-la-llamada',
    'gestion-de-las-objeciones',
    'domina-el-seguimiento',
    'comunicacion',
    'herramientas',
    'captacion-de-proyectos',
    'clases-grupales',
]
# Carpetas de la hoja para «Clases Grupales», en su orden y con sus tamaños (9 + 15 + 4 + 7 = 35).
EXPECTED_FOLDERS = [('Clases grupales', 9), ('Roleplay Cualificación', 15), ('Objeciones', 4), ('Llamada completa', 7)]


def courses():
    run = subprocess.run(
        ['node', '--experimental-strip-types', '--no-warnings', 'tests/training-courses.mjs'],
        cwd=ROOT, capture_output=True, text=True, timeout=60, check=True)
    return json.loads(run.stdout)


def test_totals_match_the_sheet():
    rows = courses()
    assert len(rows) == 12
    assert sum(len(row['lessons']) for row in rows) == 130
    assert sum(len(lesson['resources']) for row in rows for lesson in row['lessons']) == 55


def test_course_ids_are_stable_and_in_order():
    rows = courses()
    assert [row['id'] for row in rows] == EXPECTED_COURSES
    assert [row['order'] for row in rows] == list(range(1, 13))


def test_lesson_ids_are_sequential_without_gaps():
    for row in courses():
        ids = [lesson['id'] for lesson in row['lessons']]
        assert ids == [f"{row['order']}.{n}" for n in range(1, len(ids) + 1)], row['id']
        # el id lleva el número del curso: si se reordena la hoja, no se puede reciclar el de otro
        assert all(lesson_id.split('.')[0] == str(row['order']) for lesson_id in ids)


def test_only_the_grouped_course_has_folders_and_they_keep_the_sheet_order():
    for row in courses():
        folders = [lesson.get('folder') for lesson in row['lessons']]
        if row['id'] != 'clases-grupales':
            assert not any(folders), f"{row['id']} no tiene carpetas en la hoja"
            continue
        # cada carpeta aparece en un solo bloque contiguo y en el orden de la hoja
        runs = [folder for i, folder in enumerate(folders) if i == 0 or folders[i - 1] != folder]
        assert runs == [name for name, _ in EXPECTED_FOLDERS]
        sizes = [(name, folders.count(name)) for name, _ in EXPECTED_FOLDERS]
        assert sizes == EXPECTED_FOLDERS


def test_every_resource_has_a_name_and_an_http_link():
    for row in courses():
        for lesson in row['lessons']:
            assert lesson['duration'], f"{lesson['id']} sin duración"
            for resource in lesson['resources']:
                assert resource['name'].strip(), f"{lesson['id']} con recurso sin nombre"
                assert re.match(r'^https?://', resource['url']), f"{lesson['id']}: {resource['url']!r}"


def test_course_durations_are_declared_by_the_source():
    for row in courses():
        assert re.match(r'^\d+:\d{2}:\d{2}$', row['duration']), f"{row['id']}: {row['duration']!r}"


# Enlaces a las clases de Skool: los pone el propietario en la hoja («Abrir curso», «Abrir lección») y el
# portal no los construye. El módulo es obligatorio; la lección, si la hoja la enlaza, tiene que ser suya.
SKOOL_URL = re.compile(r'^https://www\.skool\.com/women-digital-closers/classroom/[0-9a-f]{8}(\?md=[0-9a-f]{32})?$')


def test_every_module_opens_its_skool_class():
    rows = courses()
    for row in rows:
        assert SKOOL_URL.match(row.get('url') or ''), f"{row['id']}: el módulo abre su clase de Skool"


def test_lesson_links_are_real_and_not_shared():
    rows = courses()
    linked = [lesson for row in rows for lesson in row['lessons'] if lesson.get('url')]
    for lesson in linked:
        assert SKOOL_URL.match(lesson['url']), f"{lesson['id']}: enlace de Skool con la forma de la hoja"
        assert '?md=' in lesson['url'], f"{lesson['id']}: el enlace apunta a la lección, no solo al módulo"
    assert len({lesson['url'] for lesson in linked}) == len(linked), 'dos lecciones no comparten enlace'
    # Todas las lecciones de la hoja vienen enlazadas; si alguna se quedara sin enlace, el portal abre el
    # módulo y dice el nombre (por eso el mínimo, no la igualdad: una hoja futura puede dejar un hueco).
    assert len(linked) >= 120, f'solo {len(linked)} lecciones con enlace propio'
