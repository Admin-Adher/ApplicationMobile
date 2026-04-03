import { View, Text, StyleSheet, TextInput, TouchableOpacity, Platform, Alert, ScrollView, Keyboard } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useState, useEffect } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { C } from '@/constants/colors';
import { useAuth } from '@/context/AuthContext';
import { useApp } from '@/context/AppContext';

const DEMO_ACCOUNTS = [
  { email: 'admin@buildtrack.fr', label: 'Admin', color: C.primary },
  { email: 'j.dupont@buildtrack.fr', label: 'Conducteur', color: C.primary },
  { email: 'm.martin@buildtrack.fr', label: "Chef d'équipe", color: C.primary },
  { email: 'p.lambert@buildtrack.fr', label: 'Observateur', color: C.textSub },
];

const DEMO_PASSWORDS: Record<string, string> = {
  'admin@buildtrack.fr': 'admin123',
  'superadmin@buildtrack.fr': 'super123',
  'j.dupont@buildtrack.fr': 'pass123',
  'm.martin@buildtrack.fr': 'pass123',
  'p.lambert@buildtrack.fr': 'pass123',
  'st.martin@buildtrack.fr': 'pass123',
};

const DEMO_USER_NAMES: Record<string, string> = {
  'admin@buildtrack.fr':     'Admin Système',
  'j.dupont@buildtrack.fr':  'Jean Dupont',
  'm.martin@buildtrack.fr':  'Marie Martin',
  'p.lambert@buildtrack.fr': 'Pierre Lambert',
};

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { login, seedStatus, user } = useAuth();
  const { setCurrentUser } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);

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
  logoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 28,
  },
  logoBox: {
    width: 52,
    height: 52,
    backgroundColor: C.accent,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoLetter: {
    fontSize: 28,
    fontFamily: 'Inter_700Bold',
    color: C.primary,
    lineHeight: 32,
  },
  brandName: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  brandSub: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.65)',
    marginTop: 1,
  },
  heroDivider: {
    width: 40,
    height: 3,
    backgroundColor: C.accent,
    borderRadius: 2,
    marginBottom: 18,
  },
  heroTitle: {
    fontSize: 36,
    fontFamily: 'Inter_700Bold',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  heroTagline: {
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: 'rgba(255,255,255,0.65)',
    marginTop: 6,
  },
  formContainer: {
    flex: 1,
    backgroundColor: C.bg,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 28,
  },
  card: {
    backgroundColor: C.surface,
    borderRadius: 18,
    padding: 24,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 20,
    elevation: 2,
    ...Platform.select({
      web: { boxShadow: '0px 2px 12px rgba(0,48,130,0.06)' } as any,
      default: { shadowColor: '#003082', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 12 },
    }),
  },
  cardTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.text, marginBottom: 20 },
  field: { marginBottom: 16 },
  label: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: C.textSub,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.surface2,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  input: { flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular', color: C.text },
  loginBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.accent,
    borderRadius: 14,
    paddingVertical: 16,
    marginTop: 8,
  },
  loginBtnDisabled: { opacity: 0.6 },
  loginBtnText: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.primary },
  demoSection: {
    backgroundColor: C.surface,
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: C.border,
  },
  demoTitle: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: C.textSub,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 14,
  },
  demoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  demoCard: {
    flex: 1,
    minWidth: '44%',
    backgroundColor: C.surface2,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  demoDot: { width: 10, height: 10, borderRadius: 5, marginBottom: 6 },
  demoLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text },
  demoEmail: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
  demoHint: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', marginTop: 12 },
  seedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: C.primaryBg,
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  seedText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.primary, flex: 1 },
  registerLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    marginTop: 4,
  },
  registerLinkText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: C.primary,
  },
});
