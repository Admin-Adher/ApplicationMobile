import { useEffect, useRef, useState } from 'react';
import { Animated, View, Text, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNetwork } from '@/context/NetworkContext';
import { C } from '@/constants/colors';

export default function OfflineBanner() {
  const { isOnline, queueCount } = useNetwork();
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-60)).current;
  const wasOffline = useRef(false);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showReconnect, setShowReconnect] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!isOnline) {
      wasOffline.current = true;
      setShowReconnect(false);
      setVisible(true);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      Animated.spring(translateY, {
        toValue: 0,
        tension: 80,
        friction: 12,
        useNativeDriver: true,
      }).start();
    } else {
      if (wasOffline.current) {
        wasOffline.current = false;
        setShowReconnect(true);
        setVisible(true);
        reconnectTimer.current = setTimeout(() => {
          Animated.timing(translateY, {
            toValue: -60,
            duration: 300,
            useNativeDriver: true,
          }).start(() => {
            setShowReconnect(false);
            setVisible(false);
          });
        }, 3000);
      } else {
        Animated.timing(translateY, {
          toValue: -60,
          duration: 300,
          useNativeDriver: true,
        }).start(() => setVisible(false));
      }
    }
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    };
  }, [isOnline]);

  if (!visible) return null;

  const bottomPad = Platform.OS === 'web' ? 16 : insets.bottom + 8;

  return (
    <Animated.View
      style={[styles.wrapper, { bottom: bottomPad, transform: [{ translateY }] }]}
      pointerEvents="none"
    >
      <View style={[styles.banner, showReconnect ? styles.bannerOnline : styles.bannerOffline]}>
        <Ionicons
          name={showReconnect ? 'wifi' : 'wifi-outline'}
          size={16}
          color={showReconnect ? '#10B981' : '#F59E0B'}
        />
        <Text style={[styles.text, { color: showReconnect ? '#10B981' : '#F59E0B' }]}>
          {showReconnect
            ? queueCount > 0
              ? `Reconnecté — sync de ${queueCount} opération${queueCount > 1 ? 's' : ''}…`
              : 'Connexion rétablie'
            : queueCount > 0
              ? `Hors connexion — ${queueCount} opération${queueCount > 1 ? 's' : ''} en attente`
              : 'Hors connexion — données sauvegardées localement'}
        </Text>
      </View>
    </Animated.View>
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
  text: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
  },
});
