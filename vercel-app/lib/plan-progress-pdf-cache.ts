/** Account-scoped PDF bytes only. Signed URLs and tokens are never persisted. */
async function database() {
  return new Promise<IDBDatabase>((resolve,reject) => {
    const request = indexedDB.open('buildtrack-plan-progress-pdf-v1',1);
    request.onupgradeneeded = () => request.result.createObjectStore('pdfs',{ keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function cached(key: string): Promise<Blob | null> {
  const db = await database();
  try { return await new Promise((resolve,reject) => {
    const request = db.transaction('pdfs').objectStore('pdfs').get(key);
    request.onsuccess = () => resolve(request.result?.blob ?? null);
    request.onerror = () => reject(request.error);
  }); } finally { db.close(); }
}
async function store(key: string, blob: Blob) {
  const db = await database();
  try { await new Promise<void>((resolve,reject) => {
    const tx = db.transaction('pdfs','readwrite');
    const entries = tx.objectStore('pdfs');
    const request = entries.getAll();
    request.onsuccess = () => {
      const rows = request.result.filter(row => row.key !== key).sort((a,b) => a.time - b.time);
      let size = rows.reduce((sum,row) => sum + row.blob.size, blob.size);
      while (rows.length && size > 100 * 1024 * 1024) { const row = rows.shift()!; size -= row.blob.size; entries.delete(row.key); }
      entries.put({ key,blob,time:Date.now() });
    };
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  }); } finally { db.close(); }
}
export async function progressPdfData(key: string, uri: string) {
  let blob = await cached(key).catch(() => null);
  if (!blob) {
    if (!uri) throw new Error('Ouvrez ce PDF en ligne une première fois pour le télécharger.');
    const response = await fetch(uri, { credentials: 'omit', signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error('Le PDF est inaccessible. Rouvrez le plan pour renouveler son accès.');
    blob = await response.blob();
    if (blob.size > 25 * 1024 * 1024) throw new Error('Ce PDF dépasse 25 Mo. Utilisez une version optimisée pour le suivi.');
    if (!(await blob.slice(0,1024).text()).includes('%PDF-')) throw new Error('Le fichier du plan n’est pas un PDF valide.');
    await store(key,blob).catch(() => {});
  }
  return new Promise<string>((resolve,reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob);
  });
}
