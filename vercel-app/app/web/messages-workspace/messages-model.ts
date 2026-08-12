import type { SupportedLang } from '@/lib/i18n';

export type MessageChannelKind = 'dm' | 'company' | 'building' | 'channel';
export type MessageChannelFilter = 'all' | 'unread' | 'company' | 'dm' | 'site';

export type MessageChannelRecord = {
  id: string;
  name?: string | null;
  type?: string | null;
  members?: unknown;
  created_at?: string | null;
};

export type MessageCompanyRecord = {
  id: string;
  name?: string | null;
};

export type MessageRecord = {
  id: string;
  channel_id: string;
  sender_id?: string | null;
  sender?: string | null;
  content?: string | null;
  created_at?: string | null;
  timestamp?: string | null;
  attachment_uri?: string | null;
  reply_to_id?: string | null;
  reply_to_content?: string | null;
  reply_to_sender?: string | null;
  reactions?: unknown;
  is_pinned?: boolean | null;
  linked_item_type?: string | null;
  linked_item_id?: string | null;
  linked_item_title?: string | null;
};

export type AuthorizedMessagesSnapshot = {
  channels: MessageChannelRecord[];
  companies: MessageCompanyRecord[];
  messages: MessageRecord[];
};

export type MessageSendInput = {
  channelId: string;
  content: string;
  attachmentRef?: string | null;
  replyTo?: Pick<MessageRecord, 'id' | 'content' | 'sender'> | null;
};

export type MessageChannelSummary = {
  channel: MessageChannelRecord;
  kind: MessageChannelKind;
  label: string;
  typeLabel: string;
  messages: MessageRecord[];
  messageCount: number;
  unreadCount: number;
  latest: MessageRecord | null;
  latestPreview: string;
  participants: string[];
  pinnedCount: number;
  originalIndex: number;
};

export type MessagesProjection = {
  channels: MessageChannelSummary[];
  visibleChannels: MessageChannelSummary[];
  selected: MessageChannelSummary | null;
  selectedMessages: MessageRecord[];
  channelCount: number;
  totalMessageCount: number;
  totalUnreadCount: number;
};

type MessagesCopy = {
  eyebrow: string;
  title: string;
  subtitle: string;
  channels: string;
  messages: string;
  unread: string;
  searchLabel: string;
  searchPlaceholder: string;
  filterAll: string;
  filterUnread: string;
  filterCompanies: string;
  filterDirect: string;
  filterSite: string;
  noChannels: string;
  noResults: string;
  clearSearch: string;
  activeChannel: string;
  noChannelSelected: string;
  emptyTitle: string;
  emptyText: string;
  composerPlaceholder: (channel: string) => string;
  send: string;
  sending: string;
  attachPhoto: string;
  uploadPhoto: string;
  uploading: string;
  removeAttachment: string;
  attachmentAlt: string;
  attachmentUnavailable: string;
  retry: string;
  reply: string;
  replyingTo: (sender: string) => string;
  cancelReply: string;
  pinned: string;
  linkedItem: string;
  photoMessage: string;
  unknownSender: string;
  backToChannels: string;
  keyboardHint: string;
  channelCount: (count: number) => string;
  messageCount: (count: number) => string;
  participantCount: (count: number) => string;
  unreadCount: (count: number) => string;
  typeDm: string;
  typeCompany: string;
  typeBuilding: string;
  typeChannel: string;
  imageOnly: string;
  fileTooLarge: string;
  uploadFailed: string;
};

