import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/server-auth';
import { deleteR2Object } from '@/lib/r2';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }
  const supabase = createServiceClient();
  if (!supabase) return NextResponse.json({ error: 'Configuration serveur manquante' }, { status: 503 });

  const { data, error } = await supabase.rpc('server_claim_media_gc_candidates', { p_limit: 100 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const stats = { claimed: (data ?? []).length, deleted: 0, failed: 0 };
  for (const asset of data ?? []) {
    let deleted = false;
    if (asset.provider === 'r2') {
      deleted = (await deleteR2Object(asset.object_key)).ok;
    } else {
      const result = await supabase.storage.from(asset.bucket).remove([asset.object_key]);
      deleted = !result.error;
    }
    if (!deleted) {
      stats.failed += 1;
      continue;
    }
    const { data: marked, error: markError } = await supabase.rpc('server_mark_media_deleted', {
      p_asset_id: asset.asset_id,
    });
    if (markError || marked !== true) stats.failed += 1;
    else stats.deleted += 1;
  }
  return NextResponse.json({ ok: stats.failed === 0, stats }, {
    headers: { 'Cache-Control': 'private, no-store' },
  });
}
