import type { Checklist, ChecklistItem } from '../constants/types';

export type ChecklistIntent = {
  table: string;
  op: string;
  filter?: { column: string; value: string };
  rpc?: { fn: string; args?: Record<string, any> };
};

export function checklistStatus(items: ChecklistItem[]): Checklist['status'] {
  if (items.length && items.every(item => item.checked)) return 'completed';
  return items.some(item => item.checked) ? 'in_progress' : 'draft';
}

/** Overlay only the edited item, keeping other clients' newly fetched checks. */
export function projectChecklistIntents<T extends Checklist>(rows: T[], queue: readonly ChecklistIntent[]): T[] {
  let projected = rows;
  for (const operation of queue) {
    if (operation.table !== 'checklists') continue;
    if (operation.op === 'delete' && operation.filter?.column === 'id') {
      projected = projected.filter(row => row.id !== operation.filter!.value);
    } else if (operation.op === 'rpc' && operation.rpc?.fn === 'set_checklist_item_checked') {
      const args = operation.rpc.args ?? {};
      projected = projected.map(row => {
        if (row.id !== args.p_checklist_id) return row;
        const items = row.items.map(item => item.id === args.p_item_id ? { ...item, checked: args.p_checked === true } : item);
        return { ...row, items, status: checklistStatus(items) };
      });
    }
  }
  return projected;
}
