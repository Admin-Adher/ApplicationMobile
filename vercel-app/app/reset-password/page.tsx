'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import { normalizeLang, type SupportedLang } from '@/lib/i18n';

const BRAND = '#003082';
const ACCENT = '#FFCB00';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  'https://jzeojdpgglbxjdasjgta.supabase.co';
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6ZW9qZHBnZ2xieGpkYXNqZ3RhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4Mjg1ODAsImV4cCI6MjA5MDQwNDU4MH0.ZcU5EAYQMEnQHVe0-6Wff_1sBanvjtdZZ0hJNJGLAz0';

const COPY = {
  fr: {
    invalidLink: 'Lien de réinitialisation invalide ou expiré. Veuillez faire une nouvelle demande.',
    passwordShort: 'Le mot de passe doit contenir au moins 8 caractères.',
    passwordMismatch: 'Les mots de passe ne correspondent pas.',
    expiredSession: 'Lien expiré. Veuillez faire une nouvelle demande de réinitialisation.',
    updateFailed: 'Impossible de mettre à jour le mot de passe.',
    errorPrefix: 'Erreur',
    checking: 'Vérification du lien...',
    invalidTitle: 'Lien invalide',
    home: "Retour à l'accueil",
    title: 'Nouveau mot de passe',
    intro: "Choisissez un mot de passe sécurisé d'au moins 8 caractères.",
    newPassword: 'Nouveau mot de passe',
    passwordPlaceholder: 'Min. 8 caractères',
    confirmPassword: 'Confirmer le mot de passe',
    confirmPlaceholder: 'Répétez le mot de passe',
    mismatchHint: 'Les mots de passe ne correspondent pas',
    submitting: 'Mise à jour...',
    submit: 'Mettre à jour le mot de passe →',
    successTitle: 'Mot de passe mis à jour !',
    successText: 'Votre mot de passe a été modifié avec succès. Vous pouvez maintenant vous connecter avec votre nouveau mot de passe.',
    openAppHint: "Ouvrez l'application BuildTrack et connectez-vous avec votre nouveau mot de passe.",
    openBuildTrack: 'Ouvrir BuildTrack →',
    footer: 'BuildTrack — Gestion de chantier numérique',
  },
  en: {
    invalidLink: 'Invalid or expired reset link. Please request a new one.',
    passwordShort: 'The password must contain at least 8 characters.',
    passwordMismatch: 'Passwords do not match.',
    expiredSession: 'The link has expired. Please request a new password reset.',
    updateFailed: 'Unable to update the password.',
    errorPrefix: 'Error',
    checking: 'Checking the link...',
    invalidTitle: 'Invalid link',
    home: 'Back to home',
    title: 'New password',
    intro: 'Choose a secure password with at least 8 characters.',
    newPassword: 'New password',
    passwordPlaceholder: 'Min. 8 characters',
    confirmPassword: 'Confirm password',
    confirmPlaceholder: 'Repeat password',
    mismatchHint: 'Passwords do not match',
    submitting: 'Updating...',
    submit: 'Update password →',
    successTitle: 'Password updated!',
    successText: 'Your password has been changed successfully. You can now sign in with your new password.',
    openAppHint: 'Open the BuildTrack app and sign in with your new password.',
    openBuildTrack: 'Open BuildTrack →',
    footer: 'BuildTrack — Digital construction management',
  },
  es: {
    invalidLink: 'Enlace de restablecimiento no válido o caducado. Solicita uno nuevo.',
    passwordShort: 'La contraseña debe tener al menos 8 caracteres.',
    passwordMismatch: 'Las contraseñas no coinciden.',
    expiredSession: 'El enlace ha caducado. Solicita un nuevo restablecimiento.',
    updateFailed: 'No se pudo actualizar la contraseña.',
    errorPrefix: 'Error',
    checking: 'Verificando el enlace...',
    invalidTitle: 'Enlace no válido',
    home: 'Volver al inicio',
    title: 'Nueva contraseña',
    intro: 'Elige una contraseña segura de al menos 8 caracteres.',
    newPassword: 'Nueva contraseña',
    passwordPlaceholder: 'Mín. 8 caracteres',
    confirmPassword: 'Confirmar contraseña',
    confirmPlaceholder: 'Repite la contraseña',
    mismatchHint: 'Las contraseñas no coinciden',
    submitting: 'Actualizando...',
    submit: 'Actualizar contraseña →',
    successTitle: '¡Contraseña actualizada!',
    successText: 'Tu contraseña se ha modificado correctamente. Ya puedes iniciar sesión con tu nueva contraseña.',
    openAppHint: 'Abre la aplicación BuildTrack e inicia sesión con tu nueva contraseña.',
    openBuildTrack: 'Abrir BuildTrack →',
    footer: 'BuildTrack — Gestión digital de obra',
  },
} as const;

