import { describe, expect, it, vi } from 'vitest';
import { runTimedIdempotentRetry, selectFirstAttemptTimeout } from '../lib/supabaseFetchRetry';

function abortError(): Error {
  return Object.assign(new Error('aborted'), { name: 'AbortError' });
}

describe('Supabase timed fetch retry', () => {
  it.each([
    { method: 'GET', url: 'https://example.supabase.co/rest/v1/chantiers', isNative: true, full: 15_000, expected: 5_000 },
    { method: 'HEAD', url: 'https://example.supabase.co/rest/v1/photos', isNative: true, full: 15_000, expected: 5_000 },
    { method: 'POST', url: 'https://example.supabase.co/rest/v1/reserves', isNative: true, full: 15_000, expected: 15_000 },
    { method: 'GET', url: 'https://example.supabase.co/rest/v1/chantiers', isNative: false, full: 15_000, expected: 15_000 },
    { method: 'GET', url: 'https://example.supabase.co/storage/v1/object/photo.jpg', isNative: true, full: 120_000, expected: 120_000 },
  ])('selects the first deadline for $method $url (native=$isNative)', ({ method, url, isNative, full, expected }) => {
    expect(selectFirstAttemptTimeout({
      method,
      url,
      isNative,
      fullTimeoutMs: full,
      staleSocketProbeMs: 5_000,
    })).toBe(expected);
  });

  it('retries a timed-out GET with the longer recovery deadline', async () => {
    const attempt = vi.fn()
      .mockRejectedValueOnce(abortError())
      .mockResolvedValueOnce('ok');
    const onRetry = vi.fn();

    await expect(runTimedIdempotentRetry({
      method: 'GET',
      firstTimeoutMs: 5_000,
      retryTimeoutMs: 15_000,
      attempt,
      onRetry,
    })).resolves.toBe('ok');

    expect(attempt).toHaveBeenNthCalledWith(1, 5_000);
    expect(attempt).toHaveBeenNthCalledWith(2, 15_000);
    expect(onRetry).toHaveBeenCalledWith(5_000, 15_000);
  });

  it('also retries an idempotent HEAD request', async () => {
    const attempt = vi.fn()
      .mockRejectedValueOnce(abortError())
      .mockResolvedValueOnce('ok');

    await expect(runTimedIdempotentRetry({
      method: 'head',
      firstTimeoutMs: 5_000,
      retryTimeoutMs: 15_000,
      attempt,
    })).resolves.toBe('ok');
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('never replays a timed-out mutation', async () => {
    const failure = abortError();
    const attempt = vi.fn().mockRejectedValue(failure);

    await expect(runTimedIdempotentRetry({
      method: 'POST',
      firstTimeoutMs: 15_000,
      retryTimeoutMs: 15_000,
      attempt,
    })).rejects.toBe(failure);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('does not retry an abort requested by the caller', async () => {
    const failure = abortError();
    const attempt = vi.fn().mockRejectedValue(failure);

    await expect(runTimedIdempotentRetry({
      method: 'GET',
      firstTimeoutMs: 5_000,
      retryTimeoutMs: 15_000,
      attempt,
      isUpstreamAborted: () => true,
    })).rejects.toBe(failure);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('does not retry an unrelated network failure', async () => {
    const failure = new TypeError('network down');
    const attempt = vi.fn().mockRejectedValue(failure);

    await expect(runTimedIdempotentRetry({
      method: 'GET',
      firstTimeoutMs: 5_000,
      retryTimeoutMs: 15_000,
      attempt,
    })).rejects.toBe(failure);
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('propagates a failed recovery attempt without a third request', async () => {
    const recoveryFailure = abortError();
    const attempt = vi.fn()
      .mockRejectedValueOnce(abortError())
      .mockRejectedValueOnce(recoveryFailure);

    await expect(runTimedIdempotentRetry({
      method: 'GET',
      firstTimeoutMs: 5_000,
      retryTimeoutMs: 15_000,
      attempt,
    })).rejects.toBe(recoveryFailure);
    expect(attempt).toHaveBeenCalledTimes(2);
  });
});
