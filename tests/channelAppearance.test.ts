import { describe, expect, it } from 'vitest';
import { channelAppearance, channelDisplayColor } from '../vercel-app/app/web/messages-workspace/channel-appearance';

describe('conversation appearance across web and mobile', () => {
  it('retains an existing mobile group appearance, including a color outside the presets', () => {
    expect(channelAppearance('group', { color: '#FF9F0A', icon: 'hammer' })).toEqual({ color: '#FF9F0A', icon: 'hammer' });
  });

  it('keeps a legacy icon when editing unrelated fields', () => {
    expect(channelAppearance('custom', { color: '#123456', icon: 'build-outline' })).toEqual({ color: '#123456', icon: 'build-outline' });
  });

  it('sets defaults for new conversations without mixing direct and group settings', () => {
    expect(channelAppearance('dm')).toEqual({ color: '#EC4899', icon: 'person-circle' });
    expect(channelAppearance('group')).toEqual({ color: '#7C3AED', icon: 'people-circle' });
    expect(channelAppearance('custom')).toEqual({ color: '#003082', icon: 'chatbubbles' });
  });

  it('does not put arbitrary stored CSS into the displayed badge', () => {
    expect(channelDisplayColor('#fF9f0A')).toBe('#fF9f0A');
    expect(channelDisplayColor('url(https://example.invalid/a)')).toBe('#003082');
    expect(channelDisplayColor(null)).toBe('#003082');
  });
});
