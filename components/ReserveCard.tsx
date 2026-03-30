import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Reserve } from '@/constants/types';
import { C } from '@/constants/colors';
import StatusBadge from './StatusBadge';
import PriorityBadge from './PriorityBadge';

interface Props {
  reserve: Reserve;
}

export default function ReserveCard({ reserve }: Props) {
  const router = useRouter();

  return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => router.push(`/reserve/${reserve.id}` as any)}
      activeOpacity={0.75}
    >
      <View style={styles.top}>
        <Text style={styles.id}>{reserve.id}</Text>
        <StatusBadge status={reserve.status} small />
      </View>

      <Text style={styles.title} numberOfLines={2}>{reserve.title}</Text>

      <View style={styles.meta}>
        <View style={styles.metaItem}>
          <Ionicons name="business-outline" size={12} color={C.textMuted} />
          <Text style={styles.metaText}>Bât. {reserve.building} — {reserve.zone} — {reserve.level}</Text>
        </View>
      </View>

      <View style={styles.bottom}>
        <View style={styles.companyWrap}>
          <Ionicons name="people-outline" size={12} color={C.textMuted} />
          <Text style={styles.company} numberOfLines={1}>{reserve.company}</Text>
        </View>
        <View style={styles.rightRow}>
          <PriorityBadge priority={reserve.priority} small />
        </View>
      </View>

      {reserve.deadline && (
        <View style={styles.deadline}>
          <Ionicons name="calendar-outline" size={11} color={C.textMuted} />
          <Text style={styles.deadlineText}>Échéance : {reserve.deadline}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: C.surface,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  id: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: C.primary,
    letterSpacing: 0.5,
  },
  title: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: C.text,
    marginBottom: 8,
    lineHeight: 20,
  },
  meta: {
    marginBottom: 10,
    gap: 4,
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  metaText: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: C.textSub,
  },
  bottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  companyWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flex: 1,
  },
  company: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: C.textSub,
    flex: 1,
  },
  rightRow: {
    flexDirection: 'row',
    gap: 6,
  },
  deadline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  deadlineText: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: C.textMuted,
  },
});
