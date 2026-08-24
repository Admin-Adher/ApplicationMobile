import { describe, expect, it } from 'vitest';
import type { InventoryMovement, InventoryProduct } from '../constants/types';
import {
  inventoryOutcomeContextFromQueuedOperation,
  isTerminalInventoryMovementOutcome,
  normalizeInventoryMovementOutcome,
  parseInventoryMovementOutcome,
  reconcileInventoryMovementCache,
  reconcileTerminalInventoryMovementCache,
  shouldBlockInventoryMovementForInsufficientStock,
} from '../lib/inventoryMovementOutcome';

const product = (overrides: Partial<InventoryProduct> = {}): InventoryProduct => ({
  id: 'product-local',
  organizationId: 'org-1',
  chantierId: 'chantier-1',
  reference: 'CEM-001',
  designation: 'Ciment',
  currentStock: 10,
  totalEntries: 10,
  totalExits: 0,
  minStock: 2,
  createdAt: '2026-08-14T08:00:00.000Z',
  updatedAt: '2026-08-14T08:00:00.000Z',
  version: 1,
  ...overrides,
});

const movement = (overrides: Partial<InventoryMovement> = {}): InventoryMovement => ({
  id: 'movement-local',
  operationId: 'operation-1',
  organizationId: 'org-1',
  chantierId: 'chantier-1',
  productId: 'product-local',
  movementType: 'out',
  quantity: 3,
  stockBefore: 10,
  stockAfter: 7,
  reference: 'CEM-001',
  designation: 'Ciment',
  userName: 'Alex',
  createdAt: '2026-08-14T09:00:00.000Z',
  ...overrides,
});

