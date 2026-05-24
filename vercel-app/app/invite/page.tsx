'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { appendLang, getRequestedLang } from '@/lib/i18n';

const BRAND = '#003082';
const ACCENT = '#FFCB00';
const APP_SCHEME = process.env.NEXT_PUBLIC_EXPO_APP_SCHEME ?? 'buildtrack';
const APK_DOWNLOAD_URL =
  'https://github.com/Admin-Adher/ApplicationMobile/releases/latest/download/buildtrack-release.apk';

const COPY = {
  fr: {
    title: 'Invitation BuildTrack',
    invalid: "Lien d'invitation invalide ou expiré.",
    invited: 'Vous avez été invité à rejoindre une organisation sur BuildTrack.',
    createAccountHint: "Pour rejoindre l'organisation, créez votre compte avec l'email sur lequel vous avez reçu cette invitation :",
    createAccount: 'Créer mon compte →',
    androidPreference: "Vous préférez l'application Android ?",
    apkDownloadHint: 'Téléchargez la dernière version de BuildTrack pour Android :',
    downloadApk: "Télécharger l'APK",
    storeUnavailable: "BuildTrack n'est pas encore publié sur l'App Store ni Google Play.",
    opening: 'Ouverture de BuildTrack en cours...',
    webFallback: "Si l'application ne s'ouvre pas, vous pouvez continuer sur le web :",
    continueWeb: 'Continuer sur le web →',
    downloadAndroidApp: "Télécharger l'application Android",
    notInstalled: "BuildTrack n'est pas encore installé sur votre appareil.",
    installAndroid: "Installer l'application Android",
    installAndroidText: "Téléchargez le fichier APK officiel de BuildTrack et installez-le sur votre téléphone :",
    androidUnknownSources: "Au lancement de l'installation, Android peut vous demander d'autoriser les sources inconnues. BuildTrack n'est pas encore publié sur Google Play.",
    mobileApp: 'Application mobile',
    iosUnavailable: "BuildTrack n'est pas encore disponible sur l'App Store. En attendant, utilisez la version web.",
    footer: 'BuildTrack — Gestion de chantier numérique',
    loading: 'Chargement...',
  },
  en: {
    title: 'BuildTrack invitation',
    invalid: 'Invalid or expired invitation link.',
    invited: 'You have been invited to join an organization on BuildTrack.',
    createAccountHint: 'To join the organization, create your account with the email address that received this invitation:',
    createAccount: 'Create my account →',
    androidPreference: 'Prefer the Android app?',
    apkDownloadHint: 'Download the latest BuildTrack version for Android:',
    downloadApk: 'Download APK',
    storeUnavailable: 'BuildTrack is not published on the App Store or Google Play yet.',
    opening: 'Opening BuildTrack...',
    webFallback: 'If the app does not open, you can continue on the web:',
    continueWeb: 'Continue on web →',
    downloadAndroidApp: 'Download the Android app',
    notInstalled: 'BuildTrack is not installed on your device yet.',
    installAndroid: 'Install the Android app',
    installAndroidText: 'Download the official BuildTrack APK file and install it on your phone:',
    androidUnknownSources: 'During installation, Android may ask you to allow unknown sources. BuildTrack is not published on Google Play yet.',
    mobileApp: 'Mobile app',
    iosUnavailable: 'BuildTrack is not available on the App Store yet. Use the web version in the meantime.',
    footer: 'BuildTrack — Digital construction management',
    loading: 'Loading...',
  },
  es: {
    title: 'Invitación BuildTrack',
    invalid: 'Enlace de invitación no válido o caducado.',
    invited: 'Has sido invitado a unirte a una organización en BuildTrack.',
    createAccountHint: 'Para unirte a la organización, crea tu cuenta con el email en el que recibiste esta invitación:',
    createAccount: 'Crear mi cuenta →',
    androidPreference: '¿Prefieres la aplicación Android?',
    apkDownloadHint: 'Descarga la última versión de BuildTrack para Android:',
    downloadApk: 'Descargar APK',
    storeUnavailable: 'BuildTrack aún no está publicado en App Store ni en Google Play.',
    opening: 'Abriendo BuildTrack...',
    webFallback: 'Si la aplicación no se abre, puedes continuar en la web:',
    continueWeb: 'Continuar en la web →',
    downloadAndroidApp: 'Descargar la aplicación Android',
    notInstalled: 'BuildTrack aún no está instalado en tu dispositivo.',
    installAndroid: 'Instalar la aplicación Android',
    installAndroidText: 'Descarga el archivo APK oficial de BuildTrack e instálalo en tu teléfono:',
    androidUnknownSources: 'Durante la instalación, Android puede pedirte que autorices fuentes desconocidas. BuildTrack aún no está publicado en Google Play.',
    mobileApp: 'Aplicación móvil',
    iosUnavailable: 'BuildTrack aún no está disponible en App Store. Mientras tanto, usa la versión web.',
    footer: 'BuildTrack — Gestión digital de obra',
    loading: 'Cargando...',
  },
} as const;

