import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '..');

function source(relativePath: string): string {
  return readFileSync(resolve(repositoryRoot, relativePath), 'utf8').replace(/\r\n/g, '\n');
}

describe('sync transfer cancellation', () => {
  it('uploads natively through a cancellable task, never through uploadAsync', () => {
    const storage = source('lib/storage.ts');

    // `FileSystem.uploadAsync` ne peut pas etre interrompu : borner sa promesse
    // laissait le transfert continuer en tache de fond apres l'echec cote
    // moteur, sur un lien deja sature, et l'ecriture pouvait aboutir apres le
    // demarrage du reessai.
    expect(storage).toContain('FileSystem.createUploadTask(');
    expect(storage).toContain('task.cancelAsync()');
    expect(storage).not.toMatch(/FileSystem\.uploadAsync\(/);

    // Une tache annulee resout sur null/undefined : ce n'est pas un succes.
    expect(storage).toContain('if (!result) {');
  });

  it('threads a cancellation signal down the whole upload chain', () => {
    const storage = source('lib/storage.ts');

    for (const signature of [
      'async function uploadFileCancellable(',
      'async function putFileToR2(',
      'async function putFileToSupabase(',
      'async function uploadRegisteredMedia(',
      'async function _uploadPhotoWithError(',
    ]) {
      const start = storage.indexOf(signature);
      expect(start, signature).toBeGreaterThan(-1);
      const params = storage.slice(start, storage.indexOf(')', start) + 1);
      expect(params, signature).toContain('signal?: AbortSignal | null');
    }

    // Le point d'entree de la passe expose l'option, et la relaie a chaque photo.
    expect(storage).toContain('signal?: AbortSignal | null;');
    expect(storage).toContain('_uploadPhotoWithError(uri, filename, undefined, options?.signal)');
  });

  it('gives every long-lived fetch a real abort, not just a rejected promise', () => {
    const storage = source('lib/storage.ts');
    const network = source('context/NetworkContext.tsx');

    // L'appel de finalisation du media n'avait AUCUNE borne.
    expect(storage).toContain('async function completeRegisteredUpload(');
    const complete = storage.slice(storage.indexOf('async function completeRegisteredUpload('));
    expect(complete.slice(0, 1200)).toContain('signal: controller.signal');

    // Les sondes de connectivite tenaient une socket bien apres leur delai.
    expect(network).toContain('async function fetchWithAbort(');
    expect(network).not.toMatch(/withTimeoutMs\(fetch\(/);
  });

  it('aborts the in-flight pass on preemption, account switch and unmount', () => {
    const network = source('context/NetworkContext.tsx');

    expect(network).toContain('const passAbortRef = useRef<AbortController | null>(null);');
    expect(network).toContain('const passAbort = new AbortController();');
    expect(network).toContain('const passSignal = passAbort.signal;');

    for (const reason of [
      'préemption passe gelée',
      'changement de compte',
      'démontage du provider',
    ]) {
      expect(network, reason).toContain(`abortCurrentPass('${reason}')`);
    }

    // Les etapes lourdes de la passe recoivent le signal.
    expect(network).toContain('signal: passSignal,');
    expect(network.match(/\{ signal: passSignal \}/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('separates a caller cancellation from a genuine timeout', () => {
    const rest = source('lib/supabaseRest.ts');

    // Une annulation demandee par l'appelant n'est pas un symptome de reseau
    // lent : elle ne doit pas alimenter le backoff comme un timeout.
    expect(rest).toContain('function linkAbortSignal(');
    expect(rest).toContain("code: cancelledByCaller ? 'REST_ABORTED' : aborted ? 'REST_TIMEOUT' : error?.code,");

    for (const entry of [
      'export async function supabaseRestSelect<T = any>(',
      'export async function supabaseRestMutation<T = any>(',
      'export async function supabaseRestRpc<T = any>(',
    ]) {
      const start = rest.indexOf(entry);
      expect(start, entry).toBeGreaterThan(-1);
      expect(rest.slice(start, rest.indexOf('):', start)), entry).toContain('options?: RestRequestOptions');
    }
  });
});
