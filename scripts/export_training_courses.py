"""Genera `apps/web/lib/trainingCourses.ts` desde la hoja del propietario (única fuente de la formación).

Hoja: «Women Digital Closers — Inventario» (pestañas Resumen, Lecciones y Recursos). Descarga el .xlsx público
o usa uno local:

    .venv/bin/python scripts/export_training_courses.py                # descarga la hoja pública
    .venv/bin/python scripts/export_training_courses.py --file x.xlsx  # desde un archivo

Qué se copia literalmente: orden de los cursos, títulos, descripciones, duraciones que declara Skool, el orden de
las lecciones, su **carpeta** (solo «Clases Grupales» agrupa las suyas) y los enlaces de recursos tal como están.
Nada se corrige ni se inventa: las erratas de la hoja viajan igual al portal.

Los identificadores son lo único que no viene de la hoja: los cursos conservan los suyos (`COURSE_IDS`) para no
romper el avance ya guardado de las alumnas, y las lecciones se numeran `curso.n` en el orden de la hoja.
"""
import argparse
import io
import urllib.request
from pathlib import Path

from openpyxl import load_workbook

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'apps/web/lib/trainingCourses.ts'
SHEET_URL = 'https://docs.google.com/spreadsheets/d/1DiZKV7G5GCLwWEjZtv3DCbK37K7SVaO4ZIiGTNVrWeI/export?format=xlsx'

# Identificadores históricos de los cursos, casados por TÍTULO de la hoja: la alumna ya tiene avance guardado con
# ellos (`wdc_training_lessons`) y las referencias del panel los usan. Van por título, no por posición, para que
# insertar o reordenar un curso en la hoja no le pegue el identificador de otro (borraría progreso real).
COURSE_IDS = {
    'Onboarding': 'onboarding',
    'Fundamentos del High Ticket': 'fundamentos-del-high-ticket',
    'Identidad profesional de la closer': 'identidad-profesional-de-la-closer',
    'Fundamentos de Marketing': 'fundamentos-de-marketing',
    'Psicología de Decisión del Cliente': 'psicologia-de-decision-del-cliente',
    'Estructura de la Llamada': 'estructura-de-la-llamada',
    'Gestión de las objeciones.': 'gestion-de-las-objeciones',
    'Domina el Seguimiento': 'domina-el-seguimiento',
    'Comunicación': 'comunicacion',
    'Herramientas': 'herramientas',
    'Captación de proyectos': 'captacion-de-proyectos',
    'Clases Grupales': 'clases-grupales',
}


def clean(value) -> str:
    return '' if value is None else str(value).strip()


def duration(value) -> str:
    """Duración de la hoja en `h:mm:ss`. Excel la guarda como duración (puede pasar de 24 h: «2 days, 7:05:12»)."""
    text = clean(value)
    if ' day' in text:  # «1 day, 0:36:52» / «3 days, 22:10:58» → horas sumadas
        days, _, rest = text.partition(',') if ',' in text else (text, '', '')
        count = int(days.split()[0])
        hours, minutes, seconds = rest.strip().split(':')
        return f'{count * 24 + int(hours)}:{minutes}:{seconds}'
    return text


def js(text: str) -> str:
    return "'" + text.replace('\\', '\\\\').replace("'", "\\'").replace('\n', '\\n') + "'"


def fetch(path: Path | None = None):
    if path is None:
        with urllib.request.urlopen(SHEET_URL, timeout=60) as response:  # noqa: S310 - URL fija del propietario
            return load_workbook(io.BytesIO(response.read()), data_only=True)
    return load_workbook(path, data_only=True)


def body(worksheet, header_first_cell: str):
    """Filas de datos de una pestaña con su número de fila, localizadas por su cabecera.

    Las hojas llevan un bloque de títulos arriba que el propietario puede ampliar; si eso pasara, un recorte
    fijo leería la cabecera como si fuera una lección. Se busca la cabecera por su primera celda. Se conserva
    el número de fila porque el enlace a la clase de Skool vive en el hipervínculo de la celda («Abrir
    lección», «Abrir curso»), no en su texto.
    """
    rows = [[cell.value for cell in row] for row in worksheet.iter_rows()]
    for index, row in enumerate(rows):
        if clean(row[0]).lower() == header_first_cell.lower():
            return [(index + 2 + offset, values) for offset, values in enumerate(rows[index + 1:])]
    raise SystemExit(f"No se encontró la cabecera {header_first_cell!r} en la pestaña {worksheet.title!r}.")


def link(worksheet, row_number: int, column: int) -> str:
    """Hipervínculo de una celda, tal cual lo puso el propietario. Vacío si la celda no enlaza nada."""
    cell = worksheet.cell(row=row_number, column=column)
    if cell.hyperlink is None or not cell.hyperlink.target:
        return ''
    return str(cell.hyperlink.target).strip()


