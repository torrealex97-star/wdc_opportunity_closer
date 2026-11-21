'use client';

import { useState } from 'react';
import { Clock3, ExternalLink, FileText, Search } from 'lucide-react';
import { CLASSROOM_TOTALS } from '../lib/classroomMap';
import { whereTaught } from '../lib/classroomSearch';

// «¿Dónde se enseña esto?»: busca en el índice del Classroom (§0 de la skill) sin modelo y sin gastar nada.
// Devuelve la clase, su módulo, lo que dura y el material que la acompaña; si el mapa no lo tiene, lo dice.
export default function WhereTaught() {
  const [query, setQuery] = useState('');
  const [asked, setAsked] = useState<string | null>(null);
  const results = asked ? whereTaught(asked) : [];

  return <section className="where-taught" aria-labelledby="where-taught-title">
    <div className="where-head">
      <div>
        <span className="eyebrow">MAPA DEL CLASSROOM</span>
        <h2 id="where-taught-title">¿Dónde se enseña esto?</h2>
        <p className="card-meta">{CLASSROOM_TOTALS.modules} módulos · {CLASSROOM_TOTALS.lessons} lecciones · {CLASSROOM_TOTALS.topics} temas. Escríbelo con tus palabras: te dice el módulo, la clase, lo que dura y su material. Sin modelo de por medio y sin coste.</p>
      </div>
    </div>

    <form className="where-form" onSubmit={(event) => { event.preventDefault(); setAsked(query.trim()); }}>
      <label htmlFor="where-taught-input" className="where-label">Qué quieres encontrar</label>
      <div className="where-row">
        <input
          id="where-taught-input"
          type="search"
          value={query}
          placeholder="objeción de pareja, no-show, vídeo de presentación…"
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
        />
        <button type="submit" className="primary"><Search size={14} aria-hidden="true" /> Buscar</button>
      </div>
    </form>

    {asked !== null && <div className="where-results">
      {results.length
        ? <>
          <p className="card-meta" role="status">{results.length === 1 ? 'Una clase responde a eso' : `${results.length} clases responden a eso`}, de más a menos ajuste.</p>
          <ol className="where-list">{results.map(result => <li key={result.lesson.id}>
            <div className="where-lesson">
              <span className="where-code">{result.lesson.id}</span>
              <strong>{result.lesson.title}</strong>
            </div>
            <p className="card-meta">Módulo {result.module.order} · {result.module.name} · <Clock3 size={12} aria-hidden="true" /> {result.lesson.duration}</p>
            <p className="card-meta">{result.resource
              ? <a className="where-resource" href={result.resource.url} target="_blank" rel="noreferrer"><FileText size={12} aria-hidden="true" /> {result.resource.name}</a>
              : 'Solo vídeo: esta clase no tiene material escrito.'}</p>
            {result.skool && <a className="skool-link" href={result.skool} target="_blank" rel="noreferrer"><ExternalLink size={12} aria-hidden="true" /> Abrir la clase en Skool</a>}
          </li>)}</ol>
        </>
        : <p className="card-meta" role="status">El mapa del Classroom no tiene ese tema. Prueba con el nombre que usa la clase (por ejemplo «cualificación profunda») o con la objeción tal como te la dicen («es muy caro»).</p>}
    </div>}
  </section>;
}
