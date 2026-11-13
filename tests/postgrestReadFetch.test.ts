import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPostgrestReadFetch } from '../vercel-app/lib/postgrest-read-fetch';
afterEach(() => vi.useRealTimers());
describe('secondary web read deadlines', () => {
  it('preserves JSON, range headers and status for ordinary reads', async () => {
    const transport = createPostgrestReadFetch(vi.fn(async () => new Response('[{"id":"a"}]', { status: 206, headers: { 'content-range': '0-0/1' } })));
    const response = await transport('https://fixture.invalid/rest/v1/project_meeting_reports');
    expect(response.status).toBe(206); expect(response.headers.get('content-range')).toBe('0-0/1');
    expect(await response.json()).toEqual([{ id: 'a' }]);
  });
  it('includes a stalled response body in the deadline', async () => {
    vi.useFakeTimers(); const response = new Response(new ReadableStream({ start() {} }));
    const transport = createPostgrestReadFetch(vi.fn(async () => response), 100);
    const pending = transport('https://fixture.invalid/rest/v1/messages');
    const assertion = expect(pending).rejects.toMatchObject({ code: 'READ_TIMEOUT' });
    await vi.advanceTimersByTimeAsync(100); await assertion;
  });
  it('leaves writes and authentication requests untouched', async () => {
    const response = new Response('ok'), fetcher = vi.fn(async () => response), transport = createPostgrestReadFetch(fetcher);
    for (const method of ['POST', 'PATCH', 'DELETE']) {
      const init = { method, body: '{"status":"done"}' };
      expect(await transport('https://fixture.invalid/rest/v1/messages', init)).toBe(response);
      expect(fetcher).toHaveBeenLastCalledWith('https://fixture.invalid/rest/v1/messages', init);
    }
    expect(await transport('https://fixture.invalid/auth/v1/user')).toBe(response);
  });
  it('supports HEAD responses without inventing a body', async () => {
    const transport = createPostgrestReadFetch(vi.fn(async () => new Response(null, { headers: { 'content-range': '*/15' } })));
    const response = await transport('https://fixture.invalid/rest/v1/profiles', { method: 'HEAD' });
    expect(await response.text()).toBe(''); expect(response.headers.get('content-range')).toBe('*/15');
  });
});
