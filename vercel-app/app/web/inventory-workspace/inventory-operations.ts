import { supabaseBrowser } from '@/lib/supabase-browser';
import { uploadRegisteredWebFile } from '@/lib/private-media-client';
import type { InventoryLanguage } from './inventory-model';

export type BarcodeCatalogueMatch = {
  designation: string;
  brand?: string | null;
  confidence?: 'high' | 'medium' | 'low' | null;
  variantComplete?: boolean | null;
  source?: string | null;
};

export type BarcodeLookupResult =
  | { state: 'found'; match: BarcodeCatalogueMatch }
  | { state: 'notFound' | 'unavailable' };

export type InventoryMovementMutation = {
  operationId: string;
  movement: Record<string, unknown>;
  product: Record<string, unknown>;
  allowNegative: boolean;
};

export type InventoryProductMutation = {
  productId: string;
  patch: Record<string, unknown>;
};

export type InventoryMutationOutcome = {
  status?: string | null;
  message?: string | null;
  stockAfter?: number | null;
};

export async function lookupInventoryBarcode(code: string, language: InventoryLanguage): Promise<BarcodeLookupResult> {
  try {
    const { data } = await supabaseBrowser.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return { state: 'unavailable' };
    const response = await fetch('/api/inventory-barcode-lookup', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ code, language }),
    });
    if (response.status === 404) return { state: 'notFound' };
    if (!response.ok) return { state: 'unavailable' };
    const payload = await response.json().catch(() => ({}));
    const match = payload?.match;
    if (!match?.designation) return { state: 'notFound' };
    return {
      state: 'found',
      match: {
        designation: String(match.designation),
        brand: match.brand == null ? null : String(match.brand),
        confidence: match.confidence ?? null,
        variantComplete: match.variantComplete ?? null,
        source: match.source == null ? null : String(match.source),
      },
    };
  } catch {
    return { state: 'unavailable' };
  }
}

export async function uploadInventoryPhoto(file: File, projectId: string, productId: string) {
  return uploadRegisteredWebFile('photos', file, `inventory_${projectId}_${productId}`);
}

export async function recordInventoryMovement(input: InventoryMovementMutation): Promise<InventoryMutationOutcome> {
  const { data, error } = await (supabaseBrowser.rpc as any)('record_inventory_movement', {
    p_operation_id: input.operationId,
    p_movement: input.movement,
    p_product: input.product,
    p_allow_negative: input.allowNegative,
  });
  if (error) throw error;
  const outcome = Array.isArray(data) ? data[0] : data;
  return {
    status: outcome?.status ?? null,
    message: outcome?.message ?? null,
    stockAfter: outcome?.stock_after == null ? null : Number(outcome.stock_after),
  };
}

export async function updateInventoryProduct(input: InventoryProductMutation): Promise<InventoryMutationOutcome> {
  const { data, error } = await (supabaseBrowser.rpc as any)('update_inventory_product', {
    p_product_id: input.productId,
    p_patch: input.patch,
  });
  if (error) throw error;
  const outcome = Array.isArray(data) ? data[0] : data;
  return {
    status: outcome?.status ?? null,
    message: outcome?.message ?? null,
  };
}
