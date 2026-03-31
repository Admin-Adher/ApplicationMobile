import { useEffect, useRef } from 'react';
import { Animated, TouchableOpacity, Text, View, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '@/context/AppContext';
import { C } from '@/constants/colors';

function getAvatarColor(name: string): string {
  const COLORS = [C.primary, '#059669', '#D97706', '#7C3AED', '#DB2777', '#EA580C', '#0891B2', '#65A30D'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
}

export default function NotificationBanner() {
  const { notification, dismissNotification, channels } = useApp();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const translateY = useRef(new Animated.Value(-120)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const isVisible = useRef(false);

  useEffect(() => {
    if (notification && !isVisible.current) {
      isVisible.current = true;
      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          tension: 80,
          friction: 10,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    } else if (!notification && isVisible.current) {
      isVisible.current = false;
      Animated.parallel([
        Animated.timing(translateY, {
          toValue: -120,
          duration: 250,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [notification]);

  if (!notification) return null;

  const { msg, channelName, channelColor, channelIcon } = notification;
  const avatarColor = getAvatarColor(msg.sender);
  const topPad = Platform.OS === 'web' ? 16 : insets.top + 8;

  function handlePress() {
    dismissNotification();
    const ch = channels.find(c => c.id === msg.channelId);
    router.push({
      pathname: '/channel/[id]',
      params: {
        id: msg.channelId,
        name: ch?.name ?? channelName,
        color: ch?.color ?? channelColor,
        icon: ch?.icon ?? channelIcon,
      },
    } as any);
  }

  const previewText = msg.attachmentUri
    ? '📷 Photo'
    : msg.content.length > 60
    ? msg.content.slice(0, 60) + '…'
    : msg.content;

  return (
    <Animated.View
      style={[
        styles.wrapper,
        { top: topPad, transform: [{ translateY }], opacity },
      ]}
    >
      <TouchableOpacity
        style={[styles.banner, { borderLeftColor: channelColor }]}
        onPress={handlePress}
        activeOpacity={0.95}
      >
        <View style={[styles.channelIconWrap, { backgroundColor: channelColor + '20' }]}>
          <Ionicons name={channelIcon as any} size={14} color={channelColor} />
        </View>
        <View style={[styles.avatar, { backgroundColor: avatarColor + '25' }]}>
          <Text style={[styles.avatarText, { color: avatarColor }]}>
            {msg.sender.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.content}>
          <View style={styles.topRow}>
            <Text style={[styles.channelLabel, { color: channelColor }]} numberOfLines={1}>
              {channelName}
            </Text>
            <Text style={styles.time}>
              {msg.timestamp.split(' ')[1] ?? ''}
            </Text>
          </View>
          <Text style={styles.sender} numberOfLines={1}>{msg.sender}</Text>
          <Text style={styles.preview} numberOfLines={1}>{previewText}</Text>
        </View>
        <TouchableOpacity style={styles.closeBtn} onPress={dismissNotification} hitSlop={8}>
          <Ionicons name="close" size={14} color={C.textMuted} />
        </TouchableOpacity>
      </TouchableOpacity>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 12,
    right: 12,
    zIndex: 9999,
    pointerEvents: 'box-none',
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.surface,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderLeftWidth: 3,
    elevation: 8,
    ...Platform.select({
      web: { boxShadow: '0px 4px 16px rgba(0,0,0,0.14)' } as any,
      default: { shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 16, shadowOffset: { width: 0, height: 4 } },
    }),
    borderWidth: 1,
    borderColor: C.border,
  },
  channelIconWrap: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    fontSize: 14,
    fontFamily: 'Inter_700Bold',
  },
  content: {
    flex: 1,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 1,
  },
  channelLabel: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  time: {
    fontSize: 10,
    fontFamily: 'Inter_400Regular',
    color: C.textMuted,
  },
  sender: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: C.text,
    marginBottom: 1,
  },
  preview: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: C.textSub,
  },
  closeBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: C.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
