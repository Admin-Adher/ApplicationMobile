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

const EXPECTED_IDS = Array.from({ length: 59 }, (_, i) => `E${String(i + 1).padStart(2, '0')}`);

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

  it('numbers the exits E01 to E59, each exactly once', () => {
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
      'E01', 'E02', 'E08', 'E10', 'E12', 'E13', 'E33', 'E36', 'E44', 'E51', 'E56',
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
    // L'historique d'echec est REMPLACE : conserver une classe ou un statut
    // HTTP perimes afficherait « refusee localement » a cote d'un « HTTP 503 »,
    // et regrouperait l'operation sous le mauvais alias dans l'export.
    for (const cleared of [
      'failureClass: undefined,',
      'lastHttpStatus: undefined,',
      'lastFailureFingerprint: undefined,',
      'sameFailureCount: 0,',
    ]) {
      expect(activeLines, cleared).toContain(cleared);
    }
    // Une validation locale prouve qu'aucune requete n'a ete emise : le stock
    // optimiste d'un mouvement doit etre annule, contrairement a une erreur
    // reseau ambigue ou l'ecriture a peut-etre abouti.
    expect(activeLines).toContain('terminalReconciliations.push({ op: terminalOperation, outcome: terminalOutcome });');
    expect(helper).toContain('isInventoryMovementOperation(operation)');
  });

  it('reconciles a movement whose RPC name vanished', () => {
    // La garde `rpc?.fn !== 'record_inventory_movement'` vivait AUSSI dans la
    // reconciliation et dans le rejet manuel : pousser la reconciliation sans
    // l'elargir aurait ete sans effet, et le cache serait reste decale.
    expect(source).toContain('if (!isInventoryMovementOperation(operation) || outcome.domain !== ');
    expect(source).toContain('if (!isInventoryMovementOperation(operation)) continue;');
    expect(source).not.toContain("operation.rpc?.fn !== 'record_inventory_movement'");
  });

  it('keeps the remaining kinds where the table puts them', () => {
    const byKind = EXPECTED_IDS.reduce<Record<string, string[]>>((accumulator, id) => {
      const kind = kindOf(id);
      (accumulator[kind] ??= []).push(id);
      return accumulator;
    }, {});

    expect(byKind.conflict).toEqual(['E28']);
    expect(byKind.deferred).toEqual(['E46']);
    expect(byKind.fail).toHaveLength(32);
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
      'E14', 'E15', 'E17', 'E18', 'E19', 'E22', 'E23', 'E26', 'E29', 'E31',
      'E34', 'E40', 'E42', 'E45', 'E47', 'E48', 'E50', 'E52', 'E53', 'E55', 'E57',
    ];

    expect(EXPECTED_IDS.filter(forwardsMeta)).toEqual(expected);
  });

  it('omits it exactly where no response exists to carry it', () => {
    // Échec d'upload, validation locale, exception, refus métier construit
    // localement : aucune réponse HTTP n'a été reçue.
    const expected = ['E03', 'E04', 'E05', 'E06', 'E07', 'E09', 'E11', 'E37', 'E38', 'E39', 'E59'];
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

describe('a prepared rebase identity is durable before the write', () => {
  const helper = source.slice(
    source.indexOf('const persistPreparedRebase = async'),
    source.indexOf('let processed = 0;'),
  );

  it('locates the entry by its local identity, never by the business id', () => {
    // `id` est precisement ce que le rebase remplace, et deux entrees peuvent
    // le partager. Le contenu ne convient pas davantage : une operation peut
    // avoir ete enrichie pendant la passe.
    expect(helper).toContain('entry.queueEntryId === prepared.queueEntryId');
    expect(helper).not.toContain('entry.id === ');
  });

  it('fails closed when the target entry is not unique', () => {
    // Sans entree cible unique, la preparation ne serait pas retrouvable apres
    // une preemption : l'ecriture ne doit pas partir.
    expect(helper).toContain('if (targets.length !== 1)');
    expect(helper).toContain('throw new Error(');
  });

  it('delegates to the publication helper, which is tested behaviourally', () => {
    // « Ecrire puis publier » n'est plus recopie ici : la sequence — rien de
    // publie avant l'ecriture, recalcul si la file a bouge — vit dans
    // `lib/queuePublication.ts`, ou elle est prouvee avec des promesses
    // controlees plutot qu'affirmee sur du texte.
    expect(helper).toContain('publishAfterDurableWrite<QueuedOperation>');
    expect(helper).toContain('write: next => writeQueueStrict(next),');
    expect(helper).not.toContain('saveQueue(');
  });

  it('migrates local identities strictly, before any network call', () => {
    // La migration doit precéder la premiere passe : une file persistee avant
    // l'existence du champ n'en porte aucune, et la preparation deviendrait
    // introuvable.
    const hydration = source.slice(
      source.indexOf('const loadQueue = useCallback'),
      source.indexOf('lastLoadedKeyRef.current = userKey ?? anonKey;'),
    );

    expect(hydration).toContain('ensureQueueEntryIdentities(coalesced, genQueueId)');
    expect(hydration).toContain('await writeQueueStrict(identified.operations);');
    expect(hydration.indexOf('ensureQueueEntryIdentities'))
      .toBeLessThan(hydration.indexOf('await writeQueueStrict('));
  });

  it('starts no pass while the identities are only in memory', () => {
    // Une identite volatile ne survivrait pas au redemarrage : la preparation
    // deviendrait introuvable et la meme ecriture metier repartirait.
    const tail = source.slice(
      source.indexOf('let identitiesAreDurable = false;'),
      source.indexOf('// ── Hydrate queue when user.id changes'),
    );

    expect(tail).toContain('queueLoadedRef.current = identitiesAreDurable;');
    expect(tail).toContain('setQueueLoaded(identitiesAreDurable);');
    expect(tail).toContain('if (!identitiesAreDurable) {');
  });

  it('stamps a local identity on every operation it creates', () => {
    // Enqueue utilisateur et patch photo differe : deux entrees nees pendant
    // l'execution, qui doivent etre localisables comme les autres.
    expect(source.split('queueEntryId: genQueueId(),').length - 1).toBe(2);
  });
});

describe('the legacy rebuild follows physical identity', () => {
  const rebuild = source.slice(
    source.indexOf('const additionsDuringPass ='),
    source.indexOf('queueRef.current = nextQueue;'),
  );

  it('never tracks processed work by the business id', () => {
    // Un rebase remplace volontairement l'identifiant serveur : suivre l'ancien
    // `id` faisait passer la version preparee pour un enqueue concurrent. Elle
    // restait dans la file apres un succes, et pouvait y coexister avec sa
    // propre version en echec.
    expect(rebuild).toContain('processedEntryIds.has(operation.queueEntryId)');
    expect(source).not.toContain('const processedIds = new Set(');
    expect(source).not.toContain('currentQueue.slice(0, processed)');
  });

  it('records the entry AFTER executing it, never from a positional count', () => {
    const start = source.indexOf('const outcome = await executeQueuedOperation(op);');
    // `indexOf` sans borne trouverait l'occurrence du rappel d'upload, situee
    // AVANT la boucle : la tranche serait vide et l'assertion sans objet.
    const loop = source.slice(start, source.indexOf('setSyncProgress({ done: processed', start));

    expect(loop.length).toBeGreaterThan(100);

    expect(loop).toContain('processedEntryIds.add(op.queueEntryId);');
  });
});

describe('the queue purge is durable and keeps what came after it', () => {
  const purge = source.slice(
    source.indexOf('const clearQueue = useCallback'),
    source.indexOf('const dismissRejectedOperations'),
  );

  it('never deletes a queue key, anywhere in the file', () => {
    // Un `removeItem` lance hors chaine pouvait se terminer APRES l'ecriture
    // d'une operation enfilee entre-temps, et la faire disparaitre du disque.
    // `[]` est une file vide parfaitement valide.
    expect(source).not.toContain('AsyncStorage.removeItem(');
  });

  it('writes STRICTLY, through the publication helper', () => {
    // Une reussite fabriquee ferait afficher une file vide pendant que le
    // disque garde les anciennes operations — qui reapparaitraient, et se
    // synchroniseraient, au redemarrage.
    expect(purge).toContain('publishAfterDurableWrite<QueuedOperation>');
    expect(purge).toContain('write: next => writeQueueStrict(next),');
  });

  it('never preempts a running pass', () => {
    // `AbortController` coupe le transport client, il n'annule pas une
    // transaction PostgreSQL : le serveur peut avoir commite juste avant.
    expect(purge).not.toContain('abortCurrentPass(');
  });

  it('delegates ordering to the tested coordinator', () => {
    // « Verrou avant la premiere attente », « une invocation obsolete ne
    // touche rien », « une operation ambigue n'est jamais supprimee » : ces
    // regles portent sur un ORDRE, que des assertions de source ne peuvent
    // pas verifier. Elles vivent dans `lib/manualQueuePurge.ts`, prouvees
    // avec des promesses controlees.
    expect(purge).toContain('runManualQueuePurge<QueuedOperation>');
    expect(purge).toContain('isSyncing: () => syncingRef.current,');
    expect(purge).toContain('isPurgeable: isUnambiguouslyPurgeableOperation,');
  });

  it('binds ownership to the account generation captured up front', () => {
    // Une purge peut traverser un changement de compte : sans ce garde,
    // l'ancienne invocation ecrivait sous la clef du compte precedent et
    // liberait le verrou d'une passe qui ne lui appartenait pas.
    expect(purge).toContain('const ownerGeneration = queueHydrationGenerationRef.current;');
    expect(purge).toContain('queueHydrationGenerationRef.current === ownerGeneration');
    expect(purge).toContain('assertCurrent: () => {');
  });

  it('restores the pass state the preempted pass no longer cleans up', () => {
    // Sa generation n'etant plus courante, la passe ne se nettoie plus
    // elle-meme : l'interface restait sur « 3/29 » et un statut `syncing`
    // alors que rien ne tournait.
    expect(purge).toContain('setSyncProgress({ done: 0, total: 0 });');
    expect(purge).toContain('setNextSyncAttemptAt(null);');
    expect(purge).toContain('passAbortRef.current = null;');
  });

  it('deletes in three durable phases, reconciling before removing', () => {
    // Supprimer d'abord laissait le stock optimiste en desaccord avec le
    // serveur, sans plus aucune operation pour reparer l'ecart. L'ordre des
    // phases est prouve dans `lib/manualQueuePurge.ts`.
    expect(purge).toContain('markPending: operation => ({ ...operation, purgeState: PURGE_PENDING_RECONCILIATION })');
    expect(purge).toContain('reconcile: reconcilePurgedOperation,');
    expect(purge).toContain('hasCompensator: operation => purgeCompensatorFor(operation) !== null,');
  });

  it('never absorbs a reconciliation failure', () => {
    // Absorber l'echec declarerait la purge reussie avec un cache incoherent.
    const compensator = source.slice(
      source.indexOf('const purgeCompensatorFor = useCallback'),
      source.indexOf('const reconcilePurgedOperation = useCallback'),
    );

    expect(compensator).toContain('await reconcileTerminalInventoryOperationCache(operation, outcome, userId);');
    expect(compensator).not.toContain('.catch(');
  });

  it('proves a dispatch could have happened BEFORE the first request', () => {
    // Sans cette preuve durable, la purge ne distingue pas une operation jamais
    // envoyee d'une operation dont la reponse s'est perdue.
    const pass = source.slice(
      source.indexOf('setSyncProgress({ done: 0, total: currentQueue.length });'),
      source.indexOf('const fail = ('),
    );

    expect(pass).toContain("dispatchState: 'started' as const");
    expect(pass).toContain('write: next => writeQueueStrict(next),');
    // Si la preuve n'atteint pas le disque, aucune requete ne part.
    expect(pass).toContain('return;');
  });

  it('resumes an interrupted purge before any pass', () => {
    const hydration = source.slice(
      source.indexOf('const loadQueue = useCallback'),
      source.indexOf('lastLoadedKeyRef.current = userKey ?? anonKey;'),
    );

    expect(hydration).toContain('resumePendingQueuePurge<QueuedOperation>');
    expect(hydration).toContain('operation.purgeState === PURGE_PENDING_RECONCILIATION');
  });

  it('never empties the anonymous key when it IS the active key', () => {
    // Sans utilisateur, `offlineQueueKey` EST la clef anonyme : cette
    // ecriture effacerait les survivantes qu'on vient de persister.
    expect(purge).toContain('if (isOwner() && offlineQueueKey !== anonKey) {');
    expect(purge).toContain('queueWriteChain.writeBestEffort(anonKey, JSON.stringify([]))');
  });
});

describe('the anonymous migration stays inside the chain', () => {
  it('merges in memory and clears the anon key only once the user queue is durable', () => {
    // Ecrire la file utilisateur puis vider la clef anonyme hors chaine
    // pouvait laisser la suppression se terminer apres une ecriture
    // concurrente. Tant que l'ecriture definitive n'a pas abouti, la copie
    // anonyme reste la seule trace de ces saisies.
    const hydration = source.slice(
      source.indexOf('const loadQueue = useCallback'),
      source.indexOf('lastLoadedKeyRef.current = userKey ?? anonKey;'),
    );

    expect(hydration).toContain('anonQueueToClear = anonKey;');
    expect(hydration).toContain('await queueWriteChain.writeBestEffort(anonQueueToClear, JSON.stringify([]));');
    expect(hydration.indexOf('writeQueueStrict(identified.operations)'))
      .toBeLessThan(hydration.indexOf('writeBestEffort(anonQueueToClear'));
  });
});

describe('a failed hydration is actually retried', () => {
  it('recalls loadQueue, not the sync scheduler', () => {
    // `scheduleSync` ne declenche le moteur que si `queueLoadedRef.current` est
    // vrai : apres un echec de migration il se reveillait, constatait que la
    // file n'etait pas chargee, et ne faisait rien. Blocage permanent pour
    // toute la session.
    const retry = source.slice(
      source.indexOf('const scheduleHydrationRetry = useCallback'),
      source.indexOf('const loadQueue = useCallback'),
    );

    expect(retry).toContain('void loadQueueRef.current?.();');
    expect(retry).toContain('if (queueHydrationGenerationRef.current !== generation) return;');
    expect(source).toContain('scheduleHydrationRetry(myHydrationGeneration);');
  });

  it('restores idle UNCONDITIONALLY on success', () => {
    // La version precedente ne remettait `idle` que si un timer etait encore
    // arme — or le vrai reessai met la reference a `null` AVANT de rappeler
    // `loadQueue`. La branche ne s'executait jamais dans le chemin qu'elle
    // pretendait couvrir, et l'assertion ne le voyait pas : le fichier
    // contient d'autres `setSyncStatus('idle')`.
    const from = source.indexOf('identitiesAreDurable = true;');
    const success = source.slice(from, source.indexOf('} catch (error) {', from));
    const active = success
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('//'));

    // Hors de toute condition : derniere ligne du bloc de succes.
    expect(active[active.length - 1]).toBe("setSyncStatus('idle');");
  });

  it('cancels the pending retry on unmount, account change and success', () => {
    const cancellations = source.split('clearTimeout(hydrationRetryTimerRef.current)').length - 1;

    // Demontage, changement de compte, hydratation reussie, et re-armement.
    expect(cancellations).toBe(4);
  });

  it('does not demand a rewrite when the disk already holds it', () => {
    // Une file relue telle quelle est deja durable : exiger une reecriture
    // ferait dependre son utilisation d'un `setItem` qui n'a rien a ecrire.
    const hydration = source.slice(
      source.indexOf('const identified = ensureQueueEntryIdentities'),
      source.indexOf('lastLoadedKeyRef.current = userKey ?? anonKey;'),
    );

    expect(hydration).toContain('if (!nothingToPersist && serialized !== persistedSnapshot) {');
    expect(hydration).toContain('await writeQueueStrict(identified.operations);');
    // Une file ABSENTE et vide n'a rien a rendre durable : exiger un `setItem`
    // ferait dependre le demarrage d'une ecriture qui n'ecrit rien.
    expect(hydration).toContain('persistedSnapshot === null && identified.operations.length === 0');
  });
});

describe('logs never carry business payloads', () => {
  it('reports the shape of a malformed comment patch, not its content', () => {
    // Le patch porte le texte du commentaire, parfois un nom : la discipline
    // d'expurgation appliquee aux erreurs persistees vaut aussi pour les
    // journaux.
    expect(executor).not.toContain('JSON.stringify(patch)');
    expect(executor).toContain("action: patch?.action,");
    expect(executor).toContain('hasComment: Boolean(patch?.comment),');
  });
});

describe('proof that the backend answers breaks the failure streak', () => {
  it('carries it on every non-failure outcome that already got an answer', () => {
    expect(exitExpression('E28')).toContain('provesServerReachable: true');
    expect(exitExpression('E46')).toContain('provesServerReachable: true');
    // E13 et E33 refusent localement, mais APRES une reponse serveur.
    expect(exitExpression('E13')).toContain('provesServerReachable: true');
    expect(exitExpression('E33')).toContain('provesServerReachable: true');
  });

  it('never lets a rebase transport failure fake that proof', () => {
    // Le defaut central : `rebase.reachedServer` valait `true` pour un 503 —
    // qui doit precisement alimenter la serie. L'echec passe desormais par la
    // politique, qui sait qu'un 503 compte et qu'un 429 arrete la passe.
    const rebaseTransport = exitExpression('E45');

    expect(rebaseTransport).toContain('fail(');
    expect(rebaseTransport).toContain('meta: rebase.meta');
    expect(rebaseTransport).toContain('serverAnsweredEarlier: true');
    expect(rebaseTransport).not.toContain('provesServerReachable');
    // Le type interdit desormais de confondre les deux causes. Il vit dans
    // `lib/reserveRebase.ts`, ou le chemin est reellement testable.
    const rebaseModule = read('lib/reserveRebase.ts');
    expect(rebaseModule).toContain("kind: 'retry_transport';");
    expect(rebaseModule).toContain("kind: 'retry_conflict';");
    expect(rebaseModule).not.toContain('reachedServer: rpc.meta.reachedServer');
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
    // Un premier verdict serveur DANS la meme operation rompt la serie ; cet
    // echec-ci en demarre une nouvelle plutot que de conserver l'ancienne.
    expect(failBody).toContain('options?.serverAnsweredEarlier ? 0 : consecutiveInfraFailures');

    // La preuve casse les DEUX dimensions. Sans cette remise a zero, le palier
    // exponentiel restait celui d'AVANT le verdict : historique 4, un
    // `version_conflict` recu, trois `503`, et le circuit repartait du palier 5.
    const activeLines = failBody
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0 && !line.startsWith('//') && !line.startsWith('*'));
    const guard = activeLines.indexOf('if (options?.serverAnsweredEarlier) {');

    expect(guard).toBeGreaterThan(-1);
    expect(activeLines[guard + 1]).toBe('syncInfrastructureFailureCountRef.current = 0;');
  });
});
