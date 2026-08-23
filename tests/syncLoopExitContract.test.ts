import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Contrat des sorties de `executeQueuedOperation`.
 *
 * Trente-sept `continue` quittaient la boucle sans dire ce qui venait de se
 * passer : « échec différé », « refus définitif », « succès » et « ligne déjà
 * absente » étaient la même instruction.
 *
 * Le verrou porte sur les IDENTIFIANTS, pas sur des décomptes : un décompte
 * reste vert si une sortie disparaît pendant qu'une autre apparaît ailleurs. Il
 * ne porte pas non plus sur les numéros de ligne, qui deviennent faux au
 * premier changement.
 *
 * Ces assertions restent un seam de source : l'exécuteur vit dans une fermeture
 * React qu'aucun test unitaire ne peut instancier. Elles disparaîtront quand
 * `runSyncPass` consommera réellement ces issues.
 */
const read = (relative: string) => readFileSync(
  resolve(import.meta.dirname, '..', relative),
  'utf8',
).replace(/\r\n/g, '\n');

const source = read('context/NetworkContext.tsx');
const contract = read('docs/sync-loop-exit-contract.md');

const executor = source.slice(
  source.indexOf('const executeQueuedOperation = async'),
  source.indexOf('for (const op of currentQueue) {'),
);

const EXPECTED_IDS = Array.from({ length: 58 }, (_, i) => `E${String(i + 1).padStart(2, '0')}`);

/** Expression rendue par une sortie, parenthèses équilibrées comprises. */
function exitExpression(id: string): string {
  const marker = `syncExit('${id}',`;
  const at = executor.indexOf(marker);
  if (at < 0) return '';

  const from = at + 'syncExit'.length;
  let depth = 0;
  for (let i = from; i < executor.length; i += 1) {
    const char = executor[i];
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      if (depth === 0) return executor.slice(from, i + 1);
    }
  }
  return '';
}

const idsInCode = [...executor.matchAll(/syncExit\('(E\d\d)'/g)].map(match => match[1]);
const idsInContract = [...contract.matchAll(/^\| (E\d\d) \|/gm)].map(match => match[1]);

describe('the contract table covers every exit, one for one', () => {
  it('locates the executor at all', () => {
    // Verrou sur la prémisse : un renommage rendrait tout le reste vide.
    expect(executor.length).toBeGreaterThan(5_000);
    expect(executor).toContain('Promise<QueuedOperationOutcome>');
  });

  it('numbers the exits E01 to E58, each exactly once', () => {
    expect(idsInCode).toEqual(EXPECTED_IDS);
  });

  it('documents exactly those identifiers, each exactly once', () => {
    expect([...idsInContract].sort()).toEqual(EXPECTED_IDS);
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
        && !line.includes('syncExit(')
        && !line.includes('const fail'));

    expect(bare).toEqual([]);
  });
});

describe('each exit declares the right kind', () => {
  const kindOf = (id: string) => {
    const expression = exitExpression(id);
    if (expression.includes('terminalLocalOperation(')) return 'terminalLocal';
    if (expression.includes('fail(')) return 'fail';
    return (expression.match(/kind: '(\w+)'/) ?? [])[1] ?? 'inconnu';
  };

  it('refuses locally, without any network call, exactly where the table says', () => {
    // Un payload absent, un filtre manquant ou une opération illisible ne peut
    // être réparé par aucune nouvelle tentative. Les différer indéfiniment
    // promettait un réessai impossible.
    const local = EXPECTED_IDS.filter(id => kindOf(id) === 'terminalLocal');

    expect(local).toEqual([
      'E01', 'E02', 'E08', 'E10', 'E12', 'E13', 'E33', 'E36', 'E44', 'E50', 'E55',
    ]);
  });

  it('persists every local refusal instead of dropping it', () => {
    // Une issue `terminal` rendue sans passer par `fail()` n'atterrissait ni
    // dans `pendingConflicts` ni dans `failedOps` : la reconstruction de la file
    // la faisait disparaître au lieu de la garder visible comme refusée.
    const helper = source.slice(
      source.indexOf('const terminalLocalOperation = ('),
      source.indexOf('let processed = 0;'),
    );
    // La ligne doit être du CODE : `toContain` seul passait encore quand la
    // poussée était commentée, puisque le commentaire contient le texte.
    const activeLines = helper
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('//') && !line.startsWith('*'));

    expect(activeLines).toContain('failedOps.push(terminalOperation);');
    expect(activeLines).toContain('terminal: true,');
    // Une opération refusée n'a aucune prochaine tentative.
    expect(activeLines).toContain('nextAttemptAt: undefined,');
    expect(activeLines).toContain('retrySource: undefined,');
  });

  it('keeps the remaining kinds where the table puts them', () => {
    const byKind = EXPECTED_IDS.reduce<Record<string, string[]>>((accumulator, id) => {
      const kind = kindOf(id);
      (accumulator[kind] ??= []).push(id);
      return accumulator;
    }, {});

    expect(byKind.conflict).toEqual(['E28']);
    expect(byKind.deferred).toEqual(['E45']);
    expect(byKind.fail).toHaveLength(31);
    expect(byKind.applied).toHaveLength(14);
    expect(byKind.inconnu).toBeUndefined();
  });
});

