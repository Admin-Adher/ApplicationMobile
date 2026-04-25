import { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/constants/colors';
import { useAppUpdate } from '@/hooks/useAppUpdate';

export default function UpdateCheckRow() {
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

  let statusText = `Installé : ${currentLabel}`;
  if (latestLabel && !updateAvailable) {
    statusText = `${currentLabel} · à jour`;
  } else if (latestLabel && updateAvailable) {
    statusText = `${currentLabel} → ${latestLabel} disponible`;
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
            <Text style={[styles.btnText, { color: '#10B981' }]}>À jour</Text>
          </>
        ) : (
          <>
            <Ionicons name="refresh" size={14} color={C.primary} />
            <Text style={styles.btnText}>Vérifier</Text>
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
