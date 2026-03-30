import { View, Text, StyleSheet } from 'react-native';
import { ReservePriority } from '@/constants/types';
import { C } from '@/constants/colors';

const PRIORITY_CONFIG: Record<ReservePriority, { label: string; color: string; bg: string; icon: string }> = {
  critical: { label: 'Critique', color: C.critical, bg: C.criticalBg, icon: '▲' },
  high: { label: 'Haute', color: C.high, bg: C.highBg, icon: '▲' },
  medium: { label: 'Moyenne', color: C.medium, bg: C.mediumBg, icon: '●' },
  low: { label: 'Basse', color: C.low, bg: C.lowBg, icon: '▼' },
};

interface Props {
  priority: ReservePriority;
  small?: boolean;
}

export default function PriorityBadge({ priority, small }: Props) {
  const config = PRIORITY_CONFIG[priority];
  return (
    <View style={[styles.badge, { backgroundColor: config.bg }, small && styles.small]}>
      <Text style={[styles.icon, { color: config.color }]}>{config.icon}</Text>
      <Text style={[styles.label, { color: config.color }, small && styles.labelSmall]}>
        {config.label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    gap: 4,
  },
  small: {
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  icon: {
    fontSize: 8,
  },
  label: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  labelSmall: {
    fontSize: 10,
  },
});

export { PRIORITY_CONFIG };
