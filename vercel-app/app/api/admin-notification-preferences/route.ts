import { NextRequest, NextResponse } from 'next/server';
import { authenticateRequest, createServiceClient, getOrganizationUser } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

function corsHeaders(req: NextRequest) {
  const origin = req.headers.get('origin') ?? '';
  const allowed = [
    process.env.EXPO_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    'https://buildtrack-mobile.vercel.app',
    'http://localhost:5000',
    'http://localhost:3000',
  ].filter(Boolean) as string[];
  const corsOrigin = allowed.includes(origin) ? origin : allowed[0] ?? '*';
  return {
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function json(req: NextRequest, body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: corsHeaders(req) });
}

function serviceClient() {
  return createServiceClient();
}

function friendlyDatabaseError(message: string) {
  if (/email_admin_|schema cache|PGRST204/i.test(message)) {
    return "Migration Supabase manquante : appliquez 05_add_notification_preferences_admin_email_marker.sql puis relancez l'action.";
  }
  return message || 'Erreur serveur';
}

async function adminTargetProfile(req: NextRequest, supabase: any, targetUserId: string) {
  const auth = await authenticateRequest(req, supabase);
  if (!auth) return { status: 401, error: 'Session admin invalide' };
  const actor = auth.authority;
  if (!actor.isPlatformAdmin && actor.role !== 'admin' && actor.role !== 'super_admin') {
    return { status: 403, error: 'Acces admin requis' };
  }
  let targetOrganizationId = actor.organizationId;
  if (actor.isPlatformAdmin) {
    const { data: membership, error } = await supabase
      .from('organization_memberships')
      .select('organization_id')
      .eq('user_id', targetUserId)
      .eq('status', 'active')
      .order('is_primary', { ascending: false })
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !membership?.organization_id) return { status: 404, error: 'Utilisateur introuvable' };
    targetOrganizationId = membership.organization_id;
  }
  if (!targetOrganizationId) return { status: 403, error: 'Organisation active requise' };
  const member = await getOrganizationUser(supabase, targetOrganizationId, targetUserId, true);
  if (!member) return { status: 404, error: 'Utilisateur introuvable' };
  const target = {
    id: member.id,
    name: member.name,
    email: member.email,
    role: member.role,
    organization_id: member.organizationId,
  };
  if (!actor.isPlatformAdmin && target.organization_id !== actor.organizationId) {
    return { status: 403, error: 'Utilisateur hors organisation' };
  }
  if (!actor.isPlatformAdmin && actor.role === 'admin' && (target.role === 'admin' || target.role === 'super_admin')) {
    return { status: 403, error: 'Modification reservee au super administrateur' };
  }
  return {
    actor: { id: actor.userId, role: actor.role, organization_id: actor.organizationId },
    target,
  };
}

const PREFERENCE_SELECT = [
  'user_id',
  'organization_id',
  'email_enabled',
  'reserve_created_email',
  'reserve_status_email',
  'reserve_critical_email',
  'reserve_overdue_email',
  'email_admin_updated_at',
  'email_admin_updated_by',
  'email_admin_action',
].join(', ');

async function getPreferences(supabase: any, profile: any) {
  const { data, error } = await supabase
    .from('notification_preferences')
    .select(PREFERENCE_SELECT)
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
    .select(PREFERENCE_SELECT)
    .single();
  if (insertError) throw insertError;
  return inserted;
}

export function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function GET(req: NextRequest) {
  const supabase = serviceClient();
  if (!supabase) {
    return json(req, { error: 'SUPABASE_SERVICE_ROLE_KEY non configuree sur Vercel' }, 500);
  }

  try {
    const userId = new URL(req.url).searchParams.get('userId')?.trim();
    if (!userId) return json(req, { error: 'userId manquant' }, 400);

    const access = await adminTargetProfile(req, supabase, userId);
    if (access.error) return json(req, { error: access.error }, access.status ?? 500);
    if (!access.target) return json(req, { error: 'Utilisateur introuvable' }, 404);

    const preferences = await getPreferences(supabase, access.target);
    return json(req, { ok: true, user: access.target, preferences });
  } catch (err: any) {
    const message = friendlyDatabaseError(err?.message ?? 'Erreur serveur');
    console.error('[admin-notification-preferences] GET:', message);
    return json(req, { error: message }, 500);
  }
}

export async function POST(req: NextRequest) {
  const supabase = serviceClient();
  if (!supabase) {
    return json(req, { error: 'SUPABASE_SERVICE_ROLE_KEY non configuree sur Vercel' }, 500);
  }

  try {
    const { userId, emailEnabled } = await req.json();
    if (!userId || typeof emailEnabled !== 'boolean') {
      return json(req, { error: 'Parametres manquants' }, 400);
    }

    const access = await adminTargetProfile(req, supabase, String(userId));
    if (access.error) return json(req, { error: access.error }, access.status ?? 500);
    if (!access.target || !access.actor) return json(req, { error: 'Utilisateur introuvable' }, 404);

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
      .select(PREFERENCE_SELECT)
      .single();
    if (error) throw error;

    return json(req, { ok: true, user: access.target, preferences: data });
  } catch (err: any) {
    const message = friendlyDatabaseError(err?.message ?? 'Erreur serveur');
    console.error('[admin-notification-preferences] POST:', message);
    return json(req, { error: message }, 500);
  }
}
