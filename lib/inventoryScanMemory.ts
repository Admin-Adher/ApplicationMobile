export function collectInventoryLabels(
  values: Array<string | null | undefined>,
  query = '',
  limit = 8,
): string[] {
  const counts = new Map<string, { label: string; count: number }>();
  for (const value of values) {
    const label = value?.trim();
    if (!label) continue;
    const key = label.toLocaleLowerCase();
    const current = counts.get(key);
    counts.set(key, { label: current?.label ?? label, count: (current?.count ?? 0) + 1 });
  }
  const needle = query.trim().toLocaleLowerCase();
  return [...counts.values()]
    .filter(entry => !needle || entry.label.toLocaleLowerCase().includes(needle))
    .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, 'fr'))
    .slice(0, limit)
    .map(entry => entry.label);
}

export function preferInventoryLabel(current: string, fallback?: string | null): string {
  return current.trim() || fallback?.trim() || '';
}
