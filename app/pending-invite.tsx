import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { C } from '@/constants/colors';
import { useAuth } from '@/context/AuthContext';

export default function PendingInviteScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, logout } = useAuth();

  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  return (
    <View style={[styles.container, { paddingTop: topPad, paddingBottom: bottomPad }]}>
      <View style={styles.content}>
        <View style={styles.iconWrap}>
          <Ionicons name="mail-unread-outline" size={52} color={C.primary} />
        </View>

        <Text style={styles.title}>En attente d'invitation</Text>

        <Text style={styles.body}>
          Votre compte a bien été créé, mais vous n'êtes encore associé à aucune organisation.
        </Text>
        <Text style={styles.body}>
          Demandez à un administrateur de vous inviter en utilisant votre adresse e-mail :
        </Text>

        <View style={styles.emailBox}>
          <Ionicons name="person-outline" size={15} color={C.primary} />
          <Text style={styles.emailText}>{user?.email ?? '—'}</Text>
        </View>

        <View style={styles.steps}>
          <View style={styles.step}>
            <View style={styles.stepBullet}>
              <Text style={styles.stepNum}>1</Text>
            </View>
            <Text style={styles.stepText}>
              L'administrateur de l'organisation vous envoie une invitation depuis l'écran Administration.
            </Text>
          </View>
          <View style={styles.step}>
            <View style={styles.stepBullet}>
              <Text style={styles.stepNum}>2</Text>
            </View>
            <Text style={styles.stepText}>
              Déconnectez-vous puis reconnectez-vous : votre accès sera automatiquement activé.
            </Text>
          </View>
        </View>

        <TouchableOpacity
          style={styles.refreshBtn}
          onPress={() => router.replace('/login')}
          activeOpacity={0.8}
        >
          <Ionicons name="refresh-outline" size={17} color="#fff" />
          <Text style={styles.refreshBtnText}>Me reconnecter</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.logoutLink} onPress={logout} activeOpacity={0.7}>
          <Text style={styles.logoutLinkText}>Se déconnecter</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
    justifyContent: 'center',
  },
  content: {
    marginHorizontal: 28,
    alignItems: 'center',
  },
  iconWrap: {
    width: 88,
    height: 88,
    borderRadius: 24,
    backgroundColor: C.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
    borderWidth: 1,
    borderColor: C.primary + '30',
  },
  title: {
    fontSize: 22,
    fontFamily: 'Inter_700Bold',
    color: C.text,
    textAlign: 'center',
    marginBottom: 14,
  },
  body: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.textSub,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 8,
  },
  emailBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.primaryBg,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: C.primary + '40',
    marginTop: 8,
    marginBottom: 28,
  },
  emailText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: C.primary,
  },
  steps: {
    width: '100%',
    gap: 14,
    marginBottom: 32,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: C.border,
  },
  stepBullet: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  stepNum: {
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
    color: '#fff',
  },
  stepText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: C.textSub,
    flex: 1,
    lineHeight: 19,
  },
  refreshBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.primary,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 28,
    width: '100%',
    justifyContent: 'center',
    marginBottom: 14,
  },
  refreshBtnText: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
  logoutLink: {
    paddingVertical: 8,
  },
  logoutLinkText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: C.textMuted,
    textDecorationLine: 'underline',
  },
});
