import { View, Text, StyleSheet, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Alert, ScrollView } from 'react-native';
import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { C } from '@/constants/colors';
import { useAuth } from '@/context/AuthContext';

const DEMO_ACCOUNTS = [
  { email: 'admin@buildtrack.fr', label: 'Admin', color: '#8B5CF6' },
  { email: 'j.dupont@buildtrack.fr', label: 'Conducteur', color: C.primary },
  { email: 'm.martin@buildtrack.fr', label: "Chef d'équipe", color: C.inProgress },
  { email: 'p.lambert@buildtrack.fr', label: 'Observateur', color: C.textSub },
];

export default function LoginScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Champs requis', 'Veuillez saisir votre email et mot de passe.');
      return;
    }
    setLoading(true);
    const result = await login(email.trim(), password);
    setLoading(false);
    if (result.success) {
      router.replace('/(tabs)');
    } else {
      Alert.alert('Erreur de connexion', result.error ?? 'Une erreur est survenue.');
    }
  }

  function fillDemo(demoEmail: string) {
    setEmail(demoEmail);
    setPassword('pass123');
    if (demoEmail === 'admin@buildtrack.fr') setPassword('admin123');
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 20 }]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.logoWrap}>
          <View style={styles.logoCircle}>
            <Ionicons name="construct" size={36} color={C.primary} />
          </View>
          <Text style={styles.appName}>BuildTrack</Text>
          <Text style={styles.tagline}>Gestion de chantier numérique</Text>
        </View>

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
              : <><Ionicons name="log-in-outline" size={20} color="#fff" /><Text style={styles.loginBtnText}>Se connecter</Text></>
            }
          </TouchableOpacity>
        </View>

        <View style={styles.demoSection}>
          <Text style={styles.demoTitle}>Comptes de démonstration</Text>
          <View style={styles.demoGrid}>
            {DEMO_ACCOUNTS.map(acc => (
              <TouchableOpacity
                key={acc.email}
                style={[styles.demoCard, { borderColor: acc.color + '50' }]}
                onPress={() => fillDemo(acc.email)}
                activeOpacity={0.7}
              >
                <View style={[styles.demoDot, { backgroundColor: acc.color }]} />
                <Text style={[styles.demoLabel, { color: acc.color }]}>{acc.label}</Text>
                <Text style={styles.demoEmail} numberOfLines={1}>{acc.email.split('@')[0]}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.demoHint}>Cliquez sur un compte pour le remplir automatiquement</Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { paddingHorizontal: 20, alignItems: 'stretch' },
  logoWrap: { alignItems: 'center', marginBottom: 32 },
  logoCircle: { width: 80, height: 80, borderRadius: 40, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center', marginBottom: 14, borderWidth: 1, borderColor: C.primary + '40' },
  appName: { fontSize: 28, fontFamily: 'Inter_700Bold', color: C.text, letterSpacing: 0.5 },
  tagline: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 4 },
  card: { backgroundColor: C.surface, borderRadius: 18, padding: 24, borderWidth: 1, borderColor: C.border, marginBottom: 24 },
  cardTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.text, marginBottom: 20 },
  field: { marginBottom: 16 },
  label: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub, marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.surface2, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 14, borderWidth: 1, borderColor: C.border },
  input: { flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular', color: C.text },
  loginBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 16, marginTop: 8 },
  loginBtnDisabled: { opacity: 0.6 },
  loginBtnText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  demoSection: { backgroundColor: C.surface, borderRadius: 18, padding: 20, borderWidth: 1, borderColor: C.border },
  demoTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 14 },
  demoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  demoCard: { flex: 1, minWidth: '44%', backgroundColor: C.surface2, borderRadius: 12, padding: 12, alignItems: 'center', borderWidth: 1 },
  demoDot: { width: 10, height: 10, borderRadius: 5, marginBottom: 6 },
  demoLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  demoEmail: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
  demoHint: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', marginTop: 12 },
});
