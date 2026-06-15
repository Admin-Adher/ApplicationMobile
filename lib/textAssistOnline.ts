import { TextAssistContext, TextAssistLanguage } from '@/lib/textAssist';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';
import i18n from '@/lib/i18n';

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

export class AdvancedTranslationError extends Error {
  status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'AdvancedTranslationError';
    this.status = status;
  }
}

function getBaseApiUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return (process.env.EXPO_PUBLIC_API_URL || process.env.EXPO_PUBLIC_APP_URL || '').replace(/\/$/, '');
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
  if (!text.trim()) return null;
  if (source === target) return { text, provider: 'none' };
  if (!base) {
    throw new AdvancedTranslationError(i18n.t('textAssistOnline.missingApiUrl'));
  }

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

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const errorMessage =
        typeof payload?.detail === 'string' ? payload.detail :
        typeof payload?.error === 'string' ? payload.error :
        i18n.t('textAssistOnline.apiError', { status: response.status });
      throw new AdvancedTranslationError(errorMessage, response.status);
    }
    const translated = typeof payload?.text === 'string' ? payload.text.trim() : '';
    if (!translated) {
      throw new AdvancedTranslationError(i18n.t('textAssistOnline.emptyResponse'));
    }
    return {
      text: translated,
      provider: typeof payload?.provider === 'string' ? payload.provider : 'online',
    };
  } catch (err: any) {
    if (err instanceof AdvancedTranslationError) throw err;
    if (err?.name === 'AbortError') {
      throw new AdvancedTranslationError(i18n.t('textAssistOnline.timeout'));
    }
    throw new AdvancedTranslationError(i18n.t('textAssistOnline.unreachable'));
  } finally {
    clearTimeout(timer);
  }
}
