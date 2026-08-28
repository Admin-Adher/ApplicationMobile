import { describe, expect, it } from 'vitest';
import {
  hrefWithReserveId,
  normalizeReserveDeepLinkId,
  reserveIdFromHref,
} from '../vercel-app/app/web/plan-reserve-workspace/reserve-deep-link';

describe('web reserve deep links', () => {
  it('accepts BuildTrack reserve identifiers and rejects unsafe values', () => {
    expect(normalizeReserveDeepLinkId(' RSV-730-935 ')).toBe('RSV-730-935');
    expect(normalizeReserveDeepLinkId('../RSV-1')).toBeNull();
    expect(normalizeReserveDeepLinkId('RSV 1')).toBeNull();
    expect(normalizeReserveDeepLinkId('x'.repeat(129))).toBeNull();
  });

  it('reads and rewrites the reserve parameter without dropping other URL state', () => {
    const href = 'https://buildtrack.example/web?lang=fr&reserve=RSV-730-935#photos';

    expect(reserveIdFromHref(href)).toBe('RSV-730-935');
    expect(hrefWithReserveId(href, null)).toBe('/web?lang=fr#photos');
    expect(hrefWithReserveId(href, 'RSV-111-222')).toBe('/web?lang=fr&reserve=RSV-111-222#photos');
  });
});
