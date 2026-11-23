// GENERADO por scripts/export_company_pages.py desde apps/api/career/data/company_targets.json. No editar a mano:
// regenerar con `python3 scripts/export_company_pages.py`. Páginas de empleo propias, ATS y feeds que el motor ya vigila.

export type CompanyPageSeed = { slug: string; name: string; monitoring: 'careers_page' | 'ats_page' | 'teamtailor_feed'; url: string };

export const COMPANY_PAGES_SEED: readonly CompanyPageSeed[] = [
  { slug: "nuclio-digital-school", name: "Nuclio Digital School", monitoring: "careers_page", url: "https://nuclio.school/portal-de-empleo-nuclio/" },
  { slug: "keepcoding", name: "KeepCoding", monitoring: "careers_page", url: "https://keepcoding.io/sobre-nosotros/trabaja-con-nosotros/" },
  { slug: "product-hackers-school", name: "Product Hackers School", monitoring: "teamtailor_feed", url: "https://producthackers.teamtailor.com/jobs" },
  { slug: "mioti-tech-business-school", name: "MIOTI Tech & Business School", monitoring: "ats_page", url: "https://mioti.factorial.es/" },
  { slug: "ironhack", name: "Ironhack", monitoring: "careers_page", url: "https://jobs.ironhack.com/" },
  { slug: "le-wagon", name: "Le Wagon", monitoring: "ats_page", url: "https://join.com/companies/lewagon2" },
  { slug: "big-school", name: "BIG school", monitoring: "careers_page", url: "https://thebigschool.com/carreras/" },
  { slug: "insparya", name: "Insparya", monitoring: "careers_page", url: "https://insparya.com/es/es/por-que-insparya/empleo/" },
  { slug: "medical-hair", name: "Medical Hair", monitoring: "careers_page", url: "https://www.medicalhair.es/trabaja-con-nosotros/" },
  { slug: "hack-a-boss", name: "HACK A BOSS", monitoring: "careers_page", url: "https://www.hackaboss.com/ofertas-empleo" },
  { slug: "adalab", name: "Adalab", monitoring: "careers_page", url: "https://www.infojobs.net/adalab/em-i10356555455554965100971018163596301058" },
  { slug: "tripleten", name: "TripleTen", monitoring: "ats_page", url: "https://www.comeet.com/jobs/tripleten/98.008" },
  { slug: "conquer-blocks-conquerx", name: "Conquer Blocks / ConquerX", monitoring: "careers_page", url: "https://www.conquerx.com/en/unete-a-nosotros" },
  { slug: "factoria-f5", name: "Factoría F5", monitoring: "careers_page", url: "https://www.tecnoempleo.com/factoria-f5/re-195355" },
];