def parse(workbook):
    """Hojas → cursos con sus lecciones (y su carpeta) y los recursos de cada lección, en el orden de la hoja."""
    summary = body(workbook['Resumen'], 'Orden')
    lessons_sheet = body(workbook['Lecciones'], 'Orden curso')
    resources_sheet = body(workbook['Recursos'], 'Lección ID')

    courses = []
    for row_number, row in summary:
        order, title = clean(row[0]), clean(row[1])
        if title.upper() == 'TOTAL':  # detrás vienen el TOTAL y el desglose por carpetas: no son cursos
            break
        if not order or not title:  # filas en blanco entre medias
            continue
        if title not in COURSE_IDS:
            raise SystemExit(f'El curso «{title}» no tiene identificador. Añádelo a COURSE_IDS (sin tocar los existentes).')
        courses.append({'order': int(float(order)), 'title': title, 'duration': duration(row[3]),
                        'summary': clean(row[6]), 'url': link(workbook['Resumen'], row_number, 6),
                        'lessons': []})

    by_title = {course['title']: course for course in courses}
    for row_number, row in lessons_sheet:
        course_title, folder, title = clean(row[1]), clean(row[2]), clean(row[4])
        if not course_title or not title:
            continue
        course = by_title.get(course_title)
        if course is None:
            raise SystemExit(f'La lección «{title}» apunta a un curso que no está en Resumen: {course_title!r}')
        course['lessons'].append({'title': title, 'duration': duration(row[5]),
                                  'folder': None if folder in ('', 'Sin carpeta') else folder,
                                  'url': link(workbook['Lecciones'], row_number, 8), 'resources': []})
    for course in courses:
        for number, lesson in enumerate(course['lessons'], start=1):
            lesson['id'] = f"{course['order']}.{number}"

    index = {(course['title'], lesson['title']): lesson for course in courses for lesson in course['lessons']}
    for _row_number, row in resources_sheet:
        name, url = clean(row[3]), clean(row[5])
        if not name:
            continue
        lesson = index.get((clean(row[1]), clean(row[2])))
        if lesson is None:
            raise SystemExit(f'Recurso «{name}» sin lección: {row[1]!r} / {row[2]!r}')
        lesson['resources'].append({'name': name, 'url': url})
    return courses


def render(courses) -> str:
    lessons_total = sum(len(course['lessons']) for course in courses)
    resources_total = sum(len(lesson['resources']) for course in courses for lesson in course['lessons'])
    lines = [
        '// Formación de Women Digital Closers, tal como está en la hoja del propietario',
        f"// («Women Digital Closers — Inventario», revisión 10/10/2026): {len(courses)} cursos, "
        f'{lessons_total} lecciones y {resources_total} recursos.',
        '// Es el único índice de la sección Formación: lo que no esté aquí no se muestra en el portal.',
        '// Generado desde la hoja con `scripts/export_training_courses.py`: no se edita a mano. Las duraciones son las',
        '// que declara Skool, los recursos se enlazan tal cual y `folder` es la carpeta de la hoja (solo «Clases Grupales» usa carpetas).',
        '// `url` es el enlace de la hoja a la clase de Skool: el del curso abre el módulo y el de la lección abre',
        '// esa clase concreta. Si una fila no trae enlace, el portal enlaza el del módulo y dice el nombre.',
        '',
        'export type TrainingResource = { name: string; url: string };',
        'export type TrainingLesson = { id: string; title: string; duration: string; folder?: string; url?: string; resources: TrainingResource[] };',
        'export type TrainingCourse = {',
        '  id: string;',
        '  order: number;',
        '  title: string;',
        '  summary: string;',
        '  duration: string;',
        '  /** Enlace de la hoja al módulo en el Classroom de Skool. */',
        '  url?: string;',
        '  lessons: TrainingLesson[];',
        '};',
        '',
        'export const TRAINING_COURSES: TrainingCourse[] = [',
    ]
    for course in courses:
        lines += [
            '  {',
            f"    id: {js(COURSE_IDS[course['title']])},",
            f"    order: {course['order']},",
            f"    title: {js(course['title'])},",
            f"    summary: {js(course['summary'])},",
            f"    duration: {js(course['duration'])},",
            (f"    url: {js(course['url'])}," if course['url'] else ''),
            '    lessons: [',
        ]
        for lesson in course['lessons']:
            folder = f", folder: {js(lesson['folder'])}" if lesson['folder'] else ''
            class_url = f", url: {js(lesson['url'])}" if lesson['url'] else ''
            if lesson['resources']:
                resources = '[' + ', '.join(
                    f"{{ name: {js(r['name'])}, url: {js(r['url'])} }}" for r in lesson['resources']) + ']'
            else:
                resources = '[]'
            lines.append(f"      {{ id: {js(lesson['id'])}, title: {js(lesson['title'])}, "
                         f"duration: {js(lesson['duration'])}{folder}{class_url}, resources: {resources} }},")
        lines += ['    ],', '  },']
    lines += [
        '];',
        '',
        'export const TOTAL_LESSONS = TRAINING_COURSES.reduce((sum, course) => sum + course.lessons.length, 0);',
        'export const TOTAL_RESOURCES = TRAINING_COURSES.reduce((sum, course) => sum + course.lessons.reduce((n, lesson) => n + lesson.resources.length, 0), 0);',
        'export const courseById = (id: string) => TRAINING_COURSES.find(course => course.id === id) ?? null;',
        '',
    ]
    return '\n'.join(lines)


def main(argv=None) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument('--file', type=Path, help='xlsx local en vez de descargar la hoja pública')
    args = parser.parse_args(argv)
    courses = parse(fetch(args.file))
    if len(courses) != len(COURSE_IDS):
        raise SystemExit(f'La hoja tiene {len(courses)} cursos y hay {len(COURSE_IDS)} identificadores: revisa '
                         'COURSE_IDS (los identificadores existentes no se cambian: borrarían el avance guardado).')
    OUT.write_text(render(courses), encoding='utf-8')
    lessons = sum(len(course['lessons']) for course in courses)
    resources = sum(len(lesson['resources']) for course in courses for lesson in course['lessons'])
    print(f"{len(courses)} cursos, {lessons} lecciones, {resources} recursos → {OUT.relative_to(ROOT)}")


if __name__ == '__main__':
    main()
