import { useState } from 'react';
import { Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { C } from '@/constants/colors';
import type { Reserve, Visite } from '@/constants/types';

export function ConducteurTodayQueue({
  verification,
  critical,
  overdue,
  todayVisits,
  canEdit,
  author,
  onApprove,
  onReject,
}: {
  verification: Reserve[];
  critical: Reserve[];
  overdue: Reserve[];
  todayVisits: Visite[];
  canEdit: boolean;
  author: string;
  onApprove: (id: string, author: string) => void;
  onReject: (id: string, author: string) => void;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const total = verification.length + critical.length + overdue.length + todayVisits.length;

  function approve(reserve: Reserve) {
    Alert.alert(
      t('dashboard.todayApproveTitle'),
      t('dashboard.todayApproveText', { title: reserve.title }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('reserveDetail.approve'),
          onPress: () => {
            setBusyId(reserve.id);
            onApprove(reserve.id, author);
            setBusyId(null);
          },
        },
      ],
    );
  }

  function reject(reserve: Reserve) {
    Alert.alert(
      t('dashboard.todayRejectTitle'),
      t('dashboard.todayRejectText', { title: reserve.title }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('reserveDetail.reject'),
          style: 'destructive',
          onPress: () => {
            setBusyId(reserve.id);
            onReject(reserve.id, author);
            setBusyId(null);
          },
        },
      ],
    );
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View>
          <Text style={styles.kicker}>{t('dashboard.todayKicker')}</Text>
          <Text style={styles.title}>{t('dashboard.todayTitle')}</Text>
        </View>
        <View style={styles.count}><Text style={styles.countText}>{total}</Text></View>
      </View>
      {total === 0 ? (
        <Text style={styles.empty}>{t('dashboard.todayEmpty')}</Text>
      ) : (
        <>
          {verification.map(reserve => (
            <View key={reserve.id} style={styles.row}>
              <TouchableOpacity style={styles.rowMain} onPress={() => router.push(`/reserve/${reserve.id}` as any)}>
                <View style={[styles.dot, { backgroundColor: C.verification }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowLabel}>{t('dashboard.todayLift')}</Text>
                  <Text style={styles.rowTitle} numberOfLines={2}>{reserve.title}</Text>
                </View>
              </TouchableOpacity>
              {canEdit ? (
                <View style={styles.actions}>
                  <TouchableOpacity style={styles.approve} disabled={busyId === reserve.id} onPress={() => approve(reserve)}>
                    <Ionicons name="checkmark" size={16} color="#059669" />
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.reject} disabled={busyId === reserve.id} onPress={() => reject(reserve)}>
                    <Ionicons name="close" size={16} color="#DC2626" />
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>
          ))}
          {critical.map(reserve => (
            <TouchableOpacity key={reserve.id} style={styles.row} onPress={() => router.push(`/reserve/${reserve.id}` as any)}>
              <View style={[styles.dot, { backgroundColor: C.critical }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>{t('dashboard.todayCritical')}</Text>
                <Text style={styles.rowTitle} numberOfLines={2}>{reserve.title}</Text>
              </View>
              <Ionicons name="chevron-forward" size={14} color={C.critical} />
            </TouchableOpacity>
          ))}
          {overdue.map(reserve => (
            <TouchableOpacity key={reserve.id} style={styles.row} onPress={() => router.push(`/reserve/${reserve.id}` as any)}>
              <View style={[styles.dot, { backgroundColor: C.high }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>{t('dashboard.todayOverdue')}</Text>
                <Text style={styles.rowTitle} numberOfLines={2}>{reserve.title}</Text>
              </View>
              <Ionicons name="chevron-forward" size={14} color={C.high} />
            </TouchableOpacity>
          ))}
          {todayVisits.map(visit => (
            <TouchableOpacity key={visit.id} style={styles.row} onPress={() => router.push(`/visite/${visit.id}` as any)}>
              <View style={[styles.dot, { backgroundColor: '#F59E0B' }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowLabel}>{t('dashboard.todayVisit')}</Text>
                <Text style={styles.rowTitle} numberOfLines={2}>{visit.title}</Text>
              </View>
              <Ionicons name="chevron-forward" size={14} color="#F59E0B" />
            </TouchableOpacity>
          ))}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: C.surface, borderRadius: 18, borderWidth: 1, borderColor: C.border, padding: 14, gap: 8 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  kicker: { color: C.primary, fontFamily: 'Inter_700Bold', fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase' },
  title: { color: C.text, fontFamily: 'Inter_700Bold', fontSize: 18, marginTop: 2 },
  count: { minWidth: 28, height: 28, borderRadius: 14, backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  countText: { color: C.primary, fontFamily: 'Inter_700Bold', fontSize: 13 },
  empty: { color: C.textMuted, fontFamily: 'Inter_400Regular', fontSize: 13, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.border },
  rowMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  rowLabel: { color: C.textSub, fontFamily: 'Inter_600SemiBold', fontSize: 10, textTransform: 'uppercase' },
  rowTitle: { color: C.text, fontFamily: 'Inter_600SemiBold', fontSize: 13, marginTop: 1 },
  actions: { flexDirection: 'row', gap: 6 },
  approve: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#ECFDF5', alignItems: 'center', justifyContent: 'center' },
  reject: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#FEF2F2', alignItems: 'center', justifyContent: 'center' },
});
