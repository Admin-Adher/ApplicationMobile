import { supabaseBrowser } from './supabase-browser';

export const TEXT_LANG_OPTIONS = [
  { value: 'fr', label: 'FR', speech: 'fr-FR', name: 'français' },
  { value: 'en', label: 'EN', speech: 'en-US', name: 'anglais' },
  { value: 'es', label: 'ES', speech: 'es-ES', name: 'espagnol' },
] as const;

export type TextLang = typeof TEXT_LANG_OPTIONS[number]['value'];

export async function requestWebTranslation(params: { text: string; source?: TextLang | 'auto'; target: TextLang; context: string }) {
  const text = params.text.trim();
  if (!text || params.source === params.target) return text;
  const { data: authData } = await supabaseBrowser.auth.getSession();
  const response = await fetch('/api/translate-text', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(authData.session?.access_token ? { Authorization: `Bearer ${authData.session.access_token}` } : {}),
    },
    body: JSON.stringify(params),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.success || typeof payload?.text !== 'string' || !payload.text.trim()) {
    throw new Error(payload?.detail || payload?.error || 'Traduction indisponible.');
  }
  return String(payload.text).trim();
}

export function defaultTextLang(): TextLang {
  if (typeof window === 'undefined') return 'fr';
  let stored: string | null = null;
  try { stored = window.localStorage.getItem('buildtrack-web-dictation-lang'); } catch { /* Storage can be disabled. */ }
  if (stored === 'fr' || stored === 'en' || stored === 'es') return stored;
  const nav = window.navigator.language.toLowerCase();
  if (nav.startsWith('en')) return 'en';
  if (nav.startsWith('es')) return 'es';
  return 'fr';
}

export function appendDictationText(current: string, transcript: string) {
  const text = transcript.trim();
  if (!text) return current;
  const base = current.trimEnd();
  return base ? `${base} ${text}` : text;
}

export function speechRecognitionErrorMessage(error?: string) {
  switch (error) {
    case 'not-allowed':
    case 'service-not-allowed':
      return "Le micro ou la reconnaissance vocale est refusé pour ce site. Vérifiez l'autorisation micro dans le navigateur.";
    case 'audio-capture':
      return "Aucun micro utilisable n'a été détecté. Vérifiez le périphérique d'entrée audio.";
    case 'network':
      return "La reconnaissance vocale du navigateur est indisponible pour le moment. Elle nécessite une connexion stable et le service vocal de Chrome/Edge.";
    case 'no-speech':
    case 'speech-timeout':
      return "Aucune parole détectée. Relancez la dictée et parlez après l'activation du micro.";
    case 'language-not-supported':
      return "Cette langue de dictée n'est pas disponible dans ce navigateur.";
    case 'aborted':
      return 'Dictée arrêtée. Vous pouvez relancer le micro.';
    default:
      return 'Dictée interrompue. Relancez le micro ou vérifiez le périphérique audio.';
  }
}

