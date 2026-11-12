/** Bounded read retries only; never retry authentication or permission failures. */
export async function readDirectory<T>(read: () => Promise<T>, signal: AbortSignal): Promise<T> {
  const cancelled = () => Object.assign(new Error('Chargement annulé.'), { code: 'CANCELLED' });
  for (let attempt = 0; ; attempt++) {
    if (signal.aborted) throw cancelled();
    try {
      const value = await read();
      if (signal.aborted) throw cancelled();
      return value;
    } catch (cause) {
      const error = cause as { code?: string; status?: number };
      if (signal.aborted) throw cancelled();
      const transient = ['REST_TIMEOUT', 'REST_NETWORK_ERROR', '57014'].includes(error?.code ?? '') ||
        [408, 429, 500, 502, 503, 504].includes(error?.status ?? 0);
      if (!transient || attempt >= 2) throw cause;
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(cancelled()); };
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, (attempt + 1) * 1_000);
        signal.addEventListener('abort', abort, { once: true });
      });
    }
  }
}
