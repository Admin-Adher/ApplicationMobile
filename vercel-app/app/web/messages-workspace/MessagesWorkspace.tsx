'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import type { SupportedLang } from '@/lib/i18n';
import { retryPrivateMedia } from '@/lib/private-media-client';
import { usePrivateMediaAccess } from '../plan-reserve-workspace/usePrivateMedia';
import { MessageIcon, type MessageIconName } from './MessageIcon';
import {
  buildMessagesProjection,
  messageClockLabel,
  messageDayLabel,
  messageFullTimestamp,
  messageListTimestamp,
  messageReactions,
  messageMentions,
  MESSAGE_HISTORY_PAGE_SIZE,
  type MessageLinkedItem,
  messagesCopy,
  messagesLocale,
  type AuthorizedMessagesSnapshot,
  type MessageChannelFilter,
  type MessageChannelKind,
  type MessageRecord,
  type MessageHistoryCursor,
  type MessageSendInput,
} from './messages-model';
import ChannelEditor, { type ChannelDraft, type ChannelPerson } from './ChannelEditor';
import type { MessageAction, MessageChannelRecord } from './messages-model';
import styles from './MessagesWorkspace.module.css';

type MessagesWorkspaceProps = {
  snapshot: AuthorizedMessagesSnapshot;
  historyRevision: number;
  onLoadHistory: (channelId: string, cursor: MessageHistoryCursor | null, signal: AbortSignal) => Promise<MessageHistoryCursor | null>;
  actor: { userId: string; displayName: string };
  language: SupportedLang;
  selectedChannelId: string | null;
  lastReadByChannel: Record<string, string>;
  pinnedChannelIds: readonly string[];
  onSetChannelPinned: (id: string, pinned: boolean) => Promise<'limit' | 'saved'>;
  draft: string;
  saving: boolean;
  onSelectChannel: (channelId: string) => void;
  onDraftChange: (value: string) => void;
  onSend: (input: MessageSendInput) => Promise<boolean>;
  channelPeople: ChannelPerson[];
  linkedItems: MessageLinkedItem[];
  selectedProjectId: string;
  onOpenLinkedItem: (item: MessageLinkedItem) => void;
  canCreateChannel: boolean;
  canManageChannel: (channel: MessageChannelRecord) => boolean;
  canModerate: boolean;
  loadChannelMembers: (channelId: string) => Promise<string[]>;
  onSaveChannel: (draft: ChannelDraft, current: MessageChannelRecord | null) => Promise<string>;
  onDeleteChannel: (channel: MessageChannelRecord) => Promise<void>;
  onMessageAction: (message: MessageRecord, action: MessageAction) => Promise<void>;
  onCreateReserveFromMessage?: (message: MessageRecord) => void;
};

type PendingAttachment = {
  channelId: string;
  file: File;
  previewUrl: string;
  filename: string;
};

const FILTERS: Array<{ id: MessageChannelFilter; icon?: MessageIconName }> = [
  { id: 'all' },
  { id: 'unread' },
  { id: 'pinned', icon: 'pin' },
  { id: 'company', icon: 'building' },
  { id: 'dm', icon: 'dm' },
  { id: 'site', icon: 'channel' },
];

function kindIcon(kind: MessageChannelKind): MessageIconName {
  if (kind === 'dm') return 'dm';
  if (kind === 'company') return 'building';
  if (kind === 'building') return 'team';
  return 'channel';
}

function initials(value: string) {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part.charAt(0).toUpperCase())
    .join('') || '?';
}

function filterLabel(filter: MessageChannelFilter, copy: ReturnType<typeof messagesCopy>) {
  if (filter === 'unread') return copy.filterUnread;
  if (filter === 'pinned') return copy.filterPinned;
  if (filter === 'company') return copy.filterCompanies;
  if (filter === 'dm') return copy.filterDirect;
  if (filter === 'site') return copy.filterSite;
  return copy.filterAll;
}

