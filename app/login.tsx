import { View, Text, StyleSheet, TextInput, TouchableOpacity, Platform, Alert, ScrollView, Keyboard, KeyboardAvoidingView, ActivityIndicator } from 'react-native';
import { useState, useEffect } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { C } from '@/constants/colors';
import { useAuth } from '@/context/AuthContext';
import { useApp } from '@/context/AppContext';
import { isSupabaseConfigured } from '@/lib/supabase';
import { requestPasswordReset } from '@/lib/email/client';


const DEMO_ACCOUNTS = [
  { email: 'admin@buildtrack.fr', label: 'Admin', color: C.primary },
  { email: 'j.dupont@buildtrack.fr', label: 'Conducteur', color: C.primary },
  { email: 'm.martin@buildtrack.fr', label: "Chef d'équipe", color: C.primary },
  { email: 'p.lambert@buildtrack.fr', label: 'Observateur', color: C.textSub },
];

const DEMO_EMAILS = new Set([
  'admin@buildtrack.fr',
  'superadmin@buildtrack.fr',
  'j.dupont@buildtrack.fr',
  'm.martin@buildtrack.fr',
  'p.lambert@buildtrack.fr',
  'st.martin@buildtrack.fr',
]);

const DEMO_USER_NAMES: Record<string, string> = {
  'admin@buildtrack.fr':     'Admin Système',
  'j.dupont@buildtrack.fr':  'Jean Dupont',
  'm.martin@buildtrack.fr':  'Marie Martin',
  'p.lambert@buildtrack.fr': 'Pierre Lambert',
};

const DEMO_PASSWORDS: Record<string, string> = {
  'admin@buildtrack.fr':       'pass123',
  'superadmin@buildtrack.fr':  'pass123',
  'j.dupont@buildtrack.fr':    'pass123',
  'm.martin@buildtrack.fr':    'pass123',
  'p.lambert@buildtrack.fr':   'pass123',
  'st.martin@buildtrack.fr':   'pass123',
};

