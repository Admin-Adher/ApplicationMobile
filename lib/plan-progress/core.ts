/** Shared wire contract. Coordinates use the PDF viewport normalised to 1000 units. */
export type ProgressDocument = {
  elements: Record<string, unknown>[];
  calibrations: Record<string, number>;
  billed: Record<string, number>;
};
export type ProgressChange = { target: 'elements' | 'calibrations' | 'billed'; key: string; before: unknown; after: unknown };
export type ProgressOperation = { id: string; planId: string; sourceRef: string; changes: ProgressChange[] };
export const emptyProgress = (): ProgressDocument => ({ elements: [], calibrations: {}, billed: {} });
/** Match the existing viewer's PDF default for legacy plans without file_type. */
export function canTrackPdfPlan(plan: { uri?: unknown; file_type?: unknown; fileType?: unknown } | null | undefined) {
  if (!plan || typeof plan.uri !== 'string' || !plan.uri) return false;
  const type = String(plan.file_type ?? plan.fileType ?? '').toLowerCase();
  if (type) return type === 'pdf' || type === 'application/pdf';
  return !/\.(png|jpe?g|gif|webp|dxf)(?:[?#]|$)|^data:image\//i.test(plan.uri);
}
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical((value as Record<string,unknown>)[key])])) : value ?? null;
const equal = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const record = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
export function readProgress(value: unknown): ProgressDocument {
  if (!record(value) || !Array.isArray(value.elements) || !record(value.calibrations) || !record(value.billed)) throw new Error('Données d’avancement invalides.');
  const ids = new Set<string>();
  for (const el of value.elements) {
    if (!record(el) || typeof el.id !== 'string' || !el.id || ids.has(el.id) || typeof el.docId !== 'string' ||
      !['point','line','area'].includes(String(el.kind)) || !['todo','progress','installed','checked'].includes(String(el.status)) ||
      typeof el.name !== 'string' || !el.name.trim() || el.name.length > 120 || !Number.isInteger(el.page) || Number(el.page) < 1 || Number(el.page) > 2000 ||
      typeof el.lotId !== 'string' || !Array.isArray(el.points) || el.points.length > 1000 ||
      el.points.length < (el.kind === 'point' ? 1 : el.kind === 'line' ? 2 : 3) || (el.kind === 'point' && el.points.length !== 1) ||
      el.points.some(point => !record(point) || typeof point.x !== 'number' || typeof point.y !== 'number' || !Number.isFinite(point.x) || !Number.isFinite(point.y) || point.x < 0 || point.x > 1000 || point.y < 0 || point.y > 100000) ||
      (el.price !== undefined && (typeof el.price !== 'number' || !Number.isFinite(el.price) || el.price < 0 || el.price > 1_000_000))) throw new Error('Ouvrage d’avancement invalide.');
    ids.add(el.id);
    let group: unknown;
    try { group = JSON.parse(el.lotId); } catch { throw new Error('Entreprise d’avancement invalide.'); }
    if (!Array.isArray(group) || group.length !== 2 || typeof group[0] !== 'string' || !group[0] || (group[1] !== null && typeof group[1] !== 'string')) throw new Error('Entreprise d’avancement invalide.');
  }
  if (ids.size > 10000 || Object.values(value.calibrations).some(n => typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > 1e9) ||
    Object.values(value.billed).some(n => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1e9)) throw new Error('Mesures d’avancement invalides.');
  return { elements: value.elements, calibrations: value.calibrations, billed: value.billed } as ProgressDocument;
}
/** Updates carry only changed fields. Concurrent edits to distinct fields are preserved. */
export function progressDiff(previous: ProgressDocument, next: ProgressDocument): ProgressChange[] {
  const result: ProgressChange[] = [];
  const oldElements = new Map(previous.elements.map(el => [String(el.id), el]));
  const newElements = new Map(next.elements.map(el => [String(el.id), el]));
  for (const id of new Set([...oldElements.keys(), ...newElements.keys()])) {
    const before = oldElements.get(id), after = newElements.get(id);
    if (equal(before, after)) continue;
    if (!before || !after) result.push({ target: 'elements', key: id, before: before ?? null, after: after ?? null });
    else {
      const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
      const fields = [...keys].filter(key => !equal(before[key], after[key]));
      result.push({ target: 'elements', key: id,
        before: Object.fromEntries(fields.map(key => [key, before[key] ?? null])),
        after: Object.fromEntries(fields.map(key => [key, after[key] ?? null])) });
    }
  }
  for (const target of ['calibrations', 'billed'] as const) {
    for (const key of new Set([...Object.keys(previous[target]), ...Object.keys(next[target])])) {
      if (!equal(previous[target][key], next[target][key])) result.push({ target, key, before: previous[target][key] ?? null, after: next[target][key] ?? null });
    }
  }
  return result;
}
/** Used to overlay durable queued changes while offline, without applying stale server snapshots. */
export function overlayProgress(document: ProgressDocument, changes: ProgressChange[]): ProgressDocument {
  const result = JSON.parse(JSON.stringify(document)) as ProgressDocument;
  for (const change of changes) {
    if (change.target === 'elements') {
      const index = result.elements.findIndex(el => el.id === change.key);
      if (change.after === null) { if (index >= 0) result.elements.splice(index, 1); }
      else if (index < 0) { if (change.before === null && record(change.after)) result.elements.push(change.after); }
      else if (record(change.after)) result.elements[index] = { ...result.elements[index], ...change.after };
    } else if (change.after === null) delete result[change.target][change.key];
    else result[change.target][change.key] = Number(change.after);
  }
  return result;
}
export function progressRpc(operation: ProgressOperation) {
  return { p_operation_id: operation.id, p_plan_id: operation.planId, p_source_ref: operation.sourceRef, p_changes: operation.changes };
}
export function progressScope(userId: string, orgId: string, planId: string, sourceRef: string) {
  return 'bt-plan-progress-v1:' + JSON.stringify([userId, orgId, planId, sourceRef]);
}
export function progressGroups(companies: { id: string; name: string; color?: string }[], lots: { id: string; name: string; companyId?: string | null }[]) {
  return companies.flatMap(company => {
    const assigned = lots.filter(lot => lot.companyId === company.id);
    return (assigned.length ? assigned : [{ id: null, name: 'Ouvrages' }]).map(lot => ({
      id: JSON.stringify([company.id, lot.id]), name: lot.name, company: company.name,
      color: company.color, companyId: company.id, icon: 'building', unit: 'u', kind: 'point', price: 0,
    }));
  });
}
export function editorHtml(template: string, boot: Record<string, unknown>) {
  // JSON is data, never executable HTML. In particular names may contain </script>.
  return template.replace('/* BUILDTRACK_BOOT */', () => 'window.BT_BOOT=' + JSON.stringify(boot).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029') + ';');
}
