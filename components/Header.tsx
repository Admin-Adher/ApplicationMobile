import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { C } from '@/constants/colors';

interface Props {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  onBack?: () => void;
  rightIcon?: string;
  onRightPress?: () => void;
  rightLabel?: string;
  rightElement?: React.ReactNode;
}

export default function Header({ title, subtitle, showBack, onBack, rightIcon, onRightPress, rightLabel, rightElement }: Props) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  function handleBack() {
    if (onBack) onBack();
    else router.back();
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
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {rightElement ?? ((rightIcon || rightLabel) ? (
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
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: C.surface,
    paddingHorizontal: 20,
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
  title: {
    fontSize: 20,
    fontFamily: 'Inter_700Bold',
    color: C.text,
  },
  subtitle: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: C.textSub,
    marginTop: 2,
  },
  rightBtn: {
    padding: 4,
    marginLeft: 8,
  },
  rightPillBtn: {
    marginLeft: 8,
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
