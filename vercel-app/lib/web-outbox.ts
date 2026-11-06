export type WebQueuedOperation = {
  key: string;
  owner: string;
  kind: 'create_reserve' | 'send_message' | 'reserve_status' | 'reserve_edit' | 'reserve_edit_full';
  payload: Record<string, unknown>;
  createdAt: number;
  files?: unknown;
  prepared?: unknown;
  error?: string;
};

const DB_NAME = 'buildtrack-web-outbox-v1';
const STORE = 'operations';
const listeners = new Set<() => void>();

function openQueue(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE, { keyPath: 'key' });
      store.createIndex('owner', 'owner');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('File locale indisponible.'));
    request.onblocked = () => reject(new Error('Fermez les anciens onglets BuildTrack pour ouvrir la file locale.'));
  });
}

async function transaction<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openQueue();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const result = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(result.result);
      tx.onabort = () => reject(tx.error ?? result.error ?? new Error('Écriture locale interrompue.'));
      tx.onerror = () => reject(tx.error ?? result.error ?? new Error('File locale indisponible.'));
    });
  } finally {
    db.close();
  }
}

export async function listWebOperations(owner: string): Promise<WebQueuedOperation[]> {
  const rows = await transaction<WebQueuedOperation[]>('readonly', store => store.index('owner').getAll(owner));
  return rows.sort((left, right) => left.createdAt - right.createdAt);
}

export async function saveWebOperation(operation: WebQueuedOperation) {
  await transaction('readwrite', store => store.put(operation));
  listeners.forEach(listener => listener());
}

export async function removeWebOperation(key: string) {
  await transaction('readwrite', store => store.delete(key));
  listeners.forEach(listener => listener());
}

export function listenWebOperations(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function isWebNetworkFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const detail = error as { name?: string; message?: string; code?: string; status?: number };
  if (detail.status && detail.status >= 500) return true;
  if (detail.code && ['57014', '08000', '08003', '08006', 'REST_TIMEOUT', '40001', '40P01'].includes(detail.code)) return true;
  return /failed to fetch|network ?error|load failed|network request failed|connexion interrompue|timeout|timed out|temporarily unavailable/i.test(detail.message ?? '');
}
