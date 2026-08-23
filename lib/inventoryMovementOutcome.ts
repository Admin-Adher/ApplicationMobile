import type { InventoryMovement, InventoryProduct } from '@/constants/types';
import type { SyncQueueTerminalOutcome } from '@/lib/syncQueuePolicy';

export type InventoryMovementOutcome = SyncQueueTerminalOutcome & { domain: 'inventory' };

const PRODUCTS_CACHE_PREFIX = 'buildtrack_inventory_products_v1';
const MOVEMENTS_CACHE_PREFIX = 'buildtrack_inventory_movements_v1';

export function inventoryProductsCacheKey(chantierId: string): string {
  return `${PRODUCTS_CACHE_PREFIX}_${chantierId}`;
}

export function inventoryMovementsCacheKey(chantierId: string): string {
  return `${MOVEMENTS_CACHE_PREFIX}_${chantierId}`;
}

export interface InventoryMovementOutcomeContext {
  operationId?: string;
  productId?: string;
  movementId?: string;
  direction?: 'in' | 'out' | 'transfer' | 'adjustment';
  productName?: string;
  productReference?: string;
  quantity?: number;
  unit?: string;
  chantierId?: string;
  chantierName?: string;
  occurredAt?: string;
}

export interface InventoryQueuedOperationLike {
  id?: string;
  queuedAt?: string;
  data?: Record<string, unknown>;
  rpc?: {
    fn?: string;
    args?: Record<string, any>;
  };
}

export interface InventoryMovementCacheReconciliation {
  products: InventoryProduct[];
  movements: InventoryMovement[];
  product?: InventoryProduct;
  movement?: InventoryMovement;
}

