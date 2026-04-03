import React, { useRef, useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  Animated, TextInput, Platform, Keyboard, PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/constants/colors';
import { Reserve, SitePlan } from '@/constants/types';
import StatusBadge from '@/components/StatusBadge';
import PriorityBadge from '@/components/PriorityBadge';
import { useRouter } from 'expo-router';

interface Props {
  reserves: Reserve[];
  allReserves: Reserve[];
  pinNumberMap: Map<string, number>;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onReservePress: (r: Reserve) => void;
  onExport: () => void;
  canCreate: boolean;
  currentPlan: SitePlan | null;
  activeChantierId: string | null;
  highlightedReserveId: string | null;
  sheetHeight: number;
  companies: Array<{ name: string; color: string }>;
}

function getCompanyColor(companyName: string, companies: Array<{ name: string; color: string }>): string {
  if (!companyName) return '#003082';
  return companies.find(c => c.name === companyName)?.color ?? '#003082';
}

const PEEK_HEIGHT = 60;

export default function ReservesSheet({
  reserves, allReserves, pinNumberMap, searchQuery, onSearchChange,
  onReservePress, onExport, canCreate, currentPlan, activeChantierId,
  highlightedReserveId, sheetHeight, companies,
}: Props) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const animY = useRef(new Animated.Value(PEEK_HEIGHT)).current;

  const EXPANDED_H = Math.min(sheetHeight * 0.65, 500);

  const expandedRef = useRef(false);
  const expandedHRef = useRef(EXPANDED_H);
  const baseHeightRef = useRef(PEEK_HEIGHT);

  useEffect(() => { expandedHRef.current = EXPANDED_H; }, [EXPANDED_H]);
  useEffect(() => { expandedRef.current = expanded; }, [expanded]);

  useEffect(() => {
    Animated.spring(animY, {
      toValue: expanded ? EXPANDED_H : PEEK_HEIGHT,
      useNativeDriver: false,
      tension: 60,
      friction: 12,
    }).start();
  }, [expanded, EXPANDED_H]);

  function snapTo(shouldExpand: boolean) {
    setExpanded(shouldExpand);
    if (shouldExpand) Keyboard.dismiss();
    Animated.spring(animY, {
      toValue: shouldExpand ? expandedHRef.current : PEEK_HEIGHT,
      useNativeDriver: false,
      tension: 60,
      friction: 12,
    }).start();
  }

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dy) > 6,
      onPanResponderGrant: () => {
        baseHeightRef.current = expandedRef.current
          ? expandedHRef.current
          : PEEK_HEIGHT;
      },
      onPanResponderMove: (_, gs) => {
        const EH = expandedHRef.current;
        const newH = Math.min(EH, Math.max(PEEK_HEIGHT, baseHeightRef.current - gs.dy));
        animY.setValue(newH);
      },
      onPanResponderRelease: (_, gs) => {
        const EH = expandedHRef.current;
        const isTap = Math.abs(gs.dx) < 8 && Math.abs(gs.dy) < 8;
        if (isTap) {
          snapTo(!expandedRef.current);
          return;
        }
        const currentH = Math.min(EH, Math.max(PEEK_HEIGHT, baseHeightRef.current - gs.dy));
        const midpoint = (PEEK_HEIGHT + EH) / 2;
        const shouldExpand =
          gs.vy < -0.4 ||
          (Math.abs(gs.vy) <= 0.4 && currentH > midpoint);
        snapTo(shouldExpand);
      },
      onPanResponderTerminate: (_, gs) => {
        const EH = expandedHRef.current;
        const currentH = Math.min(EH, Math.max(PEEK_HEIGHT, baseHeightRef.current - gs.dy));
        const midpoint = (PEEK_HEIGHT + EH) / 2;
        snapTo(currentH > midpoint);
      },
    })
  ).current;

  const filteredReserves = searchQuery.trim()
    ? reserves.filter(r => {
        const q = searchQuery.toLowerCase();
        const num = pinNumberMap.get(r.id);
        return (
          r.title.toLowerCase().includes(q) ||
          (r.company ?? '').toLowerCase().includes(q) ||
          (r.description ?? '').toLowerCase().includes(q) ||
          (num !== undefined && String(num).includes(q))
        );
      })
    : reserves;

  return (
    <Animated.View style={[styles.sheet, { height: animY }]}>
      <View
        style={styles.handle}
        {...panResponder.panHandlers}
        accessibilityLabel={expanded ? 'Réduire la liste des réserves' : 'Afficher la liste des réserves'}
        accessibilityRole="button"
      >
        <View style={styles.handleBar} />
        <View style={styles.handleContent}>
          <View style={styles.handleLeft}>
            <Ionicons name="list-outline" size={15} color={C.primary} />
            <Text style={styles.handleTitle}>
              {reserves.length > 0
                ? `${reserves.length} réserve${reserves.length !== 1 ? 's' : ''}`
                : 'Réserves'}
            </Text>
            {allReserves.length > reserves.length && (
              <Text style={styles.handleSub}>({allReserves.length} au total)</Text>
            )}
          </View>
          <View style={styles.handleRight}>
            <TouchableOpacity
              style={styles.exportBadge}
              onPress={onExport}
              accessibilityLabel="Exporter en PDF"
            >
              <Ionicons name="document-text-outline" size={13} color={C.primary} />
              <Text style={styles.exportBadgeText}>PDF</Text>
            </TouchableOpacity>
            <Ionicons
              name={expanded ? 'chevron-down' : 'chevron-up'}
              size={16}
              color={C.textMuted}
            />
          </View>
        </View>
      </View>

      {expanded && (
        <>
          <View style={styles.searchRow}>
            <View style={styles.searchBox}>
              <Ionicons name="search-outline" size={15} color={C.textMuted} />
              <TextInput
                style={styles.searchInput}
                placeholder="Rechercher une réserve…"
                placeholderTextColor={C.textMuted}
                value={searchQuery}
                onChangeText={onSearchChange}
                returnKeyType="search"
                accessibilityLabel="Rechercher dans les réserves"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => onSearchChange('')} hitSlop={8}>
                  <Ionicons name="close-circle" size={16} color={C.textMuted} />
                </TouchableOpacity>
              )}
            </View>
          </View>

          <FlatList
            data={filteredReserves}
            keyExtractor={r => r.id}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <View style={styles.emptyBox}>
                {searchQuery ? (
                  <>
                    <Ionicons name="search-outline" size={24} color={C.textMuted} />
                    <Text style={styles.emptyText}>Aucun résultat pour "{searchQuery}"</Text>
                  </>
                ) : (
                  <>
                    <Ionicons name="checkmark-circle-outline" size={28} color={C.closed} />
                    <Text style={styles.emptyText}>Aucune réserve sur ce plan</Text>
                    {canCreate && (
                      <TouchableOpacity
                        style={styles.addBtn}
                        onPress={() => router.push({
                          pathname: '/reserve/new',
                          params: { planId: currentPlan?.id ?? '', chantierId: activeChantierId ?? '' },
                        } as any)}
                      >
                        <Ionicons name="add" size={14} color={C.primary} />
                        <Text style={styles.addBtnText}>Ajouter une réserve</Text>
                      </TouchableOpacity>
                    )}
                  </>
                )}
              </View>
            }
            renderItem={({ item: r }) => (
              <TouchableOpacity
                style={[styles.row, highlightedReserveId === r.id && styles.rowHighlighted]}
                onPress={() => onReservePress(r)}
                activeOpacity={0.75}
                accessibilityLabel={`Réserve ${r.title}`}
                accessibilityRole="button"
              >
                <View style={[styles.pinBadge, { backgroundColor: getCompanyColor(r.company, companies) }]}>
                  <Text style={styles.pinText}>{pinNumberMap.get(r.id) ?? '—'}</Text>
                </View>
                <View style={styles.info}>
                  <Text style={styles.title} numberOfLines={1}>{r.title}</Text>
                  <Text style={styles.meta} numberOfLines={1}>{r.company}{r.level ? ` · ${r.level}` : ''}</Text>
                </View>
                <View style={styles.badges}>
                  <StatusBadge status={r.status} small />
                  <PriorityBadge priority={r.priority} small />
                </View>
              </TouchableOpacity>
            )}
          />
        </>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 1,
    borderLeftWidth: 1,
    borderRightWidth: 1,
    borderColor: C.border,
    overflow: 'hidden',
    ...Platform.select({
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: -3 }, shadowOpacity: 0.12, shadowRadius: 8, elevation: 12 },
      web: { boxShadow: '0 -3px 12px rgba(0,0,0,0.1)' } as any,
    }),
  },
  handle: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 6, cursor: 'grab' as any },
  handleBar: { width: 36, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginBottom: 8 },
  handleContent: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  handleLeft: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  handleRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  handleTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  handleSub: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },
  exportBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: C.primaryBg, borderWidth: 1, borderColor: C.primary + '40' },
  exportBadgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.primary },
  searchRow: { paddingHorizontal: 12, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  searchBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.surface2, borderRadius: 10, borderWidth: 1, borderColor: C.border, paddingHorizontal: 10, paddingVertical: 8 },
  searchInput: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text },
  list: { paddingHorizontal: 10, paddingVertical: 8, gap: 6, paddingBottom: 20 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.surface, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: C.border },
  rowHighlighted: { backgroundColor: C.primaryBg, borderColor: C.primary + '60' },
  pinBadge: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  pinText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#fff' },
  info: { flex: 1 },
  title: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text },
  meta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1 },
  badges: { gap: 3, alignItems: 'flex-end' },
  emptyBox: { alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 24 },
  emptyText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub, textAlign: 'center' },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10, backgroundColor: C.primaryBg, borderWidth: 1, borderColor: C.primary + '40' },
  addBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.primary },
});
