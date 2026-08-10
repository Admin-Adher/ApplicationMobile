'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { getRequestedLang } from '@/lib/i18n';

const BRAND = '#003082';
const ACCENT = '#FFCB00';

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ??
  'https://jzeojdpgglbxjdasjgta.supabase.co';
const supabaseKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp6ZW9qZHBnZ2xieGpkYXNqZ3RhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ4Mjg1ODAsImV4cCI6MjA5MDQwNDU4MH0.ZcU5EAYQMEnQHVe0-6Wff_1sBanvjtdZZ0hJNJGLAz0';

const APP_STORE_URL = 'https://apps.apple.com/app/buildtrack';
const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.buildtrack.app';

const COPY = {
  fr: {
    incompleteLink: "Lien d'invitation incomplet (aucun code).",
    verifyInvitationFailed: "Impossible de vérifier l'invitation. Vérifiez votre connexion.",
    invitationNotFound: 'Cette invitation est introuvable ou a été annulée.',
    genericError: 'Une erreur est survenue.',
    nameRequired: 'Veuillez saisir votre nom complet.',
    passwordShort: 'Le mot de passe doit contenir au moins 8 caractères.',
    passwordMismatch: 'Les deux mots de passe ne correspondent pas.',
    invitationCheckFailed: 'Impossible de vérifier votre invitation. Réessayez.',
    noPendingInvitation: "Aucune invitation en attente n'a été trouvée pour cet email.",
    alreadyRegistered: "Un compte existe déjà avec cet email. Connectez-vous depuis l'application.",
    createAccountFailed: 'Impossible de créer le compte.',
    loadingTitle: 'Vérification...',
    loadingText: 'Nous validons votre invitation.',
    invalidTitle: 'Lien invalide',
    expiredTitle: 'Invitation expirée',
    expiredText: 'Demandez à votre administrateur de vous renvoyer une invitation.',
    usedTitle: 'Invitation déjà utilisée',
    usedText: "Connectez-vous directement depuis l'application BuildTrack.",
    createTitle: 'Créer votre compte',
    invitedBy: 'vous invite',
    invited: 'Vous avez été invité',
    join: 'à rejoindre',
    emailLabel: "Email d'invitation",
    fullNameLabel: 'Nom complet',
    fullNamePlaceholder: 'Jean Dupont',
    passwordLabel: 'Mot de passe',
    passwordPlaceholder: 'Min. 8 caractères',
    confirmPasswordLabel: 'Confirmer le mot de passe',
    confirmPasswordPlaceholder: 'Répétez le mot de passe',
    submitting: 'Création en cours...',
    submit: 'Créer mon compte',
    successTitle: 'Compte créé !',
    successTextStart: 'Votre compte',
    successTextEnd: "est prêt. Téléchargez l'app BuildTrack et connectez-vous pour rejoindre votre organisation.",
    loading: 'Chargement...',
  },
  en: {
    incompleteLink: 'Incomplete invitation link (missing code).',
    verifyInvitationFailed: 'Unable to verify the invitation. Check your connection.',
    invitationNotFound: 'This invitation cannot be found or was cancelled.',
    genericError: 'An error occurred.',
    nameRequired: 'Please enter your full name.',
    passwordShort: 'The password must contain at least 8 characters.',
    passwordMismatch: 'The two passwords do not match.',
    invitationCheckFailed: 'Unable to verify your invitation. Try again.',
    noPendingInvitation: 'No pending invitation was found for this email.',
    alreadyRegistered: 'An account already exists with this email. Sign in from the app.',
    createAccountFailed: 'Unable to create the account.',
    loadingTitle: 'Checking...',
    loadingText: 'We are validating your invitation.',
    invalidTitle: 'Invalid link',
    expiredTitle: 'Invitation expired',
    expiredText: 'Ask your administrator to send you a new invitation.',
    usedTitle: 'Invitation already used',
    usedText: 'Sign in directly from the BuildTrack app.',
    createTitle: 'Create your account',
    invitedBy: 'invites you',
    invited: 'You have been invited',
    join: 'to join',
    emailLabel: 'Invitation email',
    fullNameLabel: 'Full name',
    fullNamePlaceholder: 'John Smith',
    passwordLabel: 'Password',
    passwordPlaceholder: 'Min. 8 characters',
    confirmPasswordLabel: 'Confirm password',
    confirmPasswordPlaceholder: 'Repeat password',
    submitting: 'Creating account...',
    submit: 'Create my account',
    successTitle: 'Account created!',
    successTextStart: 'Your account',
    successTextEnd: 'is ready. Download the BuildTrack app and sign in to join your organization.',
    loading: 'Loading...',
  },
  es: {
    incompleteLink: 'Enlace de invitación incompleto (sin código).',
    verifyInvitationFailed: 'No se pudo verificar la invitación. Comprueba tu conexión.',
    invitationNotFound: 'Esta invitación no existe o fue cancelada.',
    genericError: 'Se ha producido un error.',
    nameRequired: 'Introduce tu nombre completo.',
    passwordShort: 'La contraseña debe tener al menos 8 caracteres.',
    passwordMismatch: 'Las dos contraseñas no coinciden.',
    invitationCheckFailed: 'No se pudo verificar tu invitación. Inténtalo de nuevo.',
    noPendingInvitation: 'No se encontró ninguna invitación pendiente para este email.',
    alreadyRegistered: 'Ya existe una cuenta con este email. Inicia sesión desde la aplicación.',
    createAccountFailed: 'No se pudo crear la cuenta.',
    loadingTitle: 'Verificando...',
    loadingText: 'Estamos validando tu invitación.',
    invalidTitle: 'Enlace no válido',
    expiredTitle: 'Invitación caducada',
    expiredText: 'Pide a tu administrador que te envíe una nueva invitación.',
    usedTitle: 'Invitación ya utilizada',
    usedText: 'Inicia sesión directamente desde la aplicación BuildTrack.',
    createTitle: 'Crear tu cuenta',
    invitedBy: 'te invita',
    invited: 'Has sido invitado',
    join: 'a unirte a',
    emailLabel: 'Email de invitación',
    fullNameLabel: 'Nombre completo',
    fullNamePlaceholder: 'Juan García',
    passwordLabel: 'Contraseña',
    passwordPlaceholder: 'Mín. 8 caracteres',
    confirmPasswordLabel: 'Confirmar contraseña',
    confirmPasswordPlaceholder: 'Repite la contraseña',
    submitting: 'Creando cuenta...',
    submit: 'Crear mi cuenta',
    successTitle: '¡Cuenta creada!',
    successTextStart: 'Tu cuenta',
    successTextEnd: 'está lista. Descarga la app BuildTrack e inicia sesión para unirte a tu organización.',
    loading: 'Cargando...',
  },
} as const;

