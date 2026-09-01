import { supabase, isSupabaseConfigured, SUPABASE_KEY, SUPABASE_URL } from './supabase';
import { forceRefreshSession, getSessionFromStorage } from './offlineCache';

type TableFilter = { column: string; value: string | number | boolean };
type RestRequestInit = {
  method: string;
  headers?: Record<string, string>;
  body?: string;
};

/**
 * Ce que l'appelant attend du corps de la reponse.
 *
 * Un `2xx` au corps VIDE n'est ni une erreur de lecture ni un JSON invalide :
 * il passait donc encore pour une reussite. Sur `record_inventory_movement`,
 * l'absence de ligne se normalise en `server_rejected`, donc en refus terminal,
 * donc en rollback d'un mouvement que le serveur a peut-etre accepte.
 */
export type RestBodyExpectation = 'none' | 'optional-json' | 'required-json' | 'required-row';

/**
 * Une ligne de resultat exploitable existe-t-elle ?
 *
 * `required-json` ne garantissait que « il y a du JSON ». `[]`, `{}`, `[{}]`
 * ou `true` passaient donc pour des succes, et sur un mouvement de stock
 * l'absence de premiere ligne se normalise en `server_rejected` — soit un refus
 * terminal et un rollback, sur la foi d'une reponse qui ne dit rien.
 */
function hasResultRow(body: unknown): boolean {
  if (Array.isArray(body)) {
    const first = body[0];
    return body.length > 0 && first !== null && typeof first === 'object' && !Array.isArray(first);
  }
  return body !== null && typeof body === 'object' && !Array.isArray(body);
}

/** Annulation externe : préemption d'une passe, changement de compte, démontage. */
export type RestRequestOptions = {
  signal?: AbortSignal | null;
};

/**
 * L'attente de corps est decidee ICI, jamais par l'appelant : la placer dans
 * les options publiques permettait de desactiver la protection centralisee en
 * passant `bodyExpectation: 'none'`.
 */
type InternalRestRequestOptions = RestRequestOptions & {
  bodyExpectation: RestBodyExpectation;
};

/**
 * RPC dont l'appelant EXPLOITE le resultat : sans ligne de verdict, l'operation
 * ne peut pas etre declaree reussie. La connaissance vit ici pour que les
 * appelants existants en beneficient sans changement.
 */
const RPC_REQUIRING_RESULT = new Set([
  'record_inventory_movement',
  'update_inventory_product',
  'apply_reserve_patch',
  'append_reserve_status_event',
]);

/**
 * Relaie une annulation externe vers le contrôleur interne (celui qui porte
 * déjà la borne de temps). `AbortSignal.any` n'est pas garanti sur Hermes, on
 * chaîne donc les signaux à la main.
 */
function linkAbortSignal(controller: AbortController, external?: AbortSignal | null): () => void {
  if (!external) return () => {};
  if (external.aborted) {
    controller.abort();
    return () => {};
  }
  const onAbort = () => controller.abort();
  external.addEventListener('abort', onAbort);
  return () => external.removeEventListener('abort', onAbort);
}

/**
 * Metadonnees de transport consommees par la politique de reessai.
 *
 * Seule la valeur utile de `Retry-After` est conservee : recopier tous les
 * headers ferait entrer des donnees de session dans la file persistee et dans
 * l'export de diagnostic.
 */
export interface SupabaseRestMeta {
  /** Statut HTTP de la reponse FINALE, `null` si aucune n'est parvenue. */
  status: number | null;
  /** Une reponse a-t-elle ete recue ? Un 400 ou un 503 comptent comme oui. */
  reachedServer: boolean;
  /** En-tete `Retry-After` brut, a interpreter par `parseRetryAfter`. */
  retryAfter: string | null;
}

export type SupabaseRestResult<T = any> = {
  data: T[] | null;
  error: any | null;
  meta: SupabaseRestMeta;
};

/** Aucune reponse : coupure, borne de temps atteinte, ou annulation. */
const NO_RESPONSE_META: SupabaseRestMeta = {
  status: null,
  reachedServer: false,
  retryAfter: null,
};

/**
 * Seule valeur d'en-tete qui traverse la couche. Bornee : un proxy defaillant
 * ou hostile ne doit pas faire circuler une chaine arbitrairement longue
 * jusqu'a la politique, ni jusqu'a la file persistee.
 */