describe('transport metadata reaches the policy, exit by exit', () => {
  const forwardsMeta = (id: string) => exitExpression(id).includes('meta:');

  it('forwards it from every verdict built on a REST response', () => {
    // Vérifier la seule présence d'un `meta: rpcMeta` quelque part ne suffisait
    // pas : retirer `{ meta: result.meta }` d'un site laissait le test vert tant
    // qu'un autre site citait la même variable.
    const expected = [
      'E14', 'E15', 'E17', 'E18', 'E19', 'E22', 'E23', 'E26', 'E29',
      'E31', 'E34', 'E40', 'E42', 'E47', 'E49', 'E51', 'E54', 'E56',
    ];

    expect(EXPECTED_IDS.filter(forwardsMeta)).toEqual(expected);
  });

  it('omits it exactly where no response exists to carry it', () => {
    // Échec d'upload, validation locale, exception, refus métier construit
    // localement : aucune réponse HTTP n'a été reçue.
    const expected = ['E03', 'E04', 'E05', 'E06', 'E07', 'E09', 'E11', 'E37', 'E38', 'E39', 'E46', 'E52', 'E58'];
    const failuresWithoutMeta = EXPECTED_IDS
      .filter(id => exitExpression(id).includes('fail(') && !forwardsMeta(id));

    expect(failuresWithoutMeta).toEqual(expected);
  });

  it('destructures meta from every REST call whose error is classified', () => {
    // Le sondage d'existence est exclu : son erreur est volontairement avalée,
    // elle ne devient jamais un verdict.
    const withoutMeta = executor
      .split('\n')
      .filter(line => line.includes('} = await supabaseRest') && !line.includes('meta:'))
      .map(line => line.trim());

    expect(withoutMeta).toEqual([
      'const { data: exists, error: existsErr } = await supabaseRestSelect(',
      'const { data: exists, error: existsErr } = await supabaseRestSelect(',
    ]);
  });
});

describe('proof that the backend answers breaks the failure streak', () => {
  it('carries it on the conflict and on a server-side rebase', () => {
    expect(exitExpression('E28')).toContain('provesServerReachable: true');
    expect(exitExpression('E45')).toContain('provesServerReachable: rebase.reachedServer');
  });

  it('resets the streak on that proof, not only on success', () => {
    // « timeout, conflit serveur observé, timeout » donnait 1 → 1 → 2 : le
    // conflit prouvait pourtant que le backend est joignable.
    expect(source).toContain("if (outcome.kind === 'applied' || outcome.provesServerReachable === true) {");
  });

  it('never lets fail() set it', () => {
    // Un `503` est bien rendu PAR le serveur, mais il alimente délibérément la
    // série : le remettre à zéro empêcherait le disjoncteur de s'ouvrir sur une
    // panne de service prolongée. Les compteurs des échecs appartiennent au
    // classificateur seul.
    const failBody = source.slice(
      source.indexOf('const fail = ('),
      source.indexOf('const terminalLocalOperation = ('),
    );

    expect(failBody).not.toContain('provesServerReachable');
  });
});
