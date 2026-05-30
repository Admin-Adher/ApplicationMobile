import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { PdfReportPayload } from '@/types/pdfReport';
import { buildGlobalReportHtml, buildGlobalReservesHtml, buildIndividualReserveHtml, buildVisitReportHtml } from '@/lib/reportBuilder';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

function bearerToken(req: NextRequest) {
  const auth = req.headers.get('authorization') ?? '';
  return auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
}

async function authenticatedAdmin(req: NextRequest) {
  const supabase = serviceClient();
  if (!supabase) return { error: 'SUPABASE_SERVICE_ROLE_KEY non configuree sur le serveur', status: 500 };

  const token = bearerToken(req);
  if (!token) return { error: 'Session admin invalide', status: 401 };

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  const userId = userData?.user?.id;
  if (userError || !userId) return { error: 'Session admin invalide', status: 401 };

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, role, organization_id')
    .eq('id', userId)
    .maybeSingle();
  if (error || !profile) return { error: 'Profil admin introuvable', status: 401 };
  if (profile.role !== 'admin' && profile.role !== 'super_admin') {
    return { error: 'Acces admin requis', status: 403 };
  }

  return { profile };
}

function renderUrl() {
  return (process.env.WEASYPRINT_POC_URL || process.env.WEASYPRINT_RENDER_URL || '').trim();
}

function targetLabel(url: string) {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url || null;
  }
}

function placeholderUrlError(url: string) {
  if (/ton-service-weasyprint|votre-service|example\.com/i.test(url)) {
    return "WEASYPRINT_POC_URL contient encore l'URL d'exemple. Deployeez le service WeasyPrint POC, puis remplacez cette valeur par l'URL reelle terminee par /render.";
  }
  return null;
}

