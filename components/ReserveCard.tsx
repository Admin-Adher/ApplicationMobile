import { View, Text, StyleSheet, TouchableOpacity, Platform, Image, Animated } from 'react-native';
import { MediaImage } from '@/components/MediaImage';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Swipeable } from 'react-native-gesture-handler';
import { useRef, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Reserve } from '@/constants/types';
import { C } from '@/constants/colors';
import StatusBadge from './StatusBadge';
import PriorityBadge from './PriorityBadge';
import { isOverdue, formatDate, deadlineDaysLeft, formatRelativeDate } from '@/lib/reserveUtils';
import { useApp } from '@/context/AppContext';
import { useNetwork } from '@/context/NetworkContext';
import { isLocalUri } from '@/lib/storage';
import { getEnterpriseWorkflowBadges } from '@/lib/reserveEnterpriseWorkflow';

interface Props {
  reserve: Reserve;
  onPress?: (reserve: Reserve) => void;
  onLongPress?: (reserve: Reserve) => void;
  onSwipeRight?: (reserve: Reserve) => void;
  onSwipeLeft?: (reserve: Reserve) => void;
  selected?: boolean;
  isFlashed?: boolean;
  hasPlansAvailable?: boolean;
  showEnterpriseTracking?: boolean;
  /**
   * Appelé quand l'utilisateur touche la puce « Plan » d'une réserve NON
   * épinglée. Permet à l'écran parent d'ouvrir le flux guidé « Localiser sur
   * un plan » (choix du plan → placement de la pastille). Sans ce callback,
   * la puce retombe sur l'ancienne navigation brute vers l'onglet Plans.
   */
  onRequestPin?: (reserve: Reserve) => void;
}

