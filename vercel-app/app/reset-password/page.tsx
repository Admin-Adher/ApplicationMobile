'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const BRAND = '#003082';
const ACCENT = '#FFCB00';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export default function ResetPasswordPage() {
  const [stage, setStage] = useState<'loading' | 'form' | 'success' | 'error'>('loading');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [refreshToken, setRefreshToken] = useState('');

  useEffect(() => {
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
      setErrorMsg('Lien de réinitialisation invalide ou expiré. Veuillez faire une nouvelle demande.');
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');

    if (password.length < 8) {
      setErrorMsg('Le mot de passe doit contenir au moins 8 caractères.');
      return;
    }
    if (password !== confirm) {
      setErrorMsg('Les mots de passe ne correspondent pas.');
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
        setErrorMsg('Lien expiré. Veuillez faire une nouvelle demande de réinitialisation.');
        setSubmitting(false);
        return;
      }

      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        setErrorMsg(error.message ?? 'Impossible de mettre à jour le mot de passe.');
        setSubmitting(false);
        return;
      }

      await supabase.auth.signOut();
      setStage('success');
    } catch (err: any) {
      setErrorMsg(`Erreur: ${err?.message ?? JSON.stringify(err)}`);
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
          <p style={s.body}>Vérification du lien...</p>
        )}

        {stage === 'error' && (
          <>
            <div style={s.iconWrap}>🔒</div>
            <h1 style={s.title}>Lien invalide</h1>
            <p style={s.body}>{errorMsg}</p>
            <a href="https://buildtrack-mobile.vercel.app" style={s.btn}>
              Retour à l'accueil
            </a>
          </>
        )}

        {stage === 'form' && (
          <>
            <div style={s.iconWrap}>🔑</div>
            <h1 style={s.title}>Nouveau mot de passe</h1>
            <p style={s.body}>Choisissez un mot de passe sécurisé d'au moins 8 caractères.</p>

            <form onSubmit={handleSubmit} style={s.form}>
              <div style={s.field}>
                <label style={s.label}>Nouveau mot de passe</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Min. 8 caractères"
                  style={s.input}
                  required
                />
              </div>
              <div style={s.field}>
                <label style={s.label}>Confirmer le mot de passe</label>
                <input
                  type="password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  placeholder="Répétez le mot de passe"
                  style={{
                    ...s.input,
                    borderColor: confirm && confirm !== password ? '#DC2626' : '#DDE4EE',
                  }}
                  required
                />
                {confirm && confirm !== password && (
                  <p style={s.hint}>Les mots de passe ne correspondent pas</p>
                )}
              </div>

              {errorMsg ? (
                <div style={s.errorBox}>
                  <p style={s.errorText}>{errorMsg}</p>
                </div>
              ) : null}

              <button type="submit" disabled={submitting} style={s.btn}>
                {submitting ? 'Mise à jour...' : 'Mettre à jour le mot de passe →'}
              </button>
            </form>
          </>
        )}

        {stage === 'success' && (
          <>
            <div style={s.iconWrap}>✅</div>
            <h1 style={s.title}>Mot de passe mis à jour !</h1>
            <p style={s.body}>
              Votre mot de passe a été modifié avec succès. Vous pouvez maintenant vous connecter avec votre nouveau mot de passe.
            </p>
            <div style={s.infoBox}>
              <p style={s.infoText}>
                Ouvrez l'application BuildTrack et connectez-vous avec votre nouveau mot de passe.
              </p>
            </div>
            <a href="https://buildtrack-mobile.vercel.app" style={s.btn}>
              Ouvrir BuildTrack →
            </a>
          </>
        )}

        <div style={s.footer}>
          <p style={s.footerText}>BuildTrack — Gestion de chantier numérique</p>
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
