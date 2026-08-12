'use client';

import { useMemo, useState, type FormEvent } from 'react';
import { BuildTrackBrand } from '../_components/BuildTrackBrand';
import { WEB_LANGUAGES, createWebT, type SupportedLang } from '@/lib/i18n';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { webAuthFeedbackCode, type WebAuthFeedbackCode } from '@/lib/web-auth-feedback';
import styles from './BuildTrackAccess.module.css';

type BuildTrackAccessProps = {
  language: SupportedLang;
  onLanguageChange: (language: SupportedLang) => void | Promise<void>;
  sessionExpired?: boolean;
};

type AccessView = 'signin' | 'recovery' | 'recovery_sent';

function AccessIcon({ name }: { name: 'plan' | 'reserve' | 'field' | 'eye' | 'eyeOff' | 'arrow' | 'lock' | 'mail' }) {
  const content = {
    plan: <><path d="M4 4h16v16H4z" /><path d="M8 4v6h6V4m-2 10h8m-8 0v6" /></>,
    reserve: <><path d="M5 4h14v16H5z" /><path d="M9 9h6m-6 4h6m-6 4h4" /></>,
    field: <><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" /><path d="m8.5 12 2.2 2.2 4.8-5" /></>,
    eye: <><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></>,
    eyeOff: <><path d="m3 3 18 18M10.6 6.2A10.7 10.7 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-2.1 2.8M6.3 6.3C3.8 8 2.5 12 2.5 12s3.5 6 9.5 6a9.7 9.7 0 0 0 3-.5M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>,
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></>,
    mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>,
  }[name];

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {content}
    </svg>
  );
}

function errorKey(code: WebAuthFeedbackCode) {
  return `auth.error.${code}`;
}

export function BuildTrackAccessLoading({ language }: { language: SupportedLang }) {
  const t = useMemo(() => createWebT(language), [language]);
  return (
    <main className={styles.loadingPage} aria-busy="true" aria-live="polite">
      <BuildTrackBrand size="md" />
      <span className={styles.loadingIndicator} aria-hidden="true" />
      <div className={styles.loadingCopy}>
        <strong>{t('auth.checking.title')}</strong>
        <span>{t('auth.checking.text')}</span>
      </div>
    </main>
  );
}

