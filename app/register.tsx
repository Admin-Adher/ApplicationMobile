import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  Platform, Alert, ScrollView, KeyboardAvoidingView, ActivityIndicator,
} from 'react-native';
import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { C } from '@/constants/colors';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';

export default function RegisterScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { register } = useAuth();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleRegister() {
    if (!name.trim()) {
      Alert.alert('Champ requis', 'Veuillez saisir votre nom complet.');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      Alert.alert('Email invalide', 'Veuillez saisir une adresse email valide.');
      return;
    }
    if (password.length < 8) {
      Alert.alert('Mot de passe trop court', 'Le mot de passe doit contenir au moins 8 caractères.');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert('Mots de passe différents', 'Les deux mots de passe ne correspondent pas.');
      return;
    }

    setLoading(true);

    // Pré-validation : vérifier qu'une invitation en attente existe
    // avant de créer le compte, via le RPC public (pas d'auth requise).
    try {
      const { data: hasInvitation, error: rpcErr } = await supabase.rpc(
        'check_pending_invitation',
        { p_email: email.trim().toLowerCase() }
      );

      if (rpcErr) {
        console.warn('[register] check_pending_invitation RPC error:', rpcErr.message);
        // Si le RPC n'est pas encore déployé, on laisse passer —
        // la vérification côté serveur lors du register() prendra le relais.
      } else if (!hasInvitation) {
        setLoading(false);
        Alert.alert(
          'Aucune invitation trouvée',
          "Aucune invitation en attente n'a été trouvée pour cet email.\n\nDemandez à votre administrateur de vous envoyer une invitation avant de créer votre compte.",
          [{ text: 'Compris', style: 'default' }]
        );
        return;
      }
    } catch (checkErr) {
      console.warn('[register] check_pending_invitation exception:', checkErr);
    }

    const result = await register({
      name: name.trim(),
      email: email.trim(),
      password,
    });
    setLoading(false);

    if (!result.success) {
      Alert.alert('Erreur', result.error ?? 'Une erreur est survenue.');
    }
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
          <Text style={styles.heroTagline}>Créez votre compte</Text>
        </View>

        <View style={styles.formContainer}>
          {/* Bannière d'info */}
          <View style={styles.infoBanner}>
            <Ionicons name="mail-outline" size={15} color={C.inProgress} />
            <Text style={styles.infoBannerText}>
              Utilisez l'adresse email sur laquelle vous avez reçu votre invitation.
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Rejoindre une organisation</Text>

            {/* Nom complet */}
            <View style={styles.field}>
              <Text style={styles.label}>Nom complet</Text>
              <View style={styles.inputWrap}>
                <Ionicons name="person-outline" size={18} color={C.textMuted} />
                <TextInput
                  style={styles.input}
                  placeholder="Jean Dupont"
                  placeholderTextColor={C.textMuted}
                  value={name}
                  onChangeText={setName}
                  autoCorrect={false}
                />
              </View>
            </View>

            {/* Email */}
            <View style={styles.field}>
              <Text style={styles.label}>Email d'invitation</Text>
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

            {/* Mot de passe */}
            <View style={styles.field}>
              <Text style={styles.label}>Mot de passe</Text>
              <View style={styles.inputWrap}>
                <Ionicons name="lock-closed-outline" size={18} color={C.textMuted} />
                <TextInput
                  style={styles.input}
                  placeholder="Min. 8 caractères"
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

            {/* Confirmer le mot de passe */}
            <View style={styles.field}>
              <Text style={styles.label}>Confirmer le mot de passe</Text>
              <View style={[
                styles.inputWrap,
                confirmPassword.length > 0 && password !== confirmPassword && styles.inputWrapError,
              ]}>
                <Ionicons name="lock-closed-outline" size={18} color={C.textMuted} />
                <TextInput
                  style={styles.input}
                  placeholder="Répétez le mot de passe"
                  placeholderTextColor={C.textMuted}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry={!showConfirmPass}
                />
                <TouchableOpacity onPress={() => setShowConfirmPass(!showConfirmPass)} hitSlop={8}>
                  <Ionicons name={showConfirmPass ? 'eye-off-outline' : 'eye-outline'} size={18} color={C.textMuted} />
                </TouchableOpacity>
              </View>
              {confirmPassword.length > 0 && password !== confirmPassword && (
                <Text style={styles.errorHint}>Les mots de passe ne correspondent pas</Text>
              )}
            </View>

            <TouchableOpacity
              style={[styles.submitBtn, loading && styles.submitBtnDisabled]}
              onPress={handleRegister}
              disabled={loading}
              activeOpacity={0.85}
            >
              {loading ? (
                <ActivityIndicator size="small" color={C.primary} />
              ) : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={20} color={C.primary} />
                  <Text style={styles.submitBtnText}>Créer mon compte</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.backToLogin} onPress={() => router.replace('/login')} activeOpacity={0.7}>
            <Ionicons name="arrow-back-outline" size={15} color={C.primary} />
            <Text style={styles.backToLoginText}>Déjà un compte ? Se connecter</Text>
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
    paddingTop: 24,
  },
  infoBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: C.inProgressBg,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: C.inProgress + '30',
  },
  infoBannerText: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: C.inProgress,
    lineHeight: 17,
  },
  card: {
    backgroundColor: C.surface,
    borderRadius: 18,
    padding: 24,
    borderWidth: 1,
    borderColor: C.border,
    marginBottom: 16,
    elevation: 2,
    ...Platform.select({
      web: { boxShadow: '0px 2px 12px rgba(0,48,130,0.06)' } as any,
      default: { shadowColor: '#003082', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 12 },
    }),
  },
  cardTitle: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    color: C.text,
    marginBottom: 20,
  },
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
  inputWrapError: {
    borderColor: C.open,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: C.text,
  },
  errorHint: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: C.open,
    marginTop: 4,
    marginLeft: 4,
  },
  submitBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: C.accent,
    borderRadius: 14,
    paddingVertical: 16,
    marginTop: 8,
    minHeight: 52,
  },
  submitBtnDisabled: { opacity: 0.6 },
  submitBtnText: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: C.primary,
  },
  backToLogin: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
  },
  backToLoginText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: C.primary,
  },
});
