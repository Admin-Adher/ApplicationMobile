import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  Platform, Alert, ScrollView, KeyboardAvoidingView, ActivityIndicator,
} from 'react-native';
import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { C } from '@/constants/colors';
import { useAuth } from '@/context/AuthContext';
import { supabase } from '@/lib/supabase';

export default function RegisterScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { register } = useAuth();

  const search = useLocalSearchParams<{ email?: string; org?: string; invitedBy?: string; token?: string }>();
  const prefilledEmail = typeof search.email === 'string' ? search.email : '';
  const orgName = typeof search.org === 'string' ? search.org : '';
  const invitedByName = typeof search.invitedBy === 'string' ? search.invitedBy : '';
  const invitationToken = typeof search.token === 'string' ? search.token : '';
  const fromInvitation = prefilledEmail.length > 0 && invitationToken.length > 0;

  const [name, setName] = useState('');
  const [email, setEmail] = useState(prefilledEmail);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleRegister() {
    if (!name.trim()) {
      Alert.alert(t('auth.nameRequiredTitle'), t('auth.nameRequiredMessage'));
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      Alert.alert(t('auth.invalidEmailTitle'), t('auth.invalidEmailMessage'));
      return;
    }
    if (password.length < 8) {
      Alert.alert(t('auth.shortPasswordTitle'), t('auth.shortPasswordMessage'));
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert(t('auth.differentPasswordsTitle'), t('auth.differentPasswordsMessage'));
      return;
    }

    setLoading(true);

    // Validate the secret token and bound email together. Email-only lookups
    // would disclose whether an address has a pending BuildTrack invitation.
    try {
      const { data: hasInvitation, error: rpcErr } = await (supabase as any).rpc(
        'check_invitation_token',
        {
          p_token: invitationToken,
          p_email: email.trim().toLowerCase(),
        }
      );

      if (rpcErr) {
        setLoading(false);
        Alert.alert(
          t('auth.checkUnavailableTitle'),
          t('auth.checkUnavailableMessage'),
          [{ text: 'OK', style: 'default' }]
        );
        return;
      } else if (!hasInvitation) {
        setLoading(false);
        Alert.alert(
          t('auth.noInvitationTitle'),
          t('auth.noInvitationMessage'),
          [{ text: t('auth.understood'), style: 'default' }]
        );
        return;
      }
    } catch (checkErr) {
      console.warn('[register] check_invitation_token exception:', checkErr);
    }

    const result = await register({
      name: name.trim(),
      email: email.trim(),
      password,
    });
    setLoading(false);

    if (!result.success) {
      Alert.alert(t('common.error'), result.error ?? t('auth.genericError'));
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
          <Text style={styles.heroTagline}>{t('auth.createAccountTagline')}</Text>
        </View>

        <View style={styles.formContainer}>
          {/* Bannière d'info */}
          {fromInvitation ? (
            <View style={styles.invitationBanner}>
              <View style={styles.invitationBannerIcon}>
                <Ionicons name="mail-open-outline" size={18} color={C.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.invitationBannerTitle}>{t('auth.invitationAccepted')}</Text>
                <Text style={styles.invitationBannerText}>
                  {invitedByName ? t('auth.invitedBy', { name: invitedByName }) : t('auth.invitedGeneric')}
                  {orgName ? <> {t('auth.joinOrganization')} <Text style={styles.invitationBannerBold}>{orgName}</Text></> : null}.
                  {' '}{t('auth.createAccountToActivate')}
                </Text>
              </View>
            </View>
          ) : (
            <View style={styles.infoBanner}>
              <Ionicons name="mail-outline" size={15} color={C.inProgress} />
              <Text style={styles.infoBannerText}>
                {t('auth.useInvitationEmail')}
              </Text>
            </View>
          )}

          <View style={styles.card}>
            <Text style={styles.cardTitle}>{t('auth.joinOrgTitle')}</Text>

            {/* Nom complet */}
            <View style={styles.field}>
              <Text style={styles.label}>{t('auth.fullName')}</Text>
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
              <Text style={styles.label}>{t('auth.invitationEmail')}</Text>
              <View style={[styles.inputWrap, fromInvitation && styles.inputWrapLocked]}>
                <Ionicons name="mail-outline" size={18} color={fromInvitation ? C.primary : C.textMuted} />
                <TextInput
                  style={styles.input}
                  placeholder="votre@email.fr"
                  placeholderTextColor={C.textMuted}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!fromInvitation}
                />
                {fromInvitation && (
                  <Ionicons name="lock-closed" size={14} color={C.primary} />
                )}
              </View>
              {fromInvitation && (
                <Text style={styles.lockedHint}>{t('auth.prefilledEmailHint')}</Text>
              )}
            </View>

            {/* Mot de passe */}
            <View style={styles.field}>
              <Text style={styles.label}>{t('auth.password')}</Text>
              <View style={styles.inputWrap}>
                <Ionicons name="lock-closed-outline" size={18} color={C.textMuted} />
                <TextInput
                  style={styles.input}
                  placeholder={t('auth.minPassword')}
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
              <Text style={styles.label}>{t('auth.confirmPassword')}</Text>
              <View style={[
                styles.inputWrap,
                confirmPassword.length > 0 && password !== confirmPassword && styles.inputWrapError,
              ]}>
                <Ionicons name="lock-closed-outline" size={18} color={C.textMuted} />
                <TextInput
                  style={styles.input}
                  placeholder={t('auth.repeatPassword')}
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
                <Text style={styles.errorHint}>{t('auth.passwordsMismatchInline')}</Text>
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
                  <Text style={styles.submitBtnText}>{t('auth.createMyAccount')}</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.backToLogin} onPress={() => router.replace('/login')} activeOpacity={0.7}>
            <Ionicons name="arrow-back-outline" size={15} color={C.primary} />
            <Text style={styles.backToLoginText}>{t('auth.alreadyAccountLogin')}</Text>
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
  invitationBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: C.primaryBg,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: C.primary + '33',
  },
  invitationBannerIcon: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: C.surface,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: C.primary + '33',
  },
  invitationBannerTitle: {
    fontSize: 13, fontFamily: 'Inter_700Bold', color: C.primary, marginBottom: 4,
  },
  invitationBannerText: {
    fontSize: 12.5, fontFamily: 'Inter_400Regular', color: C.text, lineHeight: 18,
  },
  invitationBannerBold: {
    fontFamily: 'Inter_700Bold', color: C.primary,
  },
  inputWrapLocked: {
    backgroundColor: C.primaryBg,
    borderColor: C.primary + '33',
  },
  lockedHint: {
    fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 6, marginLeft: 4,
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