function retryAfterFromResponse(response: Response): string | null {
  const value = response.headers.get('Retry-After')?.trim();
  if (!value || value.length > 128) return null;
  return value;
}

function metaFromResponse(response: Response): SupabaseRestMeta {
  return {
    status: response.status,
    reachedServer: true,
    retryAfter: retryAfterFromResponse(response),
  };
}

/**
 * Resultat unique quand Supabase n'est pas configure.
 *
 * Le garde-fou vivait dans `restRequest`, mais les entrees publiques
 * construisent l'URL AVANT de l'appeler : `tableUrl()` et `rpcUrl()` levent
 * « Supabase URL missing » et le garde-fou n'etait jamais atteint. Or c'est
 * precisement l'absence d'URL qui rend `isSupabaseConfigured` faux.
 */
function unconfiguredResult<T>(): SupabaseRestResult<T> {
  return {
    data: null,
    error: { code: 'SUPABASE_NOT_CONFIGURED', message: 'Supabase non configure' },
    meta: { status: null, reachedServer: false, retryAfter: null },
  };
}

function isRestUsable(): boolean {
  return Boolean(isSupabaseConfigured && SUPABASE_URL && SUPABASE_KEY);
}

const REST_TIMEOUT_MS = 25_000;
const TOKEN_TIMEOUT_MS = 4_000;
const TOKEN_FAILURE_COOLDOWN_MS = 60_000;

export type SupabaseAuthenticatedSession = {
  accessToken: string;
  expiresAt: number;
  userId: string;
};

type CachedBearer = {
  accessToken: string;
  expiresAt: number;
  userId: string | null;
};

let memoryToken: CachedBearer | null = null;
let lastRefreshFailureAt = 0;
let lastSessionFailureAt = 0;
let authenticatedSessionPromise: Promise<SupabaseAuthenticatedSession | null> | null = null;
let forcedAuthenticatedSessionPromise: Promise<SupabaseAuthenticatedSession | null> | null = null;
let tokenGeneration = 0;

function cacheBearer(value: CachedBearer, expectedGeneration: number): void {
  if (expectedGeneration === tokenGeneration) memoryToken = value;
}

export function clearSupabaseRestTokenCache(): void {
  tokenGeneration += 1;
  memoryToken = null;
  authenticatedSessionPromise = null;
  forcedAuthenticatedSessionPromise = null;
  lastRefreshFailureAt = 0;
  lastSessionFailureAt = 0;
}

async function rememberRefreshedToken(
  accessToken: string,
  expectedGeneration = tokenGeneration,
): Promise<void> {
  let expiresAt = Math.floor(Date.now() / 1000) + 300;
  let userId: string | null = null;
  try {
    const cached = await getSessionFromStorage();
    if (
      cached?.access_token === accessToken &&
      typeof cached.expires_at === 'number'
    ) {
      expiresAt = cached.expires_at;
      userId = cached.user?.id ?? null;
    }
  } catch {}
  cacheBearer({ accessToken, expiresAt, userId }, expectedGeneration);
}

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

/**
 * Ne masque plus l'echec de lecture.
 *
 * Absorber l'exception rendait `null`, et `response.ok` restant vrai, la
 * requete passait pour une reussite vide. Sur un mouvement de stock, une
 * reponse vide est normalisee en `server_rejected` : une coupure pendant la
 * lecture du corps produisait donc un refus terminal et un rollback du stock
 * optimiste, alors que le serveur avait bien enregistre le mouvement.
 */
async function readBody(response: Response): Promise<any> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (cause) {
    // Une reponse d'erreur peut legitimement etre du texte brut, typiquement
    // une page produite par un proxy en amont : on la conserve telle quelle.
    if (!response.ok) return text;
    // Sur un 2xx en revanche, PostgREST renvoie du JSON. Un corps arbitraire
    // — « <html>proxy error</html> » — n'est pas un resultat exploitable, et
    // le laisser passer le ferait normaliser en `server_rejected` sur un
    // mouvement de stock, donc annuler un stock peut-etre accepte.
    throw Object.assign(new Error('La reponse REST contient un corps JSON invalide'), {
      name: 'RestBodyParseError',
      code: 'REST_BODY_PARSE_FAILED',
      cause,
    });
  }
}

