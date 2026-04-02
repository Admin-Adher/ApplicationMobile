import { View, Text, StyleSheet, TouchableOpacity, Platform, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Swipeable } from 'react-native-gesture-handler';
import { useRef } from 'react';
import { Reserve } from '@/constants/types';
import { C } from '@/constants/colors';
import StatusBadge from './StatusBadge';
import PriorityBadge from './PriorityBadge';
import { isOverdue, formatDate, deadlineDaysLeft, formatRelativeDate } from '@/lib/reserveUtils';
import { useApp } from '@/context/AppContext';

interface Props {
  reserve: Reserve;
  onPress?: (reserve: Reserve) => void;
  onLongPress?: (reserve: Reserve) => void;
  onSwipeRight?: (reserve: Reserve) => void;
  onSwipeLeft?: (reserve: Reserve) => void;
  selected?: boolean;
}

export default function ReserveCard({ reserve, onPress, onLongPress, onSwipeRight, onSwipeLeft, selected }: Props) {
  const router = useRouter();
  const { lots } = useApp();
  const swipeRef = useRef<Swipeable>(null);
  const overdue = isOverdue(reserve.deadline, reserve.status);
  const daysLeft = deadlineDaysLeft(reserve.deadline);
  const showDeadline = reserve.deadline && reserve.deadline !== '—';
  const lot = reserve.lotId ? lots.find(l => l.id === reserve.lotId) : null;
  const isObservation = reserve.kind === 'observation';
  const firstPhotoUri = reserve.photos?.[0]?.uri ?? reserve.photoUri ?? null;
  const relativeDate = formatRelativeDate(reserve.createdAt);

  const renderRightActions = () => (
    <TouchableOpacity
      style={styles.swipeRightAction}
      onPress={() => { swipeRef.current?.close(); onSwipeRight?.(reserve); }}
      accessibilityLabel="Changer le statut de cette réserve"
    >
      <Ionicons name="swap-horizontal-outline" size={20} color="#fff" />
      <Text style={styles.swipeActionText}>Statut</Text>
    </TouchableOpacity>
  );

  const renderLeftActions = () => (
    <TouchableOpacity
      style={styles.swipeLeftAction}
      onPress={() => { swipeRef.current?.close(); onSwipeLeft?.(reserve); }}
      accessibilityLabel="Archiver cette réserve"
    >
      <Ionicons name="archive-outline" size={20} color="#fff" />
      <Text style={styles.swipeActionText}>Archiver</Text>
    </TouchableOpacity>
  );

  const card = (
    <TouchableOpacity
      style={[styles.card, overdue && styles.cardOverdue, isObservation && styles.cardObservation, selected && styles.cardSelected]}
      onPress={() => onPress ? onPress(reserve) : router.push(`/reserve/${reserve.id}` as any)}
      onLongPress={() => onLongPress?.(reserve)}
      delayLongPress={400}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={`Réserve ${reserve.id} — ${reserve.title} — statut ${reserve.status === 'open' ? 'Ouvert' : reserve.status === 'in_progress' ? 'En cours' : reserve.status === 'waiting' ? 'En attente' : reserve.status === 'verification' ? 'Vérification' : 'Clôturé'} — ${(reserve.companies ?? (reserve.company ? [reserve.company] : [])).join(', ')}`}
      accessibilityHint={onLongPress ? "Appuyer longuement pour changer le statut rapidement" : undefined}
    >
      <View style={styles.top}>
        <View style={styles.topLeft}>
          <View style={styles.idWrap}>
            <Text style={styles.id}>{reserve.id}</Text>
          </View>
          {isObservation ? (
            <View style={styles.obsBadge}>
              <Ionicons name="eye-outline" size={10} color="#0EA5E9" />
              <Text style={styles.obsText}>Observation</Text>
            </View>
          ) : null}
        </View>
        <View style={styles.topRight}>
          {showDeadline && (
            <View style={[
              styles.deadlinePill,
              overdue
                ? styles.deadlinePillOverdue
                : daysLeft !== null && daysLeft <= 3
                  ? styles.deadlinePillSoon
                  : styles.deadlinePillNormal,
            ]}>
              <Ionicons
                name={overdue ? 'warning-outline' : 'calendar-outline'}
                size={10}
                color={overdue ? C.open : daysLeft !== null && daysLeft <= 3 ? '#D97706' : C.textMuted}
              />
              <Text style={[
                styles.deadlinePillText,
                overdue
                  ? { color: C.open, fontFamily: 'Inter_700Bold' }
                  : daysLeft !== null && daysLeft <= 3
                    ? { color: '#D97706', fontFamily: 'Inter_600SemiBold' }
                    : { color: C.textMuted },
              ]}>
                {overdue
                  ? `−${Math.abs(daysLeft ?? 0)}j`
                  : daysLeft === 0
                    ? "Auj."
                    : daysLeft === 1
                      ? 'Demain'
                      : daysLeft !== null && daysLeft <= 7
                        ? `J-${daysLeft}`
                        : formatDate(reserve.deadline)}
              </Text>
            </View>
          )}
          <StatusBadge status={reserve.status} small />
        </View>
      </View>

      <View style={styles.mainRow}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={2}>{reserve.title}</Text>

          <View style={styles.meta}>
            <View style={styles.metaItem}>
              <Ionicons name="business-outline" size={12} color={C.textMuted} />
              <Text style={styles.metaText}>Bât. {reserve.building} — {reserve.zone} — {reserve.level}</Text>
            </View>
            {lot && (
              <View style={styles.metaItem}>
                <View style={[styles.lotDot, { backgroundColor: lot.color ?? C.textMuted }]} />
                <Text style={[styles.metaText, { color: lot.color ?? C.textSub }]} numberOfLines={1}>
                  {lot.number ? `Lot ${lot.number} — ` : ''}{lot.name}
                </Text>
              </View>
            )}
            <View style={styles.metaItem}>
              <Ionicons name="time-outline" size={12} color={C.textMuted} />
              <Text style={styles.metaText}>{relativeDate}</Text>
            </View>
          </View>
        </View>

        {firstPhotoUri ? (
          <Image source={{ uri: firstPhotoUri }} style={styles.photoThumb} resizeMode="cover" accessibilityLabel="Photo de la réserve" />
        ) : null}
      </View>

      <View style={styles.bottom}>
        <View style={styles.companyWrap}>
          <Ionicons name="people-outline" size={12} color={C.textMuted} />
          <Text style={styles.company} numberOfLines={1}>
            {(reserve.companies && reserve.companies.length > 0 ? reserve.companies : reserve.company ? [reserve.company] : ['—']).join(', ')}
          </Text>
        </View>
        <View style={styles.rightRow}>
          {reserve.planId && reserve.planX != null && (
            <TouchableOpacity
              style={styles.planPinBtn}
              onPress={() => router.push({ pathname: '/(tabs)/plans', params: { focusPlanId: reserve.planId, focusReserveId: reserve.id } } as any)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Voir sur le plan"
            >
              <Ionicons name="location-outline" size={12} color={C.primary} />
              <Text style={styles.planPinText}>Plan</Text>
            </TouchableOpacity>
          )}
          {!firstPhotoUri && reserve.photoUri ? (
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
          {(onLongPress || onSwipeRight) && (
            <View style={styles.quickHint}>
              <Ionicons name="hand-left-outline" size={10} color={C.textMuted} />
            </View>
          )}
          <PriorityBadge priority={reserve.priority} small />
        </View>
      </View>

    </TouchableOpacity>
  );

  if (Platform.OS === 'web') return card;

  return (
    <Swipeable
      ref={swipeRef}
      renderRightActions={(onSwipeRight) ? renderRightActions : undefined}
      renderLeftActions={(onSwipeLeft) ? renderLeftActions : undefined}
      friction={2}
      rightThreshold={60}
      leftThreshold={60}
    >
      {card}
    </Swipeable>
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
  cardObservation: {
    borderLeftWidth: 3,
    borderLeftColor: '#0EA5E9',
  },
  cardSelected: {
    borderColor: C.primary,
    borderWidth: 2,
    backgroundColor: C.primaryBg,
  },
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  topLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  topRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  mainRow: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
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
  obsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#0EA5E915',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#0EA5E930',
  },
  obsText: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: '#0EA5E9',
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
  lotDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  photoThumb: {
    width: 64,
    height: 64,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.border,
    flexShrink: 0,
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
  quickHint: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: C.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.border,
  },
  deadlinePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 20,
    borderWidth: 1,
  },
  deadlinePillNormal: {
    backgroundColor: '#F4F7FB',
    borderColor: '#DDE4EE',
  },
  deadlinePillSoon: {
    backgroundColor: '#FEF3C715',
    borderColor: '#D9770640',
  },
  deadlinePillOverdue: {
    backgroundColor: C.open + '10',
    borderColor: C.open + '40',
  },
  deadlinePillText: {
    fontSize: 11,
    fontFamily: 'Inter_500Medium',
  },
  planPinBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: C.primaryBg,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: C.primary + '40',
  },
  planPinText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: C.primary,
  },
  swipeRightAction: {
    backgroundColor: C.inProgress,
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    marginBottom: 10,
    borderRadius: 14,
    gap: 4,
  },
  swipeLeftAction: {
    backgroundColor: C.waiting,
    justifyContent: 'center',
    alignItems: 'center',
    width: 80,
    marginBottom: 10,
    borderRadius: 14,
    gap: 4,
  },
  swipeActionText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
});