const COPY: Record<SupportedLang, MessagesCopy> = {
  fr: {
    eyebrow: 'Communication chantier',
    title: 'Conversations',
    subtitle: 'Retrouvez les échanges d’équipe, d’entreprise et de chantier au même endroit.',
    channels: 'Canaux',
    messages: 'Messages',
    unread: 'Non lus',
    searchLabel: 'Rechercher dans les canaux',
    searchPlaceholder: 'Canal, entreprise ou dernier message…',
    filterAll: 'Tous',
    filterUnread: 'Non lus',
    filterCompanies: 'Entreprises',
    filterDirect: 'Directs',
    filterSite: 'Chantier',
    noChannels: 'Aucun canal disponible pour votre profil.',
    noResults: 'Aucune conversation ne correspond à cette recherche.',
    clearSearch: 'Effacer la recherche',
    activeChannel: 'Canal actif',
    noChannelSelected: 'Sélectionnez une conversation',
    emptyTitle: 'La conversation est prête',
    emptyText: 'Envoyez le premier message à l’équipe.',
    composerPlaceholder: channel => `Écrire dans ${channel}`,
    send: 'Envoyer',
    sending: 'Envoi…',
    attachPhoto: 'Ajouter une photo',
    uploadPhoto: 'Choisir une photo',
    uploading: 'Téléversement…',
    removeAttachment: 'Retirer la photo',
    attachmentAlt: 'Photo jointe au message',
    attachmentUnavailable: 'Cette photo ne peut pas être affichée.',
    retry: 'Réessayer',
    reply: 'Répondre',
    replyingTo: sender => `Réponse à ${sender}`,
    cancelReply: 'Annuler la réponse',
    pinned: 'Épinglé',
    linkedItem: 'Élément BuildTrack lié',
    photoMessage: 'Photo',
    unknownSender: 'Utilisateur',
    backToChannels: 'Retour aux conversations',
    keyboardHint: 'Entrée pour envoyer · Maj + Entrée pour une ligne',
    channelCount: count => `${count} ${count > 1 ? 'canaux' : 'canal'}`,
    messageCount: count => `${count} message${count > 1 ? 's' : ''}`,
    participantCount: count => `${count} participant${count > 1 ? 's' : ''}`,
    unreadCount: count => `${count} non lu${count > 1 ? 's' : ''}`,
    typeDm: 'Message direct',
    typeCompany: 'Entreprise',
    typeBuilding: 'Bâtiment',
    typeChannel: 'Canal chantier',
    imageOnly: 'Sélectionnez une image (JPG, PNG, WebP ou HEIC).',
    fileTooLarge: 'La photo dépasse la limite de 15 Mo.',
    uploadFailed: 'La photo n’a pas pu être téléversée.',
  },
  en: {
    eyebrow: 'Site communication',
    title: 'Conversations',
    subtitle: 'Keep team, company and site discussions together in one place.',
    channels: 'Channels',
    messages: 'Messages',
    unread: 'Unread',
    searchLabel: 'Search channels',
    searchPlaceholder: 'Channel, company or latest message…',
    filterAll: 'All',
    filterUnread: 'Unread',
    filterCompanies: 'Companies',
    filterDirect: 'Direct',
    filterSite: 'Site',
    noChannels: 'No channel is available for your profile.',
    noResults: 'No conversation matches this search.',
    clearSearch: 'Clear search',
    activeChannel: 'Active channel',
    noChannelSelected: 'Select a conversation',
    emptyTitle: 'This conversation is ready',
    emptyText: 'Send the first message to the team.',
    composerPlaceholder: channel => `Write in ${channel}`,
    send: 'Send',
    sending: 'Sending…',
    attachPhoto: 'Add a photo',
    uploadPhoto: 'Choose a photo',
    uploading: 'Uploading…',
    removeAttachment: 'Remove photo',
    attachmentAlt: 'Photo attached to the message',
    attachmentUnavailable: 'This photo cannot be displayed.',
    retry: 'Try again',
    reply: 'Reply',
    replyingTo: sender => `Replying to ${sender}`,
    cancelReply: 'Cancel reply',
    pinned: 'Pinned',
    linkedItem: 'Linked BuildTrack item',
    photoMessage: 'Photo',
    unknownSender: 'User',
    backToChannels: 'Back to conversations',
    keyboardHint: 'Enter to send · Shift + Enter for a new line',
    channelCount: count => `${count} channel${count === 1 ? '' : 's'}`,
    messageCount: count => `${count} message${count === 1 ? '' : 's'}`,
    participantCount: count => `${count} participant${count === 1 ? '' : 's'}`,
    unreadCount: count => `${count} unread`,
    typeDm: 'Direct message',
    typeCompany: 'Company',
    typeBuilding: 'Building',
    typeChannel: 'Site channel',
    imageOnly: 'Select an image (JPG, PNG, WebP or HEIC).',
    fileTooLarge: 'The photo exceeds the 15 MB limit.',
    uploadFailed: 'The photo could not be uploaded.',
  },
  es: {
    eyebrow: 'Comunicación de obra',
    title: 'Conversaciones',
    subtitle: 'Reúne los intercambios de equipo, empresa y obra en un único espacio.',
    channels: 'Canales',
    messages: 'Mensajes',
    unread: 'No leídos',
    searchLabel: 'Buscar en los canales',
    searchPlaceholder: 'Canal, empresa o último mensaje…',
    filterAll: 'Todos',
    filterUnread: 'No leídos',
    filterCompanies: 'Empresas',
    filterDirect: 'Directos',
    filterSite: 'Obra',
    noChannels: 'No hay ningún canal disponible para tu perfil.',
    noResults: 'Ninguna conversación coincide con esta búsqueda.',
    clearSearch: 'Borrar la búsqueda',
    activeChannel: 'Canal activo',
    noChannelSelected: 'Selecciona una conversación',
    emptyTitle: 'La conversación está lista',
    emptyText: 'Envía el primer mensaje al equipo.',
    composerPlaceholder: channel => `Escribir en ${channel}`,
    send: 'Enviar',
    sending: 'Enviando…',
    attachPhoto: 'Añadir una foto',
    uploadPhoto: 'Elegir una foto',
    uploading: 'Subiendo…',
    removeAttachment: 'Quitar la foto',
    attachmentAlt: 'Foto adjunta al mensaje',
    attachmentUnavailable: 'Esta foto no se puede mostrar.',
    retry: 'Reintentar',
    reply: 'Responder',
    replyingTo: sender => `Respuesta a ${sender}`,
    cancelReply: 'Cancelar respuesta',
    pinned: 'Fijado',
    linkedItem: 'Elemento BuildTrack vinculado',
    photoMessage: 'Foto',
    unknownSender: 'Usuario',
    backToChannels: 'Volver a las conversaciones',
    keyboardHint: 'Intro para enviar · Mayús + Intro para una línea',
    channelCount: count => `${count} canal${count === 1 ? '' : 'es'}`,
    messageCount: count => `${count} mensaje${count === 1 ? '' : 's'}`,
    participantCount: count => `${count} participante${count === 1 ? '' : 's'}`,
    unreadCount: count => `${count} no leído${count === 1 ? '' : 's'}`,
    typeDm: 'Mensaje directo',
    typeCompany: 'Empresa',
    typeBuilding: 'Edificio',
    typeChannel: 'Canal de obra',
    imageOnly: 'Selecciona una imagen (JPG, PNG, WebP o HEIC).',
    fileTooLarge: 'La foto supera el límite de 15 MB.',
    uploadFailed: 'No se ha podido subir la foto.',
  },
};

