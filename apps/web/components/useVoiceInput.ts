'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

// Dictado por voz con la API del navegador (Chrome/Edge). No hay servicio externo:
// el audio no sale del dispositivo, lo transcribe el propio navegador.
// Si el navegador no lo soporta, la sala lo oculta y se puede seguir escribiendo.

type RecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: RecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};
type RecognitionEventLike = { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal?: boolean }> };
type RecognitionCtor = new () => RecognitionLike;

const MESSAGES: Record<string, string> = {
  'not-allowed': 'No has dado permiso al micrófono. Puedes escribir la respuesta.',
  'service-not-allowed': 'El navegador no permite usar el micrófono aquí. Escribe la respuesta.',
  'no-speech': 'No se ha oído nada. Prueba otra vez o escribe.',
  network: 'El dictado necesita conexión. Escribe la respuesta mientras tanto.',
  aborted: '',
};

type VoiceOptions = {
  /** Se llama con lo que se va oyendo (provisional); sirve para interrumpir la locución del interlocutor. */
  onHeard?: (text: string) => void;
  /** Si devuelve `false`, el texto final se descarta (eco de la propia locución). */
  accept?: (text: string) => boolean;
};

export function useVoiceInput(onFinal: (text: string) => void, options: VoiceOptions = {}) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState('');
  const recognition = useRef<RecognitionLike | null>(null);
  const answer = useRef(onFinal);
  answer.current = onFinal;
  const opts = useRef(options);
  opts.current = options;

  useEffect(() => {
    const scope = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
    setSupported(Boolean(scope.SpeechRecognition || scope.webkitSpeechRecognition));
    return () => { recognition.current?.abort(); recognition.current = null; };
  }, []);

  const stop = useCallback(() => {
    recognition.current?.stop();
    recognition.current = null;
    setListening(false);
    setInterim('');
  }, []);

  const start = useCallback(() => {
    if (!supported || recognition.current) return;
    const scope = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
    const Ctor = scope.SpeechRecognition || scope.webkitSpeechRecognition;
    if (!Ctor) return;
    const session = new Ctor();
    session.lang = 'es-ES';
    session.interimResults = true;
    session.continuous = false;
    setError('');
    setInterim('');
    session.onresult = event => {
      let partial = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result?.[0]?.transcript ?? '';
        if (result?.isFinal) {
          const finalText = text.trim();
          if (finalText) { opts.current.onHeard?.(finalText); if (opts.current.accept?.(finalText) !== false) answer.current(finalText); }
        } else partial += text;
      }
      const heard = partial.trim();
      if (heard) opts.current.onHeard?.(heard);
      setInterim(heard);
    };
    session.onerror = event => {
      const key = event.error ?? '';
      setError(MESSAGES[key] ?? 'No se ha podido dictar. Escribe la respuesta.');
      recognition.current = null;
      setListening(false);
      setInterim('');
    };
    session.onend = () => {
      recognition.current = null;
      setListening(false);
      setInterim('');
    };
    try {
      session.start();
      recognition.current = session;
      setListening(true);
    } catch {
      recognition.current = null;
      setListening(false);
      setError('No se ha podido abrir el micrófono. Escribe la respuesta.');
    }
  }, [supported]);

  return { supported, listening, interim, error, start, stop, clearError: () => setError('') };
}
