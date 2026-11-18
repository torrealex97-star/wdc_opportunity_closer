"""Evidence-based language and role rules shared by acquisition and student views."""
import re
import unicodedata


def fold(text):
    return ''.join(c for c in unicodedata.normalize('NFD', text.lower()) if unicodedata.category(c) != 'Mn')


def language_evidence(description):
    text = fold(description)
    english_only = bool(re.search(
        r'\b(?:english[- ]only|only (?:in )?english|strictly in english|exclusively in english|'
        r'english (?:remains|is) the (?:primary|sole|only) working language|'
        r'solo (?:en )?ingles|exclusivamente en ingles|idioma (?:principal|de trabajo)[: ]+ingles)\b', text))
    negative = bool(re.search(r'\b(?:spanish (?:is )?not (?:required|needed)|no (?:se )?requiere espanol)\b', text))
    # Count distinctive Spanish words, not shared Portuguese/English tokens or a footer mention.
    es = set(re.findall(r'\b(?:buscamos|ofrecemos|equipo|ventas|puesto|funciones|formacion|trabajar|'
                        r'nuestro|nuestra|tienes|seras|salario|horario|comisiones|'
                        r'necesitamos|incorporacion|llamadas|remuneracion|contratamos|tareas)\b', text))
    en = set(re.findall(r'\b(?:the|we|you|your|our|with|and|requirements|responsibilities|experience|'
                        r'must|will|looking|seeking|hiring|benefits|skills|required|qualifications)\b', text))
    spanish_text = len(es) >= 3 and len(es) >= len(en)
    # Required or used in the job; a nice-to-have/secondary Spanish mention isn't enough.
    clauses = re.split(r'[.!?\n]+', text)
    required_spanish = False
    required_english = False
    for clause in clauses:
        if re.search(r'\b(?:preferred|bonus|nice.to.have|optional|secondary|deseable|valorable|curso|course)\b', clause):
            continue
        if re.search(r'\b(?:spanish|espanol|castellano)\b', clause) and re.search(
                r'\b(?:bilingual|bilingue|fluent|fluency|required|must|proficien\w*|speaking|spoken|communication|'
                r'requiere|requerido|dominio|nativo|hablantes|idioma|atencion|clientes)\b', clause):
            required_spanish = True
        if re.search(r'\b(?:english|ingles)\b', clause) and re.search(
                r'\b(?:bilingual|fluent|fluency|required|must|proficien\w*|communication|requiere|requerido|dominio|nivel|bilingue)\b', clause):
            required_english = True
    return {'eligible': not english_only and not negative and (spanish_text or required_spanish),
            'spanish_text': spanish_text, 'english_required': required_english,
            'spanish_required': required_spanish, 'english_only': english_only}


def professional_role(title, description):
    """Families from the canonical vocabulary (vocabulary.py): many employers use
    'asesor de admisiones', 'sales advisor' or 'patient coordinator' for closing jobs."""
    from .vocabulary import ROLE_FAMILIES
    title, body = fold(title), fold(description)
    if title == 'publicacion de comunidad':
        hiring = re.search(r'\b(?:busco|buscamos|necesitamos|contratamos|se busca|estamos buscando)\b(?:\s+\w+){0,4}\s+(closer|setter|cerrador[ae]?|appointment setter|cold caller)\b', body)
        if not hiring:
            return None
        title = hiring.group(1)
    def hits(family):
        return any(re.search(r'(?<!\w)' + re.escape(term) + r'(?!\w)', title) for term in ROLE_FAMILIES[family])
    if hits('cold_caller'):
        return 'cold_caller'
    if hits('setter'):
        return 'setter'
    if hits('closer'):
        return 'closer'
    # Antes que account_executive: «Jefe de equipo comercial» contiene «comercial».
    if hits('management'):
        return 'management'
    if hits('account_executive'):
        return 'account_executive'
    if hits('sdr'):
        return 'sdr'
    if re.search(r'\b(?:comercial|ventas|sales|asesor[ae]?|enrollment|admisiones)\b', title) and re.search(
            r'\b(?:cerrar (?:la |su |las )?(?:venta|inscripcion|matricula)|cierre (?:de |comercial)|closing (?:sales|deals))', body):
        return 'closer'
    return None


# Modalidad declarada, no supuesta. Antes, todo anuncio sin «híbrido» se publicaba como «Remoto»:
# una invención que además escondía las presenciales. Las palabras son las mismas que usa el motor
# (worker.js, `modalityOf`) para que el modo local y el dominio digan lo mismo de la misma oferta.
HYBRID_WORDS = re.compile(r'\b(?:hybrid|hibrid[oa]s?|semi[ -]?presencial|mixt[oa])\b')
REMOTE_WORDS = re.compile(r'\b(?:remote|remot[oa]s?|teletrabajo|home[ -]?office|work from home|en remoto|100[ %]*remoto)\b')
ONSITE_WORDS = re.compile(r'\b(?:presencial(?:es)?|on[ -]?site|in[ -]?office|en oficina|acude a la oficina)\b')


def declared_modality(description, work_mode=''):
    hay = fold(f'{work_mode or ""} {description or ""}')
    if HYBRID_WORDS.search(hay):
        return 'Híbrido'
    if REMOTE_WORDS.search(hay):
        return 'Remoto'
    if ONSITE_WORDS.search(hay):
        return 'Presencial'
    return 'Modalidad no indicada'


# Prospección: no es un campo que ninguna fuente publique. Se declara solo cuando el anuncio lo
# dice («llamadas en frío», «outbound», «leads entrantes») y la negación cuenta al contrario
# («sin llamadas en frío» no es una oferta de prospección en frío).
OUTBOUND_WORDS = re.compile(r'\b(?:outbound|cold[ -]?call(?:s|ing)?|llamada fria|llamadas frias|prospeccion en frio|prospeccion telefonica|puerta fria)\b')
INBOUND_WORDS = re.compile(r'\b(?:inbound|leads? entrantes?|incoming leads|leads? inbound|leads? proporcionados)\b')
# La negación vale dentro de la misma cláusula: en «sin llamadas en frío, leads entrantes» el
# «sin» no niega lo entrante (la coma corta), y «no hay llamadas en frío» sí lo niega.
NEGATION = re.compile(r'\b(?:sin|no|nunca|ni|without|not)\b[^,.;:\n]{0,25}$')


def sales_motion(text):
    hay = fold(text or '')
    def mentioned(pattern):
        for match in pattern.finditer(hay):
            if not NEGATION.search(hay[max(0, match.start() - 40):match.start()]):
                return True
        return False
    if mentioned(OUTBOUND_WORDS):
        return 'outbound'
    if mentioned(INBOUND_WORDS):
        return 'inbound'
    return None


def explicitly_closed(title, description):
    """Only standalone affirmative status markers, not sales-closing duties."""
    text = fold(title + '\n' + description)
    marker = (
        r'(?:estado:\s*)?(?:'
        r'(?:esta )?vacante (?:ya )?(?:esta )?(?:cubierta|cerrada)|'
        r'proceso de (?:seleccion|contratacion) (?:cerrado|finalizado)|'
        r'(?:this )?(?:position|vacancy|role) (?:has been |is )filled|'
        r'applications (?:are )closed)'
    )
    return bool(re.search(r'(?:^|[\n.!?])\s*' + marker + r'\s*(?=$|[\n.!?])', text))
