// Imprime los portales que verá el panel (completos) para que la prueba de Python compruebe la unión real de
// `lib/apifyCatalog.ts`, no solo el módulo generado. Sin red: el catálogo es estático.
import { PORTALS } from '../apps/web/lib/apifyCatalog.ts';

console.log(JSON.stringify(PORTALS));
