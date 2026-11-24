import { COOKIES_DATE, COOKIES_VERSION, legalEntity } from '../../lib/legal';

export const metadata = { title: 'Cookies · Women Digital Closer', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

// BORRADOR redactado a partir de lo que el portal guarda de verdad en el navegador (cookies de sesión y almacenamiento local).
// NO es asesoramiento legal: debe revisarlo un profesional antes de abrir el acceso. Si se añade una cookie nueva, se actualiza aquí.
export default function Page() {
  const e = legalEntity();
  return <main className="legal" aria-labelledby="t">
    <p className="eyebrow">COOKIES Y ALMACENAMIENTO LOCAL</p>
    <h1 id="t">Qué guarda el portal en tu navegador</h1>
    <p className="legal-draft" role="note"><strong>Borrador pendiente de revisión legal.</strong> Describe lo que el portal hace hoy.</p>

    <h2>1. Solo lo imprescindible</h2>
    <p>El portal <strong>no usa cookies de publicidad, de analítica ni de seguimiento</strong>, ni de terceros con esos fines. Solo guarda lo necesario para que funcione lo que tú pides, por lo que no necesita un banner de aceptación. Responsable: {e.name}. Contacto: {e.email}.</p>

    <h2>2. Cookies</h2>
    <div className="table-wrap"><table className="data-table">
      <thead><tr><th scope="col">Nombre</th><th scope="col">Para qué</th><th scope="col">Cuánto dura</th></tr></thead>
      <tbody>
        <tr><th scope="row">wdc_student_at</th><td>Mantiene tu sesión abierta en tu espacio de alumna (acceso).</td><td>Hasta una hora; se renueva mientras estás conectada.</td></tr>
        <tr><th scope="row">wdc_student_rt</th><td>Renueva tu sesión sin pedirte la contraseña a cada rato.</td><td>7 días, o hasta que cierras sesión.</td></tr>
        <tr><th scope="row">wdc_admin_at · wdc_admin_rt</th><td>Lo mismo, pero solo para el equipo que gestiona el panel de administración.</td><td>Hasta una hora y 7 días, respectivamente.</td></tr>
      </tbody>
    </table></div>
    <p>Son cookies de sesión «HttpOnly»: el código de la página no puede leerlas. Si las bloqueas, no podrás iniciar sesión.</p>

    <h2>3. Almacenamiento local de tu navegador</h2>
    <p>Para que recuerdes tu avance sin guardarlo en nuestros servidores, el portal usa el almacenamiento local de <strong>tu</strong> navegador: historial de prácticas, lecciones y cuestionarios completados, ofertas guardadas, pre-llamada y la frase del día. No sale de tu dispositivo, y se borra con «Borrar mis datos» en tu perfil o limpiando los datos del sitio en el navegador.</p>

    <h2>4. Voz</h2>
    <p>El dictado y la lectura en voz alta usan el reconocimiento y la síntesis de <strong>tu navegador</strong>, no cookies del portal; según el navegador, el audio puede ir a su proveedor (ver <a href="/privacidad">privacidad</a>). El micrófono solo se abre cuando pulsas el botón y tú das permiso.</p>

    <p className="legal-meta">Versión {COOKIES_VERSION} · {COOKIES_DATE} · <a href="/terminos">Términos y condiciones</a> · <a href="/privacidad">Privacidad</a> · <a href="/alumna">Volver a tu espacio</a></p>
  </main>;
}
