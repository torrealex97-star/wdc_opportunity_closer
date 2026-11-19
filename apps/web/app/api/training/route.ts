import { loadTrainingCurriculum } from '../../../lib/trainingCurriculumStore';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Currículo de Formación para la alumna. Público (la formación no exige sesión), sin datos personales.
// `source` declara si viene de la base importada o de la versión firmada en el repo; la vista no
// presenta una copia vieja como si fuera la última importación.
export async function GET() {
  const loaded = await loadTrainingCurriculum();
  return Response.json(loaded, { headers: { 'Cache-Control': 'no-store' } });
}
