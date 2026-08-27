import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { C } from '@/constants/colors';
import { currentApplicationVersion } from '@/lib/clientVersion';
import { currentBundleIdentity } from '@/lib/bundleIdentity';
import { useOtaUpdate, type OtaUpdatePhase } from '@/hooks/useOtaUpdate';

const STATUS_APPEARANCE: Record<OtaUpdatePhase, {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  backgroundColor: string;
}> = {
  unsupported: { icon: 'information-circle-outline', color: C.textMuted, backgroundColor: C.surface2 },
  idle: { icon: 'cloud-download-outline', color: C.primary, backgroundColor: C.primaryBg },
  checking: { icon: 'search-outline', color: C.primary, backgroundColor: C.primaryBg },
  downloading: { icon: 'cloud-download-outline', color: '#7C3AED', backgroundColor: '#F5F3FF' },
  ready: { icon: 'checkmark-circle', color: '#047857', backgroundColor: '#ECFDF5' },
  up_to_date: { icon: 'shield-checkmark-outline', color: '#047857', backgroundColor: '#ECFDF5' },
  error: { icon: 'warning-outline', color: '#B45309', backgroundColor: '#FFFBEB' },
  restarting: { icon: 'refresh', color: C.primary, backgroundColor: C.primaryBg },
};

export default function OtaUpdateControl() {
  const { t } = useTranslation();
  const { phase, downloadProgress, lastCheckedAt, checkNow, applyUpdate } = useOtaUpdate({ automatic: false });
  const appearance = STATUS_APPEARANCE[phase];
  const bundle = currentBundleIdentity();
  const busy = phase === 'checking' || phase === 'downloading' || phase === 'restarting';
  const progress = downloadProgress === null ? null : Math.round(downloadProgress * 100);

  const statusKey = phase === 'downloading' && progress !== null
    ? 'otaUpdate.control.status.downloadingProgress'
    : `otaUpdate.control.status.${phase}`;
  const actionKey = phase === 'ready'
    ? 'otaUpdate.control.restartNow'
    : phase === 'error'
      ? 'otaUpdate.control.retry'
      : phase === 'up_to_date'
        ? 'otaUpdate.control.checkAgain'
        : phase === 'downloading'
          ? 'otaUpdate.control.downloading'
          : phase === 'checking'
            ? 'otaUpdate.control.checking'
            : phase === 'restarting'
              ? 'otaUpdate.control.restarting'
              : 'otaUpdate.control.checkNow';

  const handlePress = () => {
    if (phase === 'ready') void applyUpdate();
    else void checkNow();
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.iconWrap}>
          <Ionicons name="cloud-done-outline" size={20} color={C.primary} />
        </View>
        <View style={styles.headingCopy}>
          <Text style={styles.title}>{t('otaUpdate.control.title')}</Text>
          <Text style={styles.description}>{t('otaUpdate.control.description')}</Text>
        </View>
      </View>

      <View
        style={[styles.status, { backgroundColor: appearance.backgroundColor }]}
        accessibilityRole={phase === 'error' ? 'alert' : undefined}
        accessibilityLiveRegion="polite"
      >
        <Ionicons name={appearance.icon} size={18} color={appearance.color} />
        <View style={styles.statusCopy}>
          <Text style={[styles.statusText, { color: appearance.color }]}>
            {t(statusKey as any, { progress })}
          </Text>
          <Text style={styles.meta}>
            {t('otaUpdate.control.installedVersion', { version: currentApplicationVersion() })}
            {bundle.updateId ? ` · OTA ${bundle.updateId.slice(0, 8)}` : ''}
          </Text>
          {lastCheckedAt && (
            <Text style={styles.meta}>
              {t('otaUpdate.control.lastChecked', {
                time: lastCheckedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              })}
            </Text>
          )}
        </View>
      </View>

      {phase !== 'unsupported' && (
        <TouchableOpacity
          style={[styles.action, phase === 'ready' && styles.actionReady, busy && styles.actionDisabled]}
          onPress={handlePress}
          disabled={busy}
          activeOpacity={0.78}
          accessibilityRole="button"
          accessibilityLabel={t(actionKey as any)}
          accessibilityHint={t(phase === 'ready'
            ? 'otaUpdate.control.restartHint'
            : 'otaUpdate.control.checkHint')}
          accessibilityState={{ disabled: busy, busy }}
        >
          {busy ? (
            <ActivityIndicator size="small" color={C.primary} />
          ) : (
            <Ionicons
              name={phase === 'ready' ? 'refresh' : 'search-outline'}
              size={18}
              color={phase === 'ready' ? '#FFFFFF' : C.primary}
            />
          )}
          <Text style={[styles.actionText, phase === 'ready' && styles.actionTextReady]}>
            {t(actionKey as any)}
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: C.border,
    gap: 12,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.primaryBg,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  headingCopy: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, fontFamily: 'Inter_700Bold', color: C.text },
  description: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: C.textMuted,
    lineHeight: 17,
    marginTop: 2,
  },
  status: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: 12,
    padding: 12,
  },
  statusCopy: { flex: 1, minWidth: 0 },
  statusText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', lineHeight: 18 },
  meta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, lineHeight: 16, marginTop: 2 },
  action: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    backgroundColor: C.primaryBg,
    borderWidth: 1,
    borderColor: C.primary + '40',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  actionReady: { backgroundColor: C.primary, borderColor: C.primary },
  actionDisabled: { opacity: 0.65 },
  actionText: { flexShrink: 1, textAlign: 'center', fontSize: 14, fontFamily: 'Inter_700Bold', color: C.primary },
  actionTextReady: { color: '#FFFFFF' },
});
