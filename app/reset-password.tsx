import { View, Text, StyleSheet, TextInput, TouchableOpacity, Platform, Alert, ScrollView, Keyboard, KeyboardAvoidingView, ActivityIndicator } from 'react-native';
import { useState, useEffect } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as Linking from 'expo-linking';
import { C } from '@/constants/colors';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

type Status = 'loading' | 'ready' | 'saving' | 'success' | 'error_token' | 'error_save';
type Strength = 0 | 1 | 2 | 3;

const STRENGTH_COLORS: Record<Strength, string> = {
  0: '#E5E7EB',
  1: '#EF4444',
  2: '#F59E0B',
  3: '#22C55E',
};
const STRENGTH_LABELS: Record<Strength, string> = {
  0: '',
  1: 'Faible',
  2: 'Moyen',
  3: 'Fort',
};

function getStrength(pwd: string): Strength {
  if (!pwd) return 0;
  let score = 0;
  if (pwd.length >= 6) score++;
  if (pwd.length >= 10) score++;
  if (/[A-Z]/.test(pwd) && /[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd) && score >= 2) score++;
  return Math.min(3, score) as Strength;
}

function parseFragment(fragment: string): Record<string, string> {
  const params: Record<string, string> = {};
  const clean = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  for (const part of clean.split('&')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    params[decodeURIComponent(part.slice(0, idx))] = decodeURIComponent(part.slice(idx + 1));
  }
  return params;
}

async function extractTokensFromUrl(): Promise<{ accessToken: string; refreshToken: string } | null> {
  let fragment = '';

  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined') {
      fragment = window.location.hash;
    }
  } else {
    const initial = await Linking.getInitialURL();
    if (initial) {
      const hashIdx = initial.indexOf('#');
      if (hashIdx !== -1) fragment = initial.slice(hashIdx);
    }
  }

  if (!fragment) return null;
  const params = parseFragment(fragment);
  if (params.type !== 'recovery') return null;
  if (!params.access_token || !params.refresh_token) return null;
  return { accessToken: params.access_token, refreshToken: params.refresh_token };
}

