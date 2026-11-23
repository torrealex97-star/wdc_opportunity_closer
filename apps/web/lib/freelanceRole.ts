import { fold, type RoleFamily } from './vocabulary';

// Perfil de un PROYECTO freelance (Upwork, Workana…) cuyo título no usa las palabras de un empleo. Los clientes escriben «Cold Call Expert»,
// «Appointment Setting & Cold Outreach» o «Telemarketer»; el vocabulario de empleo (`roleFromTitle`, con paridad con el motor) no los reconoce.
// Solo se consulta cuando `roleFromTitle` no encontró nada Y la oferta es un proyecto: un empleo normal sigue por el vocabulario de siempre.
// Conservador a propósito: cada patrón nombra la actividad (llamar en frío, agendar citas), no una palabra suelta como «sales» o «outreach».
const PATTERNS: Array<{ role: RoleFamily; re: RegExp }> = [
  { role: 'cold_caller', re: /\bcold[- ]?call(?:s|er|ers|ing)?\b/ },
  { role: 'cold_caller', re: /\btelemarket(?:er|ers|ing)\b/ },
  { role: 'cold_caller', re: /\boutbound (?:calls?|callers?|calling)\b/ },
  { role: 'setter', re: /\bappointment[- ]?setting\b/ },
  { role: 'setter', re: /\bsetting (?:up )?appointments?\b/ },
  { role: 'setter', re: /\bbook(?:ing)? (?:sales )?(?:calls|appointments)\b/ },
];

export function freelanceRole(title: string | null | undefined): RoleFamily | null {
  const t = fold(title);
  return PATTERNS.find(p => p.re.test(t))?.role ?? null;
}