type ForgotStatus = 'idle' | 'loading' | 'sent' | 'error';

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { login, seedStatus, user } = useAuth();
  const { setCurrentUser } = useApp();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);

  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotStatus, setForgotStatus] = useState<ForgotStatus>('idle');
  const [forgotError, setForgotError] = useState('');

  useEffect(() => {
    if (user?.name) setCurrentUser(user.name);
  }, [user?.name]);

  async function handleLogin() {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Champs requis', 'Veuillez saisir votre email et mot de passe.');
      return;
    }
    Keyboard.dismiss();
    setLoading(true);
    const trimmedEmail = email.trim();
    const result = await login(trimmedEmail, password);
    setLoading(false);
    if (result.success) {
      const name = DEMO_USER_NAMES[trimmedEmail];
      if (name) setCurrentUser(name);
    } else {
      Alert.alert('Erreur de connexion', result.error ?? 'Une erreur est survenue.');
    }
  }

  function fillDemo(demoEmail: string) {
    setEmail(demoEmail);
    setPassword(DEMO_PASSWORDS[demoEmail] ?? 'pass123');
    setShowForgot(false);
  }

  function openForgot() {
    setForgotEmail(email.trim());
    setForgotStatus('idle');
    setForgotError('');
    setShowForgot(true);
  }

  function closeForgot() {
    setShowForgot(false);
    setForgotStatus('idle');
    setForgotError('');
  }

  async function handleForgotPassword() {
    const trimmed = forgotEmail.trim().toLowerCase();
    if (!trimmed || !trimmed.includes('@')) {
      setForgotError('Veuillez saisir une adresse email valide.');
      return;
    }

    if (DEMO_EMAILS.has(trimmed)) {
      setForgotError('La réinitialisation n\'est pas disponible pour les comptes de démonstration.');
      return;
    }

    if (!isSupabaseConfigured) {
      setForgotError('La réinitialisation de mot de passe nécessite une connexion au serveur.');
      return;
    }

    Keyboard.dismiss();
    setForgotStatus('loading');
    setForgotError('');

    const result = await requestPasswordReset(trimmed);

    if (!result.success) {
      setForgotStatus('error');
      setForgotError(result.error ?? 'Impossible d\'envoyer l\'email. Réessayez.');
      return;
    }

    setForgotStatus('sent');
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ flexGrow: 1 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.hero, { paddingTop: (Platform.OS === 'web' ? 0 : insets.top) + 20 }]}>
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

        <View style={styles.formContainer}>

          {/* ── Carte principale de connexion ── */}
          {!showForgot ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Connexion</Text>

              <View style={styles.field}>
                <Text style={styles.label}>Email</Text>
                <View style={styles.inputWrap}>
                  <Ionicons name="mail-outline" size={18} color={C.textMuted} />
                  <TextInput
                    style={styles.input}
                    placeholder="votre@email.fr"
                    placeholderTextColor={C.textMuted}
                    value={email}
                    onChangeText={setEmail}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.label}>Mot de passe</Text>
                <View style={styles.inputWrap}>
                  <Ionicons name="lock-closed-outline" size={18} color={C.textMuted} />
                  <TextInput
                    style={styles.input}
                    placeholder="••••••••"
                    placeholderTextColor={C.textMuted}
                    value={password}
                    onChangeText={setPassword}
                    secureTextEntry={!showPass}
                  />
                  <TouchableOpacity onPress={() => setShowPass(!showPass)} hitSlop={8}>
                    <Ionicons name={showPass ? 'eye-off-outline' : 'eye-outline'} size={18} color={C.textMuted} />
                  </TouchableOpacity>
                </View>
                <TouchableOpacity onPress={openForgot} activeOpacity={0.7} style={styles.forgotLink}>
                  <Text style={styles.forgotLinkText}>Mot de passe oublié ?</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[styles.loginBtn, loading && styles.loginBtnDisabled]}
                onPress={handleLogin}
                disabled={loading}
                activeOpacity={0.85}
              >
                {loading
                  ? <Text style={styles.loginBtnText}>Connexion...</Text>
                  : <><Ionicons name="log-in-outline" size={20} color={C.primary} /><Text style={styles.loginBtnText}>Se connecter</Text></>
                }
              </TouchableOpacity>
            </View>

          ) : (

            /* ── Carte réinitialisation mot de passe ── */
            <View style={styles.card}>
              <View style={styles.forgotHeader}>
                <TouchableOpacity onPress={closeForgot} hitSlop={8} style={styles.backBtn}>
                  <Ionicons name="arrow-back-outline" size={20} color={C.primary} />
                </TouchableOpacity>
                <Text style={styles.cardTitle}>Mot de passe oublié</Text>
              </View>

              {forgotStatus === 'sent' ? (
                <View style={styles.successBox}>
                  <View style={styles.successIconWrap}>
                    <Ionicons name="checkmark-circle" size={44} color={C.closed} />
                  </View>
                  <Text style={styles.successTitle}>Email envoyé !</Text>
                  <Text style={styles.successBody}>
                    Un lien de réinitialisation a été envoyé à{' '}
                    <Text style={{ fontFamily: 'Inter_600SemiBold' }}>{forgotEmail}</Text>.
                  </Text>
                  <Text style={styles.successHint}>
                    Vérifiez votre boîte de réception (et les spams). Le lien expire dans 1 heure.
                  </Text>
                  <TouchableOpacity onPress={closeForgot} style={styles.loginBtn} activeOpacity={0.85}>
                    <Ionicons name="arrow-back-outline" size={18} color={C.primary} />
                    <Text style={styles.loginBtnText}>Retour à la connexion</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <Text style={styles.forgotDesc}>
                    Saisissez votre adresse email. Vous recevrez un lien pour choisir un nouveau mot de passe.
                  </Text>

                  <View style={styles.field}>
                    <Text style={styles.label}>Adresse email</Text>
                    <View style={[styles.inputWrap, forgotError ? styles.inputWrapError : null]}>
                      <Ionicons name="mail-outline" size={18} color={C.textMuted} />
                      <TextInput
                        style={styles.input}
                        placeholder="votre@email.fr"
                        placeholderTextColor={C.textMuted}
                        value={forgotEmail}
                        onChangeText={v => { setForgotEmail(v); setForgotError(''); }}
                        keyboardType="email-address"
                        autoCapitalize="none"
                        autoCorrect={false}
                        autoFocus
                      />
                    </View>
                    {forgotError ? (
                      <View style={styles.errorRow}>
                        <Ionicons name="alert-circle-outline" size={13} color={C.open} />
                        <Text style={styles.errorText}>{forgotError}</Text>
                      </View>
                    ) : null}
                  </View>

                  <TouchableOpacity
                    style={[styles.loginBtn, forgotStatus === 'loading' && styles.loginBtnDisabled]}
                    onPress={handleForgotPassword}
                    disabled={forgotStatus === 'loading'}
                    activeOpacity={0.85}
                  >
                    {forgotStatus === 'loading' ? (
                      <>
                        <ActivityIndicator size="small" color={C.primary} />
                        <Text style={styles.loginBtnText}>Envoi en cours...</Text>
                      </>
                    ) : (
                      <>
                        <Ionicons name="send-outline" size={18} color={C.primary} />
                        <Text style={styles.loginBtnText}>Envoyer le lien</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </>
              )}
            </View>
          )}

          {/* ── Comptes de démonstration ── */}
          <View style={styles.demoSection}>
            <Text style={styles.demoTitle}>Comptes de démonstration</Text>
            {seedStatus === 'seeding' && (
              <View style={styles.seedBanner}>
                <Ionicons name="sync-outline" size={14} color={C.primary} />
                <Text style={styles.seedText}>Initialisation des comptes...</Text>
              </View>
            )}
            {seedStatus === 'error' && (
              <View style={[styles.seedBanner, { backgroundColor: C.openBg, borderColor: C.open + '40' }]}>
                <Ionicons name="warning-outline" size={14} color={C.open} />
                <Text style={[styles.seedText, { color: C.open }]}>
                  {'Comptes non créés. Si les mots de passe échouent, désactivez « Confirm email » dans Supabase → Authentication → Providers → Email.'}
                </Text>
              </View>
            )}
            <View style={styles.demoGrid}>
              {DEMO_ACCOUNTS.map(acc => (
                <TouchableOpacity
                  key={acc.email}
                  style={styles.demoCard}
                  onPress={() => fillDemo(acc.email)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.demoDot, { backgroundColor: C.primary }]} />
                  <Text style={styles.demoLabel}>{acc.label}</Text>
                  <Text style={styles.demoEmail} numberOfLines={1}>{acc.email.split('@')[0]}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.demoHint}>Appuyez sur un compte pour le remplir automatiquement</Text>
          </View>

          <TouchableOpacity
            style={styles.registerLink}
            onPress={() => router.push('/register')}
            activeOpacity={0.7}
          >
            <Ionicons name="person-add-outline" size={15} color={C.primary} />
            <Text style={styles.registerLinkText}>Nouveau client ? Créer un compte</Text>
          </TouchableOpacity>

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
  cardTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.text, marginBottom: 20 },
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
  forgotLink: { alignSelf: 'flex-end', marginTop: 8 },
  forgotLinkText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.primary },
  loginBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.accent, borderRadius: 14, paddingVertical: 16, marginTop: 8,
  },
  loginBtnDisabled: { opacity: 0.6 },
  loginBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.primary },

  /* Forgot password */
  forgotHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 },
  backBtn: { padding: 4 },
  forgotDesc: {
    fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub,
    lineHeight: 19, marginBottom: 20, marginTop: -8,
  },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6 },
  errorText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.open, flex: 1 },

  /* Success state */
  successBox: { alignItems: 'center' },
  successIconWrap: { marginBottom: 12 },
  successTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.closed, marginBottom: 10 },
  successBody: {
    fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text,
    textAlign: 'center', lineHeight: 21, marginBottom: 10,
  },
  successHint: {
    fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted,
    textAlign: 'center', lineHeight: 18, marginBottom: 24,
  },

  /* Demo section */
  demoSection: {
    backgroundColor: C.surface, borderRadius: 18, padding: 20,
    borderWidth: 1, borderColor: C.border,
  },
  demoTitle: {
    fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textSub,
    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 14,
  },
  demoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  demoCard: {
    flex: 1, minWidth: '44%', backgroundColor: C.surface2, borderRadius: 12,
    padding: 12, alignItems: 'center', borderWidth: 1, borderColor: C.border,
  },
  demoDot: { width: 10, height: 10, borderRadius: 5, marginBottom: 6 },
  demoLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text },
  demoEmail: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
  demoHint: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', marginTop: 12 },
  seedBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.primaryBg, borderRadius: 8, paddingVertical: 8,
    paddingHorizontal: 12, marginBottom: 12, borderWidth: 1, borderColor: C.border,
  },
  seedText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.primary, flex: 1 },
  registerLink: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 14, marginTop: 4,
  },
  registerLinkText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.primary },
});
