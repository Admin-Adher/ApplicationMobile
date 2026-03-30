import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform, Modal, PanResponder, Animated, GestureResponderEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useState, useRef, useCallback } from 'react';
import { useRouter } from 'expo-router';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { Reserve } from '@/constants/types';
import StatusBadge from '@/components/StatusBadge';
import PriorityBadge from '@/components/PriorityBadge';

const BUILDINGS = ['A', 'B', 'C'];

interface Room {
  id: string;
  label: string;
  x: number; y: number; w: number; h: number;
  dark?: boolean;
}

const FLOOR_PLANS: Record<string, Room[]> = {
  A: [
    { id: 'ha', label: 'Hall', x: 0, y: 0, w: 30, h: 25 },
    { id: 'b101', label: 'Bureau 101', x: 30, y: 0, w: 40, h: 25 },
    { id: 'sr', label: 'Salle Réunion', x: 70, y: 0, w: 30, h: 50 },
    { id: 'coul', label: 'Couloir', x: 0, y: 25, w: 70, h: 12, dark: true },
    { id: 'b102', label: 'Bureau 102', x: 0, y: 37, w: 35, h: 30 },
    { id: 'b103', label: 'Bureau 103', x: 35, y: 37, w: 35, h: 30 },
    { id: 'lt', label: 'Local Technique', x: 70, y: 50, w: 30, h: 25 },
    { id: 'wc', label: 'Sanitaires', x: 0, y: 67, w: 70, h: 18, dark: true },
    { id: 'esc', label: 'Escaliers', x: 70, y: 75, w: 30, h: 25 },
  ],
  B: [
    { id: 'accb', label: 'Accueil B', x: 0, y: 0, w: 100, h: 18 },
    { id: 'zt', label: 'Zone Technique', x: 0, y: 18, w: 50, h: 40 },
    { id: 'atel', label: 'Atelier', x: 50, y: 18, w: 50, h: 40 },
    { id: 'stock', label: 'Stockage', x: 0, y: 58, w: 40, h: 42 },
    { id: 'lsoc', label: 'Locaux Sociaux', x: 40, y: 58, w: 60, h: 42 },
  ],
  C: [
    { id: 'ail1', label: 'Aile Nord', x: 0, y: 0, w: 30, h: 60 },
    { id: 'hc', label: 'Hall C', x: 30, y: 0, w: 40, h: 25 },
    { id: 'ail2', label: 'Aile Sud', x: 70, y: 0, w: 30, h: 60 },
    { id: 'corp', label: 'Corps Principal', x: 30, y: 25, w: 40, h: 40 },
    { id: 'ss', label: 'Sous-sol', x: 0, y: 60, w: 100, h: 40, dark: true },
  ],
};

const MARKER_COLORS: Record<string, string> = {
  open: C.open, in_progress: C.inProgress,
  waiting: C.waiting, verification: C.verification, closed: C.closed,
};

const PLAN_W = 360;
const PLAN_H = 270;

