'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { BuildTrackBrand } from '../_components/BuildTrackBrand';
import { WEB_LANGUAGES, normalizeLang, type SupportedLang } from '@/lib/i18n';
import { supabaseUrl, supabaseAnonKey } from '@/lib/supabase-public-config';
import { readRecoveryToken } from '@/lib/recovery-link';
import { webAuthFeedbackCode } from '@/lib/web-auth-feedback';
import styles from './reset-password.module.css';

const COPY = {
  fr: {
    language: 'Langue', back: 'Retour à la connexion', eyebrow: 'Accès sécurisé',
    title: 'Créez votre nouveau mot de passe', intro: "Choisissez au moins 8 caractères. Évitez d'utiliser un mot de passe déjà employé ailleurs.",
    newPassword: 'Nouveau mot de passe', confirmPassword: 'Confirmer le mot de passe', placeholder: '8 caractères minimum',
    show: 'Afficher le mot de passe', hide: 'Masquer le mot de passe', mismatch: 'Les mots de passe ne correspondent pas.',
    tooShort: 'Le mot de passe doit contenir au moins 8 caractères.', expired: 'Ce lien est invalide ou a expiré. Demandez un nouveau lien depuis la page de connexion.',
    updateFailed: "Le mot de passe n'a pas pu être modifié. Demandez un nouveau lien ou réessayez.", network: 'Connexion au service impossible. Vérifiez votre réseau puis réessayez.',
    checking: 'Vérification du lien sécurisé…', submit: 'Mettre à jour le mot de passe', submitting: 'Mise à jour…',
    successEyebrow: 'Accès mis à jour', successTitle: 'Votre mot de passe est prêt', successText: 'Vous pouvez maintenant vous connecter à BuildTrack avec votre nouveau mot de passe.',
    signIn: 'Se connecter à BuildTrack', invalidTitle: 'Lien non valide', requestAgain: 'Retourner à la connexion',
    storyTitle: 'Votre chantier reste protégé.', storyText: "La réinitialisation met à jour votre accès sans modifier votre organisation, votre rôle ni vos données chantier.",
    storyPointOne: 'Lien de récupération temporaire', storyPointTwo: 'Session fermée après la modification', storyPointThree: 'Accès contrôlé par votre organisation',
  },
  en: {
    language: 'Language', back: 'Back to sign in', eyebrow: 'Secure access',
    title: 'Create your new password', intro: 'Choose at least 8 characters. Avoid using a password you already use elsewhere.',
    newPassword: 'New password', confirmPassword: 'Confirm password', placeholder: 'At least 8 characters',
    show: 'Show password', hide: 'Hide password', mismatch: 'Passwords do not match.',
    tooShort: 'The password must contain at least 8 characters.', expired: 'This link is invalid or has expired. Request a new one from the sign-in page.',
    updateFailed: 'The password could not be changed. Request a new link or try again.', network: 'Unable to reach the service. Check your connection and try again.',
    checking: 'Checking the secure link…', submit: 'Update password', submitting: 'Updating…',
    successEyebrow: 'Access updated', successTitle: 'Your password is ready', successText: 'You can now sign in to BuildTrack with your new password.',
    signIn: 'Sign in to BuildTrack', invalidTitle: 'Invalid link', requestAgain: 'Return to sign in',
    storyTitle: 'Your site stays protected.', storyText: 'Resetting your password updates your access without changing your organization, role or site data.',
    storyPointOne: 'Temporary recovery link', storyPointTwo: 'Session closed after the change', storyPointThree: 'Access controlled by your organization',
  },
  es: {
    language: 'Idioma', back: 'Volver al inicio de sesión', eyebrow: 'Acceso seguro',
    title: 'Crea tu nueva contraseña', intro: 'Elige al menos 8 caracteres. Evita utilizar una contraseña que ya uses en otro servicio.',
    newPassword: 'Nueva contraseña', confirmPassword: 'Confirmar contraseña', placeholder: '8 caracteres como mínimo',
    show: 'Mostrar contraseña', hide: 'Ocultar contraseña', mismatch: 'Las contraseñas no coinciden.',
    tooShort: 'La contraseña debe tener al menos 8 caracteres.', expired: 'Este enlace no es válido o ha caducado. Solicita uno nuevo desde la página de acceso.',
    updateFailed: 'No se pudo cambiar la contraseña. Solicita un nuevo enlace o vuelve a intentarlo.', network: 'No se pudo conectar con el servicio. Comprueba la red y vuelve a intentarlo.',
    checking: 'Verificando el enlace seguro…', submit: 'Actualizar contraseña', submitting: 'Actualizando…',
    successEyebrow: 'Acceso actualizado', successTitle: 'Tu contraseña está lista', successText: 'Ya puedes iniciar sesión en BuildTrack con tu nueva contraseña.',
    signIn: 'Iniciar sesión en BuildTrack', invalidTitle: 'Enlace no válido', requestAgain: 'Volver al inicio de sesión',
    storyTitle: 'Tu obra sigue protegida.', storyText: 'El restablecimiento actualiza tu acceso sin modificar tu organización, tu rol ni los datos de obra.',
    storyPointOne: 'Enlace de recuperación temporal', storyPointTwo: 'Sesión cerrada tras el cambio', storyPointThree: 'Acceso controlado por tu organización',
  },
} as const;

