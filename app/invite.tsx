import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Platform } from 'react-native';
import { useEffect, useState } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '@/constants/colors';
import { supabase } from '@/lib/supabase';

type LookupState =
  | { status: 'loading' }
  | { status: 'invalid'; reason: string }
  | { status: 'expired' }
  | { status: 'used' }
  | { status: 'ok'; email: string; organizationName: string; invitedByName: string };

export default function InviteLandingScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const token = typeof params.token === 'string' ? params.token : undefined;

  const [state, setState] = useState<LookupState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;

    async function lookup() {
      if (!token) {
        setState({ status: 'invalid', reason: 'Lien d\'invitation incomplet (aucun code).' });
        return;
      }

      try {
        const { data, error } = await supabase.rpc('get_invitation_by_token', { p_token: token });
        if (cancelled) return;

        if (error) {
          console.warn('[invite] get_invitation_by_token error:', error.message);
          setState({ status: 'invalid', reason: "Impossible de vérifier l'invitation. Vérifiez votre connexion." });
          return;
        }

        const row = Array.isArray(data) ? data[0] : data;
        if (!row || !row.email) {
          setState({ status: 'invalid', reason: 'Cette invitation est introuvable ou a été annulée.' });
          return;
        }

        if (row.status && row.status !== 'pending') {
          setState({ status: 'used' });
          return;
        }

        if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) {
          setState({ status: 'expired' });
          return;
        }

        setState({
          status: 'ok',
          email: row.email,
          organizationName: row.organization_name || '',
          invitedByName: row.invited_by_name || '',
        });

        // Redirige automatiquement vers /register avec l'email pré-rempli.
        // On laisse 600ms pour que l'utilisateur voie le message de bienvenue.
        setTimeout(() => {
          if (cancelled) return;
          router.replace({
            pathname: '/register',
            params: {
              email: row.email,
              org: row.organization_name || '',
              invitedBy: row.invited_by_name || '',
            },
          });
        }, 600);
      } catch (err: any) {
        if (cancelled) return;
        console.warn('[invite] exception:', err?.message);
        setState({ status: 'invalid', reason: 'Une erreur est survenue.' });
      }
    }

    lookup();
    return () => { cancelled = true; };
  }, [token, router]);

  function goLogin() {
    router.replace('/login');
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.hero}>
        <View style={styles.logoRow}>
          <View style={styles.logoBox}><Text style={styles.logoLetter}>B</Text></View>
          <View>
            <Text style={styles.brandName}>Bouygues</Text>
            <Text style={styles.brandSub}>Construction</Text>
          </View>
        </View>
        <View style={styles.heroDivider} />
        <Text style={styles.heroTitle}>Invitation BuildTrack</Text>
      </View>

      <View style={styles.body}>
        {state.status === 'loading' && (
          <View style={styles.center}>
            <ActivityIndicator size="large" color={C.primary} />
            <Text style={styles.statusText}>Vérification de votre invitation...</Text>
          </View>
        )}

        {state.status === 'ok' && (
          <View style={styles.center}>
            <View style={styles.iconCircle}>
              <Ionicons name="mail-open-outline" size={36} color={C.primary} />
            </View>
            <Text style={styles.welcomeTitle}>Bienvenue !</Text>
            {state.invitedByName ? (
              <Text style={styles.welcomeText}>
                <Text style={styles.bold}>{state.invitedByName}</Text> vous invite à rejoindre
                {state.organizationName ? <Text> <Text style={styles.bold}>{state.organizationName}</Text></Text> : null}.
              </Text>
            ) : (
              <Text style={styles.welcomeText}>
                Vous avez été invité à rejoindre
                {state.organizationName ? <Text> <Text style={styles.bold}>{state.organizationName}</Text></Text> : ' une organisation'}.
              </Text>
            )}
            <Text style={styles.subtle}>Redirection vers la création de compte...</Text>
            <ActivityIndicator size="small" color={C.primary} style={{ marginTop: 16 }} />
          </View>
        )}

        {state.status === 'expired' && (
          <View style={styles.center}>
            <View style={[styles.iconCircle, { backgroundColor: C.openBg }]}>
              <Ionicons name="time-outline" size={36} color={C.open} />
            </View>
            <Text style={styles.welcomeTitle}>Invitation expirée</Text>
            <Text style={styles.welcomeText}>
              Cette invitation n'est plus valide. Demandez à votre administrateur de vous en envoyer une nouvelle.
            </Text>
            <TouchableOpacity style={styles.btn} onPress={goLogin} activeOpacity={0.85}>
              <Text style={styles.btnText}>Aller à la connexion</Text>
            </TouchableOpacity>
          </View>
        )}

        {state.status === 'used' && (
          <View style={styles.center}>
            <View style={[styles.iconCircle, { backgroundColor: C.closedBg }]}>
              <Ionicons name="checkmark-circle-outline" size={36} color={C.closed} />
            </View>
            <Text style={styles.welcomeTitle}>Invitation déjà utilisée</Text>
            <Text style={styles.welcomeText}>
              Vous avez déjà accepté cette invitation. Connectez-vous avec votre email.
            </Text>
            <TouchableOpacity style={styles.btn} onPress={goLogin} activeOpacity={0.85}>
              <Text style={styles.btnText}>Se connecter</Text>
            </TouchableOpacity>
          </View>
        )}

        {state.status === 'invalid' && (
          <View style={styles.center}>
            <View style={[styles.iconCircle, { backgroundColor: C.openBg }]}>
              <Ionicons name="alert-circle-outline" size={36} color={C.open} />
            </View>
            <Text style={styles.welcomeTitle}>Lien invalide</Text>
            <Text style={styles.welcomeText}>{state.reason}</Text>
            <TouchableOpacity style={styles.btn} onPress={goLogin} activeOpacity={0.85}>
              <Text style={styles.btnText}>Aller à la connexion</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.primary },
  hero: { paddingHorizontal: 28, paddingBottom: 32, paddingTop: 20 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 22 },
  logoBox: {
    width: 52, height: 52, backgroundColor: C.accent, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
  },
  logoLetter: { fontSize: 28, fontFamily: 'Inter_700Bold', color: C.primary, lineHeight: 32 },
  brandName: { fontSize: 20, fontFamily: 'Inter_700Bold', color: '#FFFFFF', letterSpacing: 0.3 },
  brandSub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.65)', marginTop: 1 },
  heroDivider: { width: 40, height: 3, backgroundColor: C.accent, borderRadius: 2, marginBottom: 18 },
  heroTitle: { fontSize: 28, fontFamily: 'Inter_700Bold', color: '#FFFFFF', letterSpacing: -0.3 },

  body: {
    flex: 1, backgroundColor: C.bg, borderTopLeftRadius: 28, borderTopRightRadius: 28,
    paddingHorizontal: 24, paddingTop: 40, justifyContent: 'flex-start',
  },
  center: { alignItems: 'center', paddingHorizontal: 8 },
  iconCircle: {
    width: 76, height: 76, borderRadius: 38, backgroundColor: C.primaryBg,
    alignItems: 'center', justifyContent: 'center', marginBottom: 18,
  },
  welcomeTitle: {
    fontSize: 22, fontFamily: 'Inter_700Bold', color: C.text, marginBottom: 12, textAlign: 'center',
  },
  welcomeText: {
    fontSize: 15, fontFamily: 'Inter_400Regular', color: C.textSub,
    textAlign: 'center', lineHeight: 22, marginBottom: 12,
  },
  bold: { fontFamily: 'Inter_700Bold', color: C.text },
  subtle: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', marginTop: 4 },
  statusText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.textSub, marginTop: 14 },
  btn: {
    backgroundColor: C.accent, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 28,
    marginTop: 18,
  },
  btnText: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.primary },
});
