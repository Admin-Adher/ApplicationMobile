import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { useNetwork, type QueuedOperation } from '@/context/NetworkContext';
import { queryKeys } from '@/lib/queryKeys';
import { readCache, writeCache, isSupabaseSessionValid } from '@/lib/offlineCache';
import { uploadLocalPhotosInPayload } from '@/lib/storage';
import { genId } from '@/lib/utils';
import type {
  InventoryMovement,
  InventoryMovementType,
  InventoryProduct,
} from '@/constants/types';

const PRODUCTS_CACHE_PREFIX = 'buildtrack_inventory_products_v1';
const MOVEMENTS_CACHE_PREFIX = 'buildtrack_inventory_movements_v1';
const MOVEMENT_PAGE_SIZE = 250;

function numberValue(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function normalizeInventoryReference(value: string): string {
  return value.trim().toUpperCase().replace(/[\s-]+/g, '');
}

export function toInventoryProduct(row: any): InventoryProduct {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id ?? ''),
    chantierId: String(row.chantier_id ?? ''),
    reference: String(row.reference ?? ''),
    designation: String(row.designation ?? row.reference ?? ''),
    barcode: row.barcode || undefined,
    photoUrl: row.photo_url || undefined,
    currentStock: numberValue(row.current_stock),
    totalEntries: numberValue(row.total_entries),
    totalExits: numberValue(row.total_exits),
    minStock: numberValue(row.min_stock),
    location: row.location || undefined,
    supplier: row.supplier || undefined,
    createdBy: row.created_by || undefined,
    createdByName: row.created_by_name || undefined,
    createdAt: row.created_at ?? new Date().toISOString(),
    updatedAt: row.updated_at ?? row.created_at ?? new Date().toISOString(),
    version: numberValue(row.version) || 1,
    pendingSync: false,
  };
}

export function toInventoryMovement(row: any): InventoryMovement {
  return {
    id: String(row.id),
    operationId: String(row.operation_id ?? row.id),
    organizationId: String(row.organization_id ?? ''),
    chantierId: String(row.chantier_id ?? ''),
    productId: String(row.product_id ?? ''),
    movementType: row.movement_type === 'out' ? 'out' : 'in',
    quantity: numberValue(row.quantity),
    stockBefore: numberValue(row.stock_before),
    stockAfter: numberValue(row.stock_after),
    reference: String(row.reference ?? ''),
    designation: String(row.designation ?? row.reference ?? ''),
    supplier: row.supplier || undefined,
    buildingId: row.building_id || undefined,
    buildingName: row.building_name || undefined,
    zoneId: row.zone_id || undefined,
    zoneName: row.zone_name || undefined,
    companyId: row.company_id || undefined,
    companyName: row.company_name || undefined,
    personName: row.person_name || undefined,
    comment: row.comment || undefined,
    createdBy: row.created_by || undefined,
    userName: String(row.user_name ?? 'Utilisateur'),
    createdAt: row.created_at ?? new Date().toISOString(),
    pendingSync: false,
  };
}

function productsCacheKey(chantierId: string): string {
  return `${PRODUCTS_CACHE_PREFIX}_${chantierId}`;
}

function movementsCacheKey(chantierId: string): string {
  return `${MOVEMENTS_CACHE_PREFIX}_${chantierId}`;
}

function firstRpcRow(data: any): any {
  return Array.isArray(data) ? data[0] : data;
}

function pendingInventoryIds(queue: QueuedOperation[]) {
  const productIds = new Set<string>();
  const movementIds = new Set<string>();
  for (const operation of queue) {
    if (operation.terminal || operation.op !== 'rpc') continue;
    if (operation.rpc?.fn === 'record_inventory_movement') {
      const args = operation.rpc.args ?? {};
      const movement = args.p_movement ?? {};
      const product = args.p_product ?? {};
      const productId = movement.product_id ?? product.id;
      if (productId) productIds.add(String(productId));
      if (movement.id) movementIds.add(String(movement.id));
    } else if (operation.rpc?.fn === 'update_inventory_product') {
      const productId = operation.rpc.args?.p_product_id;
      if (productId) productIds.add(String(productId));
    }
  }
  return { productIds, movementIds };
}

