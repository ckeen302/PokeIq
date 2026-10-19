/**
 * JSON with every object's keys sorted, so two copies of one value compare
 * equal whatever their key order. Rows read back from Postgres jsonb don't
 * keep the order they were written in.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]])) : v
  );
}
