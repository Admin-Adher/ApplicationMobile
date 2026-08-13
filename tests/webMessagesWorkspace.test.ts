import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(repositoryRoot, path), 'utf8');

describe('BuildTrack web messages workspace', () => {
  it('owns Messages behind an authorized snapshot and intent interface', () => {
    const page = read('vercel-app/app/web/page.tsx');
    const workspace = read('vercel-app/app/web/messages-workspace/MessagesWorkspace.tsx');
    const model = read('vercel-app/app/web/messages-workspace/messages-model.ts');

    expect(page).toContain("import MessagesWorkspace from './messages-workspace/MessagesWorkspace'");
    expect(page).toContain('<MessagesWorkspace');
    expect(page).toContain('snapshot={{');
    expect(page).toContain('actor={{');
    expect(page).not.toContain('function MessagesView(');
    expect(model).toContain('AuthorizedMessagesSnapshot');
    expect(model).toContain('MessageSendInput');
    expect(workspace).not.toContain('supabaseBrowser');
    expect(workspace).toContain('await onSend({');
    expect(workspace).toContain('await onUploadPhoto(file, channelId)');
  });

  it('derives message actor and tenant on the server instead of the client payload', () => {
    const page = read('vercel-app/app/web/page.tsx');
    const sendStart = page.indexOf('async function sendMessage(input: MessageSendInput)');
    const sendEnd = page.indexOf('const canViewReserveTrash', sendStart);
    const sendImplementation = page.slice(sendStart, sendEnd);

    expect(sendImplementation).toContain(".from('messages')");
    expect(sendImplementation).toContain('channel_id: input.channelId');
    expect(sendImplementation).not.toContain('organization_id:');
    expect(sendImplementation).not.toContain('sender: profile');
    expect(sendImplementation).toContain('attachment_uri: input.attachmentRef');
    expect(sendImplementation).toContain('reply_to_id: input.replyTo?.id');
  });

  it('shares read state with mobile and keeps immutable sender identity', () => {
    const page = read('vercel-app/app/web/page.tsx');
    const model = read('vercel-app/app/web/messages-workspace/messages-model.ts');

    expect(page).toContain('loadedProfile.last_read_by_channel');
    expect(page).toContain(".update({ last_read_by_channel: next })");
    expect(page).toContain("rpc('mark_messages_read_by'");
    expect(page).not.toContain('nowIsoStamp');
    expect(model).toContain('message.sender_id');
    expect(model).toContain('String(message.sender_id) === currentUserId');
  });

  it('renders mobile list-to-thread navigation, private photos and rich message context', () => {
    const workspace = read('vercel-app/app/web/messages-workspace/MessagesWorkspace.tsx');
    const css = read('vercel-app/app/web/messages-workspace/MessagesWorkspace.module.css');

    expect(workspace).toContain("data-compact-view={compactView}");
    expect(workspace).toContain("setCompactView('thread')");
    expect(workspace).toContain("setCompactView('list')");
    expect(workspace).toContain("usePrivateMediaAccess(message.attachment_uri, { priority: 'background' })");
    expect(workspace).toContain('message.reply_to_id');
    expect(workspace).toContain('message.linked_item_title');
    expect(workspace).toContain('messageReactions(message)');
    expect(css).toContain('container-type: inline-size');
    expect(css).toContain('@container messages-workspace (max-width: 48rem)');
    expect(css).toContain('[data-compact-view="list"] .conversationPane');
    expect(css).toContain('[data-compact-view="thread"] .channelPane');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).not.toMatch(/linear-gradient|radial-gradient|backdrop-filter/);
  });

  it('uses labelled controls and minimum 44 pixel primary targets', () => {
    const workspace = read('vercel-app/app/web/messages-workspace/MessagesWorkspace.tsx');
    const css = read('vercel-app/app/web/messages-workspace/MessagesWorkspace.module.css');

    expect(workspace).toContain('role="listbox"');
    expect(workspace).toContain('role="option"');
    expect(workspace).toContain('aria-selected={active}');
    expect(workspace).toContain('aria-label={copy.backToChannels}');
    expect(workspace).toContain('aria-label={copy.attachPhoto}');
    expect(workspace).toContain('tabIndex={-1}');
    expect(workspace).toContain('aria-hidden="true"');
    expect(css).toContain('min-height: 2.75rem');
    expect(css).toContain(':focus-visible');
  });
});