function mergePendingProducts(
  fresh: InventoryProduct[],
  cached: InventoryProduct[],
  pendingIds: Set<string>,
): InventoryProduct[] {
  const merged = new Map(fresh.map(product => [product.id, product]));
  for (const cachedProduct of cached) {
    if (pendingIds.has(cachedProduct.id)) {
      merged.set(cachedProduct.id, { ...cachedProduct, pendingSync: true });
    }
  }
  return [...merged.values()].sort((a, b) => a.reference.localeCompare(b.reference));
}

function mergePendingMovements(
  fresh: InventoryMovement[],
  cached: InventoryMovement[],
  pendingIds: Set<string>,
): InventoryMovement[] {
  const merged = new Map(fresh.map(movement => [movement.id, movement]));
  for (const cachedMovement of cached) {
    if (pendingIds.has(cachedMovement.id)) {
      merged.set(cachedMovement.id, { ...cachedMovement, pendingSync: true });
    }
  }
  return [...merged.values()]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, MOVEMENT_PAGE_SIZE);
}

export interface RecordInventoryMovementInput {
  chantierId: string;
  movementType: InventoryMovementType;
  quantity: number;
  productId?: string;
  reference: string;
  designation?: string;
  barcode?: string;
  photoUrl?: string;
  minStock?: number;
  location?: string;
  supplier?: string;
  buildingId?: string;
  buildingName?: string;
  zoneId?: string;
  zoneName?: string;
  companyId?: string;
  companyName?: string;
  personName?: string;
  comment?: string;
  allowNegative?: boolean;
}

export interface UpdateInventoryProductPatch {
  reference?: string;
  designation?: string;
  barcode?: string | null;
  photoUrl?: string | null;
  minStock?: number;
  location?: string | null;
  supplier?: string | null;
}

export class InventoryOperationError extends Error {
  status: string;
  stockBefore?: number;
  stockAfter?: number;

  constructor(status: string, message: string, stockBefore?: number, stockAfter?: number) {
    super(message);
    this.name = 'InventoryOperationError';
    this.status = status;
    this.stockBefore = stockBefore;
    this.stockAfter = stockAfter;
  }
}

