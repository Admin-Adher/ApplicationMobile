import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { processEmailJobs } from '@/lib/email-outbox';
import { createServiceClient } from '@/lib/server-auth';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const supplied = Buffer.from(req.headers.get('authorization') || '');
  const expected = Buffer.from(`Bearer ${secret || ''}`);
  if (!secret || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return NextResponse.json({ success: false }, { status: 401 });
  }
  try {
    const result = await processEmailJobs();
    const db = createServiceClient()!;
    const since = new Date(Date.now() - 15 * 60_000).toISOString();
    const [issues, backlog] = await Promise.all([
      db.from('transactional_email_outbox').select('id', { count: 'exact', head: true })
        .in('status', ['failed', 'uncertain', 'expired']).gte('updated_at', since),
      db.from('transactional_email_outbox').select('id', { count: 'exact', head: true })
        .in('status', ['pending', 'preparing', 'sending']).lt('created_at', new Date(Date.now() - 10 * 60_000).toISOString()),
    ]);
    if (issues.error || backlog.error) throw new Error('email_health_unavailable');
    const healthy = !issues.count && !backlog.count;
    return NextResponse.json({ success: true, ...result, healthy, recentIssues: issues.count, delayed: backlog.count }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch {
    console.error('[email-outbox]', JSON.stringify({ code: 'worker_unavailable' }));
    return NextResponse.json({ success: false, code: 'email_worker_unavailable' }, { status: 503 });
  }
}
