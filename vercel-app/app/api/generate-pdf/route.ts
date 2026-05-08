import { NextRequest, NextResponse } from 'next/server';
import type { PdfReportPayload } from '@/types/pdfReport';
import { buildGlobalReportHtml } from '@/lib/reportBuilder';
import { sendEmail } from '@/lib/sender';

export const maxDuration = 60;

const ALLOWED_ORIGINS = [
  'https://buildtrack-mobile.vercel.app',
  'http://localhost:5000',
  'http://localhost:3000',
];

function corsHeaders(origin: string) {
  const o = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': o,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get('origin') ?? '';
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin') ?? '';
  const headers = corsHeaders(origin);

  try {
    const payload: PdfReportPayload = await req.json();

    if (!payload.chantierName || !Array.isArray(payload.reserves)) {
      return NextResponse.json(
        { success: false, error: 'Payload invalide' },
        { status: 400, headers }
      );
    }

    const html = buildGlobalReportHtml(payload);

    let chromium: typeof import('@sparticuz/chromium-min');
    let puppeteer: typeof import('puppeteer-core');

    try {
      chromium = (await import('@sparticuz/chromium-min')).default as any;
      puppeteer = (await import('puppeteer-core')).default as any;
    } catch (importErr: any) {
      console.error('[generate-pdf] Import error:', importErr?.message);
      return NextResponse.json(
        { success: false, error: 'Puppeteer non disponible sur ce runtime' },
        { status: 503, headers }
      );
    }

    const chromiumUrl =
      process.env.CHROMIUM_PACK_URL ??
      'https://github.com/Sparticuz/chromium/releases/download/v123.0.0/chromium-v123.0.0-pack.tar';

    const executablePath = await (chromium as any).executablePath(chromiumUrl);

    const browser = await (puppeteer as any).launch({
      args: (chromium as any).args,
      defaultViewport: (chromium as any).defaultViewport,
      executablePath,
      headless: true,
    });

    const page = await browser.newPage();

    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });

    const pdfBuffer: Buffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '15mm', bottom: '15mm', left: '12mm', right: '12mm' },
    });

    await browser.close();

    if (payload.sendByEmail && payload.recipients.length > 0) {
      const dateStr = new Date(payload.generatedAt).toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
      });
      const companyLabel = payload.companyFilter ?? 'Toutes les entreprises';
      const count = payload.reserves.length;
      const filename = `Rapport_${payload.chantierName.replace(/[^a-zA-Z0-9À-ÿ _-]/g, '_')}_${dateStr}.pdf`;

      const emailHtml = `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b">
          <div style="background:#003082;padding:24px 32px;border-radius:8px 8px 0 0">
            <div style="color:#fff;font-size:20px;font-weight:700">Rapport des réserves</div>
            <div style="color:rgba(255,255,255,0.75);font-size:13px;margin-top:4px">
              ${payload.chantierName} · ${companyLabel}
            </div>
          </div>
          <div style="background:#f8fafc;padding:24px 32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
            <p style="margin:0 0 16px 0">Bonjour,</p>
            <p style="margin:0 0 16px 0">
              Veuillez trouver ci-joint le rapport des réserves pour le chantier
              <strong>${payload.chantierName}</strong> (${companyLabel}),
              généré le ${dateStr}.
            </p>
            <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0;text-align:center">
              <div style="font-size:32px;font-weight:800;color:#003082">${count}</div>
              <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px">
                réserve${count !== 1 ? 's' : ''} exportée${count !== 1 ? 's' : ''}
              </div>
            </div>
            <p style="margin:16px 0 0 0;color:#64748b;font-size:12px">— BuildTrack</p>
          </div>
        </div>`;

      await Promise.allSettled(
        payload.recipients.map((to: string) =>
          sendEmail({
            to,
            subject: `Rapport des réserves — ${payload.chantierName} (${companyLabel})`,
            html: emailHtml,
            attachments: [
              {
                filename,
                content: Buffer.from(pdfBuffer),
                contentType: 'application/pdf',
              },
            ],
          })
        )
      );
    }

    const pdfBase64 = Buffer.from(pdfBuffer).toString('base64');
    return NextResponse.json({ success: true, pdfBase64 }, { headers });
  } catch (err: any) {
    console.error('[generate-pdf] Erreur:', err?.message ?? err);
    return NextResponse.json(
      { success: false, error: err?.message ?? 'Erreur serveur' },
      { status: 500, headers }
    );
  }
}