function isOwnMessage(message: MessageRecord, actor: MessagesWorkspaceProps['actor']) {
  if (message.sender_id) return String(message.sender_id) === actor.userId;
  return String(message.sender ?? '').trim().toLocaleLowerCase() === actor.displayName.trim().toLocaleLowerCase();
}

function MessageAttachment({ message, copy }: { message: MessageRecord; copy: ReturnType<typeof messagesCopy> }) {
  const access = usePrivateMediaAccess(message.attachment_uri, { priority: 'background' });
  if (!message.attachment_uri) return null;
  if (access.status === 'ready' && access.url) {
    return (
      <a className={styles.attachmentLink} href={access.url} target="_blank" rel="noreferrer">
        <img src={access.url} alt={copy.attachmentAlt} loading="lazy" />
      </a>
    );
  }
  if (access.status === 'resolving') {
    return <div className={styles.attachmentSkeleton} aria-label={copy.uploading} />;
  }
  return (
    <div className={styles.attachmentError} role="status">
      <MessageIcon name="warning" size={18} />
      <span>{copy.attachmentUnavailable}</span>
      <button type="button" onClick={() => retryPrivateMedia(message.attachment_uri, { priority: 'background' })}>{copy.retry}</button>
    </div>
  );
}

function MessageBubble({
  message,
  previousDay,
  actor,
  locale,
  copy,
  onReply,
  openLinkedItem,
  canModerate,
  onMessageAction,
  onCreateReserveFromMessage,
}: {
  message: MessageRecord;
  previousDay: string;
  actor: MessagesWorkspaceProps['actor'];
  locale: string;
  copy: ReturnType<typeof messagesCopy>;
  onReply: (message: MessageRecord) => void;
  openLinkedItem?: () => void;
  canModerate: boolean;
  onMessageAction: MessagesWorkspaceProps['onMessageAction'];
  onCreateReserveFromMessage?: MessagesWorkspaceProps['onCreateReserveFromMessage'];
}) {
  const sender = String(message.sender ?? copy.unknownSender);
  const day = messageDayLabel(message, locale);
  const own = isOwnMessage(message, actor);
  const reactions = messageReactions(message);
  const hasContent = Boolean(String(message.content ?? '').trim());
  const canChange = String(message.sender_id ?? '') === actor.userId || canModerate;
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  async function change(action: MessageAction) {
    if (actionBusy) return;
    if (action.type === 'delete' && !window.confirm('Supprimer ce message ?')) return;
    setActionBusy(true);
    setActionError('');
    try { await onMessageAction(message, action); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : 'Action indisponible.'); }
    finally { setActionBusy(false); }
  }

  return (
    <div className={styles.messageBlock}>
      {day && day !== previousDay ? <div className={styles.dateDivider}><span>{day}</span></div> : null}
      <article className={`${styles.messageRow} ${own ? styles.messageRowOwn : ''}`}>
        <div className={styles.messageAvatar} aria-hidden="true">{initials(sender)}</div>
        <div className={styles.messageColumn}>
          <div className={styles.messageMeta}>
            <strong>{sender}</strong>
            <time dateTime={message.created_at ?? undefined} title={messageFullTimestamp(message, locale)}>
              {messageClockLabel(message, locale)}
            </time>
            {message.is_pinned ? <span className={styles.pinnedLabel}><MessageIcon name="pin" size={12} />{copy.pinned}</span> : null}
          </div>
          <div className={styles.messageBubble}>
            {message.reply_to_id ? (
              <div className={styles.replyQuote}>
                <strong>{message.reply_to_sender || copy.unknownSender}</strong>
                <span>{message.reply_to_content || copy.photoMessage}</span>
              </div>
            ) : null}
            {message.linked_item_title || openLinkedItem ? (
              openLinkedItem ? (
                <button type="button" className={styles.linkedItem} onClick={openLinkedItem}>
                  <MessageIcon name="link" size={15} />
                  <span><small>{copy.linkedItem}</small><strong>{message.linked_item_title || message.reserve_id}</strong></span>
                </button>
              ) : (
                <div className={styles.linkedItem}>
                  <MessageIcon name="link" size={15} />
                  <span><small>{copy.linkedItem}</small><strong>{message.linked_item_title}</strong></span>
                </div>
              )
            ) : null}
            <MessageAttachment message={message} copy={copy} />
            {hasContent ? <p>{message.content}</p> : null}
          </div>
          <div className={styles.messageActions}>
            {Array.from(new Set(['👍', '✅', '❤️', ...reactions.map(reaction => reaction.emoji)])).map(emoji => {
              const count = reactions.find(reaction => reaction.emoji === emoji)?.count ?? 0;
              return <button key={emoji} type="button" aria-label={'Basculer la réaction ' + emoji} disabled={actionBusy} onClick={() => void change({ type: 'reaction', emoji })}>{emoji}{count ? ' ' + count : ''}</button>;
            })}
            {canChange ? <>
              <button type="button" disabled={actionBusy} onClick={() => void change({ type: 'pin' })}>{message.is_pinned ? 'Désépingler' : 'Épingler'}</button>
              <button type="button" disabled={actionBusy} onClick={() => void change({ type: 'delete' })}>Supprimer</button>
            </> : null}
            {onCreateReserveFromMessage && hasContent && (!message.type || message.type === 'message') && (
              <button type="button" onClick={() => onCreateReserveFromMessage(message)}>Créer une réserve</button>
            )}
            <button type="button" onClick={() => onReply(message)}>
              <MessageIcon name="reply" size={14} />
              {copy.reply}
            </button>
          </div>
          {actionError ? <p role="alert">{actionError}</p> : null}
        </div>
      </article>
    </div>
  );
}

