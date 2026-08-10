/**
 * Canonical server origin used by the Expo mobile app and Expo web build.
 * A configured API origin always wins over window.location.origin so a
 * static web bundle cannot fall back to legacy Expo API routes.
 */
export function canonicalApiBaseUrl(): string {
  const configured = process.env.EXPO_PUBLIC_API_URL || process.env.EXPO_PUBLIC_APP_URL || '';
  if (configured) return configured.replace(/\/+$/, '');
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin.replace(/\/+$/, '');
  }
  return '';
}
