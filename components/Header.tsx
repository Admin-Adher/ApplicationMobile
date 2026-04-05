import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { C } from '@/constants/colors';
import { useNetwork } from '@/context/NetworkContext';

interface Props {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  onBack?: () => void;
  rightIcon?: string;
  onRightPress?: () => void;
  rightLabel?: string;
  rightElement?: React.ReactNode;
  rightActions?: React.ReactNode;
  showSearch?: boolean;
  onSearchPress?: () => void;
}

export default function Header({
  title, subtitle, showBack, onBack, rightIcon, onRightPress,
  rightLabel, rightElement, rightActions, showSearch, onSearchPress,
}: Props) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const topPad = insets.top;
  const { isOnline, queueCount } = useNetwork();

  function handleBack() {
    if (onBack) onBack();
    else router.back();
  }

  function handleSearch() {
    if (onSearchPress) onSearchPress();
    else router.push('/search' as any);
  }

  return (
    <View style={[styles.container, { paddingTop: topPad + 8 }]}>
      <View style={styles.row}>
        {(showBack || onBack) && (
          <TouchableOpacity onPress={handleBack} style={styles.backBtn} hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color={C.text} />
          </TouchableOpacity>
        )}
        <View style={styles.titleWrap}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>{title}</Text>
            <View style={[
              styles.networkDot,
              { backgroundColor: isOnline ? '#22C55E' : '#EF4444' },
              (!isOnline && queueCount > 0) && styles.networkDotExpanded,
            ]}>
              {!isOnline && queueCount > 0 && (
                <Text style={styles.networkDotText}>{queueCount > 9 ? '9+' : queueCount}</Text>
              )}
            </View>
          </View>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        <View style={styles.rightActions}>
          {showSearch && (
            <TouchableOpacity onPress={handleSearch} style={styles.iconBtn} hitSlop={8}>
              <Ionicons name="search-outline" size={20} color={C.primary} />
            </TouchableOpacity>
          )}
          {rightActions ?? rightElement ?? ((rightIcon || rightLabel) ? (
            <TouchableOpacity onPress={onRightPress} style={rightLabel ? styles.rightPillBtn : styles.rightBtn} hitSlop={8}>
              {rightLabel ? (
                <Text style={styles.rightPillText}>{rightLabel}</Text>
              ) : (
                <Ionicons name={rightIcon as any} size={22} color={C.primary} />
              )}
            </TouchableOpacity>
          ) : null)}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: C.surface,
    paddingLeft: 24,
    paddingRight: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
  },
  backBtn: {
    marginRight: 8,
    padding: 2,
  },
  titleWrap: {
    flex: 1,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    color: C.text,
  },
  networkDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  networkDotExpanded: {
    width: 'auto',
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 5,
  },
  networkDotText: {
    fontSize: 9,
    fontFamily: 'Inter_700Bold',
    color: '#fff',
  },
  subtitle: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: C.textSub,
    marginTop: 2,
  },
  rightActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginLeft: 8,
  },
  iconBtn: {
    padding: 4,
  },
  rightBtn: {
    padding: 4,
  },
  rightPillBtn: {
    backgroundColor: C.primary,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  rightPillText: {
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
  rightLabel: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: C.primary,
  },
});