function authenticatedSessionFrom(value: any): SupabaseAuthenticatedSession | null {
  const accessToken = value?.access_token;
  const expiresAt = value?.expires_at;
  const userId = value?.user?.id;
  if (
    typeof accessToken !== 'string' ||
    !accessToken ||
    accessToken === SUPABASE_KEY ||
    typeof expiresAt !== 'number' ||
    typeof userId !== 'string' ||
    !userId
  ) {
    return null;
  }
  return { accessToken, expiresAt, userId };
}

async function loadSupabaseAuthenticatedSession(
  forceRefresh: boolean,
  expectedGeneration: number,
): Promise<SupabaseAuthenticatedSession | null> {
  const nowSec = Math.floor(Date.now() / 1000);
  const nowMs = Date.now();

  if (
    !forceRefresh &&
    memoryToken?.userId &&
    memoryToken.accessToken !== SUPABASE_KEY &&
    memoryToken.expiresAt - 10 > nowSec
  ) {
    return {
      accessToken: memoryToken.accessToken,
      expiresAt: memoryToken.expiresAt,
      userId: memoryToken.userId,
    };
  }

  let cached: Awaited<ReturnType<typeof getSessionFromStorage>> = null;
  try {
    cached = await getSessionFromStorage();
    const storedSession = authenticatedSessionFrom(cached);
    if (!forceRefresh && storedSession) {
      if (storedSession.expiresAt - 10 > nowSec) {
        cacheBearer(storedSession, expectedGeneration);
        return storedSession;
      }

      if (nowMs - lastRefreshFailureAt > TOKEN_FAILURE_COOLDOWN_MS) {
        const refreshed = await forceRefreshSession();
        if (refreshed) {
          await rememberRefreshedToken(refreshed, expectedGeneration);
          const refreshedStored = authenticatedSessionFrom(await getSessionFromStorage());
          if (refreshedStored?.accessToken === refreshed) return refreshedStored;
        }
        lastRefreshFailureAt = Date.now();
      }
    }
  } catch {}

  // A 401 from a private endpoint is stronger evidence than the local expiry
  // timestamp. Refresh once even when the persisted access token still looks
  // fresh, then reject the old token if the refresh did not replace it.
  if (forceRefresh && cached?.refresh_token) {
    const staleAccessToken = cached.access_token;
    const refreshed = await forceRefreshSession().catch(() => null);
    if (refreshed) {
      await rememberRefreshedToken(refreshed, expectedGeneration);
      const refreshedStored = authenticatedSessionFrom(await getSessionFromStorage());
      if (
        refreshedStored?.accessToken === refreshed &&
        refreshedStored.accessToken !== staleAccessToken
      ) {
        return refreshedStored;
      }
    } else {
      lastRefreshFailureAt = Date.now();
    }
  }

  if (forceRefresh || nowMs - lastSessionFailureAt > TOKEN_FAILURE_COOLDOWN_MS) {
    try {
      const { data } = await withTimeout(
        (supabase as any).auth.getSession(),
        TOKEN_TIMEOUT_MS,
        'supabase auth session',
      ) as any;
      const sdkSession = authenticatedSessionFrom(data?.session);
      if (
        sdkSession &&
        sdkSession.expiresAt - 10 > Math.floor(Date.now() / 1000) &&
        (!forceRefresh || sdkSession.accessToken !== cached?.access_token)
      ) {
        cacheBearer(sdkSession, expectedGeneration);
        return sdkSession;
      }
    } catch {
      lastSessionFailureAt = Date.now();
    }
  }

  return null;
}

/**
 * Return only a real user session. Private media and other RLS-sensitive
 * callers must never silently degrade to the publishable/anon key: that turns
 * an auth incident into blank data and makes account ownership ambiguous.
 * Concurrent image mounts share one bounded session lookup.
 */
export function getSupabaseAuthenticatedSession(options?: {
  forceRefresh?: boolean;
}): Promise<SupabaseAuthenticatedSession | null> {
  const forceRefresh = options?.forceRefresh === true;
  const current = forceRefresh
    ? forcedAuthenticatedSessionPromise
    : authenticatedSessionPromise;
  if (current) return current;

  const generation = tokenGeneration;
  let work!: Promise<SupabaseAuthenticatedSession | null>;
  work = loadSupabaseAuthenticatedSession(forceRefresh, generation)
    .then(session => (generation === tokenGeneration ? session : null))
    .finally(() => {
      if (forceRefresh) {
        if (forcedAuthenticatedSessionPromise === work) forcedAuthenticatedSessionPromise = null;
      } else if (authenticatedSessionPromise === work) {
        authenticatedSessionPromise = null;
      }
    });

  if (forceRefresh) forcedAuthenticatedSessionPromise = work;
  else authenticatedSessionPromise = work;
  return work;
}

