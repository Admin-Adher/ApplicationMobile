import { useState } from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '@/context/AuthContext';
import { C } from '@/constants/colors';

/**
 * Non-dismissible prompt shown when the Supabase session is terminally expired
 * (refresh token rejected server-side — see lib/sessionExpiry.ts). Until the
 * user re-authenticates, every server write silently falls back to the anon key
 * and is rejected by RLS, so sync cannot proceed. We block the UI with a single
 * "Se reconnecter" action that performs a clean, queue-preserving re-login.
 *
 * Only shown while authenticated — never over the login screen itself.
 */
export default function SessionExpiredModal() {
  const { t } = useTranslation();
  const { sessionExpired, isAuthenticated, reconnectExpiredSession } = useAuth();
  const insets = useSafeAreaInsets();
  const [reconnecting, setReconnecting] = useState(false);

  const visible = sessionExpired && isAuthenticated;
  if (!visible) return null;

  const onReconnect = async () => {
    if (reconnecting) return;
    setReconnecting(true);
    try {
      await reconnectExpiredSession();
    } catch {
      setReconnecting(false);
    }
    // On success the user becomes null → AuthGuard routes to /login and this
    // modal unmounts; no need to reset `reconnecting`.
  };

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <View style={[styles.backdrop, { paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="lock-closed-outline" size={28} color={C.waiting} />
          </View>
          <Text style={styles.title}>{t('sessionExpired.title')}</Text>
          <Text style={styles.message}>{t('sessionExpired.message')}</Text>
          <TouchableOpacity
            style={[styles.button, reconnecting && styles.buttonDisabled]}
            onPress={onReconnect}
            disabled={reconnecting}
            accessibilityRole="button"
            accessibilityLabel={t('sessionExpired.reconnect')}
          >
            {reconnecting ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Ionicons name="log-in-outline" size={18} color="#fff" />
            )}
            <Text style={styles.buttonText}>{t('sessionExpired.reconnect')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(10, 18, 35, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    backgroundColor: C.surface,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.waitingBg,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  title: {
    fontSize: 18,
    fontFamily: 'Inter_700Bold',
    color: C.text,
    textAlign: 'center',
  },
  message: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.textSub,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 6,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    alignSelf: 'stretch',
    backgroundColor: C.primary,
    borderRadius: 14,
    paddingVertical: 15,
  },
  buttonDisabled: { opacity: 0.7 },
  buttonText: {
    fontSize: 15,
    fontFamily: 'Inter_700Bold',
    color: '#fff',
  },
});