export default function PlansScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { reserves, companies } = useApp();
  const [building, setBuilding] = useState('A');
  const [selected, setSelected] = useState<Reserve | null>(null);
  const [companyFilter, setCompanyFilter] = useState<string>('all');
  const [addingMarker, setAddingMarker] = useState(false);
  const [pendingCoords, setPendingCoords] = useState<{ x: number; y: number } | null>(null);
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const lastScale = useRef(1);
  const lastTX = useRef(0);
  const lastTY = useRef(0);
  const pinchStart = useRef<number | null>(null);

  const plan = FLOOR_PLANS[building];
  let buildingReserves = reserves.filter(r => r.building === building);
  if (companyFilter !== 'all') {
    buildingReserves = buildingReserves.filter(r => r.company === companyFilter);
  }

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        lastTX.current = (translateX as any)._value;
        lastTY.current = (translateY as any)._value;
      },
      onPanResponderMove: (_, gs) => {
        translateX.setValue(lastTX.current + gs.dx);
        translateY.setValue(lastTY.current + gs.dy);
      },
      onPanResponderRelease: () => {
        lastTX.current = (translateX as any)._value;
        lastTY.current = (translateY as any)._value;
      },
    })
  ).current;

  function zoomIn() {
    const next = Math.min(lastScale.current * 1.3, 4);
    lastScale.current = next;
    Animated.spring(scale, { toValue: next, useNativeDriver: true }).start();
  }

  function zoomOut() {
    const next = Math.max(lastScale.current / 1.3, 0.5);
    lastScale.current = next;
    Animated.spring(scale, { toValue: next, useNativeDriver: true }).start();
  }

  function resetView() {
    lastScale.current = 1;
    lastTX.current = 0;
    lastTY.current = 0;
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true }),
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true }),
    ]).start();
  }

  function handlePlanTap(e: GestureResponderEvent) {
    if (!addingMarker) return;
    const { locationX, locationY } = e.nativeEvent;
    const px = Math.round((locationX / PLAN_W) * 100);
    const py = Math.round((locationY / PLAN_H) * 100);
    setPendingCoords({ x: px, y: py });
    setAddingMarker(false);
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <View style={styles.headerTop}>
          <Text style={styles.title}>Plans interactifs</Text>
          <View style={styles.zoomBtns}>
            <TouchableOpacity style={styles.zoomBtn} onPress={zoomOut}><Ionicons name="remove" size={16} color={C.text} /></TouchableOpacity>
            <TouchableOpacity style={styles.zoomBtn} onPress={resetView}><Ionicons name="scan-outline" size={14} color={C.text} /></TouchableOpacity>
            <TouchableOpacity style={styles.zoomBtn} onPress={zoomIn}><Ionicons name="add" size={16} color={C.text} /></TouchableOpacity>
          </View>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.buildingRow}>
            {BUILDINGS.map(b => (
              <TouchableOpacity
                key={b}
                style={[styles.buildingBtn, building === b && styles.buildingBtnActive]}
                onPress={() => { setBuilding(b); resetView(); }}
              >
                <Text style={[styles.buildingText, building === b && styles.buildingTextActive]}>Bâtiment {b}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </View>

      <View style={styles.companyFilterWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 16 }}>
          <TouchableOpacity
            style={[styles.filterChip, companyFilter === 'all' && styles.filterChipActive]}
            onPress={() => setCompanyFilter('all')}
          >
            <Text style={[styles.filterChipText, companyFilter === 'all' && styles.filterChipTextActive]}>Toutes</Text>
          </TouchableOpacity>
          {companies.map(c => (
            <TouchableOpacity
              key={c.id}
              style={[styles.filterChip, companyFilter === c.name && { backgroundColor: c.color + '20', borderColor: c.color }]}
              onPress={() => setCompanyFilter(companyFilter === c.name ? 'all' : c.name)}
            >
              <View style={[styles.filterDot, { backgroundColor: c.color }]} />
              <Text style={[styles.filterChipText, companyFilter === c.name && { color: c.color }]}>{c.shortName}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.planContainer}>
          <View style={styles.planTitleRow}>
            <Text style={styles.planTitle}>Bâtiment {building} — Plan masse</Text>
            <TouchableOpacity
              style={[styles.addMarkerBtn, addingMarker && styles.addMarkerBtnActive]}
              onPress={() => setAddingMarker(!addingMarker)}
            >
              <Ionicons name={addingMarker ? 'close' : 'add-circle-outline'} size={15} color={addingMarker ? C.open : C.primary} />
              <Text style={[styles.addMarkerText, addingMarker && { color: C.open }]}>
                {addingMarker ? 'Annuler' : 'Placer'}
              </Text>
            </TouchableOpacity>
          </View>

          {addingMarker && (
            <View style={styles.addingHint}>
              <Ionicons name="information-circle-outline" size={14} color={C.inProgress} />
              <Text style={styles.addingHintText}>Touchez le plan pour placer une réserve</Text>
            </View>
          )}

          <View style={styles.planViewport}>
            <Animated.View
              style={[styles.planAnimated, { transform: [{ scale }, { translateX }, { translateY }] }]}
              {...panResponder.panHandlers}
            >
              <View style={[styles.planView, { width: PLAN_W, height: PLAN_H }]} onTouchEnd={handlePlanTap}>
                {plan.map(room => (
                  <View
                    key={room.id}
                    style={[styles.room, {
                      left: `${room.x}%` as any,
                      top: `${room.y}%` as any,
                      width: `${room.w}%` as any,
                      height: `${room.h}%` as any,
                      backgroundColor: room.dark ? '#0D1520' : '#141D2E',
                    }]}
                  >
                    <Text style={styles.roomLabel} numberOfLines={2}>{room.label}</Text>
                  </View>
                ))}

                {buildingReserves.map(r => (
                  <TouchableOpacity
                    key={r.id}
                    style={[styles.marker, {
                      left: `${r.planX}%` as any,
                      top: `${r.planY}%` as any,
                      backgroundColor: MARKER_COLORS[r.status],
                    }]}
                    onPress={() => setSelected(r)}
                  >
                    <Text style={styles.markerText}>{r.id.split('-')[1] ?? '?'}</Text>
                  </TouchableOpacity>
                ))}

                {pendingCoords && (
                  <TouchableOpacity
                    style={[styles.marker, styles.markerPending, {
                      left: `${pendingCoords.x}%` as any,
                      top: `${pendingCoords.y}%` as any,
                    }]}
                    onPress={() => {
                      router.push({
                        pathname: '/reserve/new',
                        params: { building, planX: pendingCoords.x, planY: pendingCoords.y },
                      } as any);
                      setPendingCoords(null);
                    }}
                  >
                    <Ionicons name="add" size={12} color="#fff" />
                  </TouchableOpacity>
                )}
              </View>
            </Animated.View>
          </View>

          {pendingCoords && (
            <View style={styles.pendingBanner}>
              <Ionicons name="location" size={14} color={C.inProgress} />
              <Text style={styles.pendingText}>
                Position ({pendingCoords.x}%, {pendingCoords.y}%) — Touchez le + pour créer la réserve
              </Text>
              <TouchableOpacity onPress={() => setPendingCoords(null)}>
                <Ionicons name="close-circle" size={16} color={C.textMuted} />
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.legend}>
            {(['open', 'in_progress', 'waiting', 'verification', 'closed'] as const).map(s => {
              const labels: Record<string, string> = { open: 'Ouvert', in_progress: 'En cours', waiting: 'Attente', verification: 'Vérif.', closed: 'Clôturé' };
              return (
                <View key={s} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: MARKER_COLORS[s] }]} />
                  <Text style={styles.legendLabel}>{labels[s]}</Text>
                </View>
              );
            })}
          </View>
        </View>

        <Text style={styles.sectionTitle}>{buildingReserves.length} réserve(s) — Bâtiment {building}</Text>
        {buildingReserves.map(r => (
          <TouchableOpacity
            key={r.id}
            style={styles.reserveRow}
            onPress={() => router.push(`/reserve/${r.id}` as any)}
          >
            <View style={[styles.reserveColorDot, { backgroundColor: MARKER_COLORS[r.status] }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.reserveTitle}>{r.id} — {r.title}</Text>
              <Text style={styles.reserveSub}>{r.zone} — {r.level} — {r.company}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
          </TouchableOpacity>
        ))}
        {buildingReserves.length === 0 && (
          <View style={styles.empty}>
            <Ionicons name="map-outline" size={40} color={C.textMuted} />
            <Text style={styles.emptyText}>Aucune réserve pour ce bâtiment</Text>
          </View>
        )}
      </ScrollView>

      <Modal visible={!!selected} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        {selected && (
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalId}>{selected.id}</Text>
                <TouchableOpacity onPress={() => setSelected(null)} hitSlop={8}>
                  <Ionicons name="close" size={22} color={C.textSub} />
                </TouchableOpacity>
              </View>
              <Text style={styles.modalTitle}>{selected.title}</Text>
              <View style={styles.modalBadges}>
                <StatusBadge status={selected.status} />
                <PriorityBadge priority={selected.priority} />
              </View>
              <Text style={styles.modalInfo}>Bât. {selected.building} — {selected.zone} — {selected.level}</Text>
              <Text style={styles.modalInfo}>{selected.company}</Text>
              <TouchableOpacity
                style={styles.modalBtn}
                onPress={() => { setSelected(null); router.push(`/reserve/${selected.id}` as any); }}
              >
                <Text style={styles.modalBtnText}>Voir la réserve</Text>
                <Ionicons name="arrow-forward" size={16} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  title: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.text },
  zoomBtns: { flexDirection: 'row', gap: 6 },
  zoomBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  buildingRow: { flexDirection: 'row', gap: 8, paddingBottom: 2 },
  buildingBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  buildingBtnActive: { backgroundColor: C.primaryBg, borderColor: C.primary },
  buildingText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub },
  buildingTextActive: { color: C.primary },
  companyFilterWrap: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  filterChipActive: { backgroundColor: C.primaryBg, borderColor: C.primary },
  filterChipText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub },
  filterChipTextActive: { color: C.primary },
  filterDot: { width: 6, height: 6, borderRadius: 3 },
  content: { padding: 16, paddingBottom: 40 },
  planContainer: { backgroundColor: C.surface, borderRadius: 14, padding: 14, marginBottom: 20, borderWidth: 1, borderColor: C.border },
  planTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  planTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.5 },
  addMarkerBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: C.primaryBg, borderWidth: 1, borderColor: C.primary },
  addMarkerBtnActive: { backgroundColor: C.open + '15', borderColor: C.open },
  addMarkerText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.primary },
  addingHint: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.inProgress + '15', borderRadius: 8, padding: 8, marginBottom: 10 },
  addingHintText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.inProgress },
  planViewport: { borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: C.border, height: PLAN_H },
  planAnimated: { alignItems: 'flex-start' },
  planView: { position: 'relative', borderRadius: 8, overflow: 'hidden' },
  room: { position: 'absolute', borderWidth: 1, borderColor: '#1E2840', alignItems: 'center', justifyContent: 'center', padding: 4 },
  roomLabel: { fontSize: 8, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center' },
  marker: { position: 'absolute', width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginLeft: -11, marginTop: -11, borderWidth: 2, borderColor: '#0F1117' },
  markerPending: { backgroundColor: C.inProgress, borderColor: '#fff', borderWidth: 2 },
  markerText: { fontSize: 9, fontFamily: 'Inter_700Bold', color: '#fff' },
  pendingBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.inProgress + '15', borderRadius: 8, padding: 8, marginTop: 8 },
  pendingText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: C.inProgress },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub },
  sectionTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.textSub, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  reserveRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.surface, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: C.border },
  reserveColorDot: { width: 10, height: 10, borderRadius: 5 },
  reserveTitle: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.text },
  reserveSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  empty: { alignItems: 'center', paddingVertical: 32, gap: 10 },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textMuted },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: C.surface2, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modalId: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.primary },
  modalTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 12, lineHeight: 24 },
  modalBadges: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  modalInfo: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, marginBottom: 4 },
  modalBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: C.primary, borderRadius: 12, paddingVertical: 14, gap: 8, marginTop: 16 },
  modalBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },
});
