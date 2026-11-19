// Migraciones del backend local de desarrollo (SQLite). Son el espejo de las migraciones Postgres de
// `supabase/migrations/`: la tabla, sus columnas y sus límites son los mismos, con JSON como texto
// porque SQLite no tiene JSONB. Se aplican en orden, una sola vez, y se registran en
// `local_migrations` (mismo contrato que un runner de migraciones: idempotente y reanudable).
//
// Este backend SOLO se usa cuando Supabase no está configurado y el proceso no es producción
// (ver `lib/practiceRubricStore.ts`). En un despliegue real manda Postgres.
export type LocalMigration = { id: string; sql: string };

export const LOCAL_MIGRATIONS: LocalMigration[] = [
  {
    id: '20261119_practice_rubrics',
    // Equivalente local de `supabase/migrations/20261119_practice_rubrics.sql`.
    sql: `
      create table if not exists practice_rubrics (
        org_id text primary key,
        rubrics text not null check (json_valid(rubrics) and json_type(rubrics) = 'object'),
        priorities text not null default '[]' check (json_valid(priorities) and json_type(priorities) = 'array'),
        bant text not null default '{}' check (json_valid(bant) and json_type(bant) = 'object'),
        updated_at text not null,
        updated_by text check (updated_by is null or length(updated_by) <= 200)
      );
    `,
  },
  {
    id: '20261119_practice_rubrics_versions',
    // Equivalente local de `supabase/migrations/20261119_practice_rubrics_versions.sql`.
    sql: `
      alter table practice_rubrics add column version integer not null default 0 check (version >= 0);
      alter table practice_rubrics add column history text not null default '[]' check (json_valid(history) and json_type(history) = 'array');
    `,
  },
];
