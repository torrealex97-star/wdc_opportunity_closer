'use client';

import { useState } from 'react';
import { ArrowUpRight, Play, Quote, Sparkles } from 'lucide-react';
import { SUCCESS_STORIES, youtubeEmbed, youtubeWatch, type SuccessStory } from '../lib/successStories';

// Salón del éxito: trece casos reales de alumnas, cada uno con su vídeo y lo que se puede aprender.
// El objetivo es que quien entre se vea en ellas —mismo método, mismas salas— y salga con ganas de
// practicar. No es una promesa de resultados: cuenta lo que hicieron y deja claro que el resultado
// depende de lo que cada una haga con el método.
const initials = (name: string) => name.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase();

function StoryCard({ story, playing, onPlay }: { story: SuccessStory; playing: boolean; onPlay: () => void }) {
  return <article className="success-card">
    <div className="success-media">
      {playing
        ? <iframe
          className="success-frame"
          src={youtubeEmbed(story.videoId)}
          title={`Vídeo de ${story.name}`}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          referrerPolicy="strict-origin-when-cross-origin"
          allowFullScreen
        />
        : <button type="button" className="success-play" onClick={onPlay} aria-label={`Ver el vídeo de ${story.name}`}>
          <span className="success-face" aria-hidden="true">{initials(story.name)}</span>
          <span className="success-play-icon"><Play size={16} fill="currentColor" /></span>
          <span className="success-play-text">Ver su historia</span>
        </button>}
    </div>
    <div className="success-body">
      <span className="success-theme">{story.theme}</span>
      <h2>{story.name}</h2>
      <p className="success-learn"><strong>Qué aprender.</strong> {story.learn}</p>
      <blockquote className="success-message"><Quote size={14} aria-hidden="true" />{story.message}</blockquote>
      <a className="success-link" href={youtubeWatch(story.videoId)} target="_blank" rel="noreferrer">
        Abrir en YouTube <ArrowUpRight size={14} />
      </a>
    </div>
  </article>;
}

export default function StudentSuccess() {
  // Solo se carga el reproductor del vídeo que se abre: trece iframes a la vez no aportan nada y
  // mandan datos a YouTube sin que nadie lo haya pedido.
  const [playing, setPlaying] = useState<string | null>(null);
  return <section className="success">
    <div className="success-head">
      <div>
        <span className="eyebrow">SALÓN DEL ÉXITO · CASOS DE WOMEN DIGITAL CLOSER</span>
        <h1>Ellas estaban donde tú estás.</h1>
        <p>Trece alumnas cuentan cómo empezaron, qué les costó y qué hacen hoy. No son perfiles elegidos por su facilidad: son personas que decidieron practicar hasta que salió.</p>
      </div>
      <span className="success-icon"><Sparkles size={26} strokeWidth={1.4} /></span>
    </div>

    <div className="success-lead">
      <span className="eyebrow">MISMO MÉTODO, MISMAS SALAS</span>
      <p>El método no cambia de una alumna a otra. Las conversaciones, las objeciones y las salas de práctica son las mismas para todas. Lo que cambia es lo que cada una hace con ellas: cuántas llamadas prueba, cuántas veces revisa su grabación y cuánto insiste cuando todavía no sale.</p>
    </div>

    <div className="success-grid">
      {SUCCESS_STORIES.map(story => <StoryCard
        key={story.id}
        story={story}
        playing={playing === story.id}
        onPlay={() => setPlaying(playing === story.id ? null : story.id)}
      />)}
    </div>

    <div className="success-close">
      <div>
        <span className="eyebrow">LO QUE TIENEN EN COMÚN</span>
        <h2>Ninguna llegó sabiendo. Todas siguieron el mismo camino.</h2>
        <p>Empezaron sin experiencia, con miedo a la primera llamada y con dudas sobre si valían para esto. La diferencia no fue el talento: fue sentarse a practicar, escuchar su propia llamada y volver a intentarlo. Ese es el trabajo que el método pide, y está al alcance de cualquiera que decida hacerlo.</p>
        <p className="success-note">Sus resultados son suyos y no están garantizados: dependen del esfuerzo, el contexto y la constancia de cada persona. Lo que sí se puede copiar es lo que hicieron.</p>
      </div>
      <Sparkles size={26} className="success-close-icon" aria-hidden="true" />
    </div>
  </section>;
}
