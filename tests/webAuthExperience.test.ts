import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalizeLang } from '../vercel-app/lib/i18n';
import { webAuthFeedbackCode } from '../vercel-app/lib/web-auth-feedback';
import { authenticatedWorkspaceState } from '../vercel-app/lib/authenticated-workspace-state';

const repositoryRoot = resolve(import.meta.dirname, '..');

describe('BuildTrack web access experience', () => {
  it('uses English when the browser language is unsupported', () => {
    expect(normalizeLang('fr-FR')).toBe('fr');
    expect(normalizeLang('es-DO')).toBe('es');
    expect(normalizeLang('en-GB')).toBe('en');
    expect(normalizeLang('de-DE')).toBe('en');
    expect(normalizeLang(null)).toBe('en');
  });

  it('maps provider failures to stable product feedback codes', () => {
    expect(webAuthFeedbackCode({ code: 'invalid_credentials', message: 'provider detail' })).toBe('invalid_credentials');
    expect(webAuthFeedbackCode({ status: 429, message: 'provider detail' })).toBe('rate_limited');
    expect(webAuthFeedbackCode(new TypeError('Failed to fetch'))).toBe('network_unavailable');
    expect(webAuthFeedbackCode({ message: 'private upstream wording' })).toBe('unknown');
  });

  it('distinguishes expected sign-out from an expired authenticated session', () => {
    expect(authenticatedWorkspaceState(null, {
      event: 'SIGNED_OUT',
      hadSession: true,
      intendedSignOut: false,
    })).toEqual({ status: 'anonymous', reason: 'expired' });

    expect(authenticatedWorkspaceState(null, {
      event: 'SIGNED_OUT',
      hadSession: true,
      intendedSignOut: true,
    })).toEqual({ status: 'anonymous', reason: 'signed_out' });
  });

  it('uses the official repository asset everywhere through one shared brand component', () => {
    const brand = readFileSync(resolve(repositoryRoot, 'vercel-app/app/_components/BuildTrackBrand.tsx'), 'utf8');
    const login = readFileSync(resolve(repositoryRoot, 'vercel-app/app/web/BuildTrackAccess.tsx'), 'utf8');
    const reset = readFileSync(resolve(repositoryRoot, 'vercel-app/app/reset-password/page.tsx'), 'utf8');

    expect(brand).toContain("../../../assets/images/icon.png");
    expect(login).toContain('<BuildTrackBrand');
    expect(reset).toContain('<BuildTrackBrand');
    expect(`${login}\n${reset}`).not.toMatch(/Bouygues|logoBox|>B</);
  });

  it('keeps the login and recovery forms accessible and trilingual', () => {
    const login = readFileSync(resolve(repositoryRoot, 'vercel-app/app/web/BuildTrackAccess.tsx'), 'utf8');
    const route = readFileSync(resolve(repositoryRoot, 'vercel-app/app/api/request-password-reset/route.ts'), 'utf8');
    const mobileClient = readFileSync(resolve(repositoryRoot, 'lib/email/client.ts'), 'utf8');

    expect(login).toContain('htmlFor="buildtrack-email"');
    expect(login).toContain('htmlFor="buildtrack-password"');
    expect(login).toContain("type={showPassword ? 'text' : 'password'}");
    expect(login).toContain('WEB_LANGUAGES.map');
    expect(login).toContain("setPassword('')");
    expect(route).toContain('requestedLanguage');
    expect(route).toContain('?lang=${encodeURIComponent(language)}');
    expect(mobileClient).toContain('JSON.stringify({ email, language: i18n.language })');
  });
});