function healthUrl() {
  const explicit = (process.env.WEASYPRINT_HEALTH_URL || '').trim();
  if (explicit) return explicit;
  const url = renderUrl();
  if (!url) return '';
  try {
    const parsed = new URL(url);
    parsed.pathname = parsed.pathname.replace(/\/render\/?$/, '/health');
    if (!/\/health\/?$/.test(parsed.pathname)) {
      parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/health`;
    }
    parsed.search = '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function looksLikeHtml(value: string, contentType?: string | null) {
  return /text\/html/i.test(contentType ?? '') || /^\s*<!doctype\s+html/i.test(value) || /^\s*<html[\s>]/i.test(value);
}

function serviceResponseError(status: number, body: string, contentType?: string | null) {
  if (looksLikeHtml(body, contentType)) {
    return `L'URL WeasyPrint configuree repond avec une page HTML (${status}), probablement une page 404 Next/Vercel. WEASYPRINT_POC_URL doit pointer vers le service Python WeasyPrint, par exemple https://votre-service/render.`;
  }
  if (status === 404 && /^not found\s*$/i.test(body.trim())) {
    return "Le service cible repond 404 Not Found. Verifiez que le service WeasyPrint POC est bien deploye et que WEASYPRINT_POC_URL finit par /render.";
  }
  return body.slice(0, 1200) || `Service WeasyPrint indisponible (${status})`;
}

function buildHtml(payload: any) {
  const type: string = payload.type ?? 'plans';
  if (type === 'global_reserves') {
    if (!payload.chantierName || !Array.isArray(payload.reserves)) {
      throw new Error('Payload invalide (global_reserves)');
    }
    return buildGlobalReservesHtml(payload);
  }
  if (type === 'individual_reserve') {
    if (!payload.reserve || !payload.chantierName) {
      throw new Error('Payload invalide (individual_reserve)');
    }
    return buildIndividualReserveHtml(payload);
  }
  if (type === 'visit_report') {
    if (!payload.chantierName || !payload.visit || !Array.isArray(payload.reserves)) {
      throw new Error('Payload invalide (visit_report)');
    }
    return buildVisitReportHtml(payload);
  }

  const plansPayload = payload as PdfReportPayload;
  if (!plansPayload.chantierName || !Array.isArray(plansPayload.reserves) || !Array.isArray(plansPayload.plans)) {
    throw new Error('Payload invalide (plans)');
  }
  return buildGlobalReportHtml(plansPayload);
}

function safeFilePart(value: unknown, fallback = 'weasyprint-poc') {
  return String(value ?? fallback)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || fallback;
}

function pdfFilename(payload: any) {
  const project = safeFilePart(payload?.chantierName, 'BuildTrack');
  const type = payload?.type === 'global_reserves' ? 'reserves' : payload?.type === 'individual_reserve' ? 'reserve' : payload?.type === 'visit_report' ? 'visite' : 'plans';
  const language = safeFilePart(payload?.language ?? 'fr', 'fr');
  return `BuildTrack_WeasyPrint_${type}_${project}_${language}.pdf`;
}

export async function GET(req: NextRequest) {
  const access = await authenticatedAdmin(req);
  if (access.error) return NextResponse.json({ success: false, error: access.error }, { status: access.status });

  const url = renderUrl();
  if (!url) {
    return NextResponse.json({
      success: true,
      configured: false,
      message: 'WEASYPRINT_POC_URL non configuree',
    });
  }
  const placeholderError = placeholderUrlError(url);
  if (placeholderError) {
    return NextResponse.json({
      success: true,
      configured: true,
      healthy: false,
      target: targetLabel(url),
      error: placeholderError,
    });
  }

  const health = healthUrl();
  if (!health) {
    return NextResponse.json({ success: true, configured: true, healthy: null, target: targetLabel(url) });
  }

  try {
    const response = await fetch(health, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    const body = await response.text();
    const contentType = response.headers.get('content-type');
    return NextResponse.json({
      success: true,
      configured: true,
      healthy: response.ok,
      status: response.status,
      target: targetLabel(url),
      health: response.ok && body ? body.slice(0, 1000) : null,
      error: response.ok ? null : serviceResponseError(response.status, body, contentType),
    });
  } catch (err: any) {
    return NextResponse.json({
      success: true,
      configured: true,
      healthy: false,
      target: targetLabel(url),
      error: err?.message ?? 'Service WeasyPrint injoignable',
    });
  }
}

export async function POST(req: NextRequest) {
  const access = await authenticatedAdmin(req);
  if (access.error) return NextResponse.json({ success: false, error: access.error }, { status: access.status });

  const url = renderUrl();
  if (!url) {
    return NextResponse.json({
      success: false,
      error: 'WEASYPRINT_POC_URL non configuree. Configurez l URL /render du service WeasyPrint POC.',
    }, { status: 503 });
  }
  const placeholderError = placeholderUrlError(url);
  if (placeholderError) {
    return NextResponse.json({ success: false, error: placeholderError }, { status: 503 });
  }

  try {
    const payload = await req.json();
    const html = buildHtml(payload);
    const filename = pdfFilename(payload);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ html, filename }),
      signal: AbortSignal.timeout(45000),
    });

    if (!response.ok) {
      const message = await response.text();
      const contentType = response.headers.get('content-type');
      return NextResponse.json({
        success: false,
        error: serviceResponseError(response.status, message, contentType),
      }, { status: 502 });
    }

    const contentType = response.headers.get('content-type');
    if (contentType && !/application\/pdf/i.test(contentType)) {
      const message = await response.text();
      return NextResponse.json({
        success: false,
        error: serviceResponseError(response.status, message, contentType),
      }, { status: 502 });
    }

    const pdfBuffer = Buffer.from(await response.arrayBuffer());
    return NextResponse.json({
      success: true,
      engine: 'weasyprint',
      filename,
      bytes: pdfBuffer.length,
      pdfBase64: pdfBuffer.toString('base64'),
    });
  } catch (err: any) {
    console.error('[lab/weasyprint] render error:', err?.message ?? err);
    const message = String(err?.message ?? '');
    const friendly = err?.name === 'TimeoutError' || /aborted|timeout/i.test(message)
      ? 'Rendu WeasyPrint trop long pour ce test. Relancez sans photos distantes ou avec un echantillon plus petit.'
      : message || 'Erreur WeasyPrint POC';
    return NextResponse.json(
      { success: false, error: friendly },
      { status: 500 }
    );
  }
}
