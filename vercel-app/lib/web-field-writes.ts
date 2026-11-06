import type { WebQueuedOperation } from './web-outbox';

export const fieldTables = {
  time_entries: { state: 'timeEntries', label: 'Pointage' },
  journal_entries: { state: 'journalEntries', label: 'Journal' },
  checklists: { state: 'checklists', label: 'Checklist' },
  tasks: { state: 'tasks', label: 'Planning' },
  channels: { state: 'channels', label: 'Salon de chantier' },
  chantiers: { state: 'chantiers', label: 'Modification de chantier' },
  messages: { state: 'messages', label: 'Action sur un message' },
  companies: { state: 'companies', label: 'Présences d’entreprise' },
  visites: { state: 'visites', label: 'Visite', media: { bucket: 'photos', field: 'cover_photo_uri' } },
  incidents: { state: 'incidents', label: 'Incident', media: { bucket: 'photos', field: 'photo_uri' } },
  regulatory_docs: { state: 'regulatoryDocs', label: 'Document réglementaire', media: { bucket: 'documents', field: 'uri' } },
  documents: { state: 'documents', label: 'Document GED', media: { bucket: 'documents', field: 'uri' } },
  photos: { state: 'photos', label: 'Photo de galerie', media: { bucket: 'photos', field: 'uri' } },
  oprs: { state: 'oprs', label: 'Procès-verbal OPR' },
  site_plans: { state: 'sitePlans', label: 'Plan', media: { bucket: 'documents', field: 'uri' } },
} as const;

export type FieldTable = keyof typeof fieldTables;
type Fields = Record<string, any>;
export type FieldWrite =
  | { action: 'insert'; id: string; fields: Fields }
  | { action: 'update'; id: string; fields: Fields; before: Fields; organization: string | null }
  | { action: 'delete'; id: string; organization: string | null; before?: Fields };

export function fieldUpdate(row: Fields, fields: Fields): FieldWrite {
  return {
    action: 'update', id: String(row.id), fields,
    before: Object.fromEntries(Object.keys(fields).map(key => [key, row[key] ?? null])),
    organization: row.organization_id ?? null,
  };
}

export function fieldWrites(operation: WebQueuedOperation) {
  const { table, writes } = operation.payload;
  if (operation.kind !== 'field_write' || typeof table !== 'string' ||
      !Object.hasOwn(fieldTables, table) || !Array.isArray(writes)) return null;
  return { table: table as FieldTable, writes: writes as FieldWrite[] };
}

export function projectFieldRows(rows: Fields[], table: FieldTable, operations: WebQueuedOperation[]) {
  const pending = operations.filter(operation => !operation.error && fieldWrites(operation)?.table === table);
  if (!pending.length) return rows;
  const projected = new Map(rows.map(row => [String(row.id), row]));
  for (const operation of pending) {
    for (const write of fieldWrites(operation)!.writes) {
      const current = projected.get(write.id);
      if (write.action === 'delete') projected.delete(write.id);
      else if (write.action === 'insert' && !current) projected.set(write.id, write.fields);
      else if (write.action === 'update' && current) projected.set(write.id, { ...current, ...write.fields });
    }
  }
  return [...projected.values()];
}

// PostgREST returns JSONB object keys in database order.
export function sameFieldValue(first: unknown, second: unknown): boolean {
  if (first === second || (first == null && second == null)) return true;
  if (Array.isArray(first) && Array.isArray(second)) {
    return first.length === second.length && first.every((value, index) => sameFieldValue(value, second[index]));
  }
  if (!first || !second || typeof first !== 'object' || typeof second !== 'object' ||
      Array.isArray(first) || Array.isArray(second)) return false;
  const left = Object.entries(first);
  return left.length === Object.keys(second).length &&
    left.every(([key, value]) => Object.hasOwn(second, key) && sameFieldValue(value, (second as Fields)[key]));
}

export function fieldWriteApplied(row: Fields, fields: Fields): boolean {
  return Object.entries(fields).every(([key, value]) =>
    // A server may reformat its update timestamp or another client may already
    // have applied the same business change.
    key === 'updated_at' || sameFieldValue(value, row[key]),
  );
}

// Older mobile records contain French dates. Keep the calendar day when
// opening them in native HTML date fields.
export function fieldDateInput(value: unknown): string {
  if (typeof value !== 'string') return '';
  const date = value.trim();
  const iso = /^\d{4}-\d{2}-\d{2}(?=$|[T ])/u.exec(date);
  if (iso) return iso[0];
  const french = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?=$|[T ])/u.exec(date);
  if (!french) return '';
  const [, day, month, year] = french;
  return year + '-' + month.padStart(2, '0') + '-' + day.padStart(2, '0');
}
