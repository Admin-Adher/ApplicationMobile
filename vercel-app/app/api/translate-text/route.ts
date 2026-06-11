import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit } from '@/lib/rateLimit';

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

type Lang = 'fr' | 'en' | 'es';
type SourceLang = Lang | 'auto';

const TRANSLATION_LANGS: Record<Lang, { name: string; deepl: string }> = {
  fr: { name: 'French', deepl: 'FR' },
  en: { name: 'English', deepl: 'EN-US' },
  es: { name: 'Spanish', deepl: 'ES' },
};

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
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function authenticatedProfile(req: NextRequest, supabase: any) {
  const auth = req.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
  if (!token) return null;
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  const userId = userData?.user?.id;
  if (userError || !userId) return null;
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, organization_id')
    .eq('id', userId)
    .maybeSingle();
  if (error || !profile) return null;
  return profile;
}

function sanitizeTranslationText(value: unknown) {
  return String(value ?? '')
    .replace(/\u0000/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function isLang(value: string): value is Lang {
  return value === 'fr' || value === 'en' || value === 'es';
}

function providerOrder() {
  return ['azure'];
}

function azureTranslatorUrl() {
  const endpoint = String(process.env.AZURE_TRANSLATOR_ENDPOINT || 'https://api.cognitive.microsofttranslator.com').trim();
  if (/\/translate(\?|$)/i.test(endpoint)) return endpoint;
  const base = endpoint.replace(/\/+$/, '');
  if (/\/translator\/text\/v3\.0$/i.test(base)) return `${base}/translate`;
  if (/cognitiveservices\.azure\.com/i.test(base)) return `${base}/translator/text/v3.0/translate`;
  return `${base}/translate`;
}

async function translateWithAzure(params: { text: string; source: SourceLang; target: Lang }) {
  const apiKey = process.env.AZURE_TRANSLATOR_KEY;
  if (!apiKey) throw new Error('AZURE_TRANSLATOR_KEY manquant cote serveur');
  const url = new URL(azureTranslatorUrl());
  if (!url.searchParams.has('api-version')) url.searchParams.set('api-version', '3.0');
  if (params.source !== 'auto' && params.source !== params.target) url.searchParams.set('from', params.source);
  url.searchParams.set('to', params.target);

  const headers: Record<string, string> = {
    'Ocp-Apim-Subscription-Key': apiKey,
    'Content-Type': 'application/json',
  };
  if (process.env.AZURE_TRANSLATOR_REGION) {
    headers['Ocp-Apim-Subscription-Region'] = process.env.AZURE_TRANSLATOR_REGION;
  }

  const response = await fetch(url.toString(), {
    method: 'POST',
    headers,
    body: JSON.stringify([{ Text: params.text }]),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || payload?.message || response.statusText);
  }
  return sanitizeTranslationText(payload?.[0]?.translations?.[0]?.text);
}

async function translateWithDeepL(params: { text: string; source: SourceLang; target: Lang }) {
  const apiKey = process.env.DEEPL_API_KEY;
  if (!apiKey) return null;
  const apiUrl = process.env.DEEPL_API_URL || (apiKey.endsWith(':fx')
    ? 'https://api-free.deepl.com/v2/translate'
    : 'https://api.deepl.com/v2/translate');
  const body = new URLSearchParams();
  body.set('text', params.text);
  body.set('target_lang', TRANSLATION_LANGS[params.target].deepl);
  if (params.source !== 'auto' && params.source !== params.target) body.set('source_lang', params.source.toUpperCase());
  body.set('preserve_formatting', '1');

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `DeepL-Auth-Key ${apiKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || response.statusText);
  return sanitizeTranslationText(payload?.translations?.[0]?.text);
}

async function translateWithOpenAI(params: { text: string; source: SourceLang; target: Lang; context: string }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const model = process.env.OPENAI_TRANSLATION_MODEL || 'gpt-4o-mini';
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 900,
      messages: [
        {
          role: 'system',
          content: [
            params.source === 'auto'
              ? `Detect the source language and translate to ${TRANSLATION_LANGS[params.target].name}.`
              : `Translate from ${TRANSLATION_LANGS[params.source].name} to ${TRANSLATION_LANGS[params.target].name}.`,
            'Use professional construction-site wording.',
            'Preserve IDs, names, building labels, levels, dates, line breaks, and bullet structure.',
            'Do not add explanations, comments, markdown, or quotation marks.',
            `Text context: ${params.context}.`,
          ].join(' '),
        },
        { role: 'user', content: params.text },
      ],
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error?.message || response.statusText);
  return sanitizeTranslationText(payload?.choices?.[0]?.message?.content);
}

async function translateAdvanced(params: { text: string; source: SourceLang; target: Lang; context: string }) {
  const providers: Record<string, (params: any) => Promise<string | null>> = {
    azure: translateWithAzure,
    deepl: translateWithDeepL,
    openai: translateWithOpenAI,
  };
  let lastError: unknown = null;
  for (const provider of providerOrder()) {
    try {
      const translated = await providers[provider]?.(params);
      if (translated) return { text: translated, provider };
    } catch (err: any) {
      lastError = err;
      console.warn(`[translate-text] ${provider} failed:`, err?.message ?? err);
    }
  }
  if (lastError) throw lastError;
  return null;
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(request) });
}

export async function POST(request: NextRequest) {
  const headers = corsHeaders(request);
  try {
    let rateKey = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
    if (process.env.TRANSLATION_REQUIRE_AUTH !== 'false') {
      const supabase = serviceClient();
      if (!supabase) {
        return NextResponse.json({ success: false, error: 'Configuration serveur manquante' }, { status: 503, headers });
      }
      const profile = await authenticatedProfile(request, supabase);
      if (!profile) {
        return NextResponse.json({ success: false, error: 'Session invalide' }, { status: 401, headers });
      }
      rateKey = profile.id;
    }

    const rate = checkRateLimit(`translate-text:${rateKey}`, 60, 60 * 1000);
    if (!rate.allowed) {
      return NextResponse.json(
        { success: false, error: 'Trop de requêtes. Réessayez plus tard.' },
        { status: 429, headers: { ...headers, 'Retry-After': String(rate.retryAfterSeconds) } }
      );
    }

    const body = await request.json().catch(() => ({}));
    const text = sanitizeTranslationText(body?.text);
    const source = String(body?.source || 'auto').toLowerCase();
    const target = String(body?.target || '').toLowerCase();
    const context = String(body?.context || 'generic');

    if (!text) return NextResponse.json({ success: false, error: 'Texte manquant' }, { status: 400, headers });
    if (text.length > 2500) return NextResponse.json({ success: false, error: 'Texte trop long' }, { status: 413, headers });
    if ((source !== 'auto' && !isLang(source)) || !isLang(target)) {
      return NextResponse.json({ success: false, error: 'Langue non supportee' }, { status: 400, headers });
    }
    if (source !== 'auto' && source === target) return NextResponse.json({ success: true, text, provider: 'none' }, { headers });

    const result = await translateAdvanced({ text, source, target, context });
    if (!result) {
      return NextResponse.json({ success: false, error: 'Aucun fournisseur de traduction configure' }, { status: 503, headers });
    }
    return NextResponse.json({ success: true, ...result }, { headers });
  } catch (err: any) {
    console.error('[translate-text] Exception:', err?.message || 'Erreur Azure inconnue');
    return NextResponse.json({ success: false, error: 'Traduction indisponible' }, { status: 502, headers });
  }
}
