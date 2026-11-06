export function normalizeSearchText(value: unknown): string {
  return String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

export function matchesSearchText(query: string, ...fields: unknown[]): boolean {
  return query.length >= 2 && normalizeSearchText(fields.join(' ')).includes(query);
}
