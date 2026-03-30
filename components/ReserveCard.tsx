import { View, Text, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Reserve } from '@/constants/types';
import { C } from '@/constants/colors';
import StatusBadge from './StatusBadge';
import PriorityBadge from './PriorityBadge';
import { isOverdue, formatDate, deadlineDaysLeft } from '@/lib/reserveUtils';

interface Props {
  reserve: Reserve;
}

export default function ReserveCard({ reserve }: Props) {
  const router = useRouter();
  const overdue = isOverdue(reserve.deadline, reserve.status);
  const daysLeft = deadlineDaysLeft(reserve.deadline);
  const showDeadline = reserve.deadline && reserve.deadline !== '—';

  return (
    <TouchableOpacity
      style={[styles.card, overdue && styles.cardOverdue]}
      onPress={() => router.push(`/reserve/${reserve.id}` as any)}
      activeOpacity={0.75}
    >
      <View style={styles.top}>
        <View style={styles.idWrap}>
          <Text style={styles.id}>{reserve.id}</Text>
        </View>
        <View style={styles.topRight}>
          {overdue && (
            <View style={styles.overdueBadge}>
              <Ionicons name="warning-outline" size={10} color={C.open} />
              <Text style={styles.overdueText}>En retard</Text>
            </View>
          )}
          <StatusBadge status={reserve.status} small />
        </View>
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
          {reserve.photoUri ? (
            <View style={styles.iconBadge}>
              <Ionicons name="camera-outline" size={12} color={C.textMuted} />
            </View>
          ) : null}
          {reserve.comments.length > 0 ? (
            <View style={styles.iconBadge}>
              <Ionicons name="chatbubble-outline" size={12} color={C.textMuted} />
              <Text style={styles.iconBadgeCount}>{reserve.comments.length}</Text>
            </View>
          ) : null}
          <PriorityBadge priority={reserve.priority} small />
        </View>
      </View>

      {showDeadline && (
        <View style={[styles.deadline, overdue && styles.deadlineOverdue]}>
          <Ionicons name="calendar-outline" size={11} color={overdue ? C.open : C.textMuted} />
          <Text style={[styles.deadlineText, overdue && styles.deadlineTextOverdue]}>
            {formatDate(reserve.deadline)}
            {overdue
              ? ` — En retard de ${Math.abs(daysLeft ?? 0)} j`
              : daysLeft !== null && daysLeft <= 7 && daysLeft >= 0
              ? ` — J-${daysLeft}`
              : ''}
          </Text>
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
    ...Platform.select({
      web: { boxShadow: '0px 1px 6px rgba(0,48,130,0.06)' } as any,
      default: {
        shadowColor: '#003082',
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.06,
        shadowRadius: 6,
        elevation: 1,
      },
    }),
  },
  cardOverdue: {
    borderColor: C.open + '50',
    borderLeftWidth: 3,
    borderLeftColor: C.open,
  },
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  topRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
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
  overdueBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: C.open + '15',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
  },
  overdueText: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: C.open,
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
  rightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  iconBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: C.surface2,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
  },
  iconBadgeCount: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: C.textMuted,
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
  deadlineOverdue: {
    borderTopColor: C.open + '30',
  },
  deadlineText: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: C.textMuted,
  },
  deadlineTextOverdue: {
    color: C.open,
    fontFamily: 'Inter_500Medium',
  },
});