describe('inventory movement outcomes', () => {
  it('normalizes the same authoritative row for direct and replay paths', () => {
    const serverRow = [{
      status: 'insufficient_stock',
      message: 'Stock disponible insuffisant.',
      product_id: 'product-server',
      movement_id: null,
      stock_before: '2.5',
      stock_after: '-0.5',
    }];
    const replayContext = inventoryOutcomeContextFromQueuedOperation({
      id: 'queue-1',
      queuedAt: '2026-08-14T09:00:00.000Z',
      rpc: {
        fn: 'record_inventory_movement',
        args: {
          p_operation_id: 'operation-1',
          p_movement: {
            id: 'movement-local',
            chantier_id: 'chantier-1',
            product_id: 'product-local',
            movement_type: 'out',
            quantity: 3,
            created_at: '2026-08-14T09:00:00.000Z',
          },
          p_product: { id: 'product-local', reference: 'CEM-001', designation: 'Ciment' },
        },
      },
    });
    const directContext = {
      operationId: 'operation-1',
      productId: 'product-local',
      movementId: 'movement-local',
      direction: 'out' as const,
      productName: 'Ciment',
      productReference: 'CEM-001',
      quantity: 3,
      chantierId: 'chantier-1',
      occurredAt: '2026-08-14T09:00:00.000Z',
    };

    expect(normalizeInventoryMovementOutcome(serverRow, replayContext)).toEqual(
      normalizeInventoryMovementOutcome(serverRow, directContext),
    );
    expect(normalizeInventoryMovementOutcome(serverRow, directContext)).toMatchObject({
      domain: 'inventory',
      status: 'insufficient_stock',
      productId: 'product-server',
      movementId: 'movement-local',
      stockBefore: 2.5,
      stockAfter: -0.5,
      serverStock: 2.5,
      direction: 'out',
      productName: 'Ciment',
      productReference: 'CEM-001',
      quantity: 3,
    });
  });

  it('applies authoritative success identifiers and stock to the optimistic cache', () => {
    const currentProduct = product({ currentStock: 7, pendingSync: true });
    const currentMovement = movement({ pendingSync: true });
    const outcome = normalizeInventoryMovementOutcome({
      status: 'ok',
      product_id: 'product-server',
      movement_id: 'movement-server',
      stock_before: 9,
      stock_after: 6,
    }, { productId: currentProduct.id, movementId: currentMovement.id });

    const reconciled = reconcileInventoryMovementCache({
      currentProducts: [currentProduct],
      currentMovements: [currentMovement],
      optimisticProductId: currentProduct.id,
      optimisticMovementId: currentMovement.id,
      outcome,
    });

    expect(reconciled.product).toMatchObject({ id: 'product-server', currentStock: 6, pendingSync: false });
    expect(reconciled.movement).toMatchObject({
      id: 'movement-server',
      productId: 'product-server',
      stockBefore: 9,
      stockAfter: 6,
      pendingSync: false,
    });
  });


  it('corrects the stock as a DELTA, keeping a movement queued since', () => {
    // 10 en cache ; A +5 -> 15 ; B +3 -> 18. Le serveur applique A et rend 25,
    // un autre appareil etant passe entre-temps. En absolu le cache tombait a 25
    // et les +3 de B disparaissaient ; en delta, 25 - 15 = +10, donc 28.
    const productBoth = product({ currentStock: 18, pendingSync: true });
    const movementA = movement({
      id: 'movement-a',
      operationId: 'operation-a',
      movementType: 'in',
      quantity: 5,
      stockBefore: 10,
      stockAfter: 15,
      pendingSync: true,
    });
    const movementB = movement({
      id: 'movement-b',
      operationId: 'operation-b',
      movementType: 'in',
      quantity: 3,
      stockBefore: 15,
      stockAfter: 18,
      pendingSync: true,
    });
    const outcome = normalizeInventoryMovementOutcome({
      status: 'ok',
      product_id: 'product-local',
      movement_id: 'movement-a-server',
      stock_before: 20,
      stock_after: 25,
    }, { operationId: 'operation-a', productId: 'product-local', movementId: 'movement-a' });

    const reconciled = reconcileInventoryMovementCache({
      currentProducts: [productBoth],
      currentMovements: [movementA, movementB],
      optimisticProductId: 'product-local',
      optimisticMovementId: 'movement-a',
      outcome,
    });

    expect(reconciled.product?.currentStock).toBe(28);
    expect(reconciled.movements).toContainEqual(movementB);
    // Le produit reste « en attente » tant que B l'est.
    expect(reconciled.product?.pendingSync).toBe(true);
  });

  it('marks the product synced once none of its movements is left pending', () => {
    const single = product({ currentStock: 15, pendingSync: true });
    const only = movement({
      id: 'movement-a',
      operationId: 'operation-a',
      movementType: 'in',
      quantity: 5,
      stockBefore: 10,
      stockAfter: 15,
      pendingSync: true,
    });
    const outcome = normalizeInventoryMovementOutcome({
      status: 'ok',
      product_id: 'product-local',
      movement_id: 'movement-a-server',
      stock_before: 10,
      stock_after: 15,
    }, { operationId: 'operation-a', productId: 'product-local', movementId: 'movement-a' });

    const reconciled = reconcileInventoryMovementCache({
      currentProducts: [single],
      currentMovements: [only],
      optimisticProductId: 'product-local',
      optimisticMovementId: 'movement-a',
      outcome,
    });

    expect(reconciled.product).toMatchObject({ currentStock: 15, pendingSync: false });
  });

  it('leaves a movement on another product untouched', () => {
    const target = product({ currentStock: 15, pendingSync: true });
    const other = product({ id: 'product-other', currentStock: 42, pendingSync: true });
    const mine = movement({
      id: 'movement-a',
      operationId: 'operation-a',
      movementType: 'in',
      quantity: 5,
      stockBefore: 10,
      stockAfter: 15,
      pendingSync: true,
    });
    const theirs = movement({
      id: 'movement-other',
      operationId: 'operation-other',
      productId: 'product-other',
      pendingSync: true,
    });
    const outcome = normalizeInventoryMovementOutcome({
      status: 'ok',
      product_id: 'product-local',
      movement_id: 'movement-a-server',
      stock_before: 10,
      stock_after: 15,
    }, { operationId: 'operation-a', productId: 'product-local', movementId: 'movement-a' });

    const reconciled = reconcileInventoryMovementCache({
      currentProducts: [target, other],
      currentMovements: [mine, theirs],
      optimisticProductId: 'product-local',
      optimisticMovementId: 'movement-a',
      outcome,
    });

    expect(reconciled.products).toContainEqual(other);
    expect(reconciled.movements).toContainEqual(theirs);
  });

  it('rolls back only the refused delta, keeping a movement queued since', () => {
    // 10 ; A -3 -> 7 ; B -2 -> 5. A est refusee : le cache doit remonter a 8, et
    // non revenir a un instantane d'avant A, qui effacerait B.
    const productBoth = product({ currentStock: 5, totalExits: 5, pendingSync: true });
    const movementA = movement({
      id: 'movement-a',
      operationId: 'operation-a',
      movementType: 'out',
      quantity: 3,
      stockBefore: 10,
      stockAfter: 7,
      pendingSync: true,
    });
    const movementB = movement({
      id: 'movement-b',
      operationId: 'operation-b',
      movementType: 'out',
      quantity: 2,
      stockBefore: 7,
      stockAfter: 5,
      pendingSync: true,
    });
    const outcome = normalizeInventoryMovementOutcome({
      status: 'insufficient_stock',
      product_id: 'product-local',
      stock_before: 2,
      stock_after: -1,
    }, { operationId: 'operation-a', productId: 'product-local', movementId: 'movement-a' });

    const reconciled = reconcileInventoryMovementCache({
      currentProducts: [productBoth],
      currentMovements: [movementA, movementB],
      optimisticProductId: 'product-local',
      optimisticMovementId: 'movement-a',
      outcome,
    });

    expect(isTerminalInventoryMovementOutcome(outcome)).toBe(true);
    expect(reconciled.product?.currentStock).toBe(8);
    expect(reconciled.product?.totalExits).toBe(2);
    expect(reconciled.movements).toEqual([movementB]);
  });

  it('corrects nothing when the optimistic movement is gone from the cache', () => {
    // Sans lui le delta n'est pas calculable. Poser le stock absolu du serveur
    // serait definitif ; ne rien corriger laisse le refetch trancher.
    const stale = product({ currentStock: 18, pendingSync: true });
    const outcome = normalizeInventoryMovementOutcome({
      status: 'ok',
      product_id: 'product-local',
      movement_id: 'movement-a-server',
      stock_before: 20,
      stock_after: 25,
    }, { operationId: 'operation-a', productId: 'product-local', movementId: 'movement-a' });

    const reconciled = reconcileInventoryMovementCache({
      currentProducts: [stale],
      currentMovements: [],
      optimisticProductId: 'product-local',
      optimisticMovementId: 'movement-a',
      outcome,
    });

    expect(reconciled.product?.currentStock).toBe(18);
  });

  it('removes the refused movement and reverses its own delta', () => {
    // L'ancienne version restaurait `previousProducts` et posait le
    // `stock_before` serveur en absolu. Le cache local vaut 1 apres un -3 ;
    // inverser ce seul delta rend 4, et preserve l'historique conserve.
    const untouched = movement({ id: 'movement-existing', quantity: 1 });
    const outcome = normalizeInventoryMovementOutcome({
      status: 'insufficient_stock',
      product_id: 'product-local',
      stock_before: 2,
      stock_after: -1,
    }, { movementId: 'movement-local' });

    const reconciled = reconcileInventoryMovementCache({
      currentProducts: [product({ currentStock: 1, pendingSync: true })],
      currentMovements: [movement({ pendingSync: true }), untouched],
      optimisticProductId: 'product-local',
      optimisticMovementId: 'movement-local',
      outcome,
    });

    expect(isTerminalInventoryMovementOutcome(outcome)).toBe(true);
    expect(reconciled.products).toEqual([expect.objectContaining({ currentStock: 4, pendingSync: true })]);
    expect(reconciled.movements).toEqual([untouched]);
  });

  it('rolls back a replay refusal before refetch and remains idempotent', () => {
    const optimisticProduct = product({
      currentStock: 7,
      totalEntries: 10,
      totalExits: 3,
      pendingSync: true,
    });
    const optimisticMovement = movement({
      operationId: 'operation-replayed',
      quantity: 3,
      stockBefore: 10,
      stockAfter: 7,
      pendingSync: true,
    });
    const outcome = normalizeInventoryMovementOutcome({
      status: 'insufficient_stock',
      product_id: optimisticProduct.id,
      movement_id: null,
      stock_before: 8,
      stock_after: 5,
    }, {
      operationId: optimisticMovement.operationId,
    });

    const firstPass = reconcileTerminalInventoryMovementCache({
      currentProducts: [optimisticProduct],
      currentMovements: [optimisticMovement],
      outcome,
    });
    expect(firstPass.changed).toBe(true);
    expect(firstPass.products).toEqual([expect.objectContaining({
      currentStock: 10,
      totalEntries: 10,
      totalExits: 0,
    })]);
    expect(firstPass.movements).toEqual([]);

    const secondPass = reconcileTerminalInventoryMovementCache({
      currentProducts: firstPass.products,
      currentMovements: firstPass.movements,
      outcome,
    });
    expect(secondPass.changed).toBe(false);
    expect(secondPass.products).toEqual(firstPass.products);
    expect(secondPass.movements).toEqual(firstPass.movements);
  });

  it('treats duplicate operation mismatches as terminal structured outcomes', () => {
    const outcome = normalizeInventoryMovementOutcome({
      status: 'duplicate_operation_mismatch',
      message: 'Operation identifier already used with another payload.',
      product_id: 'older-server-product',
      movement_id: 'older-server-movement',
      stock_before: 99,
      stock_after: 98,
    }, {
      operationId: 'operation-1',
      productId: 'product-local',
      movementId: 'movement-local',
    });

    expect(outcome).toMatchObject({
      domain: 'inventory',
      status: 'duplicate_operation_mismatch',
      operationId: 'operation-1',
      productId: 'product-local',
      movementId: 'movement-local',
    });
    expect(outcome.stockBefore).toBeUndefined();
    expect(outcome.stockAfter).toBeUndefined();
    expect(outcome.serverStock).toBeUndefined();
    expect(isTerminalInventoryMovementOutcome(outcome)).toBe(true);
  });

  it('reverses only the rejected delta when later optimistic movements exist', () => {
    const rejected = movement({
      id: 'movement-rejected',
      operationId: 'operation-rejected',
      movementType: 'out',
      quantity: 3,
      stockBefore: 10,
      stockAfter: 7,
      pendingSync: true,
    });
    const laterPending = movement({
      id: 'movement-later',
      operationId: 'operation-later',
      movementType: 'out',
      quantity: 2,
      stockBefore: 7,
      stockAfter: 5,
      pendingSync: true,
    });
    const outcome = normalizeInventoryMovementOutcome({
      status: 'insufficient_stock',
      stock_before: 8,
      stock_after: 5,
    }, {
      operationId: rejected.operationId,
      productId: rejected.productId,
      movementId: rejected.id,
    });

    const reconciled = reconcileTerminalInventoryMovementCache({
      currentProducts: [product({ currentStock: 5, totalExits: 5 })],
      currentMovements: [laterPending, rejected],
      outcome,
    });

    expect(reconciled.products).toEqual([expect.objectContaining({
      currentStock: 8,
      totalExits: 2,
    })]);
    expect(reconciled.movements).toEqual([laterPending]);
  });

  it('lets the server decide against stale stock while online', () => {
    expect(shouldBlockInventoryMovementForInsufficientStock({
      stockAfter: -2,
      negativeAllowed: false,
      isOnline: true,
      isServerConfigured: true,
    })).toBe(false);
    expect(shouldBlockInventoryMovementForInsufficientStock({
      stockAfter: -2,
      negativeAllowed: false,
      isOnline: false,
      isServerConfigured: true,
    })).toBe(true);
    expect(shouldBlockInventoryMovementForInsufficientStock({
      stockAfter: -2,
      negativeAllowed: false,
      isOnline: true,
      isServerConfigured: false,
    })).toBe(true);
    expect(shouldBlockInventoryMovementForInsufficientStock({
      stockAfter: -2,
      negativeAllowed: true,
      isOnline: false,
      isServerConfigured: true,
    })).toBe(false);
  });
});

