import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

function repoPath(relative: string) {
  return fileURLToPath(new URL(`../${relative}`, import.meta.url));
}

function source(relative: string) {
  return readFileSync(repoPath(relative), 'utf8').toLowerCase();
}

const authority = source('supabase/migrations/20260810192253_organization_membership_authority.sql');
const integrity = source('supabase/migrations/20260810193111_enforce_tenant_integrity_and_rpc_scope.sql');
const media = source('supabase/migrations/20260810193713_add_private_tenant_media_registry.sql');
const followup = source('supabase/migrations/20260811000500_index_tenant_fks_and_harden_legacy_helpers.sql');
const visibilityHardening = source('supabase/migrations/20260811001700_fix_chantier_visibility_search_path.sql');

describe('tenant A x object B authorization matrix', () => {
  const actors = [
    { name: 'user A', organizationId: 'A', active: true, platform: false },
    { name: 'user B', organizationId: 'B', active: true, platform: false },
    { name: 'no membership', organizationId: null, active: false, platform: false },
  ];
  const objects = [
    { name: 'object A', organizationId: 'A' },
    { name: 'object B', organizationId: 'B' },
    { name: 'tenantless object', organizationId: null },
  ];

  for (const actor of actors) {
    for (const object of objects) {
      it(`${actor.name} -> ${object.name}`, () => {
        const allowed = actor.platform || (
          actor.active
          && object.organizationId !== null
          && actor.organizationId === object.organizationId
        );
        expect(allowed).toBe(
          actor.active
          && actor.organizationId !== null
          && actor.organizationId === object.organizationId,
        );
      });
    }
  }
});

describe('membership authority migration contract', () => {
  it('moves every authorization decision away from client-writable profiles', () => {
    expect(authority).toContain('create table if not exists public.organization_memberships');
    expect(authority).toContain('create table if not exists private.platform_admins');
    expect(authority).toContain('from public.organization_memberships om');
    expect(authority).toContain('revoke all on table public.profiles from public, anon, authenticated');
    expect(authority).toContain('grant update (name, preferred_language, last_read_by_channel, pinned_channels)');
    expect(authority).toContain('profile authorization fields are server-managed');
    expect(authority).not.toMatch(/grant update \([^)]*(role|organization_id|permissions_override)/);
  });

  it('makes invitation grants immutable and links them atomically server-side', () => {
    expect(authority).toContain('invitations are server-managed');
    expect(authority).toContain('revoke all on table public.invitations from public, anon, authenticated');
    expect(authority).toContain('create or replace function public.link_invitation_for_current_user');
    expect(authority).toContain('for update skip locked');
    expect(authority).toContain('create or replace function public.check_invitation_token');
    expect(authority).toContain('revoke all on function public.check_pending_invitation(text)');
  });

  it('keeps the server authorization context service-only', () => {
    expect(authority).toContain('create or replace function public.get_authorization_context_for_user');
    expect(authority).toContain(
      'revoke all on function public.get_authorization_context_for_user(uuid) from public, anon, authenticated',
    );
    expect(authority).toContain(
      'grant execute on function public.get_authorization_context_for_user(uuid) to service_role',
    );
  });

  it('makes organizations and subscriptions server-managed control-plane records', () => {
    expect(authority).toContain('organizations_select_membership_scoped');
    expect(authority).toContain('subscriptions_select_membership_scoped');
    expect(authority).toContain('revoke all on table public.organizations from public, anon, authenticated');
    expect(authority).toContain('revoke all on table public.subscriptions from public, anon, authenticated');
  });
});