export interface TerminalInventoryMovementCacheReconciliation {
  products: InventoryProduct[];
  movements: InventoryMovement[];
  removedMovement?: InventoryMovement;
  changed: boolean;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function optionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function movementDirection(value: unknown): InventoryMovementOutcomeContext['direction'] {
  return value === 'in' || value === 'out' || value === 'transfer' || value === 'adjustment'
    ? value
    : undefined;
}

function firstOutcomeRow(data: unknown): Record<string, any> | null {
  const candidate = Array.isArray(data) ? data[0] : data;
  return candidate && typeof candidate === 'object' ? candidate as Record<string, any> : null;
}

/**
 * Builds the persisted, domain-aware outcome used by both direct Supabase calls
 * and offline queue replay. Snake-case and camel-case fields are accepted so a
 * future server adapter cannot silently discard authoritative stock values.
 */
export function normalizeInventoryMovementOutcome(
  data: unknown,
  context: InventoryMovementOutcomeContext = {},
): InventoryMovementOutcome {
  const row = firstOutcomeRow(data);
  const status = optionalString(row?.status) ?? 'server_rejected';
  // A duplicate mismatch returns the result of the *older* operation that owns
  // the identifier. Those server IDs and stock values must never be attached to
  // (or used to roll back) the newly rejected optimistic command.
  const duplicateMismatch = status === 'duplicate_operation_mismatch';
  const stockBefore = duplicateMismatch
    ? undefined
    : optionalNumber(row?.stock_before ?? row?.stockBefore);
  const stockAfter = duplicateMismatch
    ? undefined
    : optionalNumber(row?.stock_after ?? row?.stockAfter);
  const productId = duplicateMismatch
    ? context.productId
    : optionalString(row?.product_id ?? row?.productId) ?? context.productId;
  const movementId = duplicateMismatch
    ? context.movementId
    : optionalString(row?.movement_id ?? row?.movementId) ?? context.movementId;
  const message = optionalString(row?.message);

  return {
    domain: 'inventory',
    status,
    ...(message ? { message } : {}),
    ...(context.operationId ? { operationId: context.operationId } : {}),
    ...(productId ? { productId } : {}),
    ...(movementId ? { movementId } : {}),
    ...(stockBefore !== undefined ? { stockBefore } : {}),
    ...(stockAfter !== undefined ? { stockAfter } : {}),
    ...(stockBefore !== undefined || stockAfter !== undefined
      ? { serverStock: status === 'ok' ? (stockAfter ?? stockBefore) : (stockBefore ?? stockAfter) }
      : {}),
    ...(context.direction ? { direction: context.direction } : {}),
    ...(context.productName ? { productName: context.productName } : {}),
    ...(context.productReference ? { productReference: context.productReference } : {}),
    ...(context.quantity !== undefined ? { quantity: context.quantity } : {}),
    ...(context.unit ? { unit: context.unit } : {}),
    ...(context.chantierId ? { chantierId: context.chantierId } : {}),
    ...(context.chantierName ? { chantierName: context.chantierName } : {}),
    ...(context.occurredAt ? { occurredAt: context.occurredAt } : {}),
  };
}

export function inventoryOutcomeContextFromQueuedOperation(
  operation: InventoryQueuedOperationLike,
): InventoryMovementOutcomeContext {
  const args = operation.rpc?.args ?? {};
  const movement = (args.p_movement ?? {}) as Record<string, any>;
  const product = (args.p_product ?? operation.data ?? {}) as Record<string, any>;

  return {
    operationId: optionalString(args.p_operation_id) ?? operation.id,
    productId: optionalString(movement.product_id ?? args.p_product_id ?? product.id),
    movementId: optionalString(movement.id),
    direction: movementDirection(movement.movement_type),
    productName: optionalString(product.designation ?? movement.designation),
    productReference: optionalString(product.reference ?? movement.reference),
    quantity: optionalNumber(movement.quantity),
    unit: optionalString(movement.unit),
    chantierId: optionalString(movement.chantier_id),
    chantierName: optionalString(movement.chantier_name),
    occurredAt: optionalString(movement.created_at) ?? operation.queuedAt,
  };
}

/**
 * Verdicts que les RPC d'inventaire emettent REELLEMENT, recenses depuis la
 * migration. `server_rejected` en est volontairement absent : c'est une
 * sentinelle CLIENTE, fabriquee par le moteur apres trois refus deterministes
 * identiques. L'accepter depuis une reponse serveur laisserait un
 * `{"status":"server_rejected"}` artificiel autoriser un rollback sans
 * appartenir au contrat SQL.
 */
const RECOGNISED_INVENTORY_STATUSES = new Set([
  'ok',
  'insufficient_stock',
  'forbidden',
  'invalid_payload',
  'not_found',
  'product_not_found',
  'duplicate_product',
  'duplicate_operation_mismatch',
]);

/** RPC dont le verdict de succes a une forme connue et verifiable. */
export type InventoryRpcKind = 'record_inventory_movement' | 'update_inventory_product';

/**
 * Un `ok` doit porter ce que la RPC promet de renvoyer, sinon il n'est pas
 * exploitable : le moteur reconcilierait le cache avec des identifiants et des
 * stocks absents.
 */
function missingSuccessField(row: Record<string, any>, kind?: InventoryRpcKind): string | null {
  const productId = optionalString(row.product_id ?? row.productId);
  if (!productId) return 'product_id';
  if (kind !== 'record_inventory_movement') return null;

  if (!optionalString(row.movement_id ?? row.movementId)) return 'movement_id';
  if (optionalNumber(row.stock_before ?? row.stockBefore) === undefined) return 'stock_before';
  if (optionalNumber(row.stock_after ?? row.stockAfter) === undefined) return 'stock_after';
  return null;
}

export type InventoryOutcomeParseResult =
  | { ok: true; outcome: InventoryMovementOutcome }
  | { ok: false; error: { code: 'REST_RESULT_INVALID'; message: string } };

/**
 * Lecture STRICTE du verdict serveur.
 *
 * `normalizeInventoryMovementOutcome` retombe sur `server_rejected` en
 * l'absence de statut, ce qui transforme une ABSENCE DE PREUVE en PREUVE DE
 * REFUS : une reponse `[{}]` ou `{}` declenchait un refus terminal et le
 * rollback d'un mouvement que le serveur avait peut-etre accepte.
 *
 * Regle de surete : un rollback optimiste n'est autorise que sur un refus
 * serveur explicite et correctement structure, jamais sur un resultat absent
 * ou malforme.
 */
/**
 * `kind` est OBLIGATOIRE : omis, un appelant beneficierait silencieusement
 * d'une validation plus faible du succes, alors que chaque RPC promet des
 * champs differents.
 */
export function parseInventoryMovementOutcome(
  data: unknown,
  context: InventoryMovementOutcomeContext,
  kind: InventoryRpcKind,
): InventoryOutcomeParseResult {
  const row = firstOutcomeRow(data);
  if (!row) {
    return {
      ok: false,
      error: { code: 'REST_RESULT_INVALID', message: 'Reponse de stock sans ligne de resultat.' },
    };
  }

  const status = optionalString(row.status);
  if (!status) {
    return {
      ok: false,
      error: { code: 'REST_RESULT_INVALID', message: 'Reponse de stock sans verdict.' },
    };
  }
  if (!RECOGNISED_INVENTORY_STATUSES.has(status)) {
    return {
      ok: false,
      error: { code: 'REST_RESULT_INVALID', message: `Verdict de stock inconnu : ${status}` },
    };
  }

  if (status === 'ok') {
    const missing = missingSuccessField(row, kind);
    if (missing) {
      return {
        ok: false,
        error: {
          code: 'REST_RESULT_INVALID',
          message: `Succes de stock incomplet : ${missing} manquant.`,
        },
      };
    }
  }

  return { ok: true, outcome: normalizeInventoryMovementOutcome(data, context) };
}

export function isSuccessfulInventoryMovementOutcome(outcome: InventoryMovementOutcome): boolean {
  return outcome.status === 'ok';
}

/** All non-ok rows returned by the inventory RPCs are deterministic refusals. */
export function isTerminalInventoryMovementOutcome(outcome: InventoryMovementOutcome): boolean {
  return outcome.status !== 'ok';
}

export function shouldBlockInventoryMovementForInsufficientStock(input: {
  stockAfter: number;
  negativeAllowed: boolean;
  isOnline: boolean;
  isServerConfigured: boolean;
}): boolean {
  return input.stockAfter < 0
    && !input.negativeAllowed
    && (!input.isOnline || !input.isServerConfigured);
}

/**
 * Reconciles the optimistic cache with the authoritative RPC row.
 *
 * A refusal restores the pre-mutation lists, removes the optimistic movement,
 * and applies stock_before when the server supplied it. A success preserves the
 * optimistic rich fields while replacing identifiers and stock values with the
 * server's authoritative result.
 */
export function reconcileInventoryMovementCache(input: {
  currentProducts: InventoryProduct[];
  currentMovements: InventoryMovement[];
  previousProducts: InventoryProduct[];
  previousMovements: InventoryMovement[];
  optimisticProductId: string;
  optimisticMovementId: string;
  outcome: InventoryMovementOutcome;
}): InventoryMovementCacheReconciliation {
  const {
    currentProducts,
    currentMovements,
    previousProducts,
    previousMovements,
    optimisticProductId,
    optimisticMovementId,
    outcome,
  } = input;
  const successful = isSuccessfulInventoryMovementOutcome(outcome);
  const productSource = successful ? currentProducts : previousProducts;
  const movementSource = successful ? currentMovements : previousMovements;
  const authoritativeProductId = outcome.productId ?? optimisticProductId;

  const products = productSource.map(product => {
    const matches = product.id === optimisticProductId || product.id === outcome.productId;
    if (!matches) return product;
    return {
      ...product,
      id: successful ? authoritativeProductId : product.id,
      ...(successful && outcome.stockAfter !== undefined ? { currentStock: outcome.stockAfter } : {}),
      ...(!successful && outcome.stockBefore !== undefined ? { currentStock: outcome.stockBefore } : {}),
      ...(successful ? { pendingSync: false } : {}),
    };
  });

  const movements = movementSource.map(movement => {
    if (!successful || movement.id !== optimisticMovementId) return movement;
    return {
      ...movement,
      id: outcome.movementId ?? movement.id,
      productId: authoritativeProductId,
      ...(outcome.stockBefore !== undefined ? { stockBefore: outcome.stockBefore } : {}),
      ...(outcome.stockAfter !== undefined ? { stockAfter: outcome.stockAfter } : {}),
      pendingSync: false,
    };
  });

  const product = products.find(item => item.id === authoritativeProductId || item.id === optimisticProductId);
  const authoritativeMovementId = outcome.movementId ?? optimisticMovementId;
  const movement = movements.find(item => item.id === authoritativeMovementId);
  return { products, movements, product, movement };
}

/**
 * Removes an optimistic movement after an offline replay is terminally refused.
 * The movement's presence is the idempotency marker: once removed, subsequent
 * renders cannot subtract its totals again, even when the terminal queue entry
 * remains visible until the user acknowledges it.
 */
export function reconcileTerminalInventoryMovementCache(input: {
  currentProducts: InventoryProduct[];
  currentMovements: InventoryMovement[];
  outcome: InventoryMovementOutcome;
}): TerminalInventoryMovementCacheReconciliation {
  const { currentProducts, currentMovements, outcome } = input;
  // The queue operation ID identifies the rejected optimistic command. A
  // movement ID in a mismatch response may belong to an older server command,
  // so it is only a fallback when no operation ID was persisted.
  const rejectedMovement = outcome.operationId
    ? currentMovements.find(movement => movement.operationId === outcome.operationId)
    : currentMovements.find(movement => !!outcome.movementId && movement.id === outcome.movementId);

  if (!rejectedMovement) {
    return {
      products: currentProducts,
      movements: currentMovements,
      changed: false,
    };
  }

  const optimisticDelta = rejectedMovement.movementType === 'in'
    ? rejectedMovement.quantity
    : rejectedMovement.movementType === 'out'
      ? -rejectedMovement.quantity
      : rejectedMovement.stockAfter - rejectedMovement.stockBefore;
  const products = currentProducts.map(product => {
    if (product.id !== rejectedMovement.productId) return product;
    return {
      ...product,
      // Reverse only this optimistic delta. An absolute server stock_before
      // would erase later pending/successful movements on the same product.
      currentStock: product.currentStock - optimisticDelta,
      totalEntries: rejectedMovement.movementType === 'in'
        ? Math.max(0, product.totalEntries - rejectedMovement.quantity)
        : product.totalEntries,
      totalExits: rejectedMovement.movementType === 'out'
        ? Math.max(0, product.totalExits - rejectedMovement.quantity)
        : product.totalExits,
    };
  });

  return {
    products,
    movements: currentMovements.filter(movement => movement !== rejectedMovement),
    removedMovement: rejectedMovement,
    changed: true,
  };
}
