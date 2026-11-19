// Backend local de desarrollo para los criterios de práctica: SQLite con `node:sqlite` (Node 22).
// Existe porque el entorno local no tiene Supabase (ni Docker/Postgres) y el panel tiene que poder
// guardar de verdad. No es un sustituto de producción: `practiceRubricStore` solo lo usa cuando no
// hay claves de Supabase y NODE_ENV no es `production`.
//
// El módulo se carga con `process.getBuiltinModule('node:sqlite')` para no obligar al bundler a
// resolver un builtin experimental; si el runtime no lo trae, se declara `unavailable` y no se
// inventa una persistencia en memoria.
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { LOCAL_MIGRATIONS } from './practiceLocalMigrations';

type Statement = {
  run: (...args: unknown[]) => unknown;
  get: (...args: unknown[]) => Record<string, unknown> | undefined;
  all: (...args: unknown[]) => Array<Record<string, unknown>>;
};
type Database = { exec: (sql: string) => void; prepare: (sql: string) => Statement; close: () => void };
type SqliteModule = { DatabaseSync?: new (path: string) => Database };

const dbPath = () => process.env.PRACTICE_DB_PATH?.trim() || resolve(process.cwd(), '.local/practice-rubrics.sqlite');

let cached: { path: string; db: Database } | null = null;

function migrate(db: Database) {
  db.exec('create table if not exists local_migrations (id text primary key, applied_at text not null)');
  const applied = new Set(db.prepare('select id from local_migrations').all().map(row => String(row.id)));
  for (const migration of LOCAL_MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    db.exec('begin');
    try {
      db.exec(migration.sql);
      db.prepare('insert into local_migrations (id, applied_at) values (?, ?)').run(migration.id, new Date().toISOString());
      db.exec('commit');
    } catch (error) {
      db.exec('rollback');
      throw error;
    }
  }
}

/** Abre (y migra) la base local. `null` = este runtime no puede usar SQLite; la causa se declara arriba. */
export function localDb(): Database | null {
  const path = dbPath();
  if (cached?.path === path) return cached.db;
  const loader = (process as unknown as { getBuiltinModule?: (id: string) => unknown }).getBuiltinModule;
  const sqlite = loader?.('node:sqlite') as SqliteModule | undefined;
  if (!sqlite?.DatabaseSync) return null;
  try {
    mkdirSync(dirname(path), { recursive: true });
    const db = new sqlite.DatabaseSync(path);
    db.exec('pragma journal_mode = wal');
    db.exec('pragma busy_timeout = 3000');
    migrate(db);
    cached = { path, db };
    return db;
  } catch {
    return null;
  }
}

export type LocalRow = { rubrics: string; priorities: string; bant: string; updated_at: string; updated_by: string | null; version: number; history: string };
export type LocalRead =
  | { ok: true; row: LocalRow | null }
  | { ok: false; reason: string };

export function readLocalConfig(orgId: string): LocalRead {
  const db = localDb();
  if (!db) return { ok: false, reason: 'Este entorno no puede usar la base local (node:sqlite no disponible).' };
  try {
    const row = db.prepare('select rubrics, priorities, bant, updated_at, updated_by, version, history from practice_rubrics where org_id = ?').get(orgId);
    if (!row) return { ok: true, row: null };
    return {
      ok: true,
      row: {
        rubrics: String(row.rubrics),
        priorities: String(row.priorities),
        bant: String(row.bant),
        updated_at: String(row.updated_at),
        updated_by: row.updated_by === null || row.updated_by === undefined ? null : String(row.updated_by),
        version: Number(row.version ?? 0),
        history: String(row.history ?? '[]'),
      },
    };
  } catch (error) {
    return { ok: false, reason: `No se pudo leer la base local (${(error as Error).message}).` };
  }
}

export function writeLocalConfig(
  orgId: string,
  config: { rubrics: unknown; priorities: unknown; bant: unknown },
  updatedBy: string,
  meta: { version: number; history: unknown },
): { ok: true } | { ok: false; reason: string } {
  const db = localDb();
  if (!db) return { ok: false, reason: 'Este entorno no puede usar la base local (node:sqlite no disponible).' };
  try {
    db.prepare(`insert into practice_rubrics (org_id, rubrics, priorities, bant, updated_at, updated_by, version, history)
      values (?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(org_id) do update set rubrics = excluded.rubrics, priorities = excluded.priorities,
        bant = excluded.bant, updated_at = excluded.updated_at, updated_by = excluded.updated_by,
        version = excluded.version, history = excluded.history`)
      .run(orgId, JSON.stringify(config.rubrics), JSON.stringify(config.priorities), JSON.stringify(config.bant), new Date().toISOString(), updatedBy.slice(0, 200), meta.version, JSON.stringify(meta.history));
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `No se pudo guardar en la base local (${(error as Error).message}).` };
  }
}

export function deleteLocalConfig(orgId: string): { ok: true } | { ok: false; reason: string } {
  const db = localDb();
  if (!db) return { ok: false, reason: 'Este entorno no puede usar la base local (node:sqlite no disponible).' };
  try {
    db.prepare('delete from practice_rubrics where org_id = ?').run(orgId);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: `No se pudo restaurar en la base local (${(error as Error).message}).` };
  }
}
