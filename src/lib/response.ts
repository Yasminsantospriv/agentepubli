// ============================================================================
// Helpers de resposta padronizada da API
// ============================================================================

export function ok<T>(data: T, status = 200) {
  return Response.json({ success: true, data }, { status });
}

export function created<T>(data: T) {
  return ok(data, 201);
}

export function fail(message: string, status = 400, details?: unknown) {
  return Response.json(
    { success: false, error: { message, details: details ?? null } },
    { status }
  );
}

export function notFound(resource: string) {
  return fail(`${resource} não encontrado`, 404);
}

/** Gera um novo UUID para uso como ID primário. */
export function newId(): string {
  return crypto.randomUUID();
}

/** Timestamp ISO 8601 atual — mesmo formato usado nos DEFAULTs do schema. */
export function nowIso(): string {
  return new Date().toISOString();
}
