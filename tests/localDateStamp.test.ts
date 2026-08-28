import { describe, expect, it } from 'vitest';
import { localDateStamp } from '../lib/localDateStamp';

describe('localDateStamp', () => {
  it('uses calendar fields from the local timezone instead of an ISO UTC slice', () => {
    expect(localDateStamp(new Date(2026, 7, 9, 23, 59, 59))).toBe('2026-08-09');
  });
});
