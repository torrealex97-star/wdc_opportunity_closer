'use client';
import { useState } from 'react';
import { LoaderCircle, Search, TriangleAlert } from 'lucide-react';

// Buscadores de un portal de Apify: los activos por orden, los retirados y la búsqueda de repuestos en la tienda.
// La app prueba los buscadores uno tras otro y retira solos los que llevan fallando; aquí el propietario ve cuáles
// quedan, retira o reactiva uno y añade sustitutos que la tienda demuestra utilizables. Buscar y validar no gasta
// crédito (metadatos públicos); «sin verificar» nunca se presenta como bueno y no se puede añadir.
type RecipeView = { name: string; actor: string; id: string | null; state: string; detail: string; added: boolean };
type RetiredView = { id: string; name: string; actor: string };
export type PortalActorsView = { id: string; name: string; recipes: RecipeView[]; retired: RetiredView[]; needs_more: boolean };
type Replacement = { actor: string; title: string; description: string | null; users: number | null; runs: number | null; verdict: 'valid' | 'invalid' | 'unverified'; reasons: string[] };
type Search = { candidates: Replacement[]; searched: string[]; error: string | null; truncated: boolean };

const VERDICT: Record<Replacement['verdict'], { text: string; cls: string }> = {
  valid: { text: 'Validado', cls: 'status ok' },
  unverified: { text: 'Sin verificar', cls: 'status' },
  invalid: { text: 'No utilizable', cls: 'status bad' },
};
const int = (value: number | null) => value === null ? '—' : value.toLocaleString('es');

export default function PortalActors({ portal, owner, busy, post, run }: {
  portal: PortalActorsView; owner: boolean; busy: boolean;
  post: (body: Record<string, unknown>) => Promise<Record<string, unknown>>;
  run: (kind: string, action: () => Promise<string>) => Promise<void>;
}) {
  const [search, setSearch] = useState<Search | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  async function find() {
    setSearching(true); setError('');
    try { setSearch(await post({ action: 'find_replacements', portal: portal.id }) as unknown as Search); }
    catch (err) { setSearch(null); setError((err as Error).message); }
    finally { setSearching(false); }
  }

  return <details data-testid={`actors-${portal.id}`}>
    <summary>Buscadores ({portal.recipes.length}){portal.retired.length ? ` · ${portal.retired.length} retirado(s)` : ''}</summary>
    {portal.needs_more && <p className="inline-hint" role="status" data-testid={`needs-more-${portal.id}`}>
      <TriangleAlert size={13} aria-hidden="true" /> {portal.recipes.length === 0 ? 'Ningún buscador activo.' : 'Solo hay un buscador: si falla, no hay repuesto.'} Busca uno en la tienda de Apify.
    </p>}
    <ul style={{ margin: '8px 0 0', paddingLeft: 18, display: 'grid', gap: 6 }}>
      {portal.recipes.map(r => <li key={r.actor}>
        <strong>{r.name}</strong>{r.added ? ' (añadido desde la tienda)' : ''}: {r.detail}
        {owner && r.id && portal.recipes.length > 1 && <button type="button" style={{ marginLeft: 8 }} disabled={busy}
          aria-label={`Retirar ${r.name} de la cascada`}
          onClick={() => { if (window.confirm(`Retirar «${r.name}» de la cascada de ${portal.name}. Podrás reactivarlo.`)) void run(`retire-${r.id}`, async () => (await post({ action: 'retire', id: r.id }) as { message: string }).message); }}>Retirar</button>}
      </li>)}
    </ul>
    {portal.retired.length > 0 && <>
      <p className="card-meta" style={{ marginBottom: 4 }}>Retirados de la cascada (a mano o por fallar varias veces seguidas):</p>
      <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>{portal.retired.map(r => <li key={r.id}>
        <strong>{r.name}</strong> <span className="card-meta">{r.actor}</span>
        {owner && <button type="button" style={{ marginLeft: 8 }} disabled={busy} aria-label={`Reactivar ${r.name}`}
          onClick={() => void run(`reactivate-${r.id}`, async () => (await post({ action: 'reactivate', id: r.id }) as { message: string }).message)}>Reactivar</button>}
      </li>)}</ul>
    </>}
    <p className="card-meta">Se usan por orden. Si uno falla o no encuentra ofertas, se pasa al siguiente automáticamente; el que falla tres veces seguidas se retira solo (siempre queda uno).</p>
    <div className="admin-toolbar" style={{ margin: '8px 0' }}>
      <button type="button" disabled={busy || searching} onClick={() => void find()}>
        {searching ? <LoaderCircle size={14} className="spin" /> : <Search size={14} />} Buscar repuestos en la tienda
      </button>
    </div>
    {error && <div className="alert error" role="alert"><span>{error}</span></div>}
    {search && <div data-testid={`replacements-${portal.id}`}>
      {search.candidates.length === 0
        ? <p className="card-meta">{search.error ?? 'La tienda no devolvió buscadores nuevos para este portal.'}</p>
        : <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'grid', gap: 10 }}>{search.candidates.map(c => <li key={c.actor} data-actor={c.actor}>
          <strong>{c.title}</strong> <span className="card-meta">{c.actor}</span> <span className={VERDICT[c.verdict].cls}>{VERDICT[c.verdict].text}</span>
          <span className="card-meta" style={{ display: 'block' }}>{c.description ?? 'Sin descripción.'} · {int(c.users)} usuarios · {int(c.runs)} ejecuciones</span>
          {c.reasons.length > 0 && <span className="card-meta" style={{ display: 'block' }}>{c.reasons.join(' ')}</span>}
          {owner && c.verdict === 'valid' && <button type="button" className="primary" disabled={busy} aria-label={`Añadir ${c.title} a ${portal.name}`}
            onClick={() => void run(`add-${c.actor}`, async () => { const message = (await post({ action: 'add_replacement', portal: portal.id, actor: c.actor, title: c.title }) as { message: string }).message; setSearch(null); return message; })}>Añadir como repuesto</button>}
        </li>)}</ul>}
      {search.truncated && <p className="card-meta">Hay más candidatos en la tienda; solo se validan los primeros para no hacer cientos de peticiones.</p>}
      {search.error && search.candidates.length > 0 && <p className="inline-hint" role="status">{search.error}</p>}
      <p className="card-meta">Validado = existe, no está obsoleto, su build por defecto terminó bien y se leyó su esquema de entrada. No garantiza que extraiga bien: la primera prueba con 10 ofertas lo comprueba.</p>
    </div>}
  </details>;
}