export default function ResetPasswordScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [status, setStatus] = useState<Status>('loading');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [fieldError, setFieldError] = useState('');

  const strength = getStrength(password);
  const strengthColor = STRENGTH_COLORS[strength];
  const strengthLabel = STRENGTH_LABELS[strength];

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isSupabaseConfigured) { setStatus('error_token'); return; }
      const tokens = await extractTokensFromUrl();
      if (cancelled) return;
      if (!tokens) { setStatus('error_token'); return; }
      const { error } = await supabase.auth.setSession({
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
      });
      if (cancelled) return;
      setStatus(error ? 'error_token' : 'ready');
    })();
    return () => { cancelled = true; };
  }, []);

  async function handleSave() {
    const pwd = password.trim();
    if (pwd.length < 6) {
      setFieldError('Le mot de passe doit contenir au moins 6 caractères.');
      return;
    }
    if (pwd !== confirm.trim()) {
      setFieldError('Les mots de passe ne correspondent pas.');
      return;
    }
    setFieldError('');
    Keyboard.dismiss();
    setStatus('saving');
    const { error } = await supabase.auth.updateUser({ password: pwd });
    if (error) {
      setStatus('error_save');
      return;
    }
    await supabase.auth.signOut();
    setStatus('success');
  }

  const paddingTop = (Platform.OS === 'web' ? 0 : insets.top) + 20;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Hero */}
        <View style={[styles.hero, { paddingTop }]}>
          <View style={styles.logoRow}>
            <View style={styles.logoBox}>
              <Text style={styles.logoLetter}>B</Text>
            </View>
            <View>
              <Text style={styles.brandName}>Bouygues</Text>
              <Text style={styles.brandSub}>Construction</Text>
            </View>
          </View>
          <View style={styles.heroDivider} />
          <Text style={styles.heroTitle}>BuildTrack</Text>
          <Text style={styles.heroTagline}>Gestion de chantier numérique</Text>
        </View>

        {/* Card */}
        <View style={styles.formContainer}>
          <View style={styles.card}>

            {/* ── Chargement ── */}
            {status === 'loading' && (
              <View style={styles.centeredBlock}>
                <ActivityIndicator size="large" color={C.primary} />
                <Text style={styles.loadingText}>Vérification du lien…</Text>
              </View>
            )}

            {/* ── Lien invalide / expiré ── */}
            {status === 'error_token' && (
              <View style={styles.centeredBlock}>
                <View style={[styles.iconCircle, { backgroundColor: C.openBg }]}>
                  <Ionicons name="warning-outline" size={32} color={C.open} />
                </View>
                <Text style={styles.errorTitle}>Lien invalide ou expiré</Text>
                <Text style={styles.errorBody}>
                  Ce lien de réinitialisation est invalide ou a expiré (durée de validité : 1 heure).
                  Veuillez refaire la demande depuis l'écran de connexion.
                </Text>
                <TouchableOpacity style={styles.btn} onPress={() => router.replace('/login')} activeOpacity={0.85}>
                  <Ionicons name="arrow-back-outline" size={18} color={C.primary} />
                  <Text style={styles.btnText}>Retour à la connexion</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* ── Formulaire ── */}
            {(status === 'ready' || status === 'saving' || status === 'error_save') && (
              <>
                <View style={styles.titleRow}>
                  <View style={[styles.iconCircle, { backgroundColor: C.primaryBg }]}>
                    <Ionicons name="lock-open-outline" size={24} color={C.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardTitle}>Nouveau mot de passe</Text>
                    <Text style={styles.cardSub}>Choisissez un mot de passe sécurisé d'au moins 6 caractères.</Text>
                  </View>
                </View>

                <View style={styles.field}>
                  <Text style={styles.label}>Nouveau mot de passe</Text>
                  <View style={[styles.inputWrap, fieldError ? styles.inputWrapError : null]}>
                    <Ionicons name="lock-closed-outline" size={18} color={C.textMuted} />
                    <TextInput
                      style={styles.input}
                      placeholder="••••••••"
                      placeholderTextColor={C.textMuted}
                      value={password}
                      onChangeText={v => { setPassword(v); setFieldError(''); }}
                      secureTextEntry={!showPass}
                      autoFocus
                    />
                    <TouchableOpacity onPress={() => setShowPass(p => !p)} hitSlop={8}>
                      <Ionicons name={showPass ? 'eye-off-outline' : 'eye-outline'} size={18} color={C.textMuted} />
                    </TouchableOpacity>
                  </View>

                  {/* ── Indicateur de force ── */}
                  {password.length > 0 && (
                    <View style={styles.strengthWrap}>
                      <View style={styles.strengthBars}>
                        {([1, 2, 3] as Strength[]).map(lvl => (
                          <View
                            key={lvl}
                            style={[
                              styles.strengthBar,
                              { backgroundColor: strength >= lvl ? strengthColor : '#E5E7EB' },
                            ]}
                          />
                        ))}
                      </View>
                      <Text style={[styles.strengthLabel, { color: strengthColor }]}>
                        {strengthLabel}
                      </Text>
                    </View>
                  )}
                </View>

                <View style={styles.field}>
                  <Text style={styles.label}>Confirmer le mot de passe</Text>
                  <View style={[styles.inputWrap, fieldError ? styles.inputWrapError : null]}>
                    <Ionicons name="lock-closed-outline" size={18} color={C.textMuted} />
                    <TextInput
                      style={styles.input}
                      placeholder="••••••••"
                      placeholderTextColor={C.textMuted}
                      value={confirm}
                      onChangeText={v => { setConfirm(v); setFieldError(''); }}
                      secureTextEntry={!showConfirm}
                    />
                    <TouchableOpacity onPress={() => setShowConfirm(p => !p)} hitSlop={8}>
                      <Ionicons name={showConfirm ? 'eye-off-outline' : 'eye-outline'} size={18} color={C.textMuted} />
                    </TouchableOpacity>
                  </View>
                  {fieldError ? (
                    <View style={styles.errorRow}>
                      <Ionicons name="alert-circle-outline" size={13} color={C.open} />
                      <Text style={styles.errorText}>{fieldError}</Text>
                    </View>
                  ) : null}
                </View>

                {status === 'error_save' && (
                  <View style={styles.saveBanner}>
                    <Ionicons name="warning-outline" size={14} color={C.open} />
                    <Text style={styles.saveBannerText}>
                      Une erreur est survenue. Réessayez ou refaites la demande depuis la connexion.
                    </Text>
                  </View>
                )}

                <TouchableOpacity
                  style={[styles.btn, status === 'saving' && styles.btnDisabled]}
                  onPress={handleSave}
                  disabled={status === 'saving'}
                  activeOpacity={0.85}
                >
                  {status === 'saving' ? (
                    <>
                      <ActivityIndicator size="small" color={C.primary} />
                      <Text style={styles.btnText}>Enregistrement…</Text>
                    </>
                  ) : (
                    <>
                      <Ionicons name="checkmark-circle-outline" size={20} color={C.primary} />
                      <Text style={styles.btnText}>Enregistrer le mot de passe</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            )}

            {/* ── Succès ── */}
            {status === 'success' && (
              <View style={styles.centeredBlock}>
                <View style={[styles.iconCircle, { backgroundColor: '#E6F9F0', width: 72, height: 72, borderRadius: 36 }]}>
                  <Ionicons name="checkmark-circle" size={40} color={C.closed} />
                </View>
                <Text style={styles.successTitle}>Mot de passe modifié !</Text>
                <Text style={styles.successBody}>
                  Votre nouveau mot de passe a bien été enregistré. Vous pouvez maintenant vous connecter.
                </Text>
                <TouchableOpacity style={styles.btn} onPress={() => router.replace('/login')} activeOpacity={0.85}>
                  <Ionicons name="log-in-outline" size={18} color={C.primary} />
                  <Text style={styles.btnText}>Se connecter</Text>
                </TouchableOpacity>
              </View>
            )}

          </View>
          <View style={{ height: insets.bottom + 24 }} />
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.primary },
  hero: {
    backgroundColor: C.primary,
    paddingHorizontal: 28,
    paddingBottom: 40,
  },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 28 },
  logoBox: {
    width: 52, height: 52, backgroundColor: C.accent, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  logoLetter: { fontSize: 28, fontFamily: 'Inter_700Bold', color: C.primary, lineHeight: 32 },
  brandName: { fontSize: 20, fontFamily: 'Inter_700Bold', color: '#FFFFFF', letterSpacing: 0.3 },
  brandSub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.65)', marginTop: 1 },
  heroDivider: { width: 40, height: 3, backgroundColor: C.accent, borderRadius: 2, marginBottom: 18 },
  heroTitle: { fontSize: 36, fontFamily: 'Inter_700Bold', color: '#FFFFFF', letterSpacing: -0.5 },
  heroTagline: { fontSize: 15, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.65)', marginTop: 6 },
  formContainer: {
    flex: 1, backgroundColor: C.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 20, paddingTop: 28,
  },
  card: {
    backgroundColor: C.surface, borderRadius: 18, padding: 24,
    borderWidth: 1, borderColor: C.border, marginBottom: 20, elevation: 2,
    ...Platform.select({
      web: { boxShadow: '0px 2px 12px rgba(0,48,130,0.06)' } as any,
      default: { shadowColor: '#003082', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 12 },
    }),
  },
  centeredBlock: { alignItems: 'center', paddingVertical: 8, gap: 14 },
  iconCircle: {
    width: 56, height: 56, borderRadius: 28,
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  loadingText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 8 },
  errorTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.text, textAlign: 'center' },
  errorBody: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, textAlign: 'center', lineHeight: 20 },
  successTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.closed, textAlign: 'center' },
  successBody: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, textAlign: 'center', lineHeight: 20 },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 14, marginBottom: 24 },
  cardTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: C.text, marginBottom: 4 },
  cardSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, lineHeight: 18 },
  field: { marginBottom: 16 },
  label: {
    fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textSub,
    marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.6,
  },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.surface2, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 14,
    borderWidth: 1, borderColor: C.border,
  },
  inputWrapError: { borderColor: C.open },
  input: { flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular', color: C.text },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  errorText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.open, flex: 1 },
  saveBanner: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: C.openBg, borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: C.open + '30', marginBottom: 16,
  },
  saveBannerText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.open, flex: 1, lineHeight: 18 },
  btn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.accent, borderRadius: 14, paddingVertical: 16, marginTop: 8,
  },
  btnDisabled: { opacity: 0.6 },
  btnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.primary },
  strengthWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  strengthBars: { flexDirection: 'row', gap: 4, flex: 1 },
  strengthBar: { flex: 1, height: 4, borderRadius: 2 },
  strengthLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', minWidth: 36, textAlign: 'right' },
});