export function BuildTrackAccess({
  language,
  onLanguageChange,
  sessionExpired = false,
}: BuildTrackAccessProps) {
  const t = useMemo(() => createWebT(language), [language]);
  const [view, setView] = useState<AccessView>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');

  function openView(nextView: AccessView) {
    setFeedback('');
    setView(nextView);
  }

  async function submitLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback('');
    try {
      const { error } = await supabaseBrowser.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) {
        setFeedback(t(errorKey(webAuthFeedbackCode(error))));
        return;
      }
      setPassword('');
    } catch (error) {
      setFeedback(t(errorKey(webAuthFeedbackCode(error))));
    } finally {
      setBusy(false);
    }
  }

  async function submitRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setFeedback('');
    try {
      const response = await fetch('/api/request-password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), language }),
      });
      if (!response.ok) {
        const code: WebAuthFeedbackCode = response.status === 429 ? 'rate_limited' : 'reset_unavailable';
        setFeedback(t(errorKey(code)));
        return;
      }
      setView('recovery_sent');
    } catch (error) {
      setFeedback(t(errorKey(webAuthFeedbackCode(error))));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.accessPage}>
      <header className={styles.accessHeader}>
        <a href="/" className={styles.brandLink} aria-label={t('auth.backHome')}>
          <BuildTrackBrand size="sm" />
        </a>
        <label className={styles.languageControl}>
          <span className={styles.visuallyHidden}>{t('common.language')}</span>
          <span aria-hidden="true">{language.toUpperCase()}</span>
          <select
            value={language}
            onChange={event => void onLanguageChange(event.target.value as SupportedLang)}
            aria-label={t('common.language')}
          >
            {WEB_LANGUAGES.map(option => (
              <option key={option.code} value={option.code}>{option.nativeName}</option>
            ))}
          </select>
        </label>
      </header>

      <div className={styles.accessShell}>
        <aside className={styles.productStory} aria-label={t('auth.story.aria')}>
          <div className={styles.storyCopy}>
            <p className={styles.storyEyebrow}>{t('auth.story.eyebrow')}</p>
            <h1>{t('auth.story.title')}</h1>
            <p className={styles.storyIntro}>{t('auth.story.text')}</p>
            <div className={styles.featureList}>
              <div><span><AccessIcon name="plan" /></span><p><strong>{t('auth.story.plans')}</strong><small>{t('auth.story.plansText')}</small></p></div>
              <div><span><AccessIcon name="reserve" /></span><p><strong>{t('auth.story.reserves')}</strong><small>{t('auth.story.reservesText')}</small></p></div>
              <div><span><AccessIcon name="field" /></span><p><strong>{t('auth.story.field')}</strong><small>{t('auth.story.fieldText')}</small></p></div>
            </div>
          </div>
          <svg className={styles.planDrawing} viewBox="0 0 720 360" aria-hidden="true">
            <path d="M40 35h640v290H40zM220 35v290M470 35v290M40 165h180m250 0h210M220 95h250M345 95v230" />
            <path d="M90 78h80v54H90zM515 210h110v72H515zM260 135h52v104h-52z" />
            <circle cx="153" cy="228" r="14" /><circle cx="418" cy="142" r="14" /><circle cx="574" cy="95" r="14" />
          </svg>
          <p className={styles.storyFoot}><AccessIcon name="lock" /> {t('auth.story.security')}</p>
        </aside>

        <section className={styles.accessPanel} aria-labelledby="buildtrack-access-title">
          <div className={styles.mobileBrand}><BuildTrackBrand size="sm" /></div>

          {view === 'signin' && (
            <>
              <p className={styles.panelEyebrow}>{t('login.eyebrow')}</p>
              <h2 id="buildtrack-access-title">{t('login.title')}</h2>
              <p className={styles.panelIntro}>{t('login.subtitle')}</p>

              {sessionExpired && (
                <div className={styles.warningBanner} role="alert">
                  <AccessIcon name="lock" />
                  <span>{t('sessionExpired.loginMessage')}</span>
                </div>
              )}

              <form className={styles.accessForm} onSubmit={submitLogin}>
                <div className={styles.field}>
                  <label htmlFor="buildtrack-email">{t('common.email')}</label>
                  <input
                    id="buildtrack-email"
                    value={email}
                    onChange={event => setEmail(event.target.value)}
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    spellCheck={false}
                    aria-invalid={feedback ? true : undefined}
                    aria-describedby={feedback ? 'buildtrack-auth-feedback' : undefined}
                    required
                    autoFocus
                  />
                </div>
                <div className={styles.field}>
                  <div className={styles.fieldHeading}>
                    <label htmlFor="buildtrack-password">{t('common.password')}</label>
                    <button type="button" onClick={() => openView('recovery')}>{t('auth.forgotPassword')}</button>
                  </div>
                  <div className={styles.passwordField}>
                    <input
                      id="buildtrack-password"
                      value={password}
                      onChange={event => setPassword(event.target.value)}
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      aria-invalid={feedback ? true : undefined}
                      aria-describedby={feedback ? 'buildtrack-auth-feedback' : undefined}
                      required
                    />
                    <button
                      type="button"
                      className={styles.passwordToggle}
                      onClick={() => setShowPassword(value => !value)}
                      aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                      aria-pressed={showPassword}
                    >
                      <AccessIcon name={showPassword ? 'eyeOff' : 'eye'} />
                    </button>
                  </div>
                </div>
                {feedback && <p id="buildtrack-auth-feedback" className={styles.feedbackError} role="alert">{feedback}</p>}
                <button className={styles.primaryAction} type="submit" disabled={busy}>
                  <span>{busy ? t('common.loggingIn') : t('common.login')}</span>
                  {busy ? <i className={styles.buttonSpinner} aria-hidden="true" /> : <AccessIcon name="arrow" />}
                </button>
              </form>
              <p className={styles.accessFoot}>{t('auth.managedAccess')}</p>
            </>
          )}

          {view === 'recovery' && (
            <>
              <button className={styles.backButton} type="button" onClick={() => openView('signin')}>{t('auth.recovery.back')}</button>
              <span className={styles.panelIcon}><AccessIcon name="mail" /></span>
              <p className={styles.panelEyebrow}>{t('auth.recovery.eyebrow')}</p>
              <h2 id="buildtrack-access-title">{t('auth.recovery.title')}</h2>
              <p className={styles.panelIntro}>{t('auth.recovery.text')}</p>
              <form className={styles.accessForm} onSubmit={submitRecovery}>
                <div className={styles.field}>
                  <label htmlFor="buildtrack-recovery-email">{t('common.email')}</label>
                  <input
                    id="buildtrack-recovery-email"
                    value={email}
                    onChange={event => setEmail(event.target.value)}
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    spellCheck={false}
                    aria-invalid={feedback ? true : undefined}
                    aria-describedby={feedback ? 'buildtrack-auth-feedback' : undefined}
                    required
                    autoFocus
                  />
                </div>
                {feedback && <p id="buildtrack-auth-feedback" className={styles.feedbackError} role="alert">{feedback}</p>}
                <button className={styles.primaryAction} type="submit" disabled={busy}>
                  <span>{busy ? t('auth.recovery.sending') : t('auth.recovery.submit')}</span>
                  {busy ? <i className={styles.buttonSpinner} aria-hidden="true" /> : <AccessIcon name="arrow" />}
                </button>
              </form>
              <p className={styles.accessFoot}>{t('auth.recovery.privacy')}</p>
            </>
          )}

          {view === 'recovery_sent' && (
            <div className={styles.sentState} role="status">
              <span className={styles.panelIcon}><AccessIcon name="mail" /></span>
              <p className={styles.panelEyebrow}>{t('auth.recovery.eyebrow')}</p>
              <h2 id="buildtrack-access-title">{t('auth.recovery.sentTitle')}</h2>
              <p className={styles.panelIntro}>{t('auth.recovery.sentText')}</p>
              <button className={styles.primaryAction} type="button" onClick={() => openView('signin')}>
                <span>{t('auth.recovery.backToLogin')}</span><AccessIcon name="arrow" />
              </button>
              <button className={styles.secondaryAction} type="button" onClick={() => openView('recovery')}>{t('auth.recovery.tryAgain')}</button>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
