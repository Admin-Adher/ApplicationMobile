'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

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
  const token = params.get('token') ?? '';
  const emailFromUrl = params.get('email') ?? '';
  const orgFromUrl = params.get('org') ?? '';
  const invitedByFromUrl = params.get('invitedBy') ?? '';

  const [stage, setStage] = useState<Stage>({ kind: 'loading' });
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      // If no token, fall back to URL params (manual ?email=... use case)
      if (!token) {
        if (emailFromUrl) {
          setStage({
            kind: 'form',
            email: emailFromUrl,
            organizationName: orgFromUrl,
            invitedByName: invitedByFromUrl,
          });
          return;
        }
        setStage({ kind: 'invalid', reason: 'Lien d\'invitation incomplet (aucun code).' });
        return;
      }

      try {
        const supabase = createClient(supabaseUrl, supabaseKey);
        const { data, error } = await supabase.rpc('get_invitation_by_token', { p_token: token });
        if (cancelled) return;

        if (error) {
          console.warn('[register] get_invitation_by_token error:', error.message);
          setStage({ kind: 'invalid', reason: 'Impossible de vérifier l\'invitation. Vérifiez votre connexion.' });
          return;
        }

        const row = Array.isArray(data) ? data[0] : data;
        if (!row || !row.email) {
          setStage({ kind: 'invalid', reason: 'Cette invitation est introuvable ou a été annulée.' });
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
        setStage({ kind: 'invalid', reason: err?.message ?? 'Une erreur est survenue.' });
      }
    }

    bootstrap();
    return () => { cancelled = true; };
  }, [token, emailFromUrl, orgFromUrl, invitedByFromUrl]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');

    if (stage.kind !== 'form') return;

    if (!name.trim()) { setErrorMsg('Veuillez saisir votre nom complet.'); return; }
    if (password.length < 8) { setErrorMsg('Le mot de passe doit contenir au moins 8 caractères.'); return; }
    if (password !== confirm) { setErrorMsg('Les deux mots de passe ne correspondent pas.'); return; }

    const { email, organizationName, invitedByName } = stage;
    setStage({ kind: 'submitting', email, organizationName, invitedByName });

    try {
      const supabase = createClient(supabaseUrl, supabaseKey);

      const { data: hasInv, error: rpcErr } = await supabase.rpc(
        'check_pending_invitation',
        { p_email: email.trim().toLowerCase() }
      );
      if (rpcErr) {
        setErrorMsg('Impossible de vérifier votre invitation. Réessayez.');
        setStage({ kind: 'form', email, organizationName, invitedByName });
        return;
      }
      if (!hasInv) {
        setErrorMsg('Aucune invitation en attente n\'a été trouvée pour cet email.');
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
          setErrorMsg('Un compte existe déjà avec cet email. Connectez-vous depuis l\'application.');
        } else {
          setErrorMsg(signUpErr.message ?? 'Impossible de créer le compte.');
        }
        setStage({ kind: 'form', email, organizationName, invitedByName });
        return;
      }

      // If signUp returned a session immediately (email confirmation disabled),
      // attempt to link the invitation right away.
      if (signUpData?.session) {
        try {
          await supabase.rpc('link_invitation_for_current_user');
        } catch (linkErr) {
          console.warn('[register] link_invitation_for_current_user warning:', linkErr);
        }
        await supabase.auth.signOut();
      }

      setStage({ kind: 'success', email });
    } catch (err: any) {
      setErrorMsg(err?.message ?? 'Une erreur est survenue.');
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
            <h1 style={styles.title}>Vérification...</h1>
            <p style={styles.body}>Nous validons votre invitation.</p>
          </>
        )}

        {stage.kind === 'invalid' && (
          <>
            <div style={{ ...styles.iconCircle, background: '#FEF2F2', color: '#B42318' }}>!</div>
            <h1 style={styles.title}>Lien invalide</h1>
            <p style={styles.body}>{stage.reason}</p>
          </>
        )}

        {stage.kind === 'expired' && (
          <>
            <div style={{ ...styles.iconCircle, background: '#FEF2F2', color: '#B42318' }}>⌛</div>
            <h1 style={styles.title}>Invitation expirée</h1>
            <p style={styles.body}>Demandez à votre administrateur de vous renvoyer une invitation.</p>
          </>
        )}

        {stage.kind === 'used' && (
          <>
            <div style={{ ...styles.iconCircle, background: '#ECFDF5', color: '#067647' }}>✓</div>
            <h1 style={styles.title}>Invitation déjà utilisée</h1>
            <p style={styles.body}>Connectez-vous directement depuis l'application BuildTrack.</p>
            <div style={styles.storeRow}>
              <a href={APP_STORE_URL} style={styles.storeBtn}>📱 App Store</a>
              <a href={PLAY_STORE_URL} style={styles.storeBtn}>🤖 Google Play</a>
            </div>
          </>
        )}

        {(stage.kind === 'form' || stage.kind === 'submitting') && (
          <>
            <h1 style={styles.title}>Créer votre compte</h1>
            <div style={styles.invitationBox}>
              <p style={{ margin: 0, fontSize: 13, color: '#334155', lineHeight: 1.6 }}>
                {stage.invitedByName ? <><strong style={{ color: BRAND }}>{stage.invitedByName}</strong> vous invite</> : 'Vous avez été invité'}
                {stage.organizationName ? <> à rejoindre <strong style={{ color: BRAND }}>{stage.organizationName}</strong></> : ''}.
              </p>
            </div>

            <form onSubmit={handleSubmit} style={{ width: '100%' }}>
              <label style={styles.label}>Email d'invitation</label>
              <input
                type="email"
                value={stage.email}
                disabled
                style={{ ...styles.input, background: '#EEF3FA', color: BRAND, fontWeight: 600 }}
              />

              <label style={styles.label}>Nom complet</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jean Dupont"
                disabled={stage.kind === 'submitting'}
                style={styles.input}
                autoFocus
              />

              <label style={styles.label}>Mot de passe</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min. 8 caractères"
                disabled={stage.kind === 'submitting'}
                style={styles.input}
              />

              <label style={styles.label}>Confirmer le mot de passe</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Répétez le mot de passe"
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
                {stage.kind === 'submitting' ? 'Création en cours...' : 'Créer mon compte'}
              </button>
            </form>
          </>
        )}

        {stage.kind === 'success' && (
          <>
            <div style={{ ...styles.iconCircle, background: '#ECFDF5', color: '#067647' }}>✓</div>
            <h1 style={styles.title}>Compte créé !</h1>
            <p style={styles.body}>
              Votre compte <strong>{stage.email}</strong> est prêt.<br/>
              Téléchargez l'app BuildTrack et connectez-vous pour rejoindre votre organisation.
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
    <Suspense fallback={<div style={styles.container}><div style={styles.card}><p>Chargement...</p></div></div>}>
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
