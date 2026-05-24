import { View, Text, StyleSheet } from 'react-native';
import { ReserveStatus } from '@/constants/types';
import { RESERVE_STATUS_CONFIG } from '@/lib/reserveLabels';
import { useTranslation } from 'react-i18next';

const STATUS_CONFIG = RESERVE_STATUS_CONFIG;

interface Props {
  status: ReserveStatus;
  small?: boolean;
}

export default function StatusBadge({ status, small }: Props) {
  const { t } = useTranslation();
  const config = STATUS_CONFIG[status];
  return (
    <View style={[styles.badge, { backgroundColor: config.bg }, small && styles.small]}>
      <View style={[styles.dot, { backgroundColor: config.color }]} />
      <Text style={[styles.label, { color: config.color }, small && styles.labelSmall]}>
        {t(`reserveLabels.status.${status}`, { defaultValue: config.label })}
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
