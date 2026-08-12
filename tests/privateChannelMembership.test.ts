import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const repositoryRoot = resolve(import.meta.dirname, '..');
const read = (path: string) => readFileSync(resolve(repositoryRoot, path), 'utf8');
const migration = read('supabase/migrations/20260812162402_migrate_private_channel_members_to_user_ids.sql');
const privateManagementHardening = read(
  'supabase/migrations/20260812170600_harden_private_channel_management.sql',
);
const legacyAliasReconciliation = read(
  'supabase/migrations/20260812171000_reconcile_empty_legacy_dm_alias.sql',
);

describe('private channel UUID membership', () => {
  it('backfills conservatively and keeps legacy labels presentation-only', () => {
    expect(migration).toContain('having count(*) = 1');
    expect(migration).toContain("c.type in ('group', 'dm')");
    expect(migration).toContain('m.sender_id');
    expect(migration).toContain('add column if not exists created_by_user_id uuid');
    expect(migration).toContain('Legacy/presentation mirror only');
  });

  it('makes UUID membership the restrictive authorization boundary', () => {
    expect(migration).toContain('create or replace function public.auth_can_access_channel');
    expect(migration).toContain('cm.user_id = auth.uid()');
    expect(migration).toContain('channels_uuid_select_restrictive');
    expect(migration).toContain('messages_uuid_select_restrictive');
    expect(migration).toContain('as restrictive for select to authenticated');
    expect(migration).toContain('drop policy if exists "Channels visibles par membres habilites v2"');
    expect(migration).toContain('drop policy if exists "Messages visibles par membres habilités"');
  });

  it('exposes one atomic UUID RPC and rejects ambiguous legacy member labels', () => {
    expect(migration).toContain('create or replace function public.upsert_private_channel');
    expect(migration).toContain('p_member_user_ids uuid[]');
    expect(migration).toContain('Every private channel member must resolve to one active user');
    expect(migration).toContain('A direct conversation requires exactly two distinct members');
    expect(migration).toContain('Every channel member must have an active tenant membership');
    expect(migration).toContain('to authenticated;');
  });

  it('does not let a tenant administrator bypass private membership', () => {
    expect(privateManagementHardening).toContain("c.type in ('group', 'dm')");
    expect(privateManagementHardening).toContain('c.created_by_user_id = auth.uid()');
    expect(privateManagementHardening).toContain(
      'using (public.auth_can_access_channel(organization_id, channel_id));',
    );

    const channelScreen = read('app/channel/[id].tsx');
    const memberModal = read('components/channel/MembersModal.tsx');
    expect(channelScreen).toContain('(!isGroupChannel && !isDMChannel)');
    expect(memberModal).toContain('(!isGroupChannel && !isDMChannel)');
  });

  it('reconciles the one empty legacy alias only behind immutable evidence', () => {
    expect(legacyAliasReconciliation).toContain("v_old_messages <> 0");
    expect(legacyAliasReconciliation).toContain("v_old_members <> 1");
    expect(legacyAliasReconciliation).toContain("v_canonical_members <> 2");
    expect(legacyAliasReconciliation).toContain("v_candidate_count <> 1");
    expect(legacyAliasReconciliation).toContain(
      'Legacy DM alias evidence changed; manual reconciliation required',
    );
  });

  it('uses immutable IDs in mobile creation, membership edits and push recipients', () => {
    const channelsHook = read('hooks/queries/useChannels.ts');
    const groupModal = read('components/NewGroupModal.tsx');
    const memberModal = read('components/channel/MembersModal.tsx');
    const pushRoute = read('vercel-app/app/api/send-push/route.ts');

    expect(channelsHook).toContain("fn: 'upsert_private_channel'");
    expect(channelsHook).toContain('p_member_user_ids: memberUserIds');
    expect(channelsHook).toContain('dmChannelIdByUserIds');
    expect(groupModal).toContain('selected.map(({ id, name: memberName })');
    expect(groupModal).toContain('profile.id !== currentUserId');
    expect(read('components/NewDMModal.tsx')).toContain('profile.id !== currentUserId');
    expect(memberModal).toContain('removeChannelMember(channelId, member)');
    expect(pushRoute).toContain(".from('channel_members')");
    expect(pushRoute).toContain(".select('user_id')");

    const resolverStart = pushRoute.indexOf('async function resolveMessageRecipientProfileIds');
    const resolverEnd = pushRoute.indexOf('async function pushForMessage', resolverStart);
    const resolver = pushRoute.slice(resolverStart, resolverEnd);
    expect(resolver).not.toContain('channel.members');
    expect(resolver).not.toContain("slice(3).split('__')");
  });
});
