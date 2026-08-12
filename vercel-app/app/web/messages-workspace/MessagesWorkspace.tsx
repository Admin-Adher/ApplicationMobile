'use client';

import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from 'react';
import type { SupportedLang } from '@/lib/i18n';
import { privateMediaAccess, retryPrivateMedia } from '@/lib/private-media-client';
import { MessageIcon, type MessageIconName } from './MessageIcon';
import {
  buildMessagesProjection,
  messageClockLabel,
  messageDayLabel,
  messageFullTimestamp,
  messageListTimestamp,
  messageReactions,
  messagesCopy,
  messagesLocale,
  type AuthorizedMessagesSnapshot,
  type MessageChannelFilter,
  type MessageChannelKind,
  type MessageRecord,
  type MessageSendInput,
} from './messages-model';
import styles from './MessagesWorkspace.module.css';

type MessagesWorkspaceProps = {
  snapshot: AuthorizedMessagesSnapshot;
  actor: { userId: string; displayName: string };
  language: SupportedLang;
  selectedChannelId: string | null;
  lastReadByChannel: Record<string, string>;
  draft: string;
  saving: boolean;
  onSelectChannel: (channelId: string) => void;
  onDraftChange: (value: string) => void;
  onSend: (input: MessageSendInput) => Promise<boolean>;
  onUploadPhoto: (file: File, channelId: string) => Promise<string>;
};

type PendingAttachment = {
  channelId: string;
  mediaRef: string;
  previewUrl: string;
  filename: string;
};

const FILTERS: Array<{ id: MessageChannelFilter; icon?: MessageIconName }> = [
  { id: 'all' },
  { id: 'unread' },
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
  const access = privateMediaAccess(message.attachment_uri);
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
      <button type="button" onClick={() => retryPrivateMedia(message.attachment_uri)}>{copy.retry}</button>
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
}: {
  message: MessageRecord;
  previousDay: string;
  actor: MessagesWorkspaceProps['actor'];
  locale: string;
  copy: ReturnType<typeof messagesCopy>;
  onReply: (message: MessageRecord) => void;
}) {
  const sender = String(message.sender ?? copy.unknownSender);
  const day = messageDayLabel(message, locale);
  const own = isOwnMessage(message, actor);
  const reactions = messageReactions(message);
  const hasContent = Boolean(String(message.content ?? '').trim());

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
            {message.linked_item_title ? (
              <div className={styles.linkedItem}>
                <MessageIcon name="link" size={15} />
                <span><small>{copy.linkedItem}</small><strong>{message.linked_item_title}</strong></span>
              </div>
            ) : null}
            <MessageAttachment message={message} copy={copy} />
            {hasContent ? <p>{message.content}</p> : null}
          </div>
          <div className={styles.messageActions}>
            {reactions.map(reaction => <span key={reaction.emoji}>{reaction.emoji} {reaction.count}</span>)}
            <button type="button" onClick={() => onReply(message)}>
              <MessageIcon name="reply" size={14} />
              {copy.reply}
            </button>
          </div>
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
  draft,
  saving,
  onSelectChannel,
  onDraftChange,
  onSend,
  onUploadPhoto,
}: MessagesWorkspaceProps) {
  const copy = messagesCopy(language);
  const locale = messagesLocale(language);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<MessageChannelFilter>('all');
  const [compactView, setCompactView] = useState<'list' | 'thread'>('list');
  const [replyTo, setReplyTo] = useState<MessageRecord | null>(null);
  const [pendingAttachment, setPendingAttachment] = useState<PendingAttachment | null>(null);
  const [attachmentUploading, setAttachmentUploading] = useState(false);
  const [attachmentError, setAttachmentError] = useState('');
  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const projection = useMemo(() => buildMessagesProjection({
    snapshot,
    selectedChannelId,
    lastReadByChannel,
    currentUserId: actor.userId,
    currentUserName: actor.displayName,
    query,
    filter,
    language,
  }), [actor.displayName, actor.userId, filter, language, lastReadByChannel, query, selectedChannelId, snapshot]);

  const selected = projection.selected;
  const activeAttachment = pendingAttachment?.channelId === selected?.channel.id ? pendingAttachment : null;
  const canSend = Boolean(selected && (draft.trim() || activeAttachment?.mediaRef) && !saving && !attachmentUploading);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => threadEndRef.current?.scrollIntoView({ block: 'end' }));
    return () => window.cancelAnimationFrame(frame);
  }, [projection.selectedMessages.length, selected?.channel.id]);

  useEffect(() => () => {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
  }, []);

  function selectChannel(channelId: string) {
    if (pendingAttachment?.channelId !== channelId) clearAttachment();
    setReplyTo(null);
    setAttachmentError('');
    onSelectChannel(channelId);
    setCompactView('thread');
  }

  async function choosePhoto(event: ChangeEvent<HTMLInputElement>) {
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
    setAttachmentUploading(true);
    setPendingAttachment({ channelId, mediaRef: '', previewUrl, filename: file.name });
    try {
      const mediaRef = await onUploadPhoto(file, channelId);
      setPendingAttachment(current => current?.channelId === channelId ? { ...current, mediaRef } : current);
    } catch (error: any) {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
      setPendingAttachment(null);
      setAttachmentError(error?.message || copy.uploadFailed);
    } finally {
      setAttachmentUploading(false);
    }
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
      attachmentRef: activeAttachment?.mediaRef || null,
      replyTo: replyTo ? { id: replyTo.id, content: replyTo.content, sender: replyTo.sender } : null,
    });
    if (sent) {
      clearAttachment();
      setReplyTo(null);
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
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
                    <strong>{summary.label}</strong>
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

        <div className={styles.thread} aria-live="polite">
          {projection.selectedMessages.map((message, index) => (
            <MessageBubble
              key={message.id}
              message={message}
              previousDay={index ? messageDayLabel(projection.selectedMessages[index - 1], locale) : ''}
              actor={actor}
              locale={locale}
              copy={copy}
              onReply={setReplyTo}
            />
          ))}
          {!projection.selectedMessages.length ? (
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
              <span><strong>{activeAttachment.filename}</strong><small>{attachmentUploading ? copy.uploading : copy.uploadPhoto}</small></span>
              <button type="button" onClick={clearAttachment} aria-label={copy.removeAttachment}><MessageIcon name="close" size={17} /></button>
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
            <button type="button" className={styles.attachButton} onClick={() => fileInputRef.current?.click()} disabled={!selected || attachmentUploading || saving} aria-label={copy.attachPhoto} title={copy.attachPhoto}>
              <MessageIcon name={attachmentUploading ? 'image' : 'camera'} size={20} />
            </button>
            <label className={styles.composerField}>
              <span className={styles.srOnly}>{selected ? copy.composerPlaceholder(selected.label) : copy.noChannelSelected}</span>
              <textarea
                value={draft}
                onChange={event => onDraftChange(event.target.value)}
                onKeyDown={handleComposerKeyDown}
                placeholder={selected ? copy.composerPlaceholder(selected.label) : copy.noChannelSelected}
                disabled={!selected || saving}
                rows={1}
                maxLength={2000}
              />
              <small>{copy.keyboardHint}</small>
            </label>
            <button type="submit" className={styles.sendButton} disabled={!canSend}>
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
