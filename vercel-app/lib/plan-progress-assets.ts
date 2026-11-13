import { boundedRead } from './bounded-read';
import { progressAssetVersions } from './plan-progress-asset-versions';

const memory = new Map<string, Promise<string>>();
/** Public immutable-by-version code only; no document bytes or user data. */
export function loadProgressAsset(name: string): Promise<string> {
  if (!progressAssetVersions[name]) return Promise.reject(new Error('Lecteur indisponible.'));
  const path = '/plan-progress/' + name + '?v=' + progressAssetVersions[name];
  let pending = memory.get(path);
  if (!pending) {
    pending = (async () => {
      const cache = await boundedRead(() => caches.open('buildtrack-plan-progress-assets-v2'), { timeoutMs: 1000, retries: 0 }).catch(() => null);
      const saved = await boundedRead(async () => (await cache?.match(path))?.text(), { timeoutMs: 1000, retries: 0 }).catch(() => null);
      if (saved) return saved;
      return boundedRead(async signal => {
        const response = await fetch(path, { signal, cache: 'force-cache' });
        if (!response.ok) throw Object.assign(new Error('Le lecteur d’avancement est indisponible.'), { status: response.status });
        const copy = response.clone();
        const text = await response.text();
        void cache?.put(path, copy).catch(() => {});
        return text;
      });
    })().catch(error => { memory.delete(path); throw error; });
    memory.set(path, pending);
  }
  return pending;
}
