import { describe, expect, it } from 'vitest';
import {
  buildMessagesProjection,
  mergeMessageReadState,
  messageMentions,
  messageHistoryFilter,
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
  it('pages across equal timestamps and rows with a legacy null timestamp', () => {
    const createdAt = '2026-11-06T10:00:00+00:00';
    expect(messageHistoryFilter({ id: 'msg,2', createdAt })).toBe(
      'created_at.lt."2026-11-06T10:00:00+00:00",and(created_at.eq."2026-11-06T10:00:00+00:00",id.lt."msg,2"),created_at.is.null',
    );
    expect(messageHistoryFilter({ id: 'last', createdAt: null })).toBe('and(created_at.is.null,id.lt."last")');
  });
  it('retains canonical mention names without treating email addresses or prefixes as mentions', () => {
    const names = ['Camille', 'Camille Recette', 'André (BTP)', 'Éloïse'];
    expect(messageMentions('@camille recette, @André (BTP) et @Éloïse. @Camille Recette', names))
      .toEqual(['Camille Recette', 'André (BTP)', 'Éloïse']);
    expect(messageMentions('adrien@Camille.fr @Camille123 @Inconnu', names)).toEqual([]);
  });

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

  it('prioritizes pinned conversations and filters only authorized conversations', () => {
    const projection = buildMessagesProjection({
      snapshot,
      selectedChannelId: 'company-company-a',
      lastReadByChannel: {},
      pinnedChannelIds: ['building-a', 'inaccessible-channel'],
      currentUserId: 'user-me',
      currentUserName: 'Alex',
      query: '',
      filter: 'pinned',
      language: 'fr',
    });

    expect(projection.channels.map(channel => channel.channel.id)).toEqual(['building-a', 'company-company-a', 'dm-1']);
    expect(projection.visibleChannels.map(channel => channel.channel.id)).toEqual(['building-a']);
    expect(projection.selected).toMatchObject({ channelPinned: false, pinnedCount: 1 });
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

  it('finds an older message without replacing the channel activity or bypassing its filter', () => {
    const input = {
      snapshot,
      selectedChannelId: 'company-company-a',
      lastReadByChannel: {},
      currentUserId: 'user-me',
      currentUserName: 'Alex',
      query: 'premier message',
      filter: 'company' as const,
      language: 'fr' as const,
    };
    const projection = buildMessagesProjection(input);
    expect(projection.visibleChannels.map(summary => summary.channel.id)).toEqual(['company-company-a']);
    expect(projection.selected?.searchMessage?.id).toBe('old');
    expect(projection.selected?.latest?.id).toBe('latest');
    expect(buildMessagesProjection({ ...input, filter: 'dm' }).visibleChannels).toEqual([]);
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
