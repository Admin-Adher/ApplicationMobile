import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type ServerAuthority = {
  userId: string;
  email: string;
  organizationId: string | null;
  role: string;
  companyId: string | null;
  permissionsOverride: Record<string, boolean>;
  membershipStatus: string | null;
  roleVersion: number;
  isPlatformAdmin: boolean;
};

export type OrganizationUser = {
  id: string;
  name: string;
  email: string;
  preferredLanguage: string | null;
  organizationId: string;
  role: string;
  companyId: string | null;
  permissionsOverride: Record<string, boolean>;
  membershipStatus: string;
};

export type AuthenticatedRequest = {
  authority: ServerAuthority;
  token: string;
  supabase: SupabaseClient;
};

function supabaseUrl(): string {
  return String(
    process.env.NEXT_PUBLIC_SUPABASE_URL
      ?? process.env.EXPO_PUBLIC_SUPABASE_URL
      ?? '',
  ).trim();
}

export function createServiceClient(): SupabaseClient | null {
  const url = supabaseUrl();
  const serviceKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function bearerToken(request: Request): string | null {
  const auth = request.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return null;
  return auth.slice(7).trim() || null;
}

export async function authenticateRequest(
  request: Request,
  client: SupabaseClient | null = createServiceClient(),
): Promise<AuthenticatedRequest | null> {
  if (!client) return null;
  const token = bearerToken(request);
  if (!token) return null;

  const { data: userData, error: userError } = await client.auth.getUser(token);
  const authUser = userData?.user;
  if (userError || !authUser?.id) return null;

  const { data, error } = await client.rpc('get_authorization_context_for_user', {
    p_user_id: authUser.id,
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row) return null;

  return {
    token,
    supabase: client,
    authority: {
      userId: authUser.id,
      email: String(authUser.email ?? '').trim().toLowerCase(),
      organizationId: row.organization_id ?? null,
      role: String(row.role ?? ''),
      companyId: row.company_id ?? null,
      permissionsOverride: row.permissions_override && typeof row.permissions_override === 'object'
        ? row.permissions_override as Record<string, boolean>
        : {},
      membershipStatus: row.membership_status ?? null,
      roleVersion: Number(row.role_version ?? 0),
      isPlatformAdmin: row.is_platform_admin === true,
    },
  };
}

export function createUserScopedClient(token: string): SupabaseClient | null {
  const url = supabaseUrl();
  const anonKey = String(
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
      ?? '',
  ).trim();
  if (!url || !anonKey || !token) return null;
  return createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

export async function getOrganizationUsers(
  client: SupabaseClient,
  organizationId: string,
  includeInactive = false,
): Promise<OrganizationUser[]> {
  let membershipQuery = client
    .from('organization_memberships')
    .select('user_id, organization_id, role, company_id, permissions_override, status')
    .eq('organization_id', organizationId);
  if (!includeInactive) membershipQuery = membershipQuery.eq('status', 'active');
  const { data: memberships, error: membershipError } = await membershipQuery;
  if (membershipError) throw membershipError;
  const memberRows = memberships ?? [];
  const userIds = memberRows.map(row => String(row.user_id)).filter(Boolean);
  if (userIds.length === 0) return [];
  const { data: profiles, error: profileError } = await client
    .from('profiles')
    .select('id, name, email, preferred_language')
    .in('id', userIds);
  if (profileError) throw profileError;
  const profileById = new Map((profiles ?? []).map(profile => [String(profile.id), profile]));
  return memberRows.map(membership => {
    const profile: any = profileById.get(String(membership.user_id)) ?? {};
    return {
      id: String(membership.user_id),
      name: String(profile.name ?? ''),
      email: String(profile.email ?? '').trim().toLowerCase(),
      preferredLanguage: profile.preferred_language ?? null,
      organizationId: String(membership.organization_id),
      role: String(membership.role ?? ''),
      companyId: membership.company_id ?? null,
      permissionsOverride: membership.permissions_override && typeof membership.permissions_override === 'object'
        ? membership.permissions_override as Record<string, boolean>
        : {},
      membershipStatus: String(membership.status ?? ''),
    };
  });
}

export async function getOrganizationUser(
  client: SupabaseClient,
  organizationId: string,
  userId: string,
  includeInactive = false,
): Promise<OrganizationUser | null> {
  const users = await getOrganizationUsers(client, organizationId, includeInactive);
  return users.find(user => user.id === userId) ?? null;
}