export function messagesCopy(language: SupportedLang) {
  return COPY[language] ?? COPY.en;
}

export function messagesLocale(language: SupportedLang) {
  if (language === 'fr') return 'fr-FR';
  if (language === 'es') return 'es-ES';
  return 'en-GB';
}

function normalized(value: unknown) {
  return String(value ?? '').trim().toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function messageTime(message: MessageRecord) {
  const value = message.created_at ?? message.timestamp ?? '';
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isOwnMessage(message: MessageRecord, currentUserName: string) {
  return Boolean(currentUserName) && normalized(message.sender) === normalized(currentUserName);
}

export function channelKind(type: unknown): MessageChannelKind {
  const value = normalized(type);
  if (value === 'dm') return 'dm';
  if (value === 'company') return 'company';
  if (value === 'building') return 'building';
  return 'channel';
}

export function channelDisplayName(channel: MessageChannelRecord, companies: MessageCompanyRecord[]) {
  if (channelKind(channel.type) === 'company' && channel.id.startsWith('company-')) {
    const companyId = channel.id.slice('company-'.length);
    return companies.find(company => String(company.id) === companyId)?.name?.trim()
      || channel.name?.trim()
      || channel.id;
  }
  return channel.name?.trim() || channel.id;
}

function channelTypeLabel(kind: MessageChannelKind, copy: MessagesCopy) {
  if (kind === 'dm') return copy.typeDm;
  if (kind === 'company') return copy.typeCompany;
  if (kind === 'building') return copy.typeBuilding;
  return copy.typeChannel;
}

function previewForMessage(message: MessageRecord | null, copy: MessagesCopy) {
  if (!message) return '';
  const content = String(message.content ?? '').replace(/\s+/g, ' ').trim();
  if (content) return content;
  if (message.attachment_uri) return copy.photoMessage;
  if (message.linked_item_title) return String(message.linked_item_title);
  return '';
}

function parseMembers(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map(item => String(item ?? '').trim()).filter(Boolean);
}

export function mergeMessageReadState(...sources: Array<Record<string, string> | null | undefined>) {
  const merged: Record<string, string> = {};
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const [channelId, rawStamp] of Object.entries(source)) {
      const stamp = String(rawStamp ?? '').trim();
      if (!channelId || !stamp || !Number.isFinite(Date.parse(stamp))) continue;
      if (!merged[channelId] || Date.parse(stamp) > Date.parse(merged[channelId])) merged[channelId] = stamp;
    }
  }
  return merged;
}