export default function ReserveCard({ reserve, onPress, onLongPress, onSwipeRight, onSwipeLeft, selected, isFlashed, hasPlansAvailable, showEnterpriseTracking, onRequestPin }: Props) {
  const isArchived = !!reserve.archivedAt;
  const router = useRouter();
  const { t } = useTranslation();
  const { lots, photos } = useApp();
  const { isOnline } = useNetwork();
  const swipeRef = useRef<Swipeable>(null);
  const flashAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isFlashed) {
      flashAnim.setValue(1);
      Animated.timing(flashAnim, { toValue: 0, duration: 800, useNativeDriver: true }).start();
    }
  }, [isFlashed]);

  const overdue = isOverdue(reserve.deadline, reserve.status);
  const daysLeft = deadlineDaysLeft(reserve.deadline);
  const showDeadline = reserve.deadline && reserve.deadline !== '—';
  const nearDeadline = !overdue && !isArchived && reserve.status !== 'closed' && daysLeft !== null && daysLeft <= 3;
  const lot = reserve.lotId ? lots.find(l => l.id === reserve.lotId) : null;
  const isObservation = reserve.kind === 'observation';
  // Certaines réserves n'ont ni `photos` ni `photo_uri` sur leur ligne mais
  // des photos liées dans la table `photos` (champ reserveId) — la fiche
  // détail les affiche via enrichReserveForPdf. Sans ce repli, la liste ne
  // montre aucune miniature alors que la fiche affiche bien des images.
  const linkedPhotoUri = useMemo(() => {
    if (reserve.photos?.[0]?.uri || reserve.photoUri) return null;
    return photos.find(p => p.reserveId === reserve.id && !!p.uri)?.uri ?? null;
  }, [photos, reserve.id, reserve.photos, reserve.photoUri]);
  const firstPhotoUri = reserve.photos?.[0]?.uri ?? reserve.photoUri ?? linkedPhotoUri;
  // URI morte (fichier local purgé, URL distante hors connexion sans cache) :
  // sans état d'erreur, la miniature rend un carré blanc muet — on affiche un
  // placeholder à la place, réinitialisé quand l'URI change.
  const [thumbFailed, setThumbFailed] = useState(false);
  useEffect(() => { setThumbFailed(false); }, [firstPhotoUri]);
  // True when at least one photo attached to this reserve still points to a
  // local file URI (camera cache, picker temp), meaning it has NOT yet been
  // uploaded to Supabase Storage and so won't be visible on other devices.
  const hasUnsyncedPhoto =
    (typeof reserve.photoUri === 'string' && isLocalUri(reserve.photoUri)) ||
    (Array.isArray(reserve.photos) && reserve.photos.some(p => p?.uri && isLocalUri(p.uri)));
  const syncPhotoIcon = isOnline ? 'cloud-upload-outline' : 'cloud-offline';
  const syncPhotoLabel = isOnline ? t('reserveCard.photoUploadPending') : t('reserveCard.unsyncedPhoto');
  const relativeDate = formatRelativeDate(reserve.createdAt);
  const enterpriseBadges = showEnterpriseTracking ? getEnterpriseWorkflowBadges(reserve, { attentionOnly: true }) : [];
  const statusLabel = reserve.status === 'open'
    ? t('reserveLabels.status.open')
    : reserve.status === 'in_progress'
      ? t('reserveLabels.status.in_progress')
      : reserve.status === 'waiting'
        ? t('reserveLabels.status.waiting')
        : reserve.status === 'verification'
          ? t('reserveLabels.status.verification')
          : t('reserveLabels.status.closed');
  const translatedRelativeDate = relativeDate === 'Auj.'
    ? t('reserveCard.todayShort')
    : relativeDate === 'Demain'
      ? t('reserveCard.tomorrow')
      : relativeDate;

  const renderRightActions = () => (
    <TouchableOpacity
      style={styles.swipeRightAction}
      onPress={() => { swipeRef.current?.close(); onSwipeRight?.(reserve); }}
      accessibilityLabel={t('reserveCard.changeStatusA11y')}
    >
      <Ionicons name="swap-horizontal-outline" size={20} color="#fff" />
      <Text style={styles.swipeActionText}>{t('reservesScreen.sections.status')}</Text>
    </TouchableOpacity>
  );

  const renderLeftActions = () => (
    <TouchableOpacity
      style={styles.swipeLeftAction}
      onPress={() => { swipeRef.current?.close(); onSwipeLeft?.(reserve); }}
      accessibilityLabel={isArchived ? t('reserveCard.unarchiveA11y') : t('reserveCard.archiveA11y')}
    >
      <Ionicons name={isArchived ? 'archive' : 'archive-outline'} size={20} color="#fff" />
      <Text style={styles.swipeActionText}>{isArchived ? t('reserveCard.unarchive') : t('reserveCard.archive')}</Text>
    </TouchableOpacity>
  );

  const card = (
    <TouchableOpacity
      style={[styles.card, overdue && styles.cardOverdue, nearDeadline && styles.cardNearDeadline, isObservation && styles.cardObservation, selected && styles.cardSelected, isArchived && styles.cardArchived]}
      onPress={() => onPress ? onPress(reserve) : router.push(`/reserve/${reserve.id}` as any)}
      onLongPress={() => onLongPress?.(reserve)}
      delayLongPress={400}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={t('reserveCard.accessibilityLabel', {
        id: reserve.id,
        title: reserve.title,
        status: statusLabel,
        companies: (reserve.companies ?? (reserve.company ? [reserve.company] : [])).join(', '),
      })}
      accessibilityHint={onLongPress ? t('reserveCard.longPressHint') : undefined}
    >
      <Animated.View
        style={[styles.flashOverlay, { opacity: flashAnim, pointerEvents: 'none' }]}
      />
      <View style={styles.top}>
        <View style={styles.topLeft}>
          <View style={styles.idWrap}>
            <Text style={styles.id}>{reserve.id}</Text>
          </View>
          {isObservation ? (
            <View style={styles.obsBadge}>
              <Ionicons name="eye-outline" size={10} color="#0EA5E9" />
              <Text style={styles.obsText}>{t('reserveCard.observation')}</Text>
            </View>
          ) : null}
          {isArchived ? (
            <View style={styles.archivedBadge}>
              <Ionicons name="archive" size={10} color="#6B7280" />
              <Text style={styles.archivedText}>{t('reserveCard.archived')}</Text>
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
                    ? t('reserveCard.todayShort')
                    : daysLeft === 1
                      ? t('reserveCard.tomorrow')
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

          {enterpriseBadges.length > 0 && (
            <View style={styles.enterpriseBadgeRow}>
              {enterpriseBadges.map(badge => (
                <View
                  key={badge.key}
                  style={[styles.enterpriseBadge, { backgroundColor: badge.bg, borderColor: badge.border }]}
                >
                  <Ionicons name={badge.icon as any} size={10} color={badge.color} />
                  <Text style={[styles.enterpriseBadgeText, { color: badge.color }]}>{badge.label}</Text>
                </View>
              ))}
            </View>
          )}

          <View style={styles.meta}>
            <View style={styles.metaItem}>
              <Ionicons name="business-outline" size={12} color={C.textMuted} />
              <Text style={styles.metaText}>
                {[reserve.building ? `${t('reserveCard.buildingShort')} ${reserve.building}` : null, reserve.zone, reserve.level].filter(Boolean).join(' — ')}
              </Text>
            </View>
            {lot && (
              <View style={styles.metaItem}>
                <View style={[styles.lotDot, { backgroundColor: lot.color ?? C.textMuted }]} />
                <Text style={[styles.metaText, { color: lot.color ?? C.textSub }]} numberOfLines={1}>
                  {lot.number ? t('reserveCard.lot', { number: lot.number }) : ''}{lot.name}
                </Text>
              </View>
            )}
            <View style={styles.metaItem}>
              <Ionicons name="time-outline" size={12} color={C.textMuted} />
              <Text style={styles.metaText}>{translatedRelativeDate}</Text>
            </View>
          </View>
        </View>

        {firstPhotoUri ? (
          <View style={styles.photoThumbWrap}>
            {thumbFailed ? (
              <View style={[styles.photoThumb, styles.photoThumbFallback]} accessibilityLabel={t('reserveCard.reservePhoto')}>
                <Ionicons name="image-outline" size={18} color={C.textMuted} />
              </View>
            ) : (
              <MediaImage source={{ uri: firstPhotoUri }} style={styles.photoThumb} resizeMode="cover" onError={() => setThumbFailed(true)} accessibilityLabel={t('reserveCard.reservePhoto')} />
            )}
            {hasUnsyncedPhoto && (
              <View style={[styles.syncDot, isOnline ? styles.syncDotPending : styles.syncDotOffline]} accessibilityLabel={syncPhotoLabel}>
                <Ionicons name={syncPhotoIcon} size={10} color="#fff" />
              </View>
            )}
          </View>
        ) : hasUnsyncedPhoto ? (
          <View style={[styles.photoThumb, styles.photoThumbPlaceholder]}>
            <Ionicons name="image-outline" size={20} color={C.textMuted} />
            <View style={[styles.syncDot, isOnline ? styles.syncDotPending : styles.syncDotOffline]} accessibilityLabel={syncPhotoLabel}>
              <Ionicons name={syncPhotoIcon} size={10} color="#fff" />
            </View>
          </View>
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
          {reserve.planId && reserve.planX != null && reserve.planY != null ? (
            <TouchableOpacity
              style={styles.planPinBtn}
              onPress={(event) => {
                event.stopPropagation();
                router.push({ pathname: '/(tabs)/plans', params: { focusPlanId: reserve.planId, focusReserveId: reserve.id } } as any);
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('reserveCard.viewOnPlan')}
            >
              <Ionicons name="location" size={12} color={C.primary} />
              <Text style={styles.planPinText}>{t('reserveCard.plan')}</Text>
              <View style={styles.planPinnedDot} />
            </TouchableOpacity>
          ) : hasPlansAvailable ? (
            <TouchableOpacity
              style={styles.planUnpinnedBtn}
              onPress={(event) => {
                event.stopPropagation();
                if (onRequestPin) onRequestPin(reserve);
                else router.push('/(tabs)/plans' as any);
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t('reserveCard.notPinnedA11y')}
            >
              <Ionicons name="location-outline" size={12} color="#B45309" />
              <Text style={styles.planUnpinnedText}>{t('reserveCard.plan')}</Text>
              <View style={styles.planUnpinnedDot}>
                <Text style={styles.planUnpinnedDotText}>!</Text>
              </View>
            </TouchableOpacity>
          ) : null}
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
  cardNearDeadline: {
    borderLeftWidth: 3,
    borderLeftColor: '#D97706',
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
  archivedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#6B728015',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#6B728030',
  },
  archivedText: {
    fontSize: 10,
    fontFamily: 'Inter_600SemiBold',
    color: '#6B7280',
  },
  cardArchived: {
    opacity: 0.65,
    borderStyle: 'dashed',
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
  enterpriseBadgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 5,
    marginBottom: 8,
  },
  enterpriseBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  enterpriseBadgeText: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
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
  photoThumbWrap: {
    position: 'relative',
    flexShrink: 0,
  },
  photoThumbFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.surface2,
  },
  photoThumbPlaceholder: {
    backgroundColor: C.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  syncDot: {
    position: 'absolute',
    top: -4,
    right: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  syncDotPending: {
    backgroundColor: '#2563EB',
  },
  syncDotOffline: {
    backgroundColor: '#DC2626',
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
  planPinnedDot: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#22C55E',
    marginLeft: 1,
  },
  planUnpinnedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#FFFBEB',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#D97706' + '50',
  },
  planUnpinnedText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: '#B45309',
  },
  planUnpinnedDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#F59E0B',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 1,
  },
  planUnpinnedDotText: {
    fontSize: 8,
    fontFamily: 'Inter_700Bold',
    color: '#fff',
    lineHeight: 10,
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
  flashOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#22C55E',
    borderRadius: 14,
    zIndex: 10,
  },
});
