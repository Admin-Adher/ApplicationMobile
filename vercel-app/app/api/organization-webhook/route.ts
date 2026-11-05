import { NextResponse } from 'next/server';
import { authenticateRequest } from '@/lib/server-auth';
import { openOrganizationWebhook, parseOrganizationWebhook, sealOrganizationWebhook } from '@/lib/organization-webhook';

function json(value: object, status = 200) {
  return NextResponse.json(value, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

const PUBLIC_FIELDS = 'provider,updated_at,last_tested_at,last_sent_at';

export async function POST(request: Request) {
  const auth = await authenticateRequest(request);
  const org = auth?.authority.organizationId;
  if (!auth || !org || (!auth.authority.isPlatformAdmin && (auth.authority.role !== 'admin' || auth.authority.membershipStatus !== 'active'))) {
    return json({ error: 'Accès administrateur requis.' }, auth ? 403 : 401);
  }
  if (Number(request.headers.get('content-length')) > 8_000) return json({ error: 'Requête trop volumineuse.' }, 413);
  const raw = await request.text();
  if (raw.length > 8_000) return json({ error: 'Requête trop volumineuse.' }, 413);
  let input;
  try { input = JSON.parse(raw); } catch { return json({ error: 'Requête invalide.' }, 400); }
  if (!['read', 'save', 'remove', 'test', 'send'].includes(input?.action)) return json({ error: 'Action inconnue.' }, 400);

  const db = auth.supabase;
  const table = () => db.from('organization_webhook_connections');
  const secret = process.env.ORGANIZATION_WEBHOOK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return json({ error: 'Connecteur temporairement indisponible.' }, 503);
  if (input.action === 'read') {
    const { data, error } = await table().select(PUBLIC_FIELDS).eq('organization_id', org).maybeSingle();
    return error ? json({ error: 'Configuration indisponible.' }, 503) : json({ connection: data });
  }
  if (input.action === 'save') {
    const target = parseOrganizationWebhook(input.url);
    if (!target) return json({ error: 'Utilisez une URL de production HTTPS de Make ou n8n Cloud.' }, 400);
    const { data, error } = await table().upsert({
      organization_id: org, provider: target.provider, encrypted_url: sealOrganizationWebhook(target.url, org, secret),
      configured_by: auth.authority.userId, updated_at: new Date().toISOString(),
      last_attempted_at: null, last_tested_at: null, last_sent_at: null,
    }).select(PUBLIC_FIELDS).single();
    return error ? json({ error: 'Configuration impossible.' }, 503) : json({ connection: data });
  }
  if (input.action === 'remove') {
    const { error } = await table().delete().eq('organization_id', org);
    return error ? json({ error: 'Impossible de retirer le connecteur.' }, 503) : json({ connection: null });
  }

  const { data: config, error: configError } = await table().select('encrypted_url,last_attempted_at')
    .eq('organization_id', org).maybeSingle();
  if (configError) return json({ error: 'Configuration indisponible.' }, 503);
  if (!config) return json({ error: 'Configurez d’abord le webhook.' }, 409);
  const target = openOrganizationWebhook(config.encrypted_url, org, secret);
  if (!target) return json({ error: 'Enregistrez à nouveau l’URL du webhook.' }, 409);

  const sentAt = new Date().toISOString();
  let payload: Record<string, unknown> = { event: 'buildtrack.connection_test', sentAt };
  if (input.action === 'send') {
    if (typeof input.projectId !== 'string' || input.projectId.length > 160) return json({ error: 'Chantier invalide.' }, 400);
    const { data: project, error: projectError } = await db.from('chantiers').select('id,name')
      .eq('organization_id', org).eq('id', input.projectId).maybeSingle();
    if (projectError || !project) return json({ error: 'Chantier inaccessible.' }, 404);
    const reserveCount = (closed: boolean) => {
      const query = db.from('reserves').select('id', { head: true, count: 'exact' })
        .eq('organization_id', org).eq('chantier_id', project.id).is('archived_at', null).is('deleted_at', null);
      return closed ? query.eq('status', 'closed') : query.neq('status', 'closed');
    };
    const [active, closed] = await Promise.all([reserveCount(false), reserveCount(true)]);
    if (active.error || closed.error) return json({ error: 'Impossible de calculer le bilan.' }, 503);
    payload = {
      event: 'buildtrack.project_summary', sentAt,
      project: { id: project.id, name: project.name },
      reserves: { active: active.count ?? 0, closed: closed.count ?? 0 },
    };
  }

  if (config.last_attempted_at && Date.now() - Date.parse(config.last_attempted_at) < 8_000) {
    return json({ error: 'Attendez quelques secondes avant de réessayer.' }, 429);
  }
  let claim = table().update({ last_attempted_at: sentAt }).eq('organization_id', org).eq('encrypted_url', config.encrypted_url);
  claim = config.last_attempted_at ? claim.eq('last_attempted_at', config.last_attempted_at) : claim.is('last_attempted_at', null);
  const { data: claimed, error: claimError } = await claim.select('organization_id').maybeSingle();
  if (claimError || !claimed) return json({ error: 'Le connecteur a changé. Réessayez.' }, 409);

  try {
    const response = await fetch(target.url, {
      method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(10_000), cache: 'no-store',
    });
    void response.body?.cancel().catch(() => {});
    if (!response.ok) return json({ error: 'Le fournisseur a répondu avec le statut ' + response.status + '.' }, 502);
  } catch {
    return json({ error: 'Le fournisseur n’a pas confirmé la réception.' }, 502);
  }
  const { data: connection, error: updateError } = await table().update(
    input.action === 'test' ? { last_tested_at: sentAt } : { last_sent_at: sentAt },
  ).eq('organization_id', org).eq('encrypted_url', config.encrypted_url).select(PUBLIC_FIELDS).maybeSingle();
  if (updateError || !connection) return json({ error: 'Le fournisseur a reçu la requête. Rechargez la configuration.' }, 409);
  return json({ connection });
}
