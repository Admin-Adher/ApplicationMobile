export type InventoryBarcodeCacheMatch = {
  barcode: string;
  designation: string;
  brand?: string;
  photoUrl?: string;
  source: string;
  sourceUrl?: string;
  confidence: 'high' | 'medium' | 'low';
  variantComplete: boolean;
};

export type InventoryBarcodeCacheClaim = {
  state: 'hit' | 'negative_hit' | 'pending' | 'claimed' | 'unavailable';
  cacheHit?: boolean;
  cachedProvider?: string;
  match?: InventoryBarcodeCacheMatch;
  retryAfterMs?: number;
};

type RpcResult = { data: unknown; error: { message?: string } | null };

export type InventoryBarcodeCacheClient = {
  rpc: (name: string, params: Record<string, unknown>) => PromiseLike<RpcResult>;
};

export class InventoryBarcodeCacheError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InventoryBarcodeCacheError';
  }
}

function parseClaim(value: unknown): InventoryBarcodeCacheClaim {
  if (!value || typeof value !== 'object') {
    throw new InventoryBarcodeCacheError('Barcode cache returned an invalid response');
  }
  const claim = value as InventoryBarcodeCacheClaim;
  if (!['hit', 'negative_hit', 'pending', 'claimed'].includes(claim.state)) {
    throw new InventoryBarcodeCacheError('Barcode cache returned an unknown state');
  }
  return claim;
}

async function rpc(
  client: InventoryBarcodeCacheClient,
  name: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  const { data, error } = await client.rpc(name, params);
  if (error) throw new InventoryBarcodeCacheError(error.message ?? `${name} failed`);
  return data;
}

function pause(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, milliseconds)));
}

/**
 * Atomically claims the right to search a barcode. If another worker already
 * owns the lease, wait briefly for its shared result instead of spending a
 * second Tavily/SerpAPI request.
 */
export async function claimInventoryBarcodeLookup(
  client: InventoryBarcodeCacheClient,
  code: string,
  leaseToken: string,
  options: { leaseSeconds?: number; maxWaitMs?: number; pollMs?: number } = {},
): Promise<InventoryBarcodeCacheClaim> {
  const startedAt = Date.now();
  const maxWaitMs = Math.max(0, options.maxWaitMs ?? 4_000);
  const pollMs = Math.max(100, options.pollMs ?? 250);
  let claim = parseClaim(await rpc(client, 'inventory_barcode_cache_claim', {
    p_barcode_key: code,
    p_raw_code: code,
    p_lease_token: leaseToken,
    p_lease_seconds: options.leaseSeconds ?? 20,
  }));

  while (claim.state === 'pending' && Date.now() - startedAt < maxWaitMs) {
    const remaining = maxWaitMs - (Date.now() - startedAt);
    await pause(Math.min(pollMs, remaining));
    claim = parseClaim(await rpc(client, 'inventory_barcode_cache_claim', {
      p_barcode_key: code,
      p_raw_code: code,
      p_lease_token: leaseToken,
      p_lease_seconds: options.leaseSeconds ?? 20,
    }));
  }

  return claim;
}

export async function completeInventoryBarcodeLookup(
  client: InventoryBarcodeCacheClient,
  code: string,
  leaseToken: string,
  match: InventoryBarcodeCacheMatch,
  metadata: {
    provider?: string;
    providersTried?: string[];
    fallbackReason?: string;
    lookupVersion?: number;
  } = {},
): Promise<void> {
  await rpc(client, 'inventory_barcode_cache_complete', {
    p_barcode_key: code,
    p_lease_token: leaseToken,
    p_match: match,
    p_provider: metadata.provider ?? null,
    p_providers_tried: metadata.providersTried ?? [],
    p_fallback_reason: metadata.fallbackReason ?? null,
    p_lookup_version: metadata.lookupVersion ?? 1,
  });
}

export async function markInventoryBarcodeNotFound(
  client: InventoryBarcodeCacheClient,
  code: string,
  leaseToken: string,
  negativeTtlSeconds = 7 * 24 * 60 * 60,
): Promise<void> {
  await rpc(client, 'inventory_barcode_cache_mark_not_found', {
    p_barcode_key: code,
    p_lease_token: leaseToken,
    p_negative_ttl_seconds: negativeTtlSeconds,
  });
}

export async function releaseInventoryBarcodeLookup(
  client: InventoryBarcodeCacheClient,
  code: string,
  leaseToken: string,
): Promise<void> {
  await rpc(client, 'inventory_barcode_cache_release', {
    p_barcode_key: code,
    p_lease_token: leaseToken,
  });
}