describe('tenant integrity migration contract', () => {
  it('derives tenant identity and applies a restrictive boundary', () => {
    expect(integrity).toContain('create or replace function private.enforce_actor_tenant');
    expect(integrity).toContain('new.organization_id := v_actor_org');
    expect(integrity).toContain('as restrictive for all to authenticated');
    expect(integrity).toContain('organization_id is not null and organization_id = public.auth_user_org()');
    expect(integrity).toContain('tenant_boundary_anonymous_deny');
  });

  it('binds child relationships to tenant-aware parent keys', () => {
    expect(integrity).toContain('foreign key (organization_id, chantier_id)');
    expect(integrity).toContain('references public.chantiers(organization_id, id) not valid');
    expect(integrity).toContain('foreign key (organization_id, product_id)');
    expect(integrity).toContain('references public.inventory_products(organization_id, id) not valid');
    expect(integrity).toContain('foreign key (organization_id, user_id)');
    expect(integrity).toContain('references public.organization_memberships(organization_id, user_id)');
  });

  it('uses immutable user IDs for message ownership', () => {
    expect(integrity).toContain('add column if not exists sender_id uuid references auth.users(id)');
    expect(integrity).toContain('new.sender_id := auth.uid()');
    expect(integrity).toContain('messages_actor_update_restrictive');
  });

  it('indexes tenant-aware foreign keys and closes legacy anonymous helpers', () => {
    expect(followup).toContain('on public.organization_memberships(organization_id, company_id)');
    expect(followup).toContain('on public.tenant_media_links(organization_id, asset_id)');
    expect(followup).toContain('on public.reserves(organization_id, plan_id)');
    expect(followup).toContain('revoke all on function public.auth_user_email() from public, anon');
    expect(followup).toContain('revoke all on function public.set_photo_organization_id() from public, anon, authenticated');
    expect(visibilityHardening).toContain('set search_path = pg_catalog, public');
  });
});

describe('private media architecture contract', () => {
  it('stores opaque references in a tenant-owned server-only registry', () => {
    expect(media).toContain('create table if not exists public.tenant_media_objects');
    expect(media).toContain('create table if not exists public.tenant_media_links');
    expect(media).toContain("'btmedia://' || a.id::text");
    expect(media).toContain('revoke all on public.tenant_media_objects from public, anon, authenticated');
    expect(media).toContain('server_get_media_candidates');
    expect(media).toContain('to service_role');
  });

  it('deploys dual-read first and requires an explicit minimum-version cutover', () => {
    expect(media).toContain("values ('private_media_storage', false");
    expect(media).toContain('create or replace function public.server_finalize_private_media_storage');
    expect(media).toContain('explicit confirmation and minimum client version are required');
    expect(media).toContain("set public = false");
    expect(media).toContain('not public.private_media_storage_enforced()');
    expect(media).toContain('create or replace function public.auth_can_upload_registered_media');
    expect(media).toContain('security definer');
    expect(media).toContain('buildtrack_media_registry_anonymous_boundary');
  });

  it('serves only completed safe media through the resolver', () => {
    expect(media).toContain("and a.status in ('ready', 'legacy')");
    expect(media).toContain('unsupported photo content type');
    expect(media).toContain('unsafe document content type');
    expect(media).toContain('p_actual_size <> v_asset.expected_size');
    const resolver = source('vercel-app/lib/private-media-server.ts');
    expect(resolver).toContain("row.status !== 'ready' && row.status !== 'legacy'");
  });

  it('garbage-collects abandoned pending and ready uploads', () => {
    expect(media).toContain("a.status = 'pending' and a.created_at < now() - interval '24 hours'");
    expect(media).toContain("a.status = 'ready' and a.completed_at < now() - interval '24 hours'");
    expect(media).toContain('not exists (\n        select 1 from public.tenant_media_links');
  });
});

describe('single canonical server contract', () => {
  it('removes unauthenticated Expo and Express API duplicates', () => {
    for (const removed of [
      'server/api.js',
      'app/api/send-email+api.ts',
      'app/api/inventory-barcode-lookup+api.ts',
      'app/api/admin-notification-preferences+api.ts',
      'app/api/request-password-reset+api.ts',
      'supabase/functions/inventory-barcode-lookup/index.ts',
    ]) {
      expect(existsSync(repoPath(removed)), removed).toBe(false);
    }
  });

  it('keeps sensitive storage endpoints behind canonical authentication', () => {
    for (const route of [
      'vercel-app/app/api/storage/presign/route.ts',
      'vercel-app/app/api/storage/complete/route.ts',
      'vercel-app/app/api/storage/resolve/route.ts',
      'vercel-app/app/api/storage/delete/route.ts',
    ]) {
      const routeSource = source(route);
      expect(routeSource, route).toContain('authenticaterequest');
      expect(routeSource, route).not.toContain('r2keyfrompublicurl');
    }
  });
});
