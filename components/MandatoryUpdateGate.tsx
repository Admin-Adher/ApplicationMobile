import {
  ActivityIndicator,
  Modal,
  SafeAreaView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAppUpdate } from '@/hooks/useAppUpdate';
import { useApkInstaller } from '@/hooks/useApkInstaller';

export default function MandatoryUpdateGate() {
  const { t } = useTranslation();
  const {
    updateRequired,
    minimumAndroidBuild,
    currentLabel,
    downloadUrl,
    refresh,
  } = useAppUpdate();
  const {
    state,
    progressPercent,
    isBusy,
    startUpdate,
  } = useApkInstaller({
    downloadUrl,
    releaseLabel: minimumAndroidBuild > 0 ? `Build ${minimumAndroidBuild}` : null,
  });

  if (!updateRequired) return null;

  const primaryLabel = state === 'downloading'
    ? t('updateBanner.downloading', { pct: progressPercent })
    : state === 'opening'
      ? t('updateBanner.opening')
      : t('mandatoryUpdate.download');

  return (
    <Modal visible animationType="fade" statusBarTranslucent onRequestClose={() => {}}>
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.card}>
          <View style={styles.iconWrap}>
            <Ionicons name="shield-checkmark" size={36} color="#FFFFFF" />
          </View>
          <Text style={styles.eyebrow}>{t('mandatoryUpdate.eyebrow')}</Text>
          <Text style={styles.title}>{t('mandatoryUpdate.title')}</Text>
          <Text style={styles.description}>{t('mandatoryUpdate.description')}</Text>

          <View style={styles.versionRow}>
            <View style={styles.versionItem}>
              <Text style={styles.versionLabel}>{t('mandatoryUpdate.installed')}</Text>
              <Text style={styles.versionValue}>{currentLabel}</Text>
            </View>
            <Ionicons name="arrow-forward" size={20} color="#8CA0B8" />
            <View style={styles.versionItem}>
              <Text style={styles.versionLabel}>{t('mandatoryUpdate.required')}</Text>
              <Text style={styles.versionValue}>Build {minimumAndroidBuild}</Text>
            </View>
          </View>

          <TouchableOpacity
            style={styles.primaryButton}
            activeOpacity={0.85}
            disabled={isBusy}
            onPress={() => { void startUpdate(); }}
          >
            {isBusy
              ? <ActivityIndicator color="#FFFFFF" />
              : <Ionicons name="download-outline" size={22} color="#FFFFFF" />}
            <Text style={styles.primaryButtonText}>{primaryLabel}</Text>
          </TouchableOpacity>
          {state === 'downloading' && (
            <View style={styles.progressTrack}>
              <View
                style={[
                  styles.progressFill,
                  { width: `${Math.max(2, progressPercent)}%` },
                ]}
              />
            </View>
          )}
          <TouchableOpacity
            style={[styles.secondaryButton, isBusy && styles.secondaryButtonDisabled]}
            disabled={isBusy}
            onPress={() => { void refresh(); }}
          >
            <Ionicons name="refresh" size={18} color="#123B73" />
            <Text style={styles.secondaryButtonText}>{t('mandatoryUpdate.checkAgain')}</Text>
          </TouchableOpacity>
          <Text style={styles.footnote}>{t('mandatoryUpdate.footnote')}</Text>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F4F7FB',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 520,
    alignSelf: 'center',
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
    padding: 28,
    borderWidth: 1,
    borderColor: '#DDE6F0',
    shadowColor: '#0B2447',
    shadowOpacity: 0.14,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    elevation: 8,
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#123B73',
    marginBottom: 22,
  },
  eyebrow: {
    color: '#C65A26',
    fontFamily: 'Inter_700Bold',
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  title: {
    color: '#10233F',
    fontFamily: 'Inter_700Bold',
    fontSize: 28,
    lineHeight: 34,
  },
  description: {
    color: '#586B82',
    fontFamily: 'Inter_400Regular',
    fontSize: 15,
    lineHeight: 23,
    marginTop: 12,
  },
  versionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#F2F6FA',
    borderRadius: 18,
    padding: 16,
    marginTop: 24,
    marginBottom: 20,
  },
  versionItem: { flex: 1 },
  versionLabel: {
    color: '#71839A',
    fontFamily: 'Inter_500Medium',
    fontSize: 11,
    marginBottom: 4,
  },
  versionValue: {
    color: '#10233F',
    fontFamily: 'Inter_700Bold',
    fontSize: 15,
  },
  primaryButton: {
    minHeight: 54,
    borderRadius: 16,
    backgroundColor: '#123B73',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontFamily: 'Inter_700Bold',
    fontSize: 16,
  },
  progressTrack: {
    height: 5,
    marginTop: 10,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: '#DDE6F0',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: '#123B73',
  },
  secondaryButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
  },
  secondaryButtonDisabled: {
    opacity: 0.45,
  },
  secondaryButtonText: {
    color: '#123B73',
    fontFamily: 'Inter_600SemiBold',
    fontSize: 14,
  },
  footnote: {
    color: '#8190A3',
    fontFamily: 'Inter_400Regular',
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 10,
  },
});
