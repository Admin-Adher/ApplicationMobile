export type ProgressiveLoadLease = {
  isCurrent: () => boolean;
};

/**
 * Publishes one dataset as soon as it is ready while keeping the original
 * promise available for the final, consistent workspace snapshot.
 */
export function publishWhenCurrent<T>(
  promise: Promise<T>,
  lease: ProgressiveLoadLease,
  publish: (value: T) => void,
): Promise<T> {
  void promise.then(value => {
    if (lease.isCurrent()) publish(value);
  }, () => {
    // The caller awaits the original promise and owns final error handling.
  });
  return promise;
}

/** Limit database pressure; newly opened modules take the next free slot. */
export function createWorkspaceReadQueue(priority: (table: string) => number, concurrency = 4) {
  let running = 0;
  const pending: { table: string; run: () => void }[] = [];
  const pump = () => {
    pending.sort((a, b) => priority(b.table) - priority(a.table));
    while (running < concurrency && pending.length) {
      running++;
      pending.shift()!.run();
    }
  };
  return {
    pump,
    run<T>(table: string, read: () => Promise<T>): Promise<T> {
      return new Promise((resolve, reject) => {
        pending.push({ table, run: () => { void read().then(resolve, reject).finally(() => { running--; pump(); }); } });
        queueMicrotask(pump);
      });
    },
  };
}

const TABLES_BY_TAB: Record<string, string[]> = {
  dashboard: ['chantiers', 'reserves', 'companies', 'tasks', 'incidents', 'visites'],
  plans: ['chantiers', 'site_plans', 'reserves', 'companies', 'lots'],
  reserves: ['chantiers', 'reserves', 'companies'],
  admin: ['chantiers', 'profiles', 'companies', 'organizations'],
  inventory: ['chantiers', 'companies', 'inventory_products', 'inventory_movements'],
  messages: ['channels', 'messages', 'profiles', 'companies'],
  media: ['photos', 'documents', 'reserves'], documents: ['documents'],
  visites: ['visites', 'reserves', 'profiles', 'companies'], opr: ['oprs', 'reserves', 'companies'],
  planning: ['tasks', 'reserves', 'companies'], journal: ['journal_entries', 'companies'],
  pointage: ['time_entries', 'companies', 'profiles'], incidents: ['incidents', 'profiles'],
  equipes: ['companies', 'lots'], chantiers: ['chantiers', 'companies'],
  analytics: ['reserves', 'companies', 'lots'], checklists: ['checklists'],
  reglementaire: ['regulatory_docs'], rapports: ['reserves', 'companies', 'visites', 'oprs'],
};
export const workspaceTablesForTab = (tab: string): string[] => TABLES_BY_TAB[tab] ?? [];

export function sameWorkspaceAuthority(a: any, b: any): boolean {
  const permissions = (p: any) => Object.entries(p?.permissions_override ?? p?.permissionsOverride ?? {}).sort(([x], [y]) => x.localeCompare(y));
  return Boolean(a && b && a.id === b.id && a.organization_id === b.organization_id && a.role === b.role &&
    a.company_id === b.company_id && a.membership_status === b.membership_status &&
    JSON.stringify(permissions(a)) === JSON.stringify(permissions(b)));
}
