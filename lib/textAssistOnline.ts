import { TextAssistContext, TextAssistLanguage } from '@/lib/textAssist';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

type AdvancedTranslationRequest = {
  text: string;
  target: TextAssistLanguage;
  source: TextAssistLanguage;
  context?: TextAssistContext;
  timeoutMs?: number;
};

export type AdvancedTranslationResult = {
  text: string;
  provider: string;
};

function getBaseApiUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return process.env.EXPO_PUBLIC_API_URL || process.env.EXPO_PUBLIC_APP_URL || '';
}

async function getAccessToken(): Promise<string | null> {
  if (!isSupabaseConfigured) return null;
  try {
    const { data } = await (supabase as any).auth.getSession();
    return data?.session?.access_token ?? null;
  } catch {
    return null;
  }
}

export async function requestAdvancedTranslation({
  text,
  target,
  source,
  context = 'generic',
  timeoutMs = 6500,
}: AdvancedTranslationRequest): Promise<AdvancedTranslationResult | null> {
  const base = getBaseApiUrl();
  if (!base || !text.trim() || source === target) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const accessToken = await getAccessToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    const response = await fetch(`${base}/api/translate-text`, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        text,
        target,
        source,
        context,
      }),
    });

    if (!response.ok) return null;
    const payload = await response.json().catch(() => null);
    const translated = typeof payload?.text === 'string' ? payload.text.trim() : '';
    if (!translated) return null;
    return {
      text: translated,
      provider: typeof payload?.provider === 'string' ? payload.provider : 'online',
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