function InviteContent() {
  const params = useSearchParams();
  const lang = getRequestedLang((name) => params.get(name));
  const copy = COPY[lang];
  const token = params.get('token');
  const [platform, setPlatform] = useState<'ios' | 'android' | 'web' | 'unknown'>('unknown');
  const [deepLinkAttempted, setDeepLinkAttempted] = useState(false);

  useEffect(() => {
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/.test(ua)) setPlatform('ios');
    else if (/Android/.test(ua)) setPlatform('android');
    else setPlatform('web');
  }, []);

  useEffect(() => {
    if (!token || platform === 'unknown' || platform === 'web') return;
    const deepLink = `${APP_SCHEME}://invite?token=${token}&lang=${lang}`;
    window.location.href = deepLink;
    const timer = setTimeout(() => setDeepLinkAttempted(true), 2500);
    return () => clearTimeout(timer);
  }, [token, platform, lang]);

  const registerUrl = appendLang(
    token
      ? `https://buildtrack-mobile.vercel.app/register?token=${encodeURIComponent(token)}`
      : `https://buildtrack-mobile.vercel.app/register`,
    lang
  );

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.header}>
          <div style={styles.logoBox}>B</div>
          <div>
            <div style={styles.brandName}>Bouygues</div>
            <div style={styles.brandSub}>Construction</div>
          </div>
        </div>
        <div style={styles.divider} />

        <div style={styles.iconCircle}>✉️</div>
        <h1 style={styles.title}>{copy.title}</h1>

        {!token ? (
          <p style={styles.body}>{copy.invalid}</p>
        ) : platform === 'web' ? (
          <>
            <p style={styles.body}>
              {copy.invited}
            </p>
            <p style={styles.bodySmall}>
              {copy.createAccountHint}
            </p>
            <a href={registerUrl} style={styles.btn}>
              {copy.createAccount}
            </a>
            <div style={styles.installNote}>
              <p style={styles.installNoteTitle}>📱 {copy.androidPreference}</p>
              <p style={styles.installNoteText}>
                {copy.apkDownloadHint}
              </p>
              <a href={APK_DOWNLOAD_URL} style={styles.installNoteBtn}>
                ⬇️ {copy.downloadApk}
              </a>
              <p style={styles.installNoteHint}>
                {copy.storeUnavailable}
              </p>
            </div>
          </>
        ) : !deepLinkAttempted ? (
          <>
            <p style={styles.body}>{copy.opening}</p>
            <div style={styles.loader} />
            <p style={styles.bodySmall}>{copy.webFallback}</p>
            <a href={registerUrl} style={styles.btn}>
              {copy.continueWeb}
            </a>
            {platform === 'android' && (
              <a href={APK_DOWNLOAD_URL} style={styles.btnSecondary}>
                ⬇️ {copy.downloadAndroidApp}
              </a>
            )}
          </>
        ) : (
          <>
            <p style={styles.body}>
              {copy.notInstalled}
            </p>
            <a href={registerUrl} style={styles.btn}>
              {copy.continueWeb}
            </a>
            {platform === 'android' ? (
              <div style={styles.installNote}>
                <p style={styles.installNoteTitle}>📱 {copy.installAndroid}</p>
                <p style={styles.installNoteText}>
                  {copy.installAndroidText}
                </p>
                <a href={APK_DOWNLOAD_URL} style={styles.installNoteBtn}>
                  ⬇️ {copy.downloadApk}
                </a>
                <p style={styles.installNoteHint}>
                  {copy.androidUnknownSources}
                </p>
              </div>
            ) : (
              <div style={styles.installNote}>
                <p style={styles.installNoteTitle}>📱 {copy.mobileApp}</p>
                <p style={styles.installNoteText}>
                  {copy.iosUnavailable}
                </p>
              </div>
            )}
          </>
        )}

        <div style={styles.footer}>
          <p style={styles.footerText}>{copy.footer}</p>
        </div>
      </div>
    </div>
  );
}

