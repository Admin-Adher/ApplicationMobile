import { useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useAppUpdate } from '@/hooks/useAppUpdate';
import { useApkInstaller } from '@/hooks/useApkInstaller';

export default function UpdateBanner() {
  const { t } = useTranslation();
  const {
    updateAvailable,
    updateRequired,
    latestLabel,
    publishedRelative,
    downloadUrl,
    dismiss,
    justUpdated,
    justUpdatedFromBuild,
    acknowledgeJustUpdated,
    currentLabel,
  } = useAppUpdate();
  const {
    state,
    progressPercent: pct,
    isBusy,
    startUpdate,
  } = useApkInstaller({ downloadUrl, releaseLabel: latestLabel });

  // Auto-dismiss du toast de succès au bout de 8 s.
  useEffect(() => {
    if (!justUpdated) return;
    const t = setTimeout(() => { acknowledgeJustUpdated(); }, 8000);
    return () => clearTimeout(t);
  }, [justUpdated, acknowledgeJustUpdated]);

  // Bannière verte de confirmation après une mise à jour réussie
  if (justUpdated && !updateRequired) {
    return (
      <View style={[styles.banner, styles.bannerSuccess]}>
        <View style={[styles.iconWrap, styles.iconWrapSuccess]}>
          <Ionicons name="checkmark-circle" size={20} color="#FFFFFF" />
        </View>
        <View style={styles.textWrap}>
          <Text style={styles.title} numberOfLines={1}>
            {t('updateBanner.installed', { label: currentLabel })}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {justUpdatedFromBuild != null
              ? t('updateBanner.previousBuild', { build: justUpdatedFromBuild })
              : t('updateBanner.latestVersion')}
          </Text>
        </View>
        <TouchableOpacity style={styles.closeBtn} onPress={() => { acknowledgeJustUpdated(); }} hitSlop={8}>
          <Ionicons name="close" size={18} color="#FFFFFFCC" />
        </TouchableOpacity>
      </View>
    );
  }

  if (!updateAvailable) return null;

  const buttonLabel =
    state === 'downloading'
      ? t('updateBanner.downloading', { pct })
      : state === 'opening'
        ? t('updateBanner.opening')
        : t('updateBanner.update');

  return (
    <View style={styles.banner}>
      <View style={styles.iconWrap}>
        <Ionicons name="rocket" size={20} color="#FFFFFF" />
      </View>
      <View style={styles.textWrap}>
        <Text style={styles.title} numberOfLines={2}>
          {t('updateBanner.newVersion', { label: latestLabel ? ` · ${latestLabel}` : '' })}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {state === 'downloading'
            ? t('updateBanner.downloadingHint')
            : publishedRelative
              ? t('updateBanner.published', { relative: publishedRelative })
              : t('updateBanner.updateHint')}
        </Text>
        {state === 'downloading' && (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.max(2, pct)}%` }]} />
          </View>
        )}
      </View>
      <TouchableOpacity
        style={[styles.updateBtn, isBusy && styles.updateBtnBusy]}
        onPress={() => { void startUpdate(); }}
        activeOpacity={0.85}
        disabled={isBusy}
      >
        <Text style={styles.updateBtnText} numberOfLines={1}>{buttonLabel}</Text>
      </TouchableOpacity>
      {!isBusy && !updateRequired && (
        <TouchableOpacity style={styles.closeBtn} onPress={dismiss} hitSlop={8}>
          <Ionicons name="close" size={18} color="#FFFFFFCC" />
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#E0512B',
    borderRadius: 14,
    paddingVertical: 12,
    paddingLeft: 12,
    paddingRight: 8,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  bannerSuccess: {
    backgroundColor: '#10B981',
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#FFFFFF22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapSuccess: {
    backgroundColor: '#FFFFFF33',
  },
  textWrap: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 14,
    lineHeight: 18,
    fontFamily: 'Inter_600SemiBold',
  },
  subtitle: {
    color: '#FFFFFFCC',
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    marginTop: 2,
  },
  progressTrack: {
    marginTop: 6,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#FFFFFF33',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: '#FFFFFF',
  },
  updateBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minWidth: 110,
    alignItems: 'center',
  },
  updateBtnBusy: {
    opacity: 0.85,
  },
  updateBtnText: {
    color: '#E0512B',
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  closeBtn: {
    padding: 4,
  },
});
