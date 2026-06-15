import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

function bearerToken(request: Request) {
  const auth = request.headers.get('authorization') ?? '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
}

function serverError(message: string, status = 500) {
  return Response.json({ error: message }, { status });
}

function adminClient() {
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return null;
  return createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function authenticatedProfile(request: Request, supabase: any) {
  const token = bearerToken(request);
  if (!token) return null;
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  const userId = userData?.user?.id;
  if (userError || !userId) return null;
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, name, email, role, organization_id')
    .eq('id', userId)
    .maybeSingle();
  if (profileError || !profile) return null;
  return profile;
}

async function adminTargetProfile(request: Request, supabase: any, targetUserId: string) {
  const actor = await authenticatedProfile(request, supabase);
  if (!actor) return { status: 401, error: 'Invalid session' };
  if (actor.role !== 'admin' && actor.role !== 'super_admin') {
    return { status: 403, error: 'Admin access required' };
  }

  const { data: target, error: targetError } = await supabase
    .from('profiles')
    .select('id, name, email, role, organization_id')
    .eq('id', targetUserId)
    .maybeSingle();
  if (targetError || !target) return { status: 404, error: 'User not found' };
  if (actor.role !== 'super_admin' && target.organization_id !== actor.organization_id) {
    return { status: 403, error: 'User is outside your organization' };
  }
  if (actor.role === 'admin' && (target.role === 'admin' || target.role === 'super_admin')) {
    return { status: 403, error: 'Only a super administrator can change this setting' };
  }
  return { actor, target };
}

async function getPreferences(supabase: any, profile: any) {
  const select = 'user_id, organization_id, email_enabled, reserve_created_email, reserve_status_email, reserve_critical_email, reserve_overdue_email, email_admin_updated_at, email_admin_updated_by, email_admin_action';
  const { data, error } = await supabase
    .from('notification_preferences')
    .select(select)
    .eq('user_id', profile.id)
    .maybeSingle();
  if (error) throw error;
  if (data) return data;

  const { data: inserted, error: insertError } = await supabase
    .from('notification_preferences')
    .insert({
      user_id: profile.id,
      organization_id: profile.organization_id ?? null,
    })
    .select(select)
    .single();
  if (insertError) throw insertError;
  return inserted;
}

export async function GET(request: Request) {
  const supabase = adminClient();
  if (!supabase) return serverError('SUPABASE_SERVICE_ROLE_KEY is not configured on the server');

  try {
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId')?.trim();
    if (!userId) return serverError('Missing userId', 400);

    const access = await adminTargetProfile(request, supabase, userId);
    if (access.error) return serverError(access.error, access.status ?? 500);
    const preferences = await getPreferences(supabase, access.target);
    return Response.json({ ok: true, user: access.target, preferences });
  } catch (err: any) {
    console.error('[admin-notification-preferences] GET:', err?.message ?? err);
    return serverError(err?.message ?? 'Server error');
  }
}

export async function POST(request: Request) {
  const supabase = adminClient();
  if (!supabase) return serverError('SUPABASE_SERVICE_ROLE_KEY is not configured on the server');

  try {
    const { userId, emailEnabled } = await request.json();
    if (!userId || typeof emailEnabled !== 'boolean') {
      return serverError('Missing parameters', 400);
    }

    const access = await adminTargetProfile(request, supabase, String(userId));
    if (access.error) return serverError(access.error, access.status ?? 500);

    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('notification_preferences')
      .upsert({
        user_id: access.target.id,
        organization_id: access.target.organization_id ?? null,
        email_enabled: emailEnabled,
        email_admin_updated_at: now,
        email_admin_updated_by: access.actor.id,
        email_admin_action: emailEnabled ? 'enabled' : 'disabled',
        updated_at: now,
      }, { onConflict: 'user_id' })
      .select('user_id, organization_id, email_enabled, reserve_created_email, reserve_status_email, reserve_critical_email, reserve_overdue_email, email_admin_updated_at, email_admin_updated_by, email_admin_action')
      .single();
    if (error) throw error;
    return Response.json({ ok: true, user: access.target, preferences: data });
  } catch (err: any) {
    console.error('[admin-notification-preferences] POST:', err?.message ?? err);
    return serverError(err?.message ?? 'Server error');
  }
}
