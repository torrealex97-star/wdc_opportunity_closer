import EmployerForm from '../../components/EmployerForm';
import { EMPLOYER_TERMS_DATE, EMPLOYER_TERMS_TEXT, EMPLOYER_TERMS_VERSION } from '../../lib/legal';

export const metadata = { title: 'Publica una oferta de closer o setter · Women Digital Closer', description: 'Las empresas que buscan closers, setters o cold callers pueden enviar su oferta a las alumnas de Women Digital Closers.' };
export const dynamic = 'force-dynamic';

export default function Page() {
  return <main className="legal" aria-labelledby="t">
    <p className="eyebrow">PARA EMPRESAS</p>
    <h1 id="t">Publica tu oferta de closer, setter o cold calling</h1>
    <p>Women Digital Closers forma a closers y setters en español. Si tu empresa busca ventas por llamada o por videollamada, envía aquí tu oferta: una persona del equipo la revisa y, si encaja, la ven nuestras alumnas. <strong>No cobramos nada</strong> por publicarla.</p>
    <p className="card-meta">Solo ofertas reales, con enlace donde aplicar y pago escrito por la empresa. Nada se publica sin revisión.</p>
    <EmployerForm terms={EMPLOYER_TERMS_TEXT} />
    <p className="legal-meta">Términos del formulario: {EMPLOYER_TERMS_VERSION} · {EMPLOYER_TERMS_DATE}.</p>
  </main>;
}