type Stage =
  | { kind: 'loading' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'expired' }
  | { kind: 'used' }
  | { kind: 'form'; email: string; organizationName: string; invitedByName: string }
  | { kind: 'submitting'; email: string; organizationName: string; invitedByName: string }
  | { kind: 'success'; email: string };

function RegisterContent() {
  const params = useSearchParams();
  const lang = getRequestedLang((name) => params.get(name));
  const copy = COPY[lang];
  const token = params.get('token') ?? '';

  const [stage, setStage] = useState<Stage>({ kind: 'loading' });
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      if (!token) {
        setStage({ kind: 'invalid', reason: copy.incompleteLink });
        return;
      }

      try {
        const supabase = createClient(supabaseUrl, supabaseKey);
        const { data, error } = await supabase.rpc('get_invitation_by_token', { p_token: token });
        if (cancelled) return;

        if (error) {
          console.warn('[register] get_invitation_by_token error:', error.message);
          setStage({ kind: 'invalid', reason: copy.verifyInvitationFailed });
          return;
        }

        const row = Array.isArray(data) ? data[0] : data;
        if (!row || !row.email) {
          setStage({ kind: 'invalid', reason: copy.invitationNotFound });
          return;
        }
        if (row.status && row.status !== 'pending') {
          setStage({ kind: 'used' });
          return;
        }
        if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
          setStage({ kind: 'expired' });
          return;
        }

        setStage({
          kind: 'form',
          email: row.email,
          organizationName: row.organization_name || '',
          invitedByName: row.invited_by_name || '',
        });
      } catch (err: any) {
        if (cancelled) return;
        setStage({ kind: 'invalid', reason: err?.message ?? copy.genericError });
      }
    }

    bootstrap();
    return () => { cancelled = true; };
  }, [token, copy]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');

    if (stage.kind !== 'form') return;

    if (!name.trim()) { setErrorMsg(copy.nameRequired); return; }
    if (password.length < 8) { setErrorMsg(copy.passwordShort); return; }
    if (password !== confirm) { setErrorMsg(copy.passwordMismatch); return; }

    const { email, organizationName, invitedByName } = stage;
    setStage({ kind: 'submitting', email, organizationName, invitedByName });

    try {
      const supabase = createClient(supabaseUrl, supabaseKey);

      const { data: hasInv, error: rpcErr } = await supabase.rpc(
        'check_invitation_token',
        {
          p_token: token,
          p_email: email.trim().toLowerCase(),
        }
      );
      if (rpcErr) {
        setErrorMsg(copy.invitationCheckFailed);
        setStage({ kind: 'form', email, organizationName, invitedByName });
        return;
      }
      if (!hasInv) {
        setErrorMsg(copy.noPendingInvitation);
        setStage({ kind: 'form', email, organizationName, invitedByName });
        return;
      }

      const { data: signUpData, error: signUpErr } = await supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: { data: { full_name: name.trim() } },
      });

      if (signUpErr) {
        const lower = (signUpErr.message ?? '').toLowerCase();
        if (lower.includes('already registered') || lower.includes('user_already_exists')) {
          setErrorMsg(copy.alreadyRegistered);
        } else {
          setErrorMsg(signUpErr.message ?? copy.createAccountFailed);
        }
        setStage({ kind: 'form', email, organizationName, invitedByName });
        return;
      }

      // If signUp returned a session immediately (email confirmation disabled),
      // attempt to link the invitation right away.
      if (signUpData?.session) {
        try {
          await supabase.rpc('ensure_current_user_profile', { p_name: name.trim() });
          await supabase.rpc('link_invitation_for_current_user');
        } catch (linkErr) {
          console.warn('[register] link_invitation_for_current_user warning:', linkErr);
        }
        await supabase.auth.signOut();
      }

      setStage({ kind: 'success', email });
    } catch (err: any) {
      setErrorMsg(err?.message ?? copy.genericError);
      setStage({ kind: 'form', email, organizationName, invitedByName });
    }
  }

  return (
    <div style={styles.container}>
      <div style={styles.card}>
        <div style={styles.headerRow}>
          <div style={styles.logoBox}>B</div>
          <div>
            <div style={styles.brandName}>Bouygues</div>
            <div style={styles.brandSub}>Construction</div>
          </div>
        </div>
        <div style={styles.divider} />

        {stage.kind === 'loading' && (
          <>
            <div style={styles.iconCircle}>⏳</div>
            <h1 style={styles.title}>{copy.loadingTitle}</h1>
            <p style={styles.body}>{copy.loadingText}</p>
          </>
        )}

        {stage.kind === 'invalid' && (
          <>
            <div style={{ ...styles.iconCircle, background: '#FEF2F2', color: '#B42318' }}>!</div>
            <h1 style={styles.title}>{copy.invalidTitle}</h1>
            <p style={styles.body}>{stage.reason}</p>
          </>
        )}

        {stage.kind === 'expired' && (
          <>
            <div style={{ ...styles.iconCircle, background: '#FEF2F2', color: '#B42318' }}>⌛</div>
            <h1 style={styles.title}>{copy.expiredTitle}</h1>
            <p style={styles.body}>{copy.expiredText}</p>
          </>
        )}

        {stage.kind === 'used' && (
          <>
            <div style={{ ...styles.iconCircle, background: '#ECFDF5', color: '#067647' }}>✓</div>
            <h1 style={styles.title}>{copy.usedTitle}</h1>
            <p style={styles.body}>{copy.usedText}</p>
            <div style={styles.storeRow}>
              <a href={APP_STORE_URL} style={styles.storeBtn}>📱 App Store</a>
              <a href={PLAY_STORE_URL} style={styles.storeBtn}>🤖 Google Play</a>
            </div>
          </>
        )}

        {(stage.kind === 'form' || stage.kind === 'submitting') && (
          <>
            <h1 style={styles.title}>{copy.createTitle}</h1>
            <div style={styles.invitationBox}>
              <p style={{ margin: 0, fontSize: 13, color: '#334155', lineHeight: 1.6 }}>
                {stage.invitedByName ? <><strong style={{ color: BRAND }}>{stage.invitedByName}</strong> {copy.invitedBy}</> : copy.invited}
                {stage.organizationName ? <> {copy.join} <strong style={{ color: BRAND }}>{stage.organizationName}</strong></> : ''}.
              </p>
            </div>

            <form onSubmit={handleSubmit} style={{ width: '100%' }}>
              <label style={styles.label}>{copy.emailLabel}</label>
              <input
                type="email"
                value={stage.email}
                disabled
                style={{ ...styles.input, background: '#EEF3FA', color: BRAND, fontWeight: 600 }}
              />

              <label style={styles.label}>{copy.fullNameLabel}</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={copy.fullNamePlaceholder}
                disabled={stage.kind === 'submitting'}
                style={styles.input}
                autoFocus
              />

              <label style={styles.label}>{copy.passwordLabel}</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={copy.passwordPlaceholder}
                disabled={stage.kind === 'submitting'}
                style={styles.input}
              />

              <label style={styles.label}>{copy.confirmPasswordLabel}</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder={copy.confirmPasswordPlaceholder}
                disabled={stage.kind === 'submitting'}
                style={styles.input}
              />

              {errorMsg && <p style={styles.error}>{errorMsg}</p>}

              <button
                type="submit"
                disabled={stage.kind === 'submitting'}
                style={{
                  ...styles.btn,
                  opacity: stage.kind === 'submitting' ? 0.6 : 1,
                  cursor: stage.kind === 'submitting' ? 'not-allowed' : 'pointer',
                }}
              >
                {stage.kind === 'submitting' ? copy.submitting : copy.submit}
              </button>
            </form>
          </>
        )}

        {stage.kind === 'success' && (
          <>
            <div style={{ ...styles.iconCircle, background: '#ECFDF5', color: '#067647' }}>✓</div>
            <h1 style={styles.title}>{copy.successTitle}</h1>
            <p style={styles.body}>
              {copy.successTextStart} <strong>{stage.email}</strong> {copy.successTextEnd}
            </p>
            <div style={styles.storeRow}>
              <a href={APP_STORE_URL} style={styles.storeBtn}>📱 App Store</a>
              <a href={PLAY_STORE_URL} style={styles.storeBtn}>🤖 Google Play</a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div style={styles.container}><div style={styles.card}><p>{COPY.fr.loading}</p></div></div>}>
      <RegisterContent />
    </Suspense>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    background: 'linear-gradient(180deg, #F4F7FB 0%, #E8EFF8 100%)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 16, fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
  },
  card: {
    width: '100%', maxWidth: 440, background: '#fff',
    borderRadius: 18, padding: 32, boxShadow: '0 8px 24px rgba(0,48,130,0.08)',
    display: 'flex', flexDirection: 'column', alignItems: 'center',
  },
  headerRow: { display: 'flex', alignItems: 'center', gap: 12, alignSelf: 'flex-start' },
  logoBox: {
    width: 44, height: 44, background: ACCENT, borderRadius: 10,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontWeight: 700, fontSize: 22, color: BRAND,
  },
  brandName: { fontWeight: 700, fontSize: 16, color: BRAND, lineHeight: 1.2 },
  brandSub: { fontSize: 12, color: '#64748B' },
  divider: { width: 36, height: 3, background: ACCENT, borderRadius: 2, alignSelf: 'flex-start', margin: '14px 0 24px' },
  iconCircle: {
    width: 64, height: 64, borderRadius: 32, background: '#EEF3FA',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 28, color: BRAND, marginBottom: 16,
  },
  title: {
    fontSize: 22, fontWeight: 700, color: BRAND,
    margin: '0 0 12px', textAlign: 'center', alignSelf: 'center',
  },
  body: { fontSize: 14, color: '#334155', lineHeight: 1.6, margin: '0 0 20px', textAlign: 'center' },
  invitationBox: {
    width: '100%', background: '#EEF3FA', border: '1px solid #DDE4EE',
    borderRadius: 10, padding: '12px 14px', marginBottom: 20,
  },
  label: {
    display: 'block', fontSize: 11, fontWeight: 600, color: '#64748B',
    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 6, marginTop: 14,
  },
  input: {
    width: '100%', boxSizing: 'border-box', padding: '12px 14px',
    border: '1px solid #DDE4EE', borderRadius: 10,
    fontSize: 15, color: '#0F172A', background: '#fff', outline: 'none',
  },
  btn: {
    width: '100%', marginTop: 22, padding: '14px 20px',
    background: ACCENT, color: BRAND, fontWeight: 700, fontSize: 15,
    border: 'none', borderRadius: 12,
  },
  error: {
    color: '#B42318', fontSize: 13, marginTop: 12, marginBottom: 0,
    background: '#FEF2F2', padding: '10px 12px', borderRadius: 8,
  },
  storeRow: { display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap', justifyContent: 'center' },
  storeBtn: {
    padding: '10px 16px', background: BRAND, color: '#fff',
    borderRadius: 10, textDecoration: 'none', fontSize: 13, fontWeight: 600,
  },
};
