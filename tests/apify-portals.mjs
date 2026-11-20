// Imprime los portales que verá el panel (id, fuente y actores) para que la prueba de Python compruebe la unión
// real de `lib/apifyCatalog.ts`, no solo el JSON exportado. Sin red: el catálogo es estático.
import { PORTALS } from '../apps/web/lib/apifyCatalog.ts';

console.log(JSON.stringify(PORTALS.map(p => ({ id: p.id, source: p.source, recipes: p.recipes.map(r => r.actor) }))));