export default function ResetPasswordPage() {
  const [lang, setLang] = useState<SupportedLang>('fr');
  const copy = COPY[lang];
  const [stage, setStage] = useState<'loading' | 'form' | 'success' | 'error'>('loading');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [refreshToken, setRefreshToken] = useState('');

  useEffect(() => {
    const nextLang = normalizeLang(new URLSearchParams(window.location.search).get('lang') ?? navigator.language);
    setLang(nextLang);
    const nextCopy = COPY[nextLang];
    const hash = window.location.hash;
    const params = new URLSearchParams(hash.replace('#', ''));
    const token = params.get('access_token');
    const refresh = params.get('refresh_token');
    const type = params.get('type');

    if (token && type === 'recovery') {
      setAccessToken(token);
      setRefreshToken(refresh ?? '');
      setStage('form');
    } else {
      setStage('error');
      setErrorMsg(nextCopy.invalidLink);
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');

    if (password.length < 8) {
      setErrorMsg(copy.passwordShort);
      return;
    }
    if (password !== confirm) {
      setErrorMsg(copy.passwordMismatch);
      return;
    }

    setSubmitting(true);
    try {
      const supabase = createClient(supabaseUrl, supabaseKey);

      const { error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });

      if (sessionError) {
        setErrorMsg(copy.expiredSession);
        setSubmitting(false);
        return;
      }

      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        setErrorMsg(error.message ?? copy.updateFailed);
        setSubmitting(false);
        return;
      }

      await supabase.auth.signOut();
      setStage('success');
    } catch (err: any) {
      setErrorMsg(`${copy.errorPrefix}: ${err?.message ?? JSON.stringify(err)}`);
      setSubmitting(false);
    }
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <div style={s.header}>
          <div style={s.logoBox}>B</div>
          <div>
            <div style={s.brandName}>Bouygues</div>
            <div style={s.brandSub}>Construction</div>
          </div>
        </div>
        <div style={s.divider} />

        {stage === 'loading' && (
          <p style={s.body}>{copy.checking}</p>
        )}

        {stage === 'error' && (
          <>
            <div style={s.iconWrap}>🔒</div>
            <h1 style={s.title}>{copy.invalidTitle}</h1>
            <p style={s.body}>{errorMsg}</p>
            <a href="https://buildtrack-mobile.vercel.app" style={s.btn}>
              {copy.home}
            </a>
          </>
        )}

        {stage === 'form' && (
          <>
            <div style={s.iconWrap}>🔑</div>
            <h1 style={s.title}>{copy.title}</h1>
            <p style={s.body}>{copy.intro}</p>

            <form onSubmit={handleSubmit} style={s.form}>
              <div style={s.field}>
                <label style={s.label}>{copy.newPassword}</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder={copy.passwordPlaceholder}
                  style={s.input}
                  required
                />
              </div>
              <div style={s.field}>
                <label style={s.label}>{copy.confirmPassword}</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder={copy.confirmPlaceholder}
                  style={{
                    ...s.input,
                    borderColor: confirm && confirm !== password ? '#DC2626' : '#DDE4EE',
                  }}
                  required
                />
                {confirm && confirm !== password && (
                  <p style={s.hint}>{copy.mismatchHint}</p>
                )}
              </div>

              {errorMsg ? (
                <div style={s.errorBox}>
                  <p style={s.errorText}>{errorMsg}</p>
                </div>
              ) : null}

              <button type="submit" disabled={submitting} style={s.btn}>
                {submitting ? copy.submitting : copy.submit}
              </button>
            </form>
          </>
        )}

        {stage === 'success' && (
          <>
            <div style={s.iconWrap}>✅</div>
            <h1 style={s.title}>{copy.successTitle}</h1>
            <p style={s.body}>
              {copy.successText}
            </p>
            <div style={s.infoBox}>
              <p style={s.infoText}>
                {copy.openAppHint}
              </p>
            </div>
            <a href="https://buildtrack-mobile.vercel.app" style={s.btn}>
              {copy.openBuildTrack}
            </a>
          </>
        )}

        <div style={s.footer}>
          <p style={s.footerText}>{copy.footer}</p>
        </div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: '#F4F7FB',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
  },
  card: {
    background: '#fff',
    borderRadius: '20px',
    padding: '36px 32px',
    maxWidth: '420px',
    width: '100%',
    boxShadow: '0 4px 32px rgba(0,48,130,0.10)',
    border: '1px solid #DDE4EE',
    textAlign: 'center',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
    justifyContent: 'center',
  },
  logoBox: {
    width: '44px',
    height: '44px',
    background: ACCENT,
    borderRadius: '10px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '22px',
    fontWeight: '700',
    color: BRAND,
    flexShrink: 0,
  },
  brandName: { fontSize: '18px', fontWeight: '700', color: BRAND, textAlign: 'left' },
  brandSub: { fontSize: '12px', color: '#8899BB', textAlign: 'left' },
  divider: {
    width: '40px',
    height: '3px',
    background: ACCENT,
    borderRadius: '2px',
    margin: '16px auto 28px',
  },
  iconWrap: { fontSize: '44px', display: 'block', marginBottom: '16px' },
  title: { fontSize: '22px', fontWeight: '700', color: BRAND, margin: '0 0 12px' },
  body: { fontSize: '14px', color: '#334155', lineHeight: '1.7', margin: '0 0 20px' },
  form: { textAlign: 'left' },
  field: { marginBottom: '16px' },
  label: {
    display: 'block',
    fontSize: '11px',
    fontWeight: '600',
    color: '#64748B',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.6px',
    marginBottom: '8px',
  },
  input: {
    width: '100%',
    fontSize: '15px',
    color: '#0F172A',
    background: '#F4F7FB',
    border: '1px solid #DDE4EE',
    borderRadius: '12px',
    padding: '13px 14px',
    boxSizing: 'border-box' as const,
    outline: 'none',
    fontFamily: 'inherit',
  },
  hint: { fontSize: '11px', color: '#DC2626', margin: '4px 0 0' },
  errorBox: {
    background: '#FEF2F2',
    border: '1px solid #FECACA',
    borderRadius: '10px',
    padding: '12px 16px',
    marginBottom: '14px',
    textAlign: 'left',
  },
  errorText: { fontSize: '13px', color: '#DC2626', margin: 0 },
  infoBox: {
    background: '#EEF3FA',
    borderRadius: '10px',
    padding: '14px 18px',
    marginBottom: '20px',
    borderLeft: `3px solid ${BRAND}`,
  },
  infoText: { fontSize: '13px', color: '#334155', margin: 0, textAlign: 'left' },
  btn: {
    display: 'block',
    width: '100%',
    background: ACCENT,
    color: BRAND,
    fontWeight: '700',
    fontSize: '15px',
    padding: '14px 28px',
    borderRadius: '12px',
    textDecoration: 'none',
    border: 'none',
    cursor: 'pointer',
    boxSizing: 'border-box' as const,
    fontFamily: 'inherit',
    textAlign: 'center',
  },
  footer: { marginTop: '28px', paddingTop: '20px', borderTop: '1px solid #EEF3FA' },
  footerText: { fontSize: '11px', color: '#8899BB', margin: 0 },
};
