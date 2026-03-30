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
        <View style={styles.idWrap}>
          <Text style={styles.id}>{reserve.id}</Text>
        </View>
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
        <PriorityBadge priority={reserve.priority} small />
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
    shadowColor: '#003082',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 6,
    elevation: 1,
  },
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  idWrap: {
    backgroundColor: C.primaryBg,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  id: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    color: C.primary,
    letterSpacing: 0.5,
  },
  title: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: C.text,
    marginBottom: 8,
    lineHeight: 21,
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
    fontFamily: 'Inter_500Medium',
    color: C.textSub,
    flex: 1,
  },
  deadline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: C.border,
  },
  deadlineText: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: C.textMuted,
  },
});