export function buildMessagesProjection({
  snapshot,
  selectedChannelId,
  lastReadByChannel,
  currentUserId,
  currentUserName,
  query,
  filter,
  language,
}: {
  snapshot: AuthorizedMessagesSnapshot;
  selectedChannelId: string | null;
  lastReadByChannel: Record<string, string>;
  currentUserId: string;
  currentUserName: string;
  query: string;
  filter: MessageChannelFilter;
  language: SupportedLang;
}): MessagesProjection {
  const copy = messagesCopy(language);
  const messagesByChannel = new Map<string, MessageRecord[]>();
  for (const message of snapshot.messages) {
    const channelId = String(message.channel_id ?? '');
    if (!channelId) continue;
    const bucket = messagesByChannel.get(channelId) ?? [];
    bucket.push(message);
    messagesByChannel.set(channelId, bucket);
  }
  for (const messages of messagesByChannel.values()) {
    messages.sort((a, b) => messageTime(a) - messageTime(b));
  }

  const channels = snapshot.channels.map((channel, originalIndex): MessageChannelSummary => {
    const kind = channelKind(channel.type);
    const messages = messagesByChannel.get(String(channel.id)) ?? [];
    const latest = messages.at(-1) ?? null;
    const lastRead = lastReadByChannel[channel.id];
    const unreadCount = messages.reduce((count, message) => {
      const createdAt = message.created_at ?? message.timestamp ?? '';
      const own = message.sender_id
        ? String(message.sender_id) === currentUserId
        : isOwnMessage(message, currentUserName);
      if (own) return count;
      if (!lastRead || (Number.isFinite(Date.parse(createdAt)) && Date.parse(createdAt) > Date.parse(lastRead))) return count + 1;
      return count;
    }, 0);
    const participants = Array.from(new Set([
      ...parseMembers(channel.members),
      ...messages.map(message => String(message.sender ?? '').trim()).filter(Boolean),
    ])).sort((a, b) => a.localeCompare(b, messagesLocale(language)));
    return {
      channel,
      kind,
      label: channelDisplayName(channel, snapshot.companies),
      typeLabel: channelTypeLabel(kind, copy),
      messages,
      messageCount: messages.length,
      unreadCount,
      latest,
      latestPreview: previewForMessage(latest, copy),
      participants,
      pinnedCount: messages.filter(message => Boolean(message.is_pinned)).length,
      originalIndex,
    };
  }).sort((a, b) => {
    const activityDelta = messageTime(b.latest ?? { id: '', channel_id: '' }) - messageTime(a.latest ?? { id: '', channel_id: '' });
    if (activityDelta) return activityDelta;
    return a.originalIndex - b.originalIndex;
  });

  const normalizedQuery = normalized(query);
  const visibleChannels = channels.filter(summary => {
    if (filter === 'unread' && summary.unreadCount === 0) return false;
    if (filter === 'company' && summary.kind !== 'company') return false;
    if (filter === 'dm' && summary.kind !== 'dm') return false;
    if (filter === 'site' && (summary.kind === 'company' || summary.kind === 'dm')) return false;
    if (!normalizedQuery) return true;
    return normalized([
      summary.label,
      summary.typeLabel,
      summary.latestPreview,
      ...summary.participants,
    ].join(' ')).includes(normalizedQuery);
  });

  const selected = channels.find(summary => summary.channel.id === selectedChannelId)
    ?? channels[0]
    ?? null;
  return {
    channels,
    visibleChannels,
    selected,
    selectedMessages: selected?.messages ?? [],
    channelCount: channels.length,
    totalMessageCount: snapshot.messages.length,
    totalUnreadCount: channels.reduce((sum, channel) => sum + channel.unreadCount, 0),
  };
}

export function messageListTimestamp(message: MessageRecord | null, locale: string, now = new Date()) {
  if (!message) return '';
  const raw = message.created_at ?? message.timestamp ?? '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString(locale, {
    day: '2-digit',
    month: 'short',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: '2-digit' }),
  });
}

export function messageDayLabel(message: MessageRecord, locale: string) {
  const raw = message.created_at ?? message.timestamp ?? '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleDateString(locale, { day: '2-digit', month: 'long', year: 'numeric' });
}

export function messageClockLabel(message: MessageRecord, locale: string) {
  const raw = message.created_at ?? message.timestamp ?? '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

export function messageFullTimestamp(message: MessageRecord, locale: string) {
  const raw = message.created_at ?? message.timestamp ?? '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString(locale, { dateStyle: 'long', timeStyle: 'short' });
}

export function messageReactions(message: MessageRecord) {
  if (!message.reactions || typeof message.reactions !== 'object' || Array.isArray(message.reactions)) return [];
  return Object.entries(message.reactions as Record<string, unknown>)
    .map(([emoji, users]) => ({ emoji, count: Array.isArray(users) ? users.length : Number(users) || 0 }))
    .filter(reaction => reaction.emoji && reaction.count > 0);
}
