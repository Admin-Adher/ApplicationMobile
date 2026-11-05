import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { authenticateRequest, createServiceClient } from '@/lib/server-auth';
import { buildOprSignature, issueOprAccess, verifyOprAccess } from '@/lib/opr-signature';

type Signer = { id: string; name: string; role?: string; email?: string; signed?: boolean; signedAt?: string };
const ISSUER_ROLES = new Set(['admin', 'conducteur', 'chef_equipe', 'super_admin']);
const SELECT = 'id,organization_id,title,date,building,level,zone,status,items,signatories,visit_contradictoire,opr_revision';

function json(body: object, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } });
}

function signerVersion(signer: Signer, opr: { title: string; date: string; building: string; level: string; zone: string | null; visit_contradictoire: string | null; items: unknown }) {
  return createHash('sha256').update(JSON.stringify([signer.id, signer.name, signer.email ?? '', signer.role ?? '', opr.title, opr.date, opr.building, opr.level, opr.zone, opr.visit_contradictoire, opr.items])).digest('base64url');
}

export async function POST(request: Request) {
  if (Number(request.headers.get('content-length')) > 120_000) return json({ error: 'Signature trop volumineuse.' }, 413);
  const raw = await request.text();
  if (raw.length > 120_000) return json({ error: 'Signature trop volumineuse.' }, 413);
  let input;
  try { input = JSON.parse(raw); } catch { return json({ error: 'Requête invalide.' }, 400); }
  const id = input?.oprId;
  const action = input?.action;
  if (typeof id !== 'string' || !/^[a-z0-9_-]{1,100}$/i.test(id) || !['issue', 'read', 'sign'].includes(action)) {
    return json({ error: 'Requête invalide.' }, 400);
  }
  const service = createServiceClient();
  const secret = process.env.OPR_SIGNATURE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!service || !secret) return json({ error: 'Signature temporairement indisponible.' }, 503);
  const issuer = action === 'issue' ? await authenticateRequest(request, service) : null;
  if (action === 'issue' && (!issuer || (!issuer.authority.isPlatformAdmin && (
    !ISSUER_ROLES.has(issuer.authority.role) || issuer.authority.membershipStatus !== 'active'
    || issuer.authority.permissionsOverride.canEdit === false
  )))) return json({ error: 'Accès refusé.' }, issuer ? 403 : 401);
  const access = action !== 'issue' ? verifyOprAccess(input.token, id, secret) : null;
  if (action !== 'issue' && !access) return json({ error: 'Lien de signature invalide ou expiré.' }, 403);

  const { data: opr, error } = await service.from('oprs').select(SELECT).eq('id', id).maybeSingle();
  if (error) return json({ error: 'Impossible de charger le procès-verbal.' }, 503);
  if (!opr || (issuer && !issuer.authority.isPlatformAdmin && opr.organization_id !== issuer.authority.organizationId)) {
    return json({ error: 'Procès-verbal inaccessible.' }, 404);
  }
  const signatories: Signer[] = Array.isArray(opr.signatories) ? opr.signatories : [];
  const signerId = access?.signerId ?? input.signerId;
  const signer = signatories.find(item => item && item.id === signerId && typeof item.name === 'string');
  if (!signer || (access && signerVersion(signer, opr) !== access.signerVersion)) {
    return json({ error: 'Signataire inaccessible.' }, 404);
  }
  const signed = signer.signed === true || Boolean(signer.signedAt);
  if (action === 'issue') {
    if (signed || opr.status === 'signed') return json({ error: 'Le procès-verbal ou ce signataire est déjà signé.' }, 409);
    return json({ token: issueOprAccess({ oprId: id, signerId, signerVersion: signerVersion(signer, opr) }, secret) });
  }
  if (action === 'read') {
    const items = Array.isArray(opr.items) ? opr.items : [];
    return json({
      title: opr.title, date: opr.date, location: [opr.building, opr.level, opr.zone].filter(Boolean).join(' · '),
      visitDate: opr.visit_contradictoire, signerName: signer.name,
      signed, finished: opr.status === 'signed',
      items: items.map(item => ({ name: item?.lotName || item?.lot_name, status: item?.status, description: item?.description })),
    });
  }
  if (signed) return json({ signed: true });
  if (opr.status === 'signed') return json({ error: 'Le procès-verbal est déjà finalisé.' }, 409);
  const signature = buildOprSignature(input.strokes);
  if (!signature) return json({ error: 'Tracez une signature avant de valider.' }, 400);

  const signedAt = new Date().toISOString();
  const next = signatories.map(item => item.id === signer.id ? { ...item, signed: true, signedAt, signature, signatureSource: 'web_link' } : item);
  const allSigned = next.every(item => item.signed || item.signedAt);
  const { data: updated, error: writeError } = await service.from('oprs').update({
    signatories: next,
    status: allSigned ? 'signed' : 'in_progress',
    ...(allSigned ? { signed_at: signedAt } : {}),
  }).eq('id', id).eq('opr_revision', opr.opr_revision).select('id').maybeSingle();
  if (writeError) return json({ error: 'Impossible d’enregistrer la signature.' }, 503);
  if (!updated) return json({ error: 'Le procès-verbal a changé. Rechargez la page avant de signer.' }, 409);
  return json({ signed: true });
}