function Icon({ name }: { name: 'eye' | 'eyeOff' | 'lock' | 'check' | 'arrow' }) {
  const content = {
    eye: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></>,
    eyeOff: <><path d="m3 3 18 18M10.6 6.2A10.7 10.7 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-2.1 2.8M6.3 6.3C3.8 8 2.5 12 2.5 12s3.5 6 9.5 6a9.7 9.7 0 0 0 3-.5" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
  }[name];
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{content}</svg>;
}

export default function ResetPasswordPage() {
  const [lang, setLang] = useState<SupportedLang>('en');
  const [stage, setStage] = useState<'checking' | 'form' | 'success' | 'error'>('checking');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState('');
  const recoveryClient = useRef<SupabaseClient | null>(null);
  const recoveryToken = useRef<string | null>(null);
  const legacySession = useRef<{ access_token: string; refresh_token: string } | null>(null);
  const verified = useRef(false);
  const submitLock = useRef(false);
  const copy = COPY[lang];

  function selectLanguage(nextLanguage: SupportedLang) {
    setLang(nextLanguage);
    document.documentElement.lang = nextLanguage;
    window.localStorage.setItem('buildtrack-web-language-preference-v1', nextLanguage);
    window.localStorage.setItem('buildtrack-web-language', nextLanguage);
  }

  useEffect(() => {
    const nextLanguage = normalizeLang(new URLSearchParams(window.location.search).get('lang') ?? navigator.language);
    selectLanguage(nextLanguage);
    // Do not consume a one-use token on page load: enterprise mail scanners
    // prefetch links. Never reuse an unrelated user's persisted web session.
    recoveryClient.current ??= createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'buildtrack-password-recovery' },
    });
    recoveryToken.current = readRecoveryToken(window.location.search, window.location.hash);
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const accessToken = hash.get('access_token');
    const refreshToken = hash.get('refresh_token');
    if (hash.get('type') === 'recovery' && accessToken && refreshToken) {
      legacySession.current = { access_token: accessToken, refresh_token: refreshToken };
    }
    if (recoveryToken.current || legacySession.current) {
      setStage('form');
    } else {
      setStage('error');
      setMessage(COPY[nextLanguage].expired);
    }
  }, []);

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitLock.current) return;
    setMessage('');
    if (password.length < 8) {
      setMessage(copy.tooShort);
      return;
    }
    if (password !== confirm) {
      setMessage(copy.mismatch);
      return;
    }

    submitLock.current = true;
    setSubmitting(true);
    try {
      const client = recoveryClient.current;
      if (!client) throw new Error('Recovery client unavailable');
      if (!verified.current) {
        const verification = recoveryToken.current
          ? await client.auth.verifyOtp({ token_hash: recoveryToken.current, type: 'recovery' })
          : legacySession.current ? await client.auth.setSession(legacySession.current) : null;
        if (!verification || verification.error || !verification.data.session) {
          setMessage(verification?.error && webAuthFeedbackCode(verification.error) === 'network_unavailable' ? copy.network : copy.expired);
          return;
        }
        verified.current = true;
        window.history.replaceState(null, '', `/reset-password?lang=${lang}`);
      }
      const { error } = await client.auth.updateUser({ password });
      if (error) {
        const code = webAuthFeedbackCode(error);
        setMessage(code === 'network_unavailable' ? copy.network : copy.updateFailed);
        return;
      }
      setPassword('');
      setConfirm('');
      await client.auth.signOut({ scope: 'local' });
      recoveryToken.current = null;
      legacySession.current = null;
      setStage('success');
    } catch (error) {
      setMessage(webAuthFeedbackCode(error) === 'network_unavailable' ? copy.network : copy.updateFailed);
    } finally {
      submitLock.current = false;
      setSubmitting(false);
    }
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <a href="/" aria-label="BuildTrack"><BuildTrackBrand size="sm" /></a>
        <label className={styles.language}>
          <span className={styles.visuallyHidden}>{copy.language}</span>
          <b aria-hidden="true">{lang.toUpperCase()}</b>
          <select value={lang} onChange={event => selectLanguage(event.target.value as SupportedLang)} aria-label={copy.language}>
            {WEB_LANGUAGES.map(option => <option key={option.code} value={option.code}>{option.nativeName}</option>)}
          </select>
        </label>
      </header>

      <div className={styles.shell}>
        <aside className={styles.story}>
          <span className={styles.storyIcon}><Icon name="lock" /></span>
          <h1>{copy.storyTitle}</h1>
          <p>{copy.storyText}</p>
          <ul>
            {[copy.storyPointOne, copy.storyPointTwo, copy.storyPointThree].map(point => <li key={point}><Icon name="check" /> {point}</li>)}
          </ul>
        </aside>

        <section className={styles.panel} aria-live="polite">
          <a className={styles.back} href={`/web?lang=${lang}`}>{copy.back}</a>

          {stage === 'checking' && (
            <div className={styles.stateBlock} aria-busy="true">
              <span className={styles.spinner} aria-hidden="true" />
              <p>{copy.checking}</p>
            </div>
          )}

          {stage === 'error' && (
            <div className={styles.stateBlock}>
              <span className={styles.panelIcon}><Icon name="lock" /></span>
              <p className={styles.eyebrow}>{copy.eyebrow}</p>
              <h2>{copy.invalidTitle}</h2>
              <p className={styles.intro}>{message}</p>
              <a className={styles.primary} href={`/web?lang=${lang}`}><span>{copy.requestAgain}</span><Icon name="arrow" /></a>
            </div>
          )}

          {stage === 'form' && (
            <>
              <p className={styles.eyebrow}>{copy.eyebrow}</p>
              <h2>{copy.title}</h2>
              <p className={styles.intro}>{copy.intro}</p>
              <form className={styles.form} onSubmit={submitPassword}>
                <div className={styles.field}>
                  <label htmlFor="new-password">{copy.newPassword}</label>
                  <div className={styles.passwordField}>
                    <input id="new-password" type={showPassword ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" placeholder={copy.placeholder} minLength={8} aria-describedby={message ? 'reset-feedback' : undefined} required autoFocus />
                    <button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? copy.hide : copy.show} aria-pressed={showPassword}><Icon name={showPassword ? 'eyeOff' : 'eye'} /></button>
                  </div>
                </div>
                <div className={styles.field}>
                  <label htmlFor="confirm-password">{copy.confirmPassword}</label>
                  <input id="confirm-password" type={showPassword ? 'text' : 'password'} value={confirm} onChange={event => setConfirm(event.target.value)} autoComplete="new-password" placeholder={copy.placeholder} minLength={8} aria-invalid={Boolean(confirm && confirm !== password)} aria-describedby={message ? 'reset-feedback' : undefined} required />
                  {confirm && confirm !== password && <span className={styles.hint}>{copy.mismatch}</span>}
                </div>
                {message && <p id="reset-feedback" className={styles.error} role="alert">{message}</p>}
                <button className={styles.primary} type="submit" disabled={submitting}><span>{submitting ? copy.submitting : copy.submit}</span>{submitting ? <i className={styles.spinner} /> : <Icon name="arrow" />}</button>
              </form>
            </>
          )}

          {stage === 'success' && (
            <div className={styles.stateBlock} role="status">
              <span className={styles.panelIconSuccess}><Icon name="check" /></span>
              <p className={styles.eyebrow}>{copy.successEyebrow}</p>
              <h2>{copy.successTitle}</h2>
              <p className={styles.intro}>{copy.successText}</p>
              <a className={styles.primary} href={`/web?lang=${lang}`}><span>{copy.signIn}</span><Icon name="arrow" /></a>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
