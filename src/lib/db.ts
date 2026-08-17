// ============================================================================
// Helper genérico de acesso ao D1
// ============================================================================

export async function dbAll<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  ...params: unknown[]
): Promise<T[]> {
  const stmt = params.length ? db.prepare(sql).bind(...params) : db.prepare(sql);
  const result = await stmt.all<T>();
  return result.results ?? [];
}

export async function dbFirst<T = Record<string, unknown>>(
  db: D1Database,
  sql: string,
  ...params: unknown[]
): Promise<T | null> {
  const stmt = params.length ? db.prepare(sql).bind(...params) : db.prepare(sql);
  const row = await stmt.first<T>();
  return row ?? null;
}

export async function dbRun(
  db: D1Database,
  sql: string,
  ...params: unknown[]
): Promise<D1Result> {
  const stmt = params.length ? db.prepare(sql).bind(...params) : db.prepare(sql);
  return stmt.run();
}

/** Executa múltiplas statements em uma única transação (batch do D1). */
export async function dbBatch(db: D1Database, statements: D1PreparedStatement[]) {
  return db.batch(statements);
}

/** JSON.parse seguro para colunas TEXT que guardam JSON — retorna fallback em caso de erro/nulo. */
export function parseJsonColumn<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
