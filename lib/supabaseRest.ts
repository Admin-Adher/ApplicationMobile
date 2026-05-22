import { supabase, isSupabaseConfigured, SUPABASE_KEY, SUPABASE_URL } from './supabase';
import { forceRefreshSession, getSessionFromStorage } from './offlineCache';

type TableFilter = { column: string; value: string | number | boolean };
type RestRequestInit = {
  method: string;
  headers?: Record<string, string>;
  body?: string;
};

export type SupabaseRestResult<T = any> = {
  data: T[] | null;
  error: any | null;
};

const REST_TIMEOUT_MS = 25_000;
const TOKEN_TIMEOUT_MS = 4_000;
const TOKEN_FAILURE_COOLDOWN_MS = 60_000;

let memoryToken: { accessToken: string; expiresAt: number } | null = null;
let lastRefreshFailureAt = 0;
let lastSessionFailureAt = 0;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timeout after ${ms}ms`)), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

function normalizeRestError(error: any, status?: number): any {
  if (!error) return { message: `HTTP ${status ?? 'unknown'}` };
  if (typeof error === 'string') return { message: error, status };
  return {
    code: error.code,
    message: error.message ?? error.error ?? `HTTP ${status ?? 'unknown'}`,
    details: error.details,
    hint: error.hint,
    status,
  };
}

async function readBody(response: Response): Promise<any> {
  const text = await response.text().catch(() => '');
  if (!text) return null;
  try { return JSON.parse(text); } catch { return text; }
}

export async function getSupabaseRestAccessToken(): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  const nowMs = Date.now();

  if (memoryToken && memoryToken.expiresAt - 10 > nowSec) {
    return memoryToken.accessToken;
  }

  try {
    const cached = await getSessionFromStorage();
    if (cached?.access_token && typeof cached.expires_at === 'number') {
      if (cached.expires_at - 10 > nowSec) {
        memoryToken = { accessToken: cached.access_token, expiresAt: cached.expires_at };
        return cached.access_token;
      }

      if (nowMs - lastRefreshFailureAt > TOKEN_FAILURE_COOLDOWN_MS) {
        const refreshed = await forceRefreshSession();
        if (refreshed) {
          memoryToken = {
            accessToken: refreshed,
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
          };
          return refreshed;
        }
        lastRefreshFailureAt = Date.now();
      }
    }
  } catch {}

  if (nowMs - lastSessionFailureAt > TOKEN_FAILURE_COOLDOWN_MS) {
    try {
      const { data } = await withTimeout(
        (supabase as any).auth.getSession(),
        TOKEN_TIMEOUT_MS,
        'supabase auth session',
      ) as any;
      const token = data?.session?.access_token;
      const expiresAt = data?.session?.expires_at;
      if (token) {
        if (typeof expiresAt === 'number') {
          memoryToken = { accessToken: token, expiresAt };
        }
        return token;
      }
    } catch {
      lastSessionFailureAt = Date.now();
    }
  }

  return SUPABASE_KEY ?? '';
}

function tableUrl(table: string, params?: Array<[string, string]>): string {
  if (!SUPABASE_URL) throw new Error('Supabase URL missing');
  const url = new URL(`${SUPABASE_URL}/rest/v1/${encodeURIComponent(table)}`);
  for (const [key, value] of params ?? []) {
    url.searchParams.append(key, value);
  }
  return url.toString();
}

function rpcUrl(fn: string): string {
  if (!SUPABASE_URL) throw new Error('Supabase URL missing');
  return `${SUPABASE_URL}/rest/v1/rpc/${encodeURIComponent(fn)}`;
}

function filterParams(filter?: TableFilter): Array<[string, string]> {
  return filter ? [[filter.column, `eq.${String(filter.value)}`]] : [];
}

async function restRequest<T = any>(
  url: string,
  init: RestRequestInit,
  timeoutMs = REST_TIMEOUT_MS,
): Promise<SupabaseRestResult<T>> {
  if (!isSupabaseConfigured || !SUPABASE_KEY) {
    return { data: null, error: { message: 'Supabase non configure' } };
  }

  const token = await getSupabaseRestAccessToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: `Bearer ${token || SUPABASE_KEY}`,
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });

    const body = await readBody(response);
    if (!response.ok) {
      return { data: null, error: normalizeRestError(body, response.status) };
    }
    return { data: Array.isArray(body) ? body : body ? [body] : null, error: null };
  } catch (error: any) {
    const aborted = error?.name === 'AbortError';
    return {
      data: null,
      error: {
        message: aborted
          ? `Timeout Supabase REST apres ${Math.round(timeoutMs / 1000)}s`
          : (error?.message ?? String(error)),
        code: aborted ? 'REST_TIMEOUT' : error?.code,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function supabaseRestSelect<T = any>(
  table: string,
  select = '*',
  filter?: TableFilter,
  limit = 1,
): Promise<SupabaseRestResult<T>> {
  const params: Array<[string, string]> = [['select', select], ...filterParams(filter)];
  if (limit > 0) params.push(['limit', String(limit)]);
  return restRequest<T>(
    tableUrl(table, params),
    { method: 'GET' },
  );
}

export async function supabaseRestMutation<T = any>(
  table: string,
  op: 'insert' | 'update' | 'upsert' | 'delete',
  data?: Record<string, any>,
  filter?: TableFilter,
): Promise<SupabaseRestResult<T>> {
  if ((op === 'update' || op === 'delete') && !filter) {
    return {
      data: null,
      error: {
        code: 'MISSING_FILTER',
        message: `Refusing ${op.toUpperCase()} on ${table} without a filter`,
      },
    };
  }

  if (op === 'insert') {
    return restRequest<T>(
      tableUrl(table),
      {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(data ?? {}),
      },
    );
  }

  if (op === 'upsert') {
    return restRequest<T>(
      tableUrl(table),
      {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
        body: JSON.stringify(data ?? {}),
      },
    );
  }

  if (op === 'update') {
    return restRequest<T>(
      tableUrl(table, filterParams(filter)),
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify(data ?? {}),
      },
    );
  }

  return restRequest<T>(
    tableUrl(table, filterParams(filter)),
    {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' },
    },
  );
}

export async function supabaseRestRpc<T = any>(
  fn: string,
  args?: Record<string, any>,
): Promise<SupabaseRestResult<T>> {
  return restRequest<T>(
    rpcUrl(fn),
    {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(args ?? {}),
    },
  );
}
