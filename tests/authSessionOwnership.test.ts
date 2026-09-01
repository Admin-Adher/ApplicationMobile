import { describe, expect, it } from 'vitest';
import { canRestoreCachedProfile } from '../lib/authSessionOwnership';

describe('cached profile authentication boundary', () => {
  const profile = { id: '11111111-1111-4111-8111-111111111111' };

  it('restores the profile only with a stored session for the same user', () => {
    expect(canRestoreCachedProfile(profile, {
      access_token: 'user-token',
      expires_at: Math.floor(Date.now() / 1_000) + 3_600,
      user: { id: profile.id },
    })).toBe(true);
  });

  it('does not treat a profile cache as authentication without a session', () => {
    expect(canRestoreCachedProfile(profile, null)).toBe(false);
    expect(canRestoreCachedProfile(profile, {
      access_token: 'incomplete-token',
      user: { id: profile.id },
    })).toBe(false);
  });

  it('blocks a cached profile from another account', () => {
    expect(canRestoreCachedProfile(profile, {
      access_token: 'other-token',
      expires_at: Math.floor(Date.now() / 1_000) + 3_600,
      user: { id: '22222222-2222-4222-8222-222222222222' },
    })).toBe(false);
  });
});
