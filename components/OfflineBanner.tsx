import { useEffect, useRef, useState } from 'react';
import { usePathname } from 'expo-router';
import { Animated, View, Text, StyleSheet, Platform, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useNetwork } from '@/context/NetworkContext';
import { C } from '@/constants/colors';
import { isSupabaseConfigured } from '@/lib/supabase';

export default function OfflineBanner() {
  const { t } = useTranslation();
  const { isOnline, queueCount } = useNetwork();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const { width } = useWindowDimensions();
  const translateY = useRef(new Animated.Value(60)).current;
  const wasOffline = useRef(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showReconnect, setShowReconnect] = useState(false);
  const [showQueuedWhileOnline, setShowQueuedWhileOnline] = useState(false);
  const [visible, setVisible] = useState(false);
  const prevQueueCount = useRef(queueCount);

  const slideIn = () => {
    Animated.spring(translateY, {
      toValue: 0,
      tension: 80,
      friction: 12,
      useNativeDriver: true,
    }).start();
  };

  const slideOut = (onDone?: () => void) => {
    Animated.timing(translateY, {
      toValue: 60,
      duration: 300,
      useNativeDriver: true,
    }).start(() => onDone?.());
  };

  // ── Connectivity transition effect ────────────────────────────────────────
  useEffect(() => {
    if (!isOnline) {
      wasOffline.current = true;
      setShowReconnect(false);
      setShowQueuedWhileOnline(false);
      setVisible(true);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (queueFlashTimer.current) clearTimeout(queueFlashTimer.current);
      slideIn();
    } else {
      if (wasOffline.current) {
        wasOffline.current = false;
        setShowReconnect(true);
        setShowQueuedWhileOnline(false);
        setVisible(true);
        if (queueFlashTimer.current) clearTimeout(queueFlashTimer.current);
        reconnectTimer.current = setTimeout(() => {
          slideOut(() => {
            setShowReconnect(false);
            setVisible(false);
          });
        }, 3000);
      } else {
        slideOut(() => setVisible(false));
      }
    }
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [isOnline]);

  // ── Queue-while-online flash ───────────────────────────────────────────────
  // When items are enqueued while isOnline is true (false-positive ping scenario),
  // neither the isOnline effect above nor wasOffline will trigger the banner.
  // We detect the queue growing from 0 → N and flash a brief "en attente" notice.
  useEffect(() => {
    const prev = prevQueueCount.current;
    prevQueueCount.current = queueCount;

    const newItemsQueued = queueCount > prev && prev === 0;
    const isInOfflineOrReconnectState = !isOnline || wasOffline.current || showReconnect;

    if (newItemsQueued && !isInOfflineOrReconnectState && !visible) {
      setShowQueuedWhileOnline(true);
      setShowReconnect(false);
      setVisible(true);
      if (queueFlashTimer.current) clearTimeout(queueFlashTimer.current);
      slideIn();
      queueFlashTimer.current = setTimeout(() => {
        slideOut(() => {
          setShowQueuedWhileOnline(false);
          setVisible(false);
        });
      }, 3000);
    }

    return () => {
      if (queueFlashTimer.current) clearTimeout(queueFlashTimer.current);
    };
  }, [queueCount]);

  const isTablet = width >= 768;
  const isTabsRoute =
    pathname === '/' ||
    pathname === '/index' ||
    pathname.startsWith('/(tabs)') ||
    ['/plans', '/reserves', '/messages', '/more', '/incidents', '/equipes', '/admin'].some(route => pathname === route || pathname.startsWith(`${route}/`));
  const tabBarOffset = !isTablet && isTabsRoute ? (Platform.OS === 'web' ? 90 : 84) : 0;
  const bottomPad = (Platform.OS === 'web' ? 16 : insets.bottom + 8) + tabBarOffset;

  const bannerColor = showReconnect
    ? '#10B981'
    : showQueuedWhileOnline
    ? '#3B82F6'
    : '#F59E0B';

  const bannerIcon = showReconnect
    ? 'wifi'
    : showQueuedWhileOnline
    ? 'cloud-upload-outline'
    : 'wifi-outline';

  const bannerText = showReconnect
    ? queueCount > 0
      ? t('offlineBanner.reconnectingSync', { count: queueCount })
      : t('offlineBanner.reconnected')
    : showQueuedWhileOnline
    ? t('offlineBanner.queuedWhileOnline', { count: queueCount })
    : queueCount > 0
    ? t('offlineBanner.offlineQueued', { count: queueCount })
    : t('offlineBanner.offlineSaved');

  const bannerStyle = showReconnect
    ? styles.bannerOnline
    : showQueuedWhileOnline
    ? styles.bannerPending
    : styles.bannerOffline;

  return (
    <>
      {!isSupabaseConfigured && (
        <View style={[styles.demoWrapper, { bottom: visible ? bottomPad + 52 : bottomPad, pointerEvents: 'none' } as any]}>
          <View style={styles.demoBanner}>
            <Ionicons name="flask-outline" size={13} color="#7C3AED" />
            <Text style={styles.demoText}>{t('offlineBanner.demo')}</Text>
          </View>
        </View>
      )}
      {visible && (
        <Animated.View
          style={[styles.wrapper, { bottom: bottomPad, transform: [{ translateY }], pointerEvents: 'none' as any }]}
        >
          <View style={[styles.banner, bannerStyle]}>
            <Ionicons name={bannerIcon as any} size={16} color={bannerColor} />
            <Text style={[styles.text, { color: bannerColor }]}>
              {bannerText}
            </Text>
          </View>
        </Animated.View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 9998,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  bannerOffline: {
    backgroundColor: '#78350F18',
    borderColor: '#F59E0B40',
  },
  bannerOnline: {
    backgroundColor: '#065F4618',
    borderColor: '#10B98140',
  },
  bannerPending: {
    backgroundColor: '#1E3A5F18',
    borderColor: '#3B82F640',
  },
  text: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
  demoWrapper: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 9997,
  },
  demoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderWidth: 1,
    backgroundColor: '#F5F3FF',
    borderColor: '#7C3AED30',
  },
  demoText: {
    flex: 1,
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
    color: '#7C3AED',
  },
});