export default function InvitePage() {
  return (
    <Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#F4F7FB' }}>{COPY.fr.loading}</div>}>
      <InviteContent />
    </Suspense>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
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
    marginBottom: '4px',
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
  brandName: {
    fontSize: '18px',
    fontWeight: '700',
    color: BRAND,
    textAlign: 'left',
  },
  brandSub: {
    fontSize: '12px',
    color: '#8899BB',
    textAlign: 'left',
  },
  divider: {
    width: '40px',
    height: '3px',
    background: ACCENT,
    borderRadius: '2px',
    margin: '16px auto 28px',
  },
  iconCircle: {
    fontSize: '44px',
    marginBottom: '16px',
    display: 'block',
  },
  title: {
    fontSize: '22px',
    fontWeight: '700',
    color: BRAND,
    margin: '0 0 16px',
  },
  body: {
    fontSize: '15px',
    color: '#334155',
    lineHeight: '1.6',
    margin: '0 0 14px',
  },
  bodySmall: {
    fontSize: '13px',
    color: '#64748B',
    lineHeight: '1.6',
    margin: '0 0 20px',
  },
  btn: {
    display: 'block',
    background: ACCENT,
    color: BRAND,
    fontWeight: '700',
    fontSize: '15px',
    padding: '14px 28px',
    borderRadius: '12px',
    textDecoration: 'none',
    margin: '0 0 14px',
  },
  btnSecondary: {
    display: 'block',
    background: '#EEF3FA',
    color: BRAND,
    fontWeight: '700',
    fontSize: '14px',
    padding: '12px 24px',
    borderRadius: '12px',
    textDecoration: 'none',
    margin: '0 0 14px',
    border: '1px solid #DDE4EE',
  },
  installNote: {
    marginTop: '16px',
    padding: '14px 16px',
    background: '#F4F7FB',
    border: '1px solid #DDE4EE',
    borderRadius: '12px',
    textAlign: 'left',
  },
  installNoteTitle: {
    fontSize: '13px',
    fontWeight: '700',
    color: BRAND,
    margin: '0 0 6px',
  },
  installNoteText: {
    fontSize: '12px',
    color: '#475569',
    lineHeight: '1.55',
    margin: '0 0 10px',
  },
  installNoteBtn: {
    display: 'inline-block',
    background: '#fff',
    color: BRAND,
    fontWeight: '700',
    fontSize: '13px',
    padding: '10px 16px',
    borderRadius: '10px',
    textDecoration: 'none',
    border: `1.5px solid ${BRAND}`,
    marginBottom: '8px',
  },
  installNoteHint: {
    fontSize: '11px',
    color: '#8899BB',
    lineHeight: '1.5',
    margin: '0',
  },
  loader: {
    width: '36px',
    height: '36px',
    border: `3px solid #EEF3FA`,
    borderTop: `3px solid ${BRAND}`,
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
    margin: '16px auto',
  },
  footer: {
    marginTop: '28px',
    paddingTop: '20px',
    borderTop: '1px solid #EEF3FA',
  },
  footerText: {
    fontSize: '11px',
    color: '#8899BB',
    margin: '0',
  },
};
