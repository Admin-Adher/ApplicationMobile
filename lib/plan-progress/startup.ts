/** Resolve an ephemeral URL without restarting an editor when it is refreshed. */
export function waitForPlanUri(read: () => string, signal: AbortSignal, timeoutMs = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    const finish = (error?: Error, uri?: string) => {
      clearTimeout(timer); signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(uri!);
    };
    const abort = () => finish(new Error('Ouverture du plan annulée.'));
    const check = () => {
      if (signal.aborted) { abort(); return; }
      const uri = read();
      if (uri) { finish(undefined, uri); return; }
      if (Date.now() - started >= timeoutMs) { finish(new Error('Le lien du PDF n’est pas encore disponible. Réessayez dans quelques instants.')); return; }
      timer = setTimeout(check, 100);
    };
    signal.addEventListener('abort', abort, { once: true }); check();
  });
}
