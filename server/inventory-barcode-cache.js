'use strict';

const crypto = require('crypto');

class InventoryBarcodeCacheError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InventoryBarcodeCacheError';
  }
}

async function cacheRpc(supabase, name, params) {
  const { data, error } = await supabase.rpc(name, params);
  if (error) throw new InventoryBarcodeCacheError(error.message || `${name} failed`);
  return data;
}

function validClaim(value) {
  return value && ['hit', 'negative_hit', 'pending', 'claimed'].includes(value.state);
}

function pause(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, Math.max(0, milliseconds)));
}

async function claimInventoryBarcodeLookup(
  supabase,
  code,
  { leaseSeconds = 20, maxWaitMs = 4000, pollMs = 250 } = {},
) {
  const leaseToken = crypto.randomUUID();
  const startedAt = Date.now();
  const claimOnce = async () => {
    const claim = await cacheRpc(supabase, 'inventory_barcode_cache_claim', {
      p_barcode_key: code,
      p_raw_code: code,
      p_lease_token: leaseToken,
      p_lease_seconds: leaseSeconds,
    });
    if (!validClaim(claim)) throw new InventoryBarcodeCacheError('Barcode cache returned an invalid state');
    return claim;
  };

  let claim = await claimOnce();
  while (claim.state === 'pending' && Date.now() - startedAt < maxWaitMs) {
    const remaining = maxWaitMs - (Date.now() - startedAt);
    await pause(Math.min(Math.max(100, pollMs), remaining));
    claim = await claimOnce();
  }
  return { ...claim, leaseToken };
}

async function completeInventoryBarcodeLookup(supabase, code, leaseToken, match, metadata = {}) {
  return cacheRpc(supabase, 'inventory_barcode_cache_complete', {
    p_barcode_key: code,
    p_lease_token: leaseToken,
    p_match: match,
    p_provider: metadata.provider || null,
    p_providers_tried: metadata.providersTried || [],
    p_fallback_reason: metadata.fallbackReason || null,
    p_lookup_version: metadata.lookupVersion || 1,
  });
}

async function markInventoryBarcodeNotFound(supabase, code, leaseToken, negativeTtlSeconds = 604800) {
  return cacheRpc(supabase, 'inventory_barcode_cache_mark_not_found', {
    p_barcode_key: code,
    p_lease_token: leaseToken,
    p_negative_ttl_seconds: negativeTtlSeconds,
  });
}

async function releaseInventoryBarcodeLookup(supabase, code, leaseToken) {
  return cacheRpc(supabase, 'inventory_barcode_cache_release', {
    p_barcode_key: code,
    p_lease_token: leaseToken,
  });
}

module.exports = {
  InventoryBarcodeCacheError,
  claimInventoryBarcodeLookup,
  completeInventoryBarcodeLookup,
  markInventoryBarcodeNotFound,
  releaseInventoryBarcodeLookup,
};
