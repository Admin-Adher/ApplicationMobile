import { describe, expect, it, vi } from 'vitest';
import { firstSuccessfulSequentially } from '../lib/sequentialFallback';

describe('sequential provider fallback', () => {
  it('does not call a fallback after the primary endpoint succeeds', async () => {
    const attempt = vi.fn(async (endpoint: string) => endpoint === 'edge' ? 'match' : null);

    await expect(firstSuccessfulSequentially(['edge', 'api'], attempt)).resolves.toBe('match');
    expect(attempt).toHaveBeenCalledTimes(1);
    expect(attempt).toHaveBeenCalledWith('edge');
  });

  it('calls the secondary endpoint only after the primary endpoint fails', async () => {
    const attempt = vi.fn(async (endpoint: string) => endpoint === 'api' ? 'fallback-match' : null);

    await expect(firstSuccessfulSequentially(['edge', 'api'], attempt)).resolves.toBe('fallback-match');
    expect(attempt.mock.calls.map(([endpoint]) => endpoint)).toEqual(['edge', 'api']);
  });
});
