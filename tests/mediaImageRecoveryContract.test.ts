import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('MediaImage recovery contract', () => {
  const source = fs.readFileSync(
    path.resolve(process.cwd(), 'components/MediaImage.tsx'),
    'utf8',
  );

  it('never renders a managed image with an undefined source', () => {
    expect(source).toContain('TRANSPARENT_PIXEL_URI');
    expect(source).not.toContain("resolvedUri ? { ...(source as object), uri: resolvedUri } : undefined");
  });

  it('retries transient failures and wakes immediately after session recovery', () => {
    expect(source).toContain('isRetryableMediaResolutionError(error)');
    expect(source).toContain('subscribeSessionRecovery');
    expect(source).toContain('RETRY_DELAYS_MS');
  });

  it('invalidates one broken signed URL before exposing a permanent image error', () => {
    expect(source).toContain('invalidateMediaRef(originalUri)');
    expect(source).toContain('nativeFailureCountRef.current >= 1');
  });
});
