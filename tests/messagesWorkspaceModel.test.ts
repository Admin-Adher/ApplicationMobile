import { describe, expect, it } from 'vitest';
import {
  buildMessagesProjection,
  mergeMessageReadState,
  messagesCopy,
  messagesLocale,
  type AuthorizedMessagesSnapshot,
} from '../vercel-app/app/web/messages-workspace/messages-model';

const snapshot: AuthorizedMessagesSnapshot = {
  companies: [{ id: 'company-a', name: 'INICA' }],
  channels: [
    { id: 'company-company-a', type: 'company', name: 'Ancien nom' },
    { id: 'dm-1', type: 'dm', name: 'Alex', members: ['Alex Martin', 'Alex Morel'] },
    { id: 'building-a', type: 'building', name: 'Service Building' },
  ],
  messages: [
    { id: 'old', channel_id: 'company-company-a', sender_id: 'user-other', sender: 'Entreprise', content: 'Premier message', created_at: '2026-08-12T08:00:00.000Z' },
    { id: 'latest', channel_id: 'company-company-a', sender_id: 'user-other', sender: 'Entreprise', content: 'Livraison confirmée', created_at: '2026-08-12T10:00:00.000Z', is_pinned: true },
    { id: 'own-same-name', channel_id: 'dm-1', sender_id: 'user-me', sender: 'Alex', content: 'Mon message', created_at: '2026-08-12T09:00:00.000Z' },
    { id: 'other-same-name', channel_id: 'dm-1', sender_id: 'user-other', sender: 'Alex', content: 'Autre utilisateur', created_at: '2026-08-12T09:30:00.000Z' },
  ],
};

describe('BuildTrack messages workspace model', () => {
  it('indexes, orders and labels the authorized snapshot without mutating it', () => {
    const projection = buildMessagesProjection({
      snapshot,
      selectedChannelId: 'company-company-a',
      lastReadByChannel: { 'company-company-a': '2026-08-12T08:30:00.000Z' },
      currentUserId: 'user-me',
      currentUserName: 'Alex',
      query: '',
      filter: 'all',
      language: 'fr',
    });

    expect(projection.channels[0].label).toBe('INICA');
    expect(projection.channels[0].latest?.id).toBe('latest');
    expect(projection.channels[0].unreadCount).toBe(1);
    expect(projection.channels[0].pinnedCount).toBe(1);
    expect(snapshot.messages.map(message => message.id)).toEqual(['old', 'latest', 'own-same-name', 'other-same-name']);
  });

  it('uses immutable sender ids before display names for unread state', () => {
    const projection = buildMessagesProjection({
      snapshot,
      selectedChannelId: 'dm-1',
      lastReadByChannel: { 'dm-1': '2026-08-12T08:00:00.000Z' },
      currentUserId: 'user-me',
      currentUserName: 'Alex',
      query: '',
      filter: 'unread',
      language: 'en',
    });

    expect(projection.selected?.unreadCount).toBe(1);
    expect(projection.visibleChannels.map(channel => channel.channel.id)).toContain('dm-1');
  });

  it('combines accent-insensitive search and semantic channel filters', () => {
    const projection = buildMessagesProjection({
      snapshot,
      selectedChannelId: null,
      lastReadByChannel: {},
      currentUserId: 'user-me',
      currentUserName: 'Alex',
      query: 'livraison confirmee',
      filter: 'company',
      language: 'fr',
    });

    expect(projection.visibleChannels.map(channel => channel.label)).toEqual(['INICA']);
  });

  it('merges device and server read markers by newest valid timestamp', () => {
    expect(mergeMessageReadState(
      { channel: '2026-08-12T08:00:00.000Z', invalid: 'nope' },
      { channel: '2026-08-12T09:00:00.000Z', other: '2026-08-11T12:00:00.000Z' },
    )).toEqual({
      channel: '2026-08-12T09:00:00.000Z',
      other: '2026-08-11T12:00:00.000Z',
    });
  });

  it('ships complete FR, EN and ES copy with stable locales', () => {
    expect(messagesCopy('fr').attachPhoto).toBe('Ajouter une photo');
    expect(messagesCopy('en').backToChannels).toBe('Back to conversations');
    expect(messagesCopy('es').filterCompanies).toBe('Empresas');
    expect([messagesLocale('fr'), messagesLocale('en'), messagesLocale('es')]).toEqual(['fr-FR', 'en-GB', 'es-ES']);
  });
});
