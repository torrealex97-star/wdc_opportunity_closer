'use client';
import { Lightbulb } from 'lucide-react';
import { IDEA_COST_LABEL, IDEA_HOW_LABEL, SOURCE_IDEAS, type IdeaFamily } from '../lib/sourceIdeas';

// Fuentes del SOP diario que la app puede incorporar. Se muestran con lo que se sabe y lo que no:
// las comunidades exigen sesión propia y se quedan como ritual manual, no como recogida automática.
const FAMILIES: IdeaFamily[] = ['España', 'LatAm', 'Freelance', 'Remoto', 'Agregadores', 'Comunidades'];
// Una URL inválida en los datos no debe tumbar todo el panel; y solo se enlaza http(s), nunca `javascript:`.
function safeUrl(raw: string): URL | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch { return null; }
}

export default function SourceIdeas() {
  const open = SOURCE_IDEAS.filter(i => i.how !== 'manual').length;
  return <details className="source-ideas" style={{ marginBottom: 20 }}>
    <summary style={{ cursor: 'pointer' }}>
      <Lightbulb size={16} aria-hidden="true" /> Fuentes que aún no se recogen ({SOURCE_IDEAS.length}) · {open} se pueden añadir desde aquí
    </summary>
    <p className="card-meta" style={{ marginTop: 12 }}>
      Tomadas del SOP diario de WDC. Solo se listan las que el documento da con enlace real. Las comunidades
      (Facebook, Telegram) piden sesión personal y sus normas no permiten recogida automática: quedan como
      ritual manual de la alumna. Google Jobs usa 7 búsquedas al día (4 España + 3 LatAm): 0,0175 USD con
      JSearch y hasta 0,175 USD si caen a SerpApi. Para ampliarlo, sube <code>SERPAPI_JOBS_MAX_DORKS</code>;
      cada búsqueda extra cuesta 0,0025 USD con JSearch y 0,025 USD con SerpApi.
    </p>
    {FAMILIES.map(family => {
      const rows = SOURCE_IDEAS.filter(i => i.family === family);
      if (!rows.length) return null;
      return <div key={family} style={{ marginTop: 12 }}>
        <h4 className="eyebrow" style={{ marginBottom: 6 }}>{family}</h4>
        <div className="table-wrap"><table className="data-table">
          <thead><tr><th>Fuente</th><th>Por qué</th><th>Vía</th><th>Coste</th><th>Búsqueda</th></tr></thead>
          <tbody>{rows.map(i => { const url = safeUrl(i.url); return <tr key={i.url}>
            <td className="primary-cell"><strong>{url ? <a href={url.href} target="_blank" rel="noopener noreferrer">{i.name}</a> : i.name}</strong><span>{url ? url.hostname.replace(/^www\./, '') : 'Enlace no válido'}</span></td>
            <td style={{ maxWidth: 380 }}>{i.why}</td>
            <td>{IDEA_HOW_LABEL[i.how]}</td>
            <td>{IDEA_COST_LABEL[i.cost]}</td>
            <td><code>{i.terms}</code></td>
          </tr>; })}</tbody></table></div>
      </div>;
    })}
  </details>;
}