export async function getSupabaseRestAccessToken(): Promise<string> {
  const nowSec = Math.floor(Date.now() / 1000);
  const nowMs = Date.now();
  const generation = tokenGeneration;

  if (memoryToken && memoryToken.expiresAt - 10 > nowSec) {
    return memoryToken.accessToken;
  }

  try {
    const cached = await getSessionFromStorage();
    if (cached?.access_token && typeof cached.expires_at === 'number') {
      if (cached.expires_at - 10 > nowSec) {
        cacheBearer({
          accessToken: cached.access_token,
          expiresAt: cached.expires_at,
          userId: cached.user?.id ?? null,
        }, generation);
        return cached.access_token;
      }

      if (nowMs - lastRefreshFailureAt > TOKEN_FAILURE_COOLDOWN_MS) {
        const refreshed = await forceRefreshSession();
        if (refreshed) {
          await rememberRefreshedToken(refreshed, generation);
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
          cacheBearer({
            accessToken: token,
            expiresAt,
            userId: data?.session?.user?.id ?? null,
          }, generation);
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
  options?: InternalRestRequestOptions,
): Promise<SupabaseRestResult<T>> {
  if (!isSupabaseConfigured || !SUPABASE_KEY) {
    return { data: null, error: { message: 'Supabase non configure' }, meta: { ...NO_RESPONSE_META } };
  }

  if (options?.signal?.aborted) {
    return {
      data: null,
      error: { code: 'REST_ABORTED', message: 'Requete aborted avant envoi' },
      meta: { ...NO_RESPONSE_META },
    };
  }

  const token = await getSupabaseRestAccessToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const unlink = linkAbortSignal(controller, options?.signal);

  try {
    const send = (accessToken: string) => fetch(url, {
      ...init,
      headers: {
        apikey: SUPABASE_KEY!,
        Authorization: `Bearer ${accessToken || SUPABASE_KEY}`,
        Accept: 'application/json',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init.headers ?? {}),
      },
      signal: controller.signal,
    });

    let response = await send(token);

    // A cached JWT can become invalid before its local expiry (logout, account
    // switch, server-side revocation). Invalidate it immediately and perform at
    // most one bounded refresh/retry. The queue remains intact if that retry
    // also fails.
    if (response.status === 401 && token && token !== SUPABASE_KEY) {
      clearSupabaseRestTokenCache();
      const refreshGeneration = tokenGeneration;
      if (Date.now() - lastRefreshFailureAt > TOKEN_FAILURE_COOLDOWN_MS) {
        const refreshed = await forceRefreshSession().catch(() => null);
        if (refreshed) {
          await rememberRefreshedToken(refreshed, refreshGeneration);
          response = await send(refreshed);
        } else if (!refreshed) {
          lastRefreshFailureAt = Date.now();
        }
      }
    }

    // Les metadonnees decrivent la reponse FINALE. Apres un 401 rejoue avec un
    // jeton rafraichi, c'est le second verdict qui compte pour l'appelant : le
    // 401 intermediaire a deja ete traite ici meme.
    const meta = metaFromResponse(response);

    let body: any;
    try {
      body = await readBody(response);
    } catch (readError: any) {
      // Une preemption peut survenir APRES reception des headers, pendant la
      // lecture du corps. La classer en echec de lecture ferait compter une
      // annulation volontaire comme une tentative ratee, avec backoff.
      const abortedWhileReading = readError?.name === 'AbortError';
      const cancelledWhileReading = abortedWhileReading && Boolean(options?.signal?.aborted);
      const code = cancelledWhileReading
        ? 'REST_ABORTED'
        : abortedWhileReading
          ? 'REST_TIMEOUT'
          : readError?.code === 'REST_BODY_PARSE_FAILED'
            ? 'REST_BODY_PARSE_FAILED'
            : 'REST_BODY_READ_FAILED';

      // Le serveur a repondu, mais le resultat n'a pas pu etre lu de facon
      // fiable : ni une reussite, ni une absence de backend. Le statut recu est
      // conserve puisque les headers sont bien arrives.
      return {
        data: null,
        error: {
          code,
          message: readError?.message ?? 'Lecture de la reponse interrompue',
          status: response.status,
        },
        meta,
      };
    }

    if (!response.ok) {
      return { data: null, error: normalizeRestError(body, response.status), meta };
    }

    const expectation = options?.bodyExpectation;
    if (body === null && (expectation === 'required-json' || expectation === 'required-row')) {
      return {
        data: null,
        error: {
          code: 'REST_BODY_EMPTY',
          message: 'La reponse REST ne contient aucun resultat',
          status: response.status,
        },
        meta,
      };
    }

    if (expectation === 'required-row' && !hasResultRow(body)) {
      return {
        data: null,
        error: {
          code: 'REST_RESULT_EMPTY',
          message: 'La reponse REST ne contient aucune ligne de resultat',
          status: response.status,
        },
        meta,
      };
    }

    return { data: Array.isArray(body) ? body : body ? [body] : null, error: null, meta };
  } catch (error: any) {
    const aborted = error?.name === 'AbortError';
    // Distinguer « la borne de temps a coupé » d'une annulation demandée par
    // l'appelant : la seconde n'est pas un symptôme de réseau lent, elle ne doit
    // donc pas alimenter le backoff comme un timeout.
    const cancelledByCaller = aborted && Boolean(options?.signal?.aborted);
    // Coupure, borne de temps ou annulation : aucune reponse n'est parvenue,
    // meme si un 401 intermediaire avait ete recu avant le rejeu.
    return {
      data: null,
      error: {
        message: cancelledByCaller
          ? 'Requete aborted par l appelant'
          : aborted
            ? `Timeout Supabase REST apres ${Math.round(timeoutMs / 1000)}s`
            : (error?.message ?? String(error)),
        code: cancelledByCaller ? 'REST_ABORTED' : aborted ? 'REST_TIMEOUT' : error?.code,
      },
      meta: { ...NO_RESPONSE_META },
    };
  } finally {
    clearTimeout(timer);
    unlink();
  }
}

export async function supabaseRestSelect<T = any>(
  table: string,
  select = '*',
  filter?: TableFilter,
  limit = 1,
  options?: RestRequestOptions,
): Promise<SupabaseRestResult<T>> {
  // Verifie AVANT la construction de l'URL, qui leverait sans URL configuree.
  if (!isRestUsable()) return unconfiguredResult<T>();
  const params: Array<[string, string]> = [['select', select], ...filterParams(filter)];
  if (limit > 0) params.push(['limit', String(limit)]);
  return restRequest<T>(
    tableUrl(table, params),
    { method: 'GET' },
    REST_TIMEOUT_MS,
    { ...options, bodyExpectation: 'required-json' },
  );
}

export async function supabaseRestMutation<T = any>(
  table: string,
  op: 'insert' | 'update' | 'upsert' | 'delete',
  data?: Record<string, any>,
  filter?: TableFilter,
  options?: RestRequestOptions,
): Promise<SupabaseRestResult<T>> {
  if (!isRestUsable()) return unconfiguredResult<T>();
  if ((op === 'update' || op === 'delete') && !filter) {
    return {
      data: null,
      error: {
        code: 'MISSING_FILTER',
        message: `Refusing ${op.toUpperCase()} on ${table} without a filter`,
      },
      meta: { ...NO_RESPONSE_META },
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
      REST_TIMEOUT_MS,
      // `return=minimal` : un corps vide est le comportement attendu.
      { ...options, bodyExpectation: 'none' },
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
      REST_TIMEOUT_MS,
      { ...options, bodyExpectation: 'required-json' },
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
      REST_TIMEOUT_MS,
      { ...options, bodyExpectation: 'required-json' },
    );
  }

  return restRequest<T>(
    tableUrl(table, filterParams(filter)),
    {
      method: 'DELETE',
      headers: { Prefer: 'return=representation' },
    },
    REST_TIMEOUT_MS,
    { ...options, bodyExpectation: 'required-json' },
  );
}

export async function supabaseRestRpc<T = any>(
  fn: string,
  args?: Record<string, any>,
  options?: RestRequestOptions,
): Promise<SupabaseRestResult<T>> {
  if (!isRestUsable()) return unconfiguredResult<T>();
  return restRequest<T>(
    rpcUrl(fn),
    {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(args ?? {}),
    },
    REST_TIMEOUT_MS,
    {
      ...options,
      // Un verdict metier exige une LIGNE, pas seulement du JSON.
      bodyExpectation: RPC_REQUIRING_RESULT.has(fn) ? 'required-row' : 'optional-json',
    },
  );
}
