import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Le module lit sa configuration a l'import : on la remplace avant de le
 * charger, sinon il tenterait de joindre un vrai projet Supabase.
 */
vi.mock('../lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
  isSupabaseConfigured: true,
  SUPABASE_KEY: 'anon-key',
  SUPABASE_URL: 'https://exemple.supabase.co',
}));

const forceRefreshSession = vi.fn(async () => 'jeton-rafraichi');
vi.mock('../lib/offlineCache', () => ({
  forceRefreshSession: (...args: unknown[]) => forceRefreshSession(...(args as [])),
  getSessionFromStorage: async () => ({
    access_token: 'jeton-utilisateur',
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  }),
}));

const {
  clearSupabaseRestTokenCache,
  supabaseRestMutation,
  supabaseRestRpc,
  supabaseRestSelect,
} = await import('../lib/supabaseRest');

/** Reponse minimale, avec uniquement les en-tetes que le test veut exposer. */
function httpResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => headers[name] ?? null },
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  } as unknown as Response;
}


/** Reponse dont la lecture du corps est pilotee par le test. */
function responseWithBody(status: number, readBody: () => Promise<string>) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    text: readBody,
  } as unknown as Response;
}

/** `fetch` qui reste en vol jusqu'a ce que son signal soit annule. */
function pendingFetch() {
  return (_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
    init.signal?.addEventListener(
      'abort',
      () => reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })),
      { once: true },
    );
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  forceRefreshSession.mockClear();
  forceRefreshSession.mockResolvedValue('jeton-rafraichi');
  clearSupabaseRestTokenCache();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('transport metadata', () => {
  it('reports a successful response', async () => {
    fetchMock.mockResolvedValue(httpResponse(200, [{ id: 'R1' }]));

    const result = await supabaseRestSelect('reserves');

    expect(result.error).toBeNull();
    expect(result.meta).toEqual({ status: 200, reachedServer: true, retryAfter: null });
  });

  it('counts a negative response as having reached the server', async () => {
    // Un 400 prouve que le backend repond : la politique ne doit pas le
    // confondre avec une coupure.
    fetchMock.mockResolvedValue(httpResponse(400, { message: 'refuse' }));

    const result = await supabaseRestRpc('record_inventory_movement', {});

    expect(result.error).toBeTruthy();
    expect(result.meta.status).toBe(400);
    expect(result.meta.reachedServer).toBe(true);
  });

  it('keeps Retry-After in seconds and as an HTTP date', async () => {
    fetchMock.mockResolvedValue(httpResponse(429, { message: 'slow down' }, { 'Retry-After': '120' }));
    expect((await supabaseRestRpc('x', {})).meta).toEqual({
      status: 429, reachedServer: true, retryAfter: '120',
    });

    const httpDate = 'Wed, 22 Aug 2026 20:00:00 GMT';
    fetchMock.mockResolvedValue(httpResponse(503, null, { 'Retry-After': httpDate }));
    expect((await supabaseRestRpc('x', {})).meta).toEqual({
      status: 503, reachedServer: true, retryAfter: httpDate,
    });
  });

  it('leaks no other header into the queue', async () => {
    fetchMock.mockResolvedValue(httpResponse(200, [], {
      'Retry-After': '30',
      'set-cookie': 'session=secret',
      Authorization: 'Bearer fuite',
      'x-request-id': 'trace-123',
    }));

    const result = await supabaseRestSelect('reserves');

    // Recopier tous les en-tetes ferait entrer des donnees de session dans la
    // file persistee et dans l'export de diagnostic.
    expect(Object.keys(result.meta).sort()).toEqual(['reachedServer', 'retryAfter', 'status']);
    expect(JSON.stringify(result.meta)).not.toContain('secret');
    expect(JSON.stringify(result.meta)).not.toContain('trace-123');
  });

  it('reports no response for a transport cut', async () => {
    fetchMock.mockRejectedValue(Object.assign(new Error('socket closed'), { code: 'ECONNRESET' }));

    const result = await supabaseRestSelect('reserves');

    expect(result.meta).toEqual({ status: null, reachedServer: false, retryAfter: null });
  });

  it('reports no response when the caller cancels before sending', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await supabaseRestSelect('reserves', '*', undefined, 1, { signal: controller.signal });

    expect(result.error.code).toBe('REST_ABORTED');
    expect(result.meta).toEqual({ status: null, reachedServer: false, retryAfter: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a caller cancellation during an active fetch', async () => {
    // Le test precedent ne transmettait AUCUN signal externe : `cancelledByCaller`
    // etait donc faux et l erreur ressortait en REST_TIMEOUT. Il n assertait que
    // `meta`, donc il passait sans jamais exercer le chemin qu il pretendait
    // couvrir.
    const external = new AbortController();

    fetchMock.mockImplementation((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener(
        'abort',
        () => reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })),
        { once: true },
      );
    }));

    const pending = supabaseRestSelect('reserves', '*', undefined, 1, { signal: external.signal });
    await vi.waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1); });
    external.abort();

    const result = await pending;

    expect(result.error.code).toBe('REST_ABORTED');
    expect(result.meta).toEqual({ status: null, reachedServer: false, retryAfter: null });
  });

  it('distinguishes the local deadline from a caller cancellation', async () => {
    // Meme AbortError, mais sans signal externe : c est la borne de temps.
    fetchMock.mockRejectedValue(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }));

    const result = await supabaseRestSelect('reserves');

    expect(result.error.code).toBe('REST_TIMEOUT');
    expect(result.meta).toEqual({ status: null, reachedServer: false, retryAfter: null });
  });

  it('does not turn an interrupted body read into a success', async () => {
    // Absorber l echec de lecture rendait `null` avec `response.ok` vrai. Sur un
    // mouvement de stock, une reponse vide est normalisee en `server_rejected` :
    // la coupure produisait un refus terminal et un rollback du stock, alors que
    // le serveur avait bien enregistre le mouvement.
    fetchMock.mockResolvedValue({
      status: 200,
      ok: true,
      headers: { get: () => null },
      text: async () => { throw new Error('connection reset while reading body'); },
    } as unknown as Response);

    const result = await supabaseRestRpc('record_inventory_movement', {});

    expect(result.data).toBeNull();
    expect(result.error.code).toBe('REST_BODY_READ_FAILED');
    expect(result.error.status).toBe(200);
    // Le serveur a bien repondu : ce n est pas une absence de backend.
    expect(result.meta).toEqual({ status: 200, reachedServer: true, retryAfter: null });
  });

  it('keeps the negative status when the body of an error cannot be read', async () => {
    fetchMock.mockResolvedValue({
      status: 400,
      ok: false,
      headers: { get: () => null },
      text: async () => { throw new Error('connection reset'); },
    } as unknown as Response);

    const result = await supabaseRestSelect('reserves');

    expect(result.error.code).toBe('REST_BODY_READ_FAILED');
    expect(result.meta).toEqual({ status: 400, reachedServer: true, retryAfter: null });
  });

  it('drops an absurdly long Retry-After rather than forwarding it', async () => {
    fetchMock.mockResolvedValue(httpResponse(429, null, { 'Retry-After': 'x'.repeat(5000) }));

    const result = await supabaseRestRpc('x', {});

    expect(result.meta.retryAfter).toBeNull();
    expect(result.meta.status).toBe(429);
  });

  it('still returns complete metadata on a purely local refusal', async () => {
    // Aucune branche ne doit conserver l'ancien format sans `meta`.
    const missingFilter = await supabaseRestMutation('reserves', 'update', { a: 1 });

    expect(missingFilter.error.code).toBe('MISSING_FILTER');
    expect(missingFilter.meta).toEqual({ status: null, reachedServer: false, retryAfter: null });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('metadata after the internal 401 replay', () => {
  it('describes the second response when the replay succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(httpResponse(401, { message: 'jwt expired' }))
      .mockResolvedValueOnce(httpResponse(200, [{ id: 'R1' }]));

    const result = await supabaseRestSelect('reserves');

    // Le 401 intermediaire a deja ete traite ici : l'appelant doit voir le
    // verdict final, sinon il ouvrirait un circuit d'authentification pour une
    // requete qui a finalement abouti.
    expect(result.meta).toEqual({ status: 200, reachedServer: true, retryAfter: null });
    expect(result.error).toBeNull();
    expect(forceRefreshSession).toHaveBeenCalledTimes(1);
  });

  it('describes the second response when the replay is refused', async () => {
    fetchMock
      .mockResolvedValueOnce(httpResponse(401, { message: 'jwt expired' }))
      .mockResolvedValueOnce(httpResponse(403, { code: '42501', message: 'permission denied' }));

    const result = await supabaseRestSelect('reserves');

    expect(result.meta.status).toBe(403);
    expect(result.meta.reachedServer).toBe(true);
  });

  it('reports no response when the replay is cut by the network', async () => {
    fetchMock
      .mockResolvedValueOnce(httpResponse(401, { message: 'jwt expired' }))
      .mockRejectedValueOnce(new Error('Network request failed'));

    const result = await supabaseRestSelect('reserves');

    // Contrat retenu : les metadonnees decrivent la tentative courante, pas une
    // reponse intermediaire deja consommee par la couche transport.
    expect(result.meta).toEqual({ status: null, reachedServer: false, retryAfter: null });
  });

  it('keeps the 401 when no refresh is possible', async () => {
    forceRefreshSession.mockResolvedValue(null as any);
    fetchMock.mockResolvedValue(httpResponse(401, { message: 'jwt expired' }));

    const result = await supabaseRestSelect('reserves');

    expect(result.meta.status).toBe(401);
    expect(result.meta.reachedServer).toBe(true);
  });
});

describe('body reading is never mistaken for a verdict', () => {
  it('refuses a 2xx whose body is not JSON', async () => {
    // « <html>proxy error</html> » n est pas un resultat exploitable. Le
    // laisser passer le ferait normaliser en `server_rejected` sur un mouvement
    // de stock, donc annuler un stock peut-etre accepte par le serveur.
    fetchMock.mockResolvedValue(responseWithBody(200, async () => '<html>proxy error</html>'));

    const result = await supabaseRestRpc('record_inventory_movement', {});

    expect(result.data).toBeNull();
    expect(result.error.code).toBe('REST_BODY_PARSE_FAILED');
    expect(result.meta).toEqual({ status: 200, reachedServer: true, retryAfter: null });
  });

  it('keeps a plain-text error body as-is', async () => {
    // Une page d erreur de proxy sur un 502 reste classable en indisponibilite.
    fetchMock.mockResolvedValue(responseWithBody(502, async () => 'Bad Gateway'));

    const result = await supabaseRestSelect('reserves');

    expect(result.error.code).toBeUndefined();
    expect(result.error.message).toBe('Bad Gateway');
    expect(result.meta).toEqual({ status: 502, reachedServer: true, retryAfter: null });
  });

  it('classifies a caller cancellation that lands during the body read', async () => {
    // Une preemption peut survenir APRES les headers. La compter comme un echec
    // de lecture ferait subir un backoff a une annulation volontaire.
    const external = new AbortController();
    fetchMock.mockResolvedValue(responseWithBody(200, () => {
      external.abort();
      return Promise.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    }));

    const result = await supabaseRestSelect('reserves', '*', undefined, 1, { signal: external.signal });

    expect(result.error.code).toBe('REST_ABORTED');
    expect(result.meta.status).toBe(200);
  });

  it('classifies a local deadline that lands during the body read', async () => {
    fetchMock.mockResolvedValue(responseWithBody(200, () => Promise.reject(
      Object.assign(new Error('aborted'), { name: 'AbortError' }),
    )));

    const result = await supabaseRestSelect('reserves');

    expect(result.error.code).toBe('REST_TIMEOUT');
  });

  it('classifies a spontaneous cut during the body read', async () => {
    fetchMock.mockResolvedValue(responseWithBody(200, () => Promise.reject(new Error('connection reset'))));

    const result = await supabaseRestSelect('reserves');

    expect(result.error.code).toBe('REST_BODY_READ_FAILED');
  });
});

describe('the local deadline actually fires', () => {
  it('aborts an in-flight fetch when the 25s bound expires', async () => {
    // Le test precedent injectait un AbortError tout fait : il ne demontrait ni
    // que le temps s ecoule, ni que le controleur interne coupe reellement le
    // fetch en vol.
    vi.useFakeTimers();
    try {
      fetchMock.mockImplementation(pendingFetch());

      const pending = supabaseRestSelect('reserves');
      await vi.waitFor(() => { expect(fetchMock).toHaveBeenCalledTimes(1); });
      await vi.advanceTimersByTimeAsync(25_000);

      const result = await pending;

      expect(result.error.code).toBe('REST_TIMEOUT');
      expect(result.meta).toEqual({ status: null, reachedServer: false, retryAfter: null });
    } finally {
      vi.useRealTimers();
    }
  });
});
