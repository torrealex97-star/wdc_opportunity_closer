'use client';
import { useEffect, useMemo, useState } from 'react';
import { Bookmark, Check, Quote, Sparkles } from 'lucide-react';
import { QUOTES, quoteDayKey, quoteOfDay, quoteSeed, type DailyQuote as QuoteType } from '../lib/dailyQuote';

const SAVED_KEY = 'wdc_quote_saved';
const READ_KEY = 'wdc_quote_read';

function readJson<T>(key: string, fallback: T): T {
  try { return JSON.parse(window.localStorage.getItem(key) ?? 'null') ?? fallback; } catch { return fallback; }
}

// Frase diaria contextualizada: cambia de tema según el día y avanza sin repetir la de ayer. Guardar y
// marcar como leída viven en este navegador, como el resto de datos personales de la formación.
export default function DailyQuote({ compact = false }: { compact?: boolean }) {
  const [quote, setQuote] = useState<QuoteType | null>(null);
  const [day, setDay] = useState('');
  const [saved, setSaved] = useState<string[]>([]);
  const [readDay, setReadDay] = useState('');
  const [storageOk, setStorageOk] = useState(true);

  useEffect(() => {
    let storage: Storage | null = null;
    try { storage = window.localStorage; } catch { storage = null; }
    setStorageOk(Boolean(storage));
    const today = quoteDayKey();
    setDay(today);
    setQuote(quoteOfDay(quoteSeed(storage), today));
    if (storage) {
      const stored = readJson<unknown>(SAVED_KEY, []);
      setSaved(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : []);
      setReadDay(readJson<unknown>(READ_KEY, '') as string);
    }
  }, []);

  const savedQuotes = useMemo(() => QUOTES.filter(item => saved.includes(item.id)), [saved]);
  if (!quote) return <div className="daily-quote is-loading" aria-hidden="true"><span className="shimmer-line wide" /><span className="shimmer-line" /></div>;

  const isSaved = saved.includes(quote.id);
  const isRead = readDay === day;
  function toggleSaved() {
    const next = isSaved ? saved.filter(id => id !== quote!.id) : [...saved, quote!.id];
    setSaved(next);
    try { window.localStorage.setItem(SAVED_KEY, JSON.stringify(next)); } catch { setStorageOk(false); }
  }
  function markRead() {
    setReadDay(day);
    try { window.localStorage.setItem(READ_KEY, JSON.stringify(day)); } catch { setStorageOk(false); }
  }

  return <section className={`daily-quote${compact ? ' is-compact' : ''}`} aria-label="Frase del día">
    <div className="daily-quote-head"><span className="eyebrow"><Sparkles size={13} /> FRASE DEL DÍA · {quote.category.toUpperCase()}</span>
      {isRead && <span className="status ok"><Check size={12} /> Leída</span>}</div>
    <blockquote><Quote size={18} aria-hidden="true" />{quote.text}</blockquote>
    <div className="daily-quote-actions">
      <button type="button" onClick={toggleSaved} aria-pressed={isSaved}><Bookmark size={14} />{isSaved ? 'Guardada' : 'Guardar'}</button>
      {!isRead && <button type="button" onClick={markRead}><Check size={14} />Ya la he leído</button>}
      {savedQuotes.length > 0 && <details><summary>Mis frases ({savedQuotes.length})</summary>
        <ul>{savedQuotes.map(item => <li key={item.id}><span>{item.category}</span>{item.text}</li>)}</ul></details>}
      {!storageOk && <small>No se pudo guardar en este navegador; la frase se mantiene mientras la pestaña esté abierta.</small>}
    </div>
  </section>;
}
