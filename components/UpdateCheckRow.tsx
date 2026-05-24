import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { C } from '@/constants/colors';
import { useAppUpdate } from '@/hooks/useAppUpdate';

export default function UpdateCheckRow() {
  const { t } = useTranslation();
  const { currentLabel, latestLabel, updateAvailable, refresh, loading } = useAppUpdate();
  const [checking, setChecking] = useState(false);
  const [justChecked, setJustChecked] = useState(false);

  const handleCheck = async () => {
    setChecking(true);
    setJustChecked(false);
    await refresh();
    setChecking(false);
    setJustChecked(true);
    setTimeout(() => setJustChecked(false), 2500);
  };

  let statusText = t('updateCheck.installed', { label: currentLabel });
  if (latestLabel && !updateAvailable) {
    statusText = t('updateCheck.upToDateStatus', { current: currentLabel });
  } else if (latestLabel && updateAvailable) {
    statusText = t('updateCheck.availableStatus', { current: currentLabel, latest: latestLabel });
  }

  const isBusy = checking || loading;

  return (
    <View style={styles.row}>
      <Text style={styles.status} numberOfLines={1}>{statusText}</Text>
      <TouchableOpacity
        style={[styles.btn, isBusy && styles.btnDisabled]}
        onPress={handleCheck}
        disabled={isBusy}
        activeOpacity={0.75}
      >
        {isBusy ? (
          <ActivityIndicator size="small" color={C.primary} />
        ) : justChecked && !updateAvailable ? (
          <>
            <Ionicons name="checkmark-circle" size={14} color="#10B981" />
            <Text style={[styles.btnText, { color: '#10B981' }]}>{t('updateCheck.upToDate')}</Text>
          </>
        ) : (
          <>
            <Ionicons name="refresh" size={14} color={C.primary} />
            <Text style={styles.btnText}>{t('updateCheck.check')}</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginTop: 8,
  },
  status: {
    flex: 1,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: C.textMuted,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: C.primary + '15',
    borderWidth: 1,
    borderColor: C.primary + '30',
  },
  btnDisabled: {
    opacity: 0.6,
  },
  btnText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: C.primary,
  },
});
