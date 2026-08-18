import { dbFirst, dbRun } from "./db";
import { nowIso } from "./response";

export async function getSetting<T>(db: D1Database, key: string, fallback: T): Promise<T> {
  const row = await dbFirst<{ value: string | null }>(db, "SELECT value FROM settings WHERE key = ?", key);
  if (!row?.value) return fallback;

  try {
    return JSON.parse(row.value) as T;
  } catch {
    return row.value as unknown as T;
  }
}

export async function setSetting(db: D1Database, key: string, value: unknown): Promise<void> {
  await dbRun(
    db,
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    key,
    JSON.stringify(value),
    nowIso()
  );
}

export async function deleteSetting(db: D1Database, key: string): Promise<void> {
  await dbRun(db, "DELETE FROM settings WHERE key = ?", key);
}
