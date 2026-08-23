import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Contrat des sorties de `executeQueuedOperation`.
 *
 * Trente-sept `continue` quittaient la boucle sans dire ce qui venait de se
 * passer : « échec différé », « refus définitif », « succès » et « ligne déjà
 * absente » étaient la même instruction, et le succès se déduisait a posteriori
 * de `failedOps.length` — une heuristique incapable de distinguer « le serveur
 * n'a pas répondu » de « le serveur a dit non ».
 *
 * Ces assertions restent un seam de source : l'exécuteur vit dans une fermeture
 * React qu'aucun test unitaire ne peut instancier. Elles disparaîtront quand
 * `runSyncPass` consommera réellement ces issues.
 */
const source = readFileSync(
  resolve(import.meta.dirname, '..', 'context/NetworkContext.tsx'),
  'utf8',
).replace(/\r\n/g, '\n');

const executor = source.slice(
  source.indexOf('const executeQueuedOperation = async'),
  source.indexOf('for (const op of currentQueue) {'),
);

const occurrences = (needle: string) => executor.split(needle).length - 1;

describe('every exit declares what happened', () => {
  it('locates the executor at all', () => {
    // Verrou sur la prémisse : un renommage rendrait toutes les assertions
    // ci-dessous vides sans que personne ne le remarque.
    expect(executor.length).toBeGreaterThan(5_000);
    expect(executor).toContain('Promise<PassOperationOutcome<QueuedOperation>>');
  });

  it('has no implicit exit left', () => {
    expect(executor).not.toContain('continue;');
  });

  it('never calls fail() without returning its verdict', () => {
    // `fail()` rend l'issue. L'appeler sans la rendre, c'est enregistrer
    // l'échec puis poursuivre la passe — le défaut exact qui laissait le moteur
    // continuer d'envoyer pendant une limitation serveur.
    const bare = executor
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.includes('fail(')
        && !line.startsWith('//')
        && !line.includes('return fail(')
        && !line.includes('const fail')
        && !line.includes('fallbackErr'));

    expect(bare).toEqual([]);
  });

  /**
   * Inventaire figé. Si ce décompte change, la table de contrat de la PR doit
   * être mise à jour dans le même commit — c'est le but de ce verrou.
   */
  it('matches the contract table exactly', () => {
    expect({
      failures: occurrences('return fail('),
      applied: occurrences("return { kind: 'applied'"),
      terminal: occurrences("return { kind: 'terminal'"),
      conflict: occurrences("return { kind: 'conflict'"),
      deferred: occurrences("return { kind: 'deferred'"),
    }).toEqual({
      failures: 40,
      applied: 14,
      terminal: 2,
      conflict: 1,
      deferred: 1,
    });
  });
});

describe('transport metadata reaches the policy', () => {
  it.each([
    ['RPC', 'rpcMeta'],
    ['mutation de repli', 'fallbackMeta'],
    ['métadonnées de plan', 'metadataMeta'],
    ['lecture de conflit', 'fetchMeta'],
    ['écriture fusionnée', 'writeMeta'],
    ['application de statut', 'applyMeta'],
    ['réserves liées', 'linkedMeta'],
    ['rejeu générique', 'result.meta'],
  ])('forwards %s', (_label, metaVariable) => {
    // Sans `meta`, un 503 porteur d'un `Retry-After` suit la politique de panne
    // ordinaire : ni l'échéance exacte, ni l'abandon backend demandé par le
    // serveur ne sont appliqués.
    expect(executor).toContain(`meta: ${metaVariable}`);
  });

  it('passes meta to every verdict built from a REST response', () => {
    // Vérifier la seule PRÉSENCE d'un `meta: rpcMeta` ne suffit pas : retirer
    // `{ meta: result.meta }` d'un site laissait le test vert tant qu'un autre
    // site citait la même variable. Le décompte, lui, bouge.
    const destructured = executor
      .split('\n')
      .filter(line => line.includes('} = await supabaseRest') && line.includes('meta:'))
      .length;

    expect({
      destructured,
      forwarded: occurrences('meta:') - destructured,
    }).toEqual({ destructured: 10, forwarded: 20 });
  });

  it('destructures meta from every REST call whose error is classified', () => {
    // Le sondage d'existence est exclu : son erreur est volontairement avalée,
    // elle ne devient jamais un verdict.
    const restCalls = executor
      .split('\n')
      .filter(line => line.includes('} = await supabaseRest'))
      .map(line => line.trim());

    const withoutMeta = restCalls.filter(line => !line.includes('meta:'));

    expect(withoutMeta).toEqual([
      'const { data: exists, error: existsErr } = await supabaseRestSelect(',
      'const { data: exists, error: existsErr } = await supabaseRestSelect(',
    ]);
  });
});
