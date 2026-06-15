import * as Crypto from 'expo-crypto';
import { supabaseRestRpc, type SupabaseRestResult } from './supabaseRest';

export type ReserveMutationStatus =
  | 'ok'
  | 'version_conflict'
  | 'deleted'
  | 'forbidden'
  | 'not_found'
  | 'duplicate_operation_mismatch'
  | 'invalid_payload';

export type ReserveMutationResult = {
  status: ReserveMutationStatus;
  reserve_id?: string;
  version?: number;
  current_version?: number;
  message?: string;
  [key: string]: any;
};

export type ReserveStatusEventPayload = {
  id: string;
  reserve_id: string;
  from_status?: string | null;
  to_status: string;
  actor_id?: string | null;
  actor_name?: string | null;
  occurred_at: string;
  reason?: string | null;
  history_entry?: any;
  closed_at?: string | null;
  closed_by?: string | null;
};

export function newOperationId(): string {
  const cryptoLike = (globalThis as any).crypto;
  if (typeof cryptoLike?.randomUUID === 'function') {
    return cryptoLike.randomUUID();
  }

  const bytes = new Uint8Array(16);
  if (typeof cryptoLike?.getRandomValues === 'function') {
    cryptoLike.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function canonicalize(value: unknown): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== 'object') return value;

  const input = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const key of Object.keys(input).sort()) {
    const next = input[key];
    if (typeof next === 'undefined') continue;
    output[key] = canonicalize(next);
  }
  return output;
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export async function buildRequestHash(value: unknown): Promise<string> {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    canonicalStringify(value),
  );
}

export function firstReserveMutationResult(
  data: SupabaseRestResult<ReserveMutationResult>['data'],
): ReserveMutationResult | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== 'object') return null;
  return row as ReserveMutationResult;
}

export function isReserveMutationRpcUnavailable(error: any): boolean {
  const message = String(error?.message ?? error ?? '').toLowerCase();
  const code = String(error?.code ?? '').toUpperCase();
  return (
    code === 'PGRST202' ||
    code === 'PGRST204' ||
    message.includes('could not find the function') ||
    message.includes('schema cache') ||
    message.includes('apply_reserve_patch') ||
    message.includes('append_reserve_status_event')
  );
}

export async function applyReservePatchOperation(params: {
  operationId: string;
  reserveId: string;
  baseVersion?: number | null;
  patch: Record<string, any>;
}) {
  const request = {
    fn: 'apply_reserve_patch',
    reserve_id: params.reserveId,
    base_version: params.baseVersion ?? null,
    patch: params.patch,
  };
  const requestHash = await buildRequestHash(request);
  return supabaseRestRpc<ReserveMutationResult>('apply_reserve_patch', {
    p_operation_id: params.operationId,
    p_request_hash: requestHash,
    p_reserve_id: params.reserveId,
    p_base_version: params.baseVersion ?? null,
    p_patch: params.patch,
  });
}

export async function appendReserveStatusEventOperation(params: {
  operationId: string;
  event: ReserveStatusEventPayload;
}) {
  const request = {
    fn: 'append_reserve_status_event',
    event: params.event,
  };
  const requestHash = await buildRequestHash(request);
  return supabaseRestRpc<ReserveMutationResult>('append_reserve_status_event', {
    p_operation_id: params.operationId,
    p_request_hash: requestHash,
    p_event: params.event,
  });
}