export default function MessagesWorkspace({
  snapshot,
  actor,
  language,
  selectedChannelId,
  lastReadByChannel,
  pinnedChannelIds,
  onSetChannelPinned,
  historyRevision,
  onLoadHistory,
  draft,
  saving,
  onSelectChannel,
  onDraftChange,
  onSend,
  channelPeople, linkedItems, selectedProjectId, onOpenLinkedItem, canCreateChannel, canManageChannel, canModerate,
  loadChannelMembers, onSaveChannel, onDeleteChannel, onMessageAction, onCreateReserveFromMessage,
}: MessagesWorkspaceProps) {
  const copy = messagesCopy(language);
  const locale = messagesLocale(language);
  const [query, setQuery] = useState('');
  const [editingChannel, setEditingChannel] = useState<MessageChannelRecord | null | undefined>(undefined);
  const [channelError, setChannelError] = useState('');
  const [pinBusy, setPinBusy] = useState(false);
  const [pinError, setPinError] = useState('');
  const [filter, setFilter] = useState<MessageChannelFilter>('all');
  const [compactView, setCompactView] = useState<'list' | 'thread'>('list');
  const [replyTo, setReplyTo] = useState<MessageRecord | null>(null);
  const [linkedItem, setLinkedItem] = useState<MessageLinkedItem>();
  const [showLinkPicker, setShowLinkPicker] = useState(false);
  const [history, setHistory] = useState<{
    channelId: string; revision: number; cursor: MessageHistoryCursor | null; limit: number; error: boolean; loading: boolean;
  }>();
  const historyRequest = useRef<AbortController | null>(null);
  const [mentionCaret, setMentionCaret] = useState<number | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const mentionListRef = useRef<HTMLDivElement>(null);
  const linkCopy = {
    fr: { attach: 'Joindre une fiche chantier', none: 'Choisir une fiche', mention: 'Personnes à mentionner', remove: 'Retirer la fiche', groups: ['Réserves', 'Plans', 'Tâches', 'Incidents', 'Visites', 'OPR'] },
    en: { attach: 'Attach a project record', none: 'Choose a record', mention: 'People to mention', remove: 'Remove record', groups: ['Issues', 'Plans', 'Tasks', 'Incidents', 'Visits', 'Handover'] },
    es: { attach: 'Adjuntar una ficha de obra', none: 'Elegir una ficha', mention: 'Personas para mencionar', remove: 'Quitar la ficha', groups: ['Reservas', 'Planos', 'Tareas', 'Incidentes', 'Visitas', 'Recepción'] },
  }[language];
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null);
  const [attachmentError, setAttachmentError] = useState('');
  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const projection = useMemo(() => buildMessagesProjection({
    snapshot,
    selectedChannelId,
    lastReadByChannel,
    pinnedChannelIds,
    currentUserId: actor.userId,
    currentUserName: actor.displayName,
    query,
    filter,
    language,
  }), [actor.displayName, actor.userId, filter, language, lastReadByChannel, pinnedChannelIds, query, selectedChannelId, snapshot]);

  const selected = projection.selected;
  const historyChannelId = selected?.channel.id;
  const channelHistory = history?.channelId === historyChannelId && history?.revision === historyRevision ? history : undefined;
  const historyLabels = {
    fr: { more: 'Charger les messages plus anciens', loading: 'Chargement de l’historique…', failed: 'Impossible de charger l’historique du canal.', retry: 'Réessayer' },
    en: { more: 'Load older messages', loading: 'Loading history…', failed: 'Could not load the channel history.', retry: 'Retry' },
    es: { more: 'Cargar mensajes anteriores', loading: 'Cargando el historial…', failed: 'No se pudo cargar el historial del canal.', retry: 'Reintentar' },
  }[language];
  const activeAttachment = pendingAttachment?.channelId === selected?.channel.id ? pendingAttachment : null;
  const canSend = Boolean(selected && (draft.trim() || activeAttachment?.file || linkedItem) && !saving);
  const linkTypes = ['reserve', 'plan', 'task', 'incident', 'visite', 'opr'] as const;
  const availableLinks = linkedItems.filter(item => selectedProjectId === 'all' || !item.projectId || item.projectId === selectedProjectId);
  const linkedByKey = new Map(linkedItems.map(item => [item.type + ':' + item.id, item]));
  const mentionFragment = mentionCaret === null ? null : /(?:^|\s)@([^@\n]{0,70})$/u.exec(draft.slice(0, mentionCaret));
  const suggestions = mentionFragment && !saving
    ? channelPeople.filter(person => person.id !== actor.userId && person.name.toLowerCase().includes(mentionFragment[1].trim().toLowerCase())).slice(0, 7)
    : [];

  function chooseMention(name: string) {
    if (!mentionFragment || mentionCaret === null) return;
    const start = mentionCaret - mentionFragment[1].length;
    const prefix = draft.slice(0, start) + name + ' ';
    onDraftChange((prefix + draft.slice(mentionCaret)).slice(0, 2000));
    setMentionCaret(null);
    window.requestAnimationFrame(() => {
      composerRef.current?.focus();
      composerRef.current?.setSelectionRange(prefix.length, prefix.length);
    });
  }

  const selectedMessages = channelHistory?.limit && channelHistory.cursor
    ? projection.selectedMessages.slice(-channelHistory.limit)
    : projection.selectedMessages;
  const latestMessageId = selectedMessages.at(-1)?.id;
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => threadEndRef.current?.scrollIntoView({ block: 'end' }));
    return () => window.cancelAnimationFrame(frame);
  }, [latestMessageId, historyChannelId]);

  const loadHistory = useCallback(async (channelId: string, cursor: MessageHistoryCursor | null, limit: number) => {
    historyRequest.current?.abort();
    const controller = new AbortController();
    historyRequest.current = controller;
    const pending = { channelId, revision: historyRevision, cursor, limit, error: false, loading: true };
    setHistory(pending);
    try {
      const next = await onLoadHistory(channelId, cursor, controller.signal);
      if (!controller.signal.aborted) setHistory({ ...pending, cursor: next, limit: limit + MESSAGE_HISTORY_PAGE_SIZE, loading: false });
    } catch {
      if (!controller.signal.aborted) setHistory({ ...pending, error: true, loading: false });
    }
  }, [historyRevision, onLoadHistory]);

  useEffect(() => {
    if (!historyChannelId) return;
    void loadHistory(historyChannelId, null, 0);
    return () => historyRequest.current?.abort();
  }, [historyChannelId, loadHistory]);

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  function selectChannel(channelId: string) {
    if (pendingAttachment?.channelId !== channelId) clearAttachment();
    setReplyTo(null);
    setLinkedItem(undefined);
    setShowLinkPicker(false);
    setMentionCaret(null);
    setAttachmentError('');
    onSelectChannel(channelId);
    setCompactView('thread');
  }

  function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !selected) return;
    if (!file.type.startsWith('image/')) {
      setAttachmentError(copy.imageOnly);
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setAttachmentError(copy.fileTooLarge);
      return;
    }
    const channelId = selected.channel.id;
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    const previewUrl = URL.createObjectURL(file);
    previewUrlRef.current = previewUrl;
    setAttachmentError('');
    setPendingAttachment({ channelId, file, previewUrl, filename: file.name });
  }

  function clearAttachment() {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = null;
    setPendingAttachment(null);
    setAttachmentError('');
  }

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (!selected || !canSend) return;
    const sent = await onSend({
      channelId: selected.channel.id,
      content: draft.trim(),
      attachmentFile: activeAttachment?.file,
      mentions: messageMentions(draft, channelPeople.map(person => person.name)),
      linkedItem,
      replyTo: replyTo ? { id: replyTo.id, content: replyTo.content, sender: replyTo.sender } : null,
    });
    if (sent) {
      clearAttachment();
      setReplyTo(null);
      setLinkedItem(undefined);
      setShowLinkPicker(false);
      setMentionCaret(null);
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'ArrowDown' && suggestions.length) {
      event.preventDefault();
      mentionListRef.current?.querySelector('button')?.focus();
      return;
    }
    if (event.key === 'Escape') setMentionCaret(null);
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void submit();
  }

  return (
    <div className={styles.viewport}>
    <section className={styles.workspace} data-compact-view={compactView} aria-label={copy.title}>
      <aside className={styles.channelPane}>
        <header className={styles.channelHeader}>
          <div>
            <p className={styles.eyebrow}>{copy.eyebrow}</p>
            <h2>{copy.title}</h2>
          </div>
          <span className={styles.channelTotal}>{projection.channelCount}</span>
          <p className={styles.channelSubtitle}>{copy.subtitle}</p>
        </header>

        {canCreateChannel && editingChannel === undefined ? <div className={styles.manageChannel}><button type="button" onClick={() => setEditingChannel(null)}>Nouveau canal</button></div> : null}
        {editingChannel === null ? <ChannelEditor actorId={actor.userId} people={channelPeople} current={null} loadMembers={loadChannelMembers} close={() => setEditingChannel(undefined)} save={async value => {
          const id = await onSaveChannel(value, null);
          setEditingChannel(undefined);
          selectChannel(id);
        }} /> : null}
        <div className={styles.channelTools}>
          <label className={styles.searchBox}>
            <span className={styles.srOnly}>{copy.searchLabel}</span>
            <MessageIcon name="search" size={18} />
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder={copy.searchPlaceholder} />
            {query ? <button type="button" onClick={() => setQuery('')} aria-label={copy.clearSearch}><MessageIcon name="close" size={16} /></button> : null}
          </label>
          <div className={styles.filters} role="group" aria-label={copy.channels}>
            {FILTERS.map(item => {
              const active = filter === item.id;
              const badge = item.id === 'unread' && projection.totalUnreadCount ? projection.totalUnreadCount : null;
              return (
                <button key={item.id} type="button" className={active ? styles.filterActive : styles.filter} aria-pressed={active} onClick={() => setFilter(item.id)}>
                  {item.icon ? <MessageIcon name={item.icon} size={14} /> : null}
                  {filterLabel(item.id, copy)}
                  {badge ? <span>{badge > 99 ? '99+' : badge}</span> : null}
                </button>
              );
            })}
          </div>
          <p className={styles.channelMetrics}>
            <span>{copy.channelCount(projection.channelCount)}</span>
            <span>{copy.messageCount(projection.totalMessageCount)}</span>
            {projection.totalUnreadCount ? <strong>{copy.unreadCount(projection.totalUnreadCount)}</strong> : null}
          </p>
        </div>

        <div className={styles.channelList} role="listbox" aria-label={copy.channels}>
          {projection.visibleChannels.map(summary => {
            const active = selected?.channel.id === summary.channel.id;
            return (
              <button
                key={summary.channel.id}
                type="button"
                role="option"
                aria-selected={active}
                className={active ? styles.channelActive : styles.channel}
                onClick={() => selectChannel(summary.channel.id)}
              >
                <span className={styles.channelIcon}><MessageIcon name={kindIcon(summary.kind)} size={19} /></span>
                <span className={styles.channelBody}>
                  <span className={styles.channelNameRow}>
                    <strong>{summary.channelPinned ? <span aria-label={copy.filterPinned}><MessageIcon name="pin" size={13} /> </span> : null}{summary.label}</strong>
                    <time>{messageListTimestamp(summary.latest, locale)}</time>
                  </span>
                  <span className={styles.channelPreview}>{summary.latestPreview || summary.typeLabel}</span>
                </span>
                {summary.unreadCount ? <span className={styles.unreadBadge} aria-label={copy.unreadCount(summary.unreadCount)}>{summary.unreadCount > 99 ? '99+' : summary.unreadCount}</span> : null}
              </button>
            );
          })}
          {!projection.visibleChannels.length ? (
            <div className={styles.noChannelResult}>
              <MessageIcon name="message" size={24} />
              <p>{projection.channelCount ? copy.noResults : copy.noChannels}</p>
              {query ? <button type="button" onClick={() => setQuery('')}>{copy.clearSearch}</button> : null}
            </div>
          ) : null}
        </div>
      </aside>

      <div className={styles.conversationPane}>
        <header className={styles.conversationHeader}>
          <button type="button" className={styles.backButton} onClick={() => setCompactView('list')} aria-label={copy.backToChannels}>
            <MessageIcon name="arrow-left" size={20} />
          </button>
          {selected ? (
            <>
              <span className={styles.conversationIcon}><MessageIcon name={kindIcon(selected.kind)} size={21} /></span>
              <div className={styles.conversationIdentity}>
                <p>{selected.typeLabel}</p>
                <h2>{selected.label}</h2>
              </div>
              <div className={styles.conversationMeta}>
                <span>{copy.messageCount(selected.messageCount)}</span>
                {selected.participants.length ? <span><MessageIcon name="team" size={14} />{copy.participantCount(selected.participants.length)}</span> : null}
                {selected.pinnedCount ? <span><MessageIcon name="pin" size={13} />{selected.pinnedCount}</span> : null}
                {selected.unreadCount ? <strong>{copy.unreadCount(selected.unreadCount)}</strong> : <em><MessageIcon name="check" size={13} />{copy.activeChannel}</em>}
              </div>
            </>
          ) : (
            <div className={styles.conversationIdentity}><h2>{copy.noChannelSelected}</h2></div>
          )}
        </header>

        {selected ? <div className={styles.manageChannel}>
          <button type="button" disabled={pinBusy || !actor.userId} onClick={async () => {
            setPinError('');
            setPinBusy(true);
            try {
              const result = await onSetChannelPinned(selected.channel.id, !selected.channelPinned);
              if (result === 'limit') setPinError(copy.pinChannelLimit);
            } catch {
              setPinError(copy.pinChannelError);
            } finally {
              setPinBusy(false);
            }
          }}><MessageIcon name="pin" size={15} /> {selected.channelPinned ? copy.unpinChannel : copy.pinChannel}</button>
        </div> : null}
        {pinError ? <p role="alert">{pinError}</p> : null}
        {selected && canManageChannel(selected.channel) ? <div className={styles.manageChannel}>
          <button type="button" onClick={() => { setChannelError(''); setEditingChannel(selected.channel); }}>Gérer le canal</button>
          <button type="button" onClick={async () => {
            if (!window.confirm('Supprimer le canal « ' + selected.label + ' » ?')) return;
            setChannelError('');
            try { await onDeleteChannel(selected.channel); setEditingChannel(undefined); }
            catch (cause) { setChannelError(cause instanceof Error ? cause.message : 'Suppression impossible.'); }
          }}>Supprimer le canal</button>
        </div> : null}
        {channelError ? <p role="alert">{channelError}</p> : null}
        {editingChannel && selected?.channel.id === editingChannel.id ? (
          <ChannelEditor key={editingChannel.id} actorId={actor.userId} people={channelPeople} current={editingChannel} loadMembers={loadChannelMembers} close={() => setEditingChannel(undefined)} save={async value => {
            await onSaveChannel(value, editingChannel);
            setEditingChannel(undefined);
          }} />
        ) : null}
        <div className={styles.thread} aria-live="polite">
          {historyChannelId && (
            <div className={styles.manageChannel}>
              {(!channelHistory || channelHistory.loading) && <p role="status">{historyLabels.loading}</p>}
              {channelHistory?.error && <p role="status">{historyLabels.failed}</p>}
              {channelHistory && !channelHistory.loading && (channelHistory.error || channelHistory.cursor) && (
                <button type="button" onClick={() => void loadHistory(historyChannelId, channelHistory.cursor, channelHistory.limit)}>
                  {channelHistory.error ? historyLabels.retry : historyLabels.more}
                </button>
              )}
            </div>
          )}
          {selectedMessages.map((message, index) => {
            const linked = message.linked_item_type && message.linked_item_id
              ? linkedByKey.get(message.linked_item_type + ':' + message.linked_item_id)
              : message.reserve_id ? linkedByKey.get('reserve:' + message.reserve_id) : undefined;
            return (
            <MessageBubble
              key={message.id}
              message={message}
              previousDay={index ? messageDayLabel(selectedMessages[index - 1], locale) : ''}
              actor={actor}
              locale={locale}
              copy={copy}
              onReply={setReplyTo}
              openLinkedItem={linked ? () => onOpenLinkedItem(linked) : undefined}
              canModerate={canModerate}
              onMessageAction={onMessageAction}
              onCreateReserveFromMessage={onCreateReserveFromMessage}
            />
            );
          })}
          {!selectedMessages.length && (!selected || (channelHistory?.limit && !channelHistory.loading && !channelHistory.error)) ? (
            <div className={styles.emptyConversation}>
              <span><MessageIcon name="message" size={28} /></span>
              <strong>{selected ? copy.emptyTitle : copy.noChannelSelected}</strong>
              <p>{selected ? copy.emptyText : copy.subtitle}</p>
            </div>
          ) : null}
          <div ref={threadEndRef} />
        </div>

        <form className={styles.composer} onSubmit={submit}>
          {replyTo ? (
            <div className={styles.composerContext}>
              <MessageIcon name="reply" size={17} />
              <span><strong>{copy.replyingTo(String(replyTo.sender ?? copy.unknownSender))}</strong><small>{replyTo.content || copy.photoMessage}</small></span>
              <button type="button" onClick={() => setReplyTo(null)} aria-label={copy.cancelReply}><MessageIcon name="close" size={17} /></button>
            </div>
          ) : null}
          {activeAttachment ? (
            <div className={styles.attachmentPreview}>
              <img src={activeAttachment.previewUrl} alt={copy.attachmentAlt} />
              <span><strong>{activeAttachment.filename}</strong><small>{saving ? copy.uploading : copy.uploadPhoto}</small></span>
              <button type="button" onClick={clearAttachment} aria-label={copy.removeAttachment}><MessageIcon name="close" size={17} /></button>
            </div>
          ) : null}
          {linkedItem ? (
            <div className={styles.composerContext}>
              <MessageIcon name="link" size={17} />
              <span><strong>{linkedItem.title}</strong></span>
              <button type="button" onClick={() => setLinkedItem(undefined)} aria-label={linkCopy.remove}><MessageIcon name="close" size={17} /></button>
            </div>
          ) : null}
          {showLinkPicker ? (
            <label className={styles.linkPicker}>
              <span>{linkCopy.attach}</span>
              <select value="" onChange={event => {
                setLinkedItem(linkedByKey.get(event.target.value));
                setShowLinkPicker(false);
              }}>
                <option value="">{linkCopy.none}</option>
                {linkTypes.map((type, index) => {
                  const items = availableLinks.filter(item => item.type === type);
                  return items.length ? <optgroup key={type} label={linkCopy.groups[index]}>{items.map(item => (
                    <option key={item.id} value={item.type + ':' + item.id}>{item.title}</option>
                  ))}</optgroup> : null;
                })}
              </select>
            </label>
          ) : null}
          {suggestions.length ? (
            <div className={styles.mentionSuggestions} ref={mentionListRef} role="group" aria-label={linkCopy.mention}>
              {suggestions.map(person => <button type="button" key={person.id} onClick={() => chooseMention(person.name)}>{person.name}</button>)}
            </div>
          ) : null}
          {attachmentError ? <p className={styles.composerError} role="alert">{attachmentError}</p> : null}
          <div className={styles.composerBox}>
            <input
              ref={fileInputRef}
              className={styles.fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
              tabIndex={-1}
              aria-hidden="true"
              onChange={choosePhoto}
            />
            <button type="button" className={styles.attachButton} onClick={() => fileInputRef.current?.click()} disabled={!selected || saving} aria-label={copy.attachPhoto} title={copy.attachPhoto}>
              <MessageIcon name={saving ? 'image' : 'camera'} size={20} />
            </button>
            <button type="button" className={styles.attachButton} onClick={() => setShowLinkPicker(current => !current)} disabled={!selected || saving || !availableLinks.length} aria-expanded={showLinkPicker} aria-label={linkCopy.attach} title={linkCopy.attach}>
              <MessageIcon name="link" size={19} />
            </button>
            <label className={styles.composerField}>
              <span className={styles.srOnly}>{selected ? copy.composerPlaceholder(selected.label) : copy.noChannelSelected}</span>
              <textarea
                ref={composerRef}
                value={draft}
                onSelect={event => setMentionCaret(event.currentTarget.selectionStart)}
                onChange={event => {
                  setMentionCaret(event.currentTarget.selectionStart);
                  onDraftChange(event.target.value);
                }}
                onKeyDown={handleComposerKeyDown}
                placeholder={selected ? copy.composerPlaceholder(selected.label) : copy.noChannelSelected}
                disabled={!selected || saving}
                rows={1}
                maxLength={2000}
              />
              <small>{copy.keyboardHint}</small>
            </label>
            <button type="submit" className={styles.sendButton} disabled={!canSend} aria-label={saving ? copy.sending : copy.send}>
              <MessageIcon name="send" size={18} />
              <span>{saving ? copy.sending : copy.send}</span>
            </button>
          </div>
        </form>
      </div>
    </section>
    </div>
  );
}