export function useInventory(chantierId: string | null | undefined, chantierOrganizationId?: string) {
  const { user, permissions } = useAuth();
  const { isOnline, enqueueOperation, queue, queueLoaded } = useNetwork();
  const queryClient = useQueryClient();
  const userId = user?.id;
  const orgId = chantierOrganizationId ?? user?.organizationId ?? '';
  const validChantierId = chantierId ?? '';
  const queueRef = useRef(queue);
  useEffect(() => { queueRef.current = queue; }, [queue]);

  const productsKey = useMemo(() => queryKeys.inventoryProducts(validChantierId), [validChantierId]);
  const movementsKey = useMemo(() => queryKeys.inventoryMovements(validChantierId), [validChantierId]);

  useEffect(() => {
    if (!userId || !validChantierId) return;
    void Promise.all([
      readCache<InventoryProduct>(productsCacheKey(validChantierId), userId),
      readCache<InventoryMovement>(movementsCacheKey(validChantierId), userId),
    ]).then(([cachedProducts, cachedMovements]) => {
      if (cachedProducts?.length && !queryClient.getQueryData<InventoryProduct[]>(productsKey)?.length) {
        queryClient.setQueryData(productsKey, cachedProducts);
      }
      if (cachedMovements?.length && !queryClient.getQueryData<InventoryMovement[]>(movementsKey)?.length) {
        queryClient.setQueryData(movementsKey, cachedMovements);
      }
    });
  }, [queryClient, userId, validChantierId]);

  const productsQuery = useQuery({
    queryKey: productsKey,
    enabled: !!userId && !!validChantierId && permissions.canViewInventory && queueLoaded,
    queryFn: async (): Promise<InventoryProduct[]> => {
      const cached = await readCache<InventoryProduct>(productsCacheKey(validChantierId), userId) ?? [];
      if (!isSupabaseConfigured || !(await isSupabaseSessionValid())) return cached;
      try {
        const { data, error } = await (supabase.from('inventory_products') as any)
          .select('*')
          .eq('chantier_id', validChantierId)
          .order('reference', { ascending: true });
        if (error) throw error;
        const fresh = (data ?? []).map(toInventoryProduct);
        const pending = pendingInventoryIds(queueRef.current).productIds;
        const merged = mergePendingProducts(fresh, cached, pending);
        await writeCache(productsCacheKey(validChantierId), merged, userId);
        return merged;
      } catch (error) {
        console.warn('[inventory] product fetch failed, using cache:', (error as any)?.message ?? error);
        return cached;
      }
    },
  });

  const movementsQuery = useQuery({
    queryKey: movementsKey,
    enabled: !!userId && !!validChantierId && permissions.canViewInventory && queueLoaded,
    queryFn: async (): Promise<InventoryMovement[]> => {
      const cached = await readCache<InventoryMovement>(movementsCacheKey(validChantierId), userId) ?? [];
      if (!isSupabaseConfigured || !(await isSupabaseSessionValid())) return cached;
      try {
        const { data, error } = await (supabase.from('inventory_movements') as any)
          .select('*')
          .eq('chantier_id', validChantierId)
          .order('created_at', { ascending: false })
          .range(0, MOVEMENT_PAGE_SIZE - 1);
        if (error) throw error;
        const fresh = (data ?? []).map(toInventoryMovement);
        const pending = pendingInventoryIds(queueRef.current).movementIds;
        const merged = mergePendingMovements(fresh, cached, pending);
        await writeCache(movementsCacheKey(validChantierId), merged, userId);
        return merged;
      } catch (error) {
        console.warn('[inventory] movement fetch failed, using cache:', (error as any)?.message ?? error);
        return cached;
      }
    },
  });

  const persistCurrent = useCallback(async () => {
    if (!validChantierId || !userId) return;
    const products = queryClient.getQueryData<InventoryProduct[]>(productsKey) ?? [];
    const movements = queryClient.getQueryData<InventoryMovement[]>(movementsKey) ?? [];
    await Promise.all([
      writeCache(productsCacheKey(validChantierId), products, userId),
      writeCache(movementsCacheKey(validChantierId), movements, userId),
    ]);
  }, [queryClient, userId, validChantierId]);

  const recordMovement = useCallback(async (input: RecordInventoryMovementInput) => {
    if (!user || !permissions.canRecordInventory) {
      throw new InventoryOperationError('forbidden', 'Vous ne pouvez pas enregistrer de mouvement de stock.');
    }
    if (!validChantierId || input.chantierId !== validChantierId) {
      throw new InventoryOperationError('invalid_payload', 'Aucun chantier actif.');
    }
    const quantity = Number(input.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new InventoryOperationError('invalid_payload', 'La quantité doit être supérieure à zéro.');
    }

    const currentProducts = queryClient.getQueryData<InventoryProduct[]>(productsKey) ?? [];
    const normalizedReference = normalizeInventoryReference(input.reference);
    const existingProduct = currentProducts.find(product =>
      (input.productId && product.id === input.productId)
      || (!!input.barcode && product.barcode === input.barcode)
      || normalizeInventoryReference(product.reference) === normalizedReference,
    );
    if (!existingProduct && input.movementType === 'out') {
      throw new InventoryOperationError('product_not_found', 'Cette référence n’existe pas dans le stock.');
    }
    if (!normalizedReference) {
      throw new InventoryOperationError('invalid_payload', 'La référence est obligatoire.');
    }

    const before = existingProduct?.currentStock ?? 0;
    const after = input.movementType === 'in' ? before + quantity : before - quantity;
    const negativeAllowed = !!input.allowNegative && permissions.canAdjustInventory;
    if (after < 0 && !negativeAllowed) {
      throw new InventoryOperationError('insufficient_stock', 'Stock disponible insuffisant.', before, after);
    }

    const now = new Date().toISOString();
    const productId = existingProduct?.id ?? input.productId ?? genId('stock-product');
    const operationId = genId('stock-op');
    const movementId = genId('stock-movement');
    const pending = isSupabaseConfigured;
    const optimisticProduct: InventoryProduct = existingProduct
      ? {
          ...existingProduct,
          barcode: existingProduct.barcode ?? input.barcode,
          photoUrl: existingProduct.photoUrl ?? input.photoUrl,
          supplier: input.movementType === 'in' ? (input.supplier || existingProduct.supplier) : existingProduct.supplier,
          location: input.location || existingProduct.location,
          currentStock: after,
          totalEntries: existingProduct.totalEntries + (input.movementType === 'in' ? quantity : 0),
          totalExits: existingProduct.totalExits + (input.movementType === 'out' ? quantity : 0),
          updatedAt: now,
          version: existingProduct.version + 1,
          pendingSync: pending,
        }
      : {
          id: productId,
          organizationId: orgId,
          chantierId: validChantierId,
          reference: input.reference.trim(),
          designation: input.designation?.trim() || input.reference.trim(),
          barcode: input.barcode?.trim() || undefined,
          photoUrl: input.photoUrl,
          currentStock: after,
          totalEntries: quantity,
          totalExits: 0,
          minStock: Number.isFinite(Number(input.minStock)) ? Math.max(0, Number(input.minStock)) : 0,
          location: input.location?.trim() || undefined,
          supplier: input.supplier?.trim() || undefined,
          createdBy: user.id,
          createdByName: user.name,
          createdAt: now,
          updatedAt: now,
          version: 1,
          pendingSync: pending,
        };
    const optimisticMovement: InventoryMovement = {
      id: movementId,
      operationId,
      organizationId: orgId,
      chantierId: validChantierId,
      productId,
      movementType: input.movementType,
      quantity,
      stockBefore: before,
      stockAfter: after,
      reference: optimisticProduct.reference,
      designation: optimisticProduct.designation,
      supplier: input.supplier?.trim() || undefined,
      buildingId: input.buildingId,
      buildingName: input.buildingName,
      zoneId: input.zoneId,
      zoneName: input.zoneName,
      companyId: input.companyId,
      companyName: input.companyName,
      personName: input.personName?.trim() || undefined,
      comment: input.comment?.trim() || undefined,
      createdBy: user.id,
      userName: user.name,
      createdAt: now,
      pendingSync: pending,
    };

    const previousProducts = currentProducts;
    const previousMovements = queryClient.getQueryData<InventoryMovement[]>(movementsKey) ?? [];
    queryClient.setQueryData<InventoryProduct[]>(productsKey, old => {
      const list = old ?? [];
      return list.some(product => product.id === productId)
        ? list.map(product => product.id === productId ? optimisticProduct : product)
        : [...list, optimisticProduct].sort((a, b) => a.reference.localeCompare(b.reference));
    });
    queryClient.setQueryData<InventoryMovement[]>(movementsKey, old => [optimisticMovement, ...(old ?? [])].slice(0, MOVEMENT_PAGE_SIZE));
    await persistCurrent();

    const movementPayload = {
      id: movementId,
      chantier_id: validChantierId,
      product_id: productId,
      movement_type: input.movementType,
      quantity,
      reference: optimisticProduct.reference,
      barcode: input.barcode ?? optimisticProduct.barcode ?? null,
      supplier: input.supplier ?? null,
      location: input.location ?? null,
      building_id: input.buildingId ?? null,
      building_name: input.buildingName ?? null,
      zone_id: input.zoneId ?? null,
      zone_name: input.zoneName ?? null,
      company_id: input.companyId ?? null,
      company_name: input.companyName ?? null,
      person_name: input.personName ?? null,
      comment: input.comment ?? null,
      created_at: now,
    };
    const productPayload = {
      id: productId,
      reference: optimisticProduct.reference,
      designation: optimisticProduct.designation,
      barcode: optimisticProduct.barcode ?? null,
      photo_url: optimisticProduct.photoUrl ?? null,
      min_stock: optimisticProduct.minStock,
      location: optimisticProduct.location ?? null,
      supplier: optimisticProduct.supplier ?? null,
    };
    const queueRpc = (queuedProductPayload: Record<string, any>) => {
      enqueueOperation({
        table: 'inventory_movements',
        op: 'rpc',
        data: queuedProductPayload,
        rpc: {
          fn: 'record_inventory_movement',
          args: {
            p_operation_id: operationId,
            p_movement: movementPayload,
            p_product: queuedProductPayload,
            p_allow_negative: negativeAllowed,
          },
        },
      });
    };

    if (!isSupabaseConfigured) {
      queryClient.setQueryData<InventoryProduct[]>(productsKey, old => (old ?? []).map(product => product.id === productId ? { ...product, pendingSync: false } : product));
      queryClient.setQueryData<InventoryMovement[]>(movementsKey, old => (old ?? []).map(movement => movement.id === movementId ? { ...movement, pendingSync: false } : movement));
      await persistCurrent();
      return { product: { ...optimisticProduct, pendingSync: false }, movement: { ...optimisticMovement, pendingSync: false }, queued: false };
    }

    if (!isOnline) {
      queueRpc(productPayload);
      return { product: optimisticProduct, movement: optimisticMovement, queued: true };
    }

    const prepared = await uploadLocalPhotosInPayload('inventory_products', productPayload);
    if (!prepared.allOk) {
      queueRpc(productPayload);
      return { product: optimisticProduct, movement: optimisticMovement, queued: true };
    }
    const preparedProduct = prepared.data ?? productPayload;
    if (preparedProduct.photo_url && preparedProduct.photo_url !== optimisticProduct.photoUrl) {
      queryClient.setQueryData<InventoryProduct[]>(productsKey, old => (old ?? []).map(product => product.id === productId ? { ...product, photoUrl: preparedProduct.photo_url } : product));
      await persistCurrent();
    }

    const { data, error } = await (supabase.rpc as any)('record_inventory_movement', {
      p_operation_id: operationId,
      p_movement: movementPayload,
      p_product: preparedProduct,
      p_allow_negative: negativeAllowed,
    });
    if (error) {
      queueRpc(preparedProduct);
      return { product: optimisticProduct, movement: optimisticMovement, queued: true };
    }
    const outcome = firstRpcRow(data);
    if (!outcome || outcome.status !== 'ok') {
      queryClient.setQueryData(productsKey, previousProducts);
      queryClient.setQueryData(movementsKey, previousMovements);
      await persistCurrent();
      throw new InventoryOperationError(
        outcome?.status ?? 'server_error',
        outcome?.message ?? 'Le mouvement a été refusé par le serveur.',
        numberValue(outcome?.stock_before),
        numberValue(outcome?.stock_after),
      );
    }

    queryClient.setQueryData<InventoryProduct[]>(productsKey, old => (old ?? []).map(product => product.id === productId ? {
      ...product,
      id: outcome.product_id ?? product.id,
      currentStock: numberValue(outcome.stock_after),
      pendingSync: false,
    } : product));
    queryClient.setQueryData<InventoryMovement[]>(movementsKey, old => (old ?? []).map(movement => movement.id === movementId ? {
      ...movement,
      id: outcome.movement_id ?? movement.id,
      pendingSync: false,
    } : movement));
    await persistCurrent();
    void queryClient.invalidateQueries({ queryKey: productsKey });
    void queryClient.invalidateQueries({ queryKey: movementsKey });
    return { product: optimisticProduct, movement: optimisticMovement, queued: false };
  }, [enqueueOperation, isOnline, movementsKey, orgId, permissions.canAdjustInventory, permissions.canRecordInventory, persistCurrent, productsKey, queryClient, user, validChantierId]);

  const updateProduct = useCallback(async (productId: string, patch: UpdateInventoryProductPatch) => {
    if (!user || !permissions.canAdjustInventory) {
      throw new InventoryOperationError('forbidden', 'Vous ne pouvez pas modifier cette fiche produit.');
    }
    const previous = queryClient.getQueryData<InventoryProduct[]>(productsKey) ?? [];
    const current = previous.find(product => product.id === productId);
    if (!current) throw new InventoryOperationError('not_found', 'Produit introuvable.');
    const optimistic: InventoryProduct = {
      ...current,
      ...patch,
      reference: patch.reference ?? current.reference,
      designation: patch.designation ?? current.designation,
      barcode: patch.barcode === null ? undefined : (patch.barcode ?? current.barcode),
      photoUrl: patch.photoUrl === null ? undefined : (patch.photoUrl ?? current.photoUrl),
      location: patch.location === null ? undefined : (patch.location ?? current.location),
      supplier: patch.supplier === null ? undefined : (patch.supplier ?? current.supplier),
      minStock: patch.minStock === undefined ? current.minStock : Math.max(0, Number(patch.minStock)),
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
      pendingSync: isSupabaseConfigured,
    };
    queryClient.setQueryData<InventoryProduct[]>(productsKey, old => (old ?? []).map(product => product.id === productId ? optimistic : product));
    await persistCurrent();

    const rpcPatch: Record<string, any> = {};
    if (patch.reference !== undefined) rpcPatch.reference = patch.reference;
    if (patch.designation !== undefined) rpcPatch.designation = patch.designation;
    if (patch.barcode !== undefined) rpcPatch.barcode = patch.barcode;
    if (patch.photoUrl !== undefined) rpcPatch.photo_url = patch.photoUrl;
    if (patch.minStock !== undefined) rpcPatch.min_stock = patch.minStock;
    if (patch.location !== undefined) rpcPatch.location = patch.location;
    if (patch.supplier !== undefined) rpcPatch.supplier = patch.supplier;

    const queueRpc = (queuedPatch: Record<string, any>) => enqueueOperation({
      table: 'inventory_products',
      op: 'rpc',
      data: queuedPatch,
      rpc: { fn: 'update_inventory_product', args: { p_product_id: productId, p_patch: queuedPatch } },
    });
    if (!isSupabaseConfigured) {
      queryClient.setQueryData<InventoryProduct[]>(productsKey, old => (old ?? []).map(product => product.id === productId ? { ...product, pendingSync: false } : product));
      await persistCurrent();
      return { queued: false };
    }
    if (!isOnline) {
      queueRpc(rpcPatch);
      return { queued: true };
    }

    const prepared = await uploadLocalPhotosInPayload('inventory_products', { ...rpcPatch, reference: optimistic.reference });
    if (!prepared.allOk) {
      queueRpc(rpcPatch);
      return { queued: true };
    }
    const preparedPatch = { ...(prepared.data ?? rpcPatch) };
    const { data, error } = await (supabase.rpc as any)('update_inventory_product', {
      p_product_id: productId,
      p_patch: preparedPatch,
    });
    if (error) {
      queueRpc(preparedPatch);
      return { queued: true };
    }
    const outcome = firstRpcRow(data);
    if (!outcome || outcome.status !== 'ok') {
      queryClient.setQueryData(productsKey, previous);
      await persistCurrent();
      throw new InventoryOperationError(outcome?.status ?? 'server_error', outcome?.message ?? 'La modification a été refusée.');
    }
    queryClient.setQueryData<InventoryProduct[]>(productsKey, old => (old ?? []).map(product => product.id === productId ? {
      ...product,
      photoUrl: preparedPatch.photo_url === undefined ? product.photoUrl : (preparedPatch.photo_url || undefined),
      pendingSync: false,
    } : product));
    await persistCurrent();
    void queryClient.invalidateQueries({ queryKey: productsKey });
    return { queued: false };
  }, [enqueueOperation, isOnline, permissions.canAdjustInventory, persistCurrent, productsKey, queryClient, user]);

  const products = productsQuery.data ?? [];
  const movements = movementsQuery.data ?? [];
  const lowStockProducts = useMemo(
    () => products.filter(product => product.minStock > 0 && product.currentStock <= product.minStock),
    [products],
  );
  const findProduct = useCallback((value: string) => {
    const needle = value.trim();
    const normalized = normalizeInventoryReference(needle);
    return products.find(product =>
      product.id === needle
      || (!!product.barcode && product.barcode === needle)
      || normalizeInventoryReference(product.reference) === normalized,
    );
  }, [products]);

  return {
    products,
    movements,
    lowStockProducts,
    isLoading: productsQuery.isLoading || movementsQuery.isLoading,
    isRefreshing: productsQuery.isFetching || movementsQuery.isFetching,
    error: productsQuery.error ?? movementsQuery.error,
    findProduct,
    recordMovement,
    updateProduct,
    refresh: async () => {
      await Promise.all([productsQuery.refetch(), movementsQuery.refetch()]);
    },
  };
}

export async function fetchInventoryMovementsForExport(
  chantierId: string,
  fallback: InventoryMovement[],
): Promise<InventoryMovement[]> {
  if (!isSupabaseConfigured || !(await isSupabaseSessionValid())) return fallback;
  const all: InventoryMovement[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await (supabase.from('inventory_movements') as any)
      .select('*')
      .eq('chantier_id', chantierId)
      .order('created_at', { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const page = (data ?? []).map(toInventoryMovement);
    all.push(...page);
    if (page.length < pageSize) break;
  }
  return all;
}