describe('strict verdict parsing', () => {
  const context = { operationId: 'op-1', productId: 'P1', chantierId: 'C1' };

  it.each([
    ['aucune ligne', []],
    ['objet vide', {}],
    ['ligne vide', [{}]],
    ['primitive', true],
    ['null', null],
    ['statut vide', [{ status: '   ' }]],
    ['statut inconnu', [{ status: 'peut_etre' }]],
  ])('refuses to read a verdict from %s', (_label, data) => {
    // Le fallback `status ?? 'server_rejected'` transformait une ABSENCE DE
    // PREUVE en PREUVE DE REFUS, donc en rollback du stock optimiste.
    const parsed = parseInventoryMovementOutcome(data, context, 'record_inventory_movement');

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.code).toBe('REST_RESULT_INVALID');
  });

  it('refuses the client sentinel coming from a server response', () => {
    // `server_rejected` est fabrique par le moteur apres trois refus
    // deterministes identiques, jamais emis par les RPC. L accepter laisserait
    // une reponse artificielle autoriser un rollback hors contrat SQL.
    const parsed = parseInventoryMovementOutcome([{ status: 'server_rejected' }], context, 'record_inventory_movement');

    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error.code).toBe('REST_RESULT_INVALID');
  });

  it.each([
    ['product_id', { status: 'ok', movement_id: 'M1', stock_before: 1, stock_after: 2 }],
    ['movement_id', { status: 'ok', product_id: 'P1', stock_before: 1, stock_after: 2 }],
    ['stock_before', { status: 'ok', product_id: 'P1', movement_id: 'M1', stock_after: 2 }],
    ['stock_after', { status: 'ok', product_id: 'P1', movement_id: 'M1', stock_before: 1 }],
  ])('refuses a movement success missing %s', (_field, row) => {
    // Un `ok` incomplet ferait reconcilier le cache avec des identifiants et
    // des stocks absents.
    const parsed = parseInventoryMovementOutcome([row], context, 'record_inventory_movement');

    expect(parsed.ok).toBe(false);
  });

  it('accepts a complete movement success', () => {
    const parsed = parseInventoryMovementOutcome(
      [{ status: 'ok', product_id: 'P1', movement_id: 'M1', stock_before: 1, stock_after: 2 }],
      context,
      'record_inventory_movement',
    );

    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.outcome.movementId).toBe('M1');
      expect(parsed.outcome.stockAfter).toBe(2);
    }
  });

  it('asks less of a product update, which returns less', () => {
    // `update_inventory_product` ne renvoie que status, message et product_id.
    const parsed = parseInventoryMovementOutcome(
      [{ status: 'ok', product_id: 'P1' }],
      context,
      'update_inventory_product',
    );

    expect(parsed.ok).toBe(true);
  });

  it('never demands success fields from a refusal', () => {
    // Un refus n a pas a porter movement_id ni stocks.
    const parsed = parseInventoryMovementOutcome(
      [{ status: 'forbidden', message: 'Droit manquant.' }],
      context,
      'record_inventory_movement',
    );

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(isTerminalInventoryMovementOutcome(parsed.outcome)).toBe(true);
  });

  it.each([
    'ok',
    'insufficient_stock',
    'forbidden',
    'invalid_payload',
    'not_found',
    'product_not_found',
    'duplicate_product',
    'duplicate_operation_mismatch',
  ])('accepts the real server verdict %s', status => {
    // Sans `kind`, seul `product_id` est exige sur un succes.
    const parsed = parseInventoryMovementOutcome(
      [{ status, product_id: 'P1' }], context, 'update_inventory_product',
    );

    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.outcome.status).toBe(status);
  });

  it('keeps an explicit refusal terminal, and only that', () => {
    const refused = parseInventoryMovementOutcome(
      [{ status: 'insufficient_stock', stock_before: 5 }],
      context,
      'record_inventory_movement',
    );
    expect(refused.ok).toBe(true);
    if (refused.ok) {
      expect(isTerminalInventoryMovementOutcome(refused.outcome)).toBe(true);
      expect(refused.outcome.stockBefore).toBe(5);
    }

    const accepted = parseInventoryMovementOutcome(
      [{ status: 'ok', product_id: 'P1', stock_after: 12 }], context, 'update_inventory_product',
    );
    expect(accepted.ok).toBe(true);
    if (accepted.ok) expect(isTerminalInventoryMovementOutcome(accepted.outcome)).toBe(false);
  });
});
