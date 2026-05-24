import { NextRequest, NextResponse } from 'next/server';
import type { PdfReportPayload } from '@/types/pdfReport';
import { buildGlobalReportHtml, buildGlobalReservesHtml, buildIndividualReserveHtml } from '@/lib/reportBuilder';
import { sendEmail } from '@/lib/sender';
import { getReserveStatusLabel } from '@/lib/reserveLabels';
import { createClient } from '@supabase/supabase-js';
import { normalizeEmailLanguage, type EmailLanguage } from '@/lib/templates';

export const maxDuration = 60;

const ALLOWED_ORIGINS = [
  'https://buildtrack-mobile.vercel.app',
  'http://localhost:5000',
  'http://localhost:3000',
];

function safePdfFilePart(value: unknown, fallback = 'document'): string {
  const cleaned = String(value ?? fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/['\u2019`]/g, '')
    .replace(/&/g, ' et ')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
    .replace(/^_+|_+$/g, '');
  return cleaned || fallback;
}

function buildPdfFilename(type: string, parts: unknown[] = []): string {
  const segments = [type, ...parts]
    .map(part => safePdfFilePart(part, ''))
    .filter(Boolean);
  return `${segments.length > 0 ? segments.join('_') : 'Document'}.pdf`;
}

function corsHeaders(origin: string) {
  const o = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': o,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function resolveRecipientLanguage(email: string, fallback?: string | null): Promise<EmailLanguage> {
  const supabase = getServiceClient();
  const normalizedEmail = String(email ?? '').trim().toLowerCase();
  if (!supabase || !normalizedEmail) return normalizeEmailLanguage(fallback);
  const { data, error } = await supabase
    .from('profiles')
    .select('preferred_language')
    .eq('email', normalizedEmail)
    .maybeSingle();
  if (error) {
    console.warn('[generate-pdf] preferred_language indisponible:', error.message);
    return normalizeEmailLanguage(fallback);
  }
  return normalizeEmailLanguage(data?.preferred_language ?? fallback);
}

const PDF_EMAIL_COPY = {
  fr: {
    hello: 'Bonjour,',
    individualTitle: 'Fiche de réserve',
    individualSubject: (title: string, chantier: string) => `Fiche réserve — ${title} (${chantier})`,
    individualIntro: (title: string) => `Veuillez trouver ci-joint la fiche de réserve <strong>${title}</strong>.`,
    status: 'Statut',
    building: 'Bâtiment',
    level: 'Niveau',
    allCompanies: 'Toutes les entreprises',
    reportSubject: (kind: string, chantier: string, company: string) => `Rapport des ${kind} — ${chantier} (${company})`,
    reportTitle: (kind: string) => `Rapport des ${kind}`,
    reportIntro: (kind: string, chantier: string, company: string, date: string) => `Veuillez trouver ci-joint le rapport des ${kind} pour <strong>${chantier}</strong> (${company}), généré le ${date}.`,
    reserveCount: (count: number) => `réserve${count !== 1 ? 's' : ''} exportée${count !== 1 ? 's' : ''}`,
    reservesKind: 'réserves',
    plansKind: 'plans',
  },
  en: {
    hello: 'Hello,',
    individualTitle: 'Issue sheet',
    individualSubject: (title: string, chantier: string) => `Issue sheet — ${title} (${chantier})`,
    individualIntro: (title: string) => `Please find attached the issue sheet for <strong>${title}</strong>.`,
    status: 'Status',
    building: 'Building',
    level: 'Level',
    allCompanies: 'All companies',
    reportSubject: (kind: string, chantier: string, company: string) => `${kind} report — ${chantier} (${company})`,
    reportTitle: (kind: string) => `${kind} report`,
    reportIntro: (kind: string, chantier: string, company: string, date: string) => `Please find attached the ${kind.toLowerCase()} report for <strong>${chantier}</strong> (${company}), generated on ${date}.`,
    reserveCount: (count: number) => `${count === 1 ? 'issue' : 'issues'} exported`,
    reservesKind: 'Issues',
    plansKind: 'Plans',
  },
  es: {
    hello: 'Hola,',
    individualTitle: 'Ficha de reserva',
    individualSubject: (title: string, chantier: string) => `Ficha de reserva — ${title} (${chantier})`,
    individualIntro: (title: string) => `Adjuntamos la ficha de reserva <strong>${title}</strong>.`,
    status: 'Estado',
    building: 'Edificio',
    level: 'Nivel',
    allCompanies: 'Todas las empresas',
    reportSubject: (kind: string, chantier: string, company: string) => `Informe de ${kind} — ${chantier} (${company})`,
    reportTitle: (kind: string) => `Informe de ${kind}`,
    reportIntro: (kind: string, chantier: string, company: string, date: string) => `Adjuntamos el informe de ${kind} para <strong>${chantier}</strong> (${company}), generado el ${date}.`,
    reserveCount: (count: number) => `${count === 1 ? 'reserva exportada' : 'reservas exportadas'}`,
    reservesKind: 'reservas',
    plansKind: 'planos',
  },
} as const;

const PDF_LOCALES: Record<EmailLanguage, string> = {
  fr: 'fr-FR',
  en: 'en-GB',
  es: 'es-ES',
};

const STATUS_LABELS: Record<EmailLanguage, Record<string, string>> = {
  fr: {},
  en: { open: 'Open', in_progress: 'In progress', waiting: 'Pending', verification: 'Verification', closed: 'Closed' },
  es: { open: 'Abierta', in_progress: 'En curso', waiting: 'En espera', verification: 'Verificación', closed: 'Cerrada' },
};

function reserveStatusForEmail(status: string | undefined, language: EmailLanguage) {
  if (language === 'fr') return getReserveStatusLabel(status, true);
  return STATUS_LABELS[language][status ?? ''] ?? status ?? '—';
}

export async function OPTIONS(req: NextRequest) {
  const origin = req.headers.get('origin') ?? '';
  return new NextResponse(null, { status: 204, headers: corsHeaders(origin) });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin') ?? '';
  const headers = corsHeaders(origin);

  try {
    const payload = await req.json();
    const type: string = payload.type ?? 'plans';

    let html: string;

    if (type === 'global_reserves') {
      if (!payload.chantierName || !Array.isArray(payload.reserves)) {
        return NextResponse.json(
          { success: false, error: 'Payload invalide (global_reserves)' },
          { status: 400, headers }
        );
      }
      html = buildGlobalReservesHtml(payload);
    } else if (type === 'individual_reserve') {
      if (!payload.reserve || !payload.chantierName) {
        return NextResponse.json(
          { success: false, error: 'Payload invalide (individual_reserve)' },
          { status: 400, headers }
        );
      }
      html = buildIndividualReserveHtml(payload);
    } else {
      const plansPayload = payload as PdfReportPayload;
      if (!plansPayload.chantierName || !Array.isArray(plansPayload.reserves) || !Array.isArray(plansPayload.plans)) {
        return NextResponse.json(
          { success: false, error: 'Payload invalide (plans)' },
          { status: 400, headers }
        );
      }
      html = buildGlobalReportHtml(plansPayload);
    }

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

    if (payload.sendByEmail && Array.isArray(payload.recipients) && payload.recipients.length > 0) {
      await Promise.allSettled(
        (payload.recipients as string[]).map(async (to: string) => {
          const language = await resolveRecipientLanguage(to, payload.language);
          const copy = PDF_EMAIL_COPY[language];
          const dateStr = new Date(payload.generatedAt || Date.now()).toLocaleDateString(PDF_LOCALES[language], {
            day: '2-digit',
            month: 'long',
            year: 'numeric',
          });

          let filename: string;
          let subject: string;
          let emailHtml: string;

          if (type === 'individual_reserve') {
            const r = payload.reserve;
            const title = r.title || r.id;
            filename = buildPdfFilename('Reserve', [(r.id as string) || 'reserve', r.title, payload.chantierName]);
            subject = copy.individualSubject(title, payload.chantierName);
            const sLabel = reserveStatusForEmail(r.status, language);
            emailHtml = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b">
              <div style="background:#003082;padding:24px 32px;border-radius:8px 8px 0 0">
                <div style="color:#fff;font-size:20px;font-weight:700">${copy.individualTitle}</div>
                <div style="color:rgba(255,255,255,0.75);font-size:13px;margin-top:4px">${payload.chantierName}</div>
              </div>
              <div style="background:#f8fafc;padding:24px 32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
                <p style="margin:0 0 16px 0">${copy.hello}</p>
                <p style="margin:0 0 16px 0">${copy.individualIntro(title)}</p>
                <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0">
                  <div style="font-size:13px;color:#64748b">${copy.status} : <strong>${sLabel}</strong></div>
                  <div style="font-size:13px;color:#64748b;margin-top:4px">${copy.building} : <strong>${r.building || '—'}</strong> · ${copy.level} : <strong>${r.level || '—'}</strong></div>
                </div>
                <p style="margin:16px 0 0 0;color:#64748b;font-size:12px">— BuildTrack</p>
              </div>
            </div>`;
          } else {
            const companyFilter = payload.companyFilter as string | null;
            const companyLabel = companyFilter ?? copy.allCompanies;
            const count = Array.isArray(payload.reserves) ? (payload.reserves as any[]).length : 0;
            const companyPart = companyFilter ? companyLabel : null;
            filename = buildPdfFilename(type === 'global_reserves' ? 'Rapport_Reserves' : 'Rapport_Plans', [
              payload.chantierName,
              companyPart,
            ]);
            const reportKind = type === 'global_reserves' ? copy.reservesKind : copy.plansKind;
            subject = copy.reportSubject(reportKind, payload.chantierName, companyLabel);
            emailHtml = `<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#1e293b">
              <div style="background:#003082;padding:24px 32px;border-radius:8px 8px 0 0">
                <div style="color:#fff;font-size:20px;font-weight:700">${copy.reportTitle(reportKind)}</div>
                <div style="color:rgba(255,255,255,0.75);font-size:13px;margin-top:4px">${payload.chantierName} · ${companyLabel}</div>
              </div>
              <div style="background:#f8fafc;padding:24px 32px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
                <p style="margin:0 0 16px 0">${copy.hello}</p>
                <p style="margin:0 0 16px 0">${copy.reportIntro(reportKind, payload.chantierName, companyLabel, dateStr)}</p>
                <div style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;padding:16px;margin:16px 0;text-align:center">
                  <div style="font-size:32px;font-weight:800;color:#003082">${count}</div>
                  <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px">${copy.reserveCount(count)}</div>
                </div>
                <p style="margin:16px 0 0 0;color:#64748b;font-size:12px">— BuildTrack</p>
              </div>
            </div>`;
          }

          return sendEmail({
            to,
            subject,
            html: emailHtml,
            attachments: [
              {
                filename,
                content: Buffer.from(pdfBuffer),
                contentType: 'application/pdf',
              },
            ],
          });
        })
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