import { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Animated, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useOtaUpdate } from '@/hooks/useOtaUpdate';
import { useAppUpdate } from '@/hooks/useAppUpdate';

export default function OtaUpdateBanner() {
  const { t } = useTranslation();
  const { updateReady, applyUpdate } = useOtaUpdate();
  const { loading: apkCheckLoading, updateDetected: apkUpdateDetected } = useAppUpdate();
  const translateY = useRef(new Animated.Value(-80)).current;
  const visible = useRef(false);

  useEffect(() => {
    if (updateReady && !visible.current) {
      visible.current = true;
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        tension: 80,
        friction: 10,
      }).start();
    }
  }, [updateReady, translateY]);

  // An APK release already has its own richer Terrain flow (download progress
  // + package installer). Never stack the OTA pop-in over that same release.
  if (!updateReady || apkCheckLoading || apkUpdateDetected || Platform.OS === 'web') return null;

  return (
    <Animated.View style={[styles.container, { transform: [{ translateY }] }]}>
      <View style={styles.banner}>
        <View style={styles.iconWrap}>
          <Ionicons name="sparkles" size={18} color="#FFFFFF" />
        </View>
        <View style={styles.textWrap}>
          <Text style={styles.title}>{t('otaUpdate.title')}</Text>
          <Text style={styles.sub}>{t('otaUpdate.subtitle')}</Text>
        </View>
        <TouchableOpacity style={styles.btn} onPress={applyUpdate} activeOpacity={0.85}>
          <Text style={styles.btnText}>{t('otaUpdate.restart')}</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    paddingHorizontal: 16,
    paddingTop: 52,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#6D28D9',
    borderRadius: 14,
    paddingVertical: 10,
    paddingLeft: 12,
    paddingRight: 8,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 6,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: '#FFFFFF22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  sub: {
    color: '#FFFFFFCC',
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    marginTop: 1,
  },
  btn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  btnText: {
    color: '#6D28D9',
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
});
