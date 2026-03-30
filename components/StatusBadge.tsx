import { View, Text, StyleSheet } from 'react-native';
import { ReserveStatus } from '@/constants/types';
import { C } from '@/constants/colors';

const STATUS_CONFIG: Record<ReserveStatus, { label: string; color: string; bg: string }> = {
  open: { label: 'Ouvert', color: C.open, bg: C.openBg },
  in_progress: { label: 'En cours', color: C.inProgress, bg: C.inProgressBg },
  waiting: { label: 'En attente', color: C.waiting, bg: C.waitingBg },
  verification: { label: 'Vérification', color: C.verification, bg: C.verificationBg },
  closed: { label: 'Clôturé', color: C.closed, bg: C.closedBg },
};

interface Props {
  status: ReserveStatus;
  small?: boolean;
}

export default function StatusBadge({ status, small }: Props) {
  const config = STATUS_CONFIG[status];
  return (
    <View style={[styles.badge, { backgroundColor: config.bg }, small && styles.small]}>
      <View style={[styles.dot, { backgroundColor: config.color }]} />
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
    gap: 5,
  },
  small: {
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  label: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  labelSmall: {
    fontSize: 10,
  },
});

export { STATUS_CONFIG };
