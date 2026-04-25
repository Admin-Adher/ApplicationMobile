'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Suspense } from 'react';

const BRAND = '#003082';
const ACCENT = '#FFCB00';
const APP_SCHEME = process.env.NEXT_PUBLIC_EXPO_APP_SCHEME ?? 'buildtrack';
const APK_DOWNLOAD_URL =
  'https://github.com/Admin-Adher/ApplicationMobile/releases/latest/download/buildtrack-release.apk';

function InviteContent() {
  const params = useSearchParams();
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
    const deepLink = `${APP_SCHEME}://invite?token=${token}`;
    window.location.href = deepLink;
    const timer = setTimeout(() => setDeepLinkAttempted(true), 2500);
    return () => clearTimeout(timer);
  }, [token, platform]);

  const registerUrl = token
    ? `https://buildtrack-mobile.vercel.app/register?token=${encodeURIComponent(token)}`
    : `https://buildtrack-mobile.vercel.app/register`;

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
        <h1 style={styles.title}>Invitation BuildTrack</h1>

        {!token ? (
          <p style={styles.body}>Lien d'invitation invalide ou expiré.</p>
        ) : platform === 'web' ? (
          <>
            <p style={styles.body}>
              Vous avez été invité à rejoindre une organisation sur BuildTrack.
            </p>
            <p style={styles.bodySmall}>
              Pour rejoindre l'organisation, créez votre compte avec l'email sur lequel vous avez reçu cette invitation :
            </p>
            <a href={registerUrl} style={styles.btn}>
              Créer mon compte →
            </a>
            <div style={styles.installNote}>
              <p style={styles.installNoteTitle}>📱 Vous préférez l'application Android ?</p>
              <p style={styles.installNoteText}>
                Téléchargez la dernière version de BuildTrack pour Android :
              </p>
              <a href={APK_DOWNLOAD_URL} style={styles.installNoteBtn}>
                ⬇️ Télécharger l'APK
              </a>
              <p style={styles.installNoteHint}>
                BuildTrack n'est pas encore publié sur l'App Store ni Google Play.
              </p>
            </div>
          </>
        ) : !deepLinkAttempted ? (
          <>
            <p style={styles.body}>Ouverture de BuildTrack en cours...</p>
            <div style={styles.loader} />
            <p style={styles.bodySmall}>Si l'application ne s'ouvre pas, vous pouvez continuer sur le web :</p>
            <a href={registerUrl} style={styles.btn}>
              Continuer sur le web →
            </a>
            {platform === 'android' && (
              <a href={APK_DOWNLOAD_URL} style={styles.btnSecondary}>
                ⬇️ Télécharger l'application Android
              </a>
            )}
          </>
        ) : (
          <>
            <p style={styles.body}>
              BuildTrack n'est pas encore installé sur votre appareil.
            </p>
            <a href={registerUrl} style={styles.btn}>
              Continuer sur le web →
            </a>
            {platform === 'android' ? (
              <div style={styles.installNote}>
                <p style={styles.installNoteTitle}>📱 Installer l'application Android</p>
                <p style={styles.installNoteText}>
                  Téléchargez le fichier APK officiel de BuildTrack et installez-le sur votre téléphone :
                </p>
                <a href={APK_DOWNLOAD_URL} style={styles.installNoteBtn}>
                  ⬇️ Télécharger l'APK
                </a>
                <p style={styles.installNoteHint}>
                  Au lancement de l'installation, Android peut vous demander d'autoriser les sources inconnues. BuildTrack n'est pas encore publié sur Google Play.
                </p>
              </div>
            ) : (
              <div style={styles.installNote}>
                <p style={styles.installNoteTitle}>📱 Application mobile</p>
                <p style={styles.installNoteText}>
                  BuildTrack n'est pas encore disponible sur l'App Store. En attendant, utilisez la version web.
                </p>
              </div>
            )}
          </>
        )}

        <div style={styles.footer}>
          <p style={styles.footerText}>BuildTrack — Gestion de chantier numérique</p>
        </div>
      </div>
    </div>
  );
}

export default function InvitePage() {
  return (
    <Suspense fallback={<div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', background: '#F4F7FB' }}>Chargement...</div>}>
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
