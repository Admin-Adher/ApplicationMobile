import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/server-auth';
import { checkRateLimit } from '@/lib/rateLimit';
import { browserPushEndpoint, browserPushEndpointHash, browserPushVapid, parseBrowserPushSubscription } from '@/lib/web-push';

export const runtime = 'nodejs';

function json(value: object, status = 200) {
  return NextResponse.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  const org = auth?.authority.organizationId;
  if (!auth || !org || auth.authority.membershipStatus !== 'active') return json({ error: 'Session d’organisation requise.' }, 401);
  const user = auth.authority.userId;
  if (!checkRateLimit(`browser-push:${user}`, 30, 60_000).allowed) return json({ error: 'Attendez avant de réessayer.' }, 429);
  if (Number(request.headers.get('content-length')) > 4096) return json({ error: 'Requête trop volumineuse.' }, 413);
  const body = await request.text();
  if (body.length > 4096) return json({ error: 'Requête trop volumineuse.' }, 413);
  let input;
  try { input = JSON.parse(body); } catch { return json({ error: 'Requête invalide.' }, 400); }
  const table = () => auth.supabase.from('web_push_subscriptions');
  if (input?.action === 'remove') {
    const endpoint = browserPushEndpoint(input.endpoint);
    if (!endpoint) return json({ error: 'Abonnement invalide.' }, 400);
    const { error } = await table().delete().eq('endpoint_hash', browserPushEndpointHash(endpoint)).eq('user_id', user).eq('organization_id', org);
    return error ? json({ error: 'Impossible de retirer cet abonnement.' }, 503) : json({ ok: true });
  }
  const vapid = browserPushVapid();
  if (!vapid) return json({ error: 'Les notifications navigateur ne sont pas encore configurées sur le serveur.' }, 503);
  if (input?.action === 'config') return json({ publicKey: vapid.publicKey });
  if (input?.action !== 'save') return json({ error: 'Action inconnue.' }, 400);
  const subscription = parseBrowserPushSubscription(input.subscription);
  if (!subscription) return json({ error: 'Abonnement navigateur non pris en charge.' }, 400);
  const { error } = await table().upsert({
    endpoint_hash: browserPushEndpointHash(subscription.endpoint), user_id: user, organization_id: org,
    subscription, updated_at: new Date().toISOString(),
  });
  return error ? json({ error: 'Impossible d’enregistrer cet abonnement.' }, 503) : json({ ok: true });
}
