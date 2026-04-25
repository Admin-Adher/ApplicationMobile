import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal,
  ScrollView, TextInput, Platform, PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '@/constants/colors';

export interface LevelItem {
  id: string;
  name: string;
  planCount: number;
  reserveCount: number;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  buildingName: string;
  levels: LevelItem[];
  selectedId: string;          // level id, or 'all'
  recentIds: string[];
  onSelect: (id: string) => void;   // pass 'all' to choose "Tous niveaux"
}

const ALL_LEVELS = 'all';

function levelSortKey(name: string): { num: number; lex: string } {
  const t = name.trim();
  // Cas RDC / RC / Rez-de-chaussée → 0
  if (/^(rdc|r\.?d\.?c\.?|rc|rez)/i.test(t)) return { num: 0, lex: t };
  // Cas R+N / R-N / R N
  let m = t.match(/^r\s*([+\-])\s*(\d+)/i);
  if (m) {
    const n = parseInt(m[2], 10) * (m[1] === '-' ? -1 : 1);
    return { num: n, lex: t };
  }
  // N° de niveau pur
  m = t.match(/^([+\-]?\d+)/);
  if (m) return { num: parseInt(m[1], 10), lex: t };
  // Sous-sol explicite
  if (/sous.?sol|s\.?s\.?/i.test(t)) return { num: -1, lex: t };
  return { num: 99, lex: t };
}

function sortLevels(a: LevelItem, b: LevelItem) {
  const ka = levelSortKey(a.name);
  const kb = levelSortKey(b.name);
  if (ka.num !== kb.num) return ka.num - kb.num;
  return ka.lex.localeCompare(kb.lex, 'fr', { numeric: true });
}

export default function LevelPickerSheet({
  visible, onClose, buildingName, levels, selectedId, recentIds, onSelect,
}: Props) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  const handlePan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 8 && g.dy > Math.abs(g.dx),
      onPanResponderRelease: (_, g) => {
        if (g.dy > 60 || g.vy > 0.5) onClose();
      },
    })
  ).current;

  useEffect(() => { if (!visible) setQuery(''); }, [visible]);

  const sortedLevels = useMemo(() => [...levels].sort(sortLevels), [levels]);

  const recents = useMemo(() => {
    const map = new Map(levels.map(l => [l.id, l]));
    return recentIds.map(id => map.get(id)).filter(Boolean) as LevelItem[];
  }, [levels, recentIds]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sortedLevels;
    return sortedLevels.filter(l => l.name.toLowerCase().includes(q));
  }, [sortedLevels, query]);

  const totalReserves = useMemo(
    () => levels.reduce((acc, l) => acc + l.reserveCount, 0),
    [levels]
  );
  const totalPlans = useMemo(
    () => levels.reduce((acc, l) => acc + l.planCount, 0),
    [levels]
  );

  function pick(id: string) {
    onSelect(id);
    setQuery('');
    onClose();
  }

  const bottomPad = Platform.OS === 'web' ? 24 : Math.max(insets.bottom + 16, 32);
  const showGrid = !query;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={() => { setQuery(''); onClose(); }}
      statusBarTranslucent
    >
      <TouchableOpacity
        style={styles.backdrop}
        activeOpacity={1}
        onPress={() => { setQuery(''); onClose(); }}
      />
      <View style={styles.sheet}>
        <View style={styles.handleHitArea} {...handlePan.panHandlers}>
          <View style={styles.handle} />
        </View>

        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Choisir un niveau</Text>
            <Text style={styles.subtitle} numberOfLines={1}>
              {buildingName} · {levels.length} niveau{levels.length > 1 ? 'x' : ''}
            </Text>
          </View>
          <TouchableOpacity onPress={() => { setQuery(''); onClose(); }} style={styles.closeBtn}>
            <Ionicons name="close" size={18} color={C.textSub} />
          </TouchableOpacity>
        </View>

        <View style={styles.searchWrap}>
          <Ionicons name="search" size={16} color={C.textMuted} />
          <TextInput
            style={styles.searchInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Rechercher un niveau (ex. R+5)"
            placeholderTextColor={C.textMuted}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={C.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          style={styles.list}
          contentContainerStyle={{ paddingBottom: bottomPad }}
          keyboardShouldPersistTaps="handled"
        >
          {/* Entrée "Tous niveaux" épinglée en haut, hors recherche */}
          {!query && (
            <TouchableOpacity
              style={[styles.row, selectedId === ALL_LEVELS && styles.rowActive]}
              onPress={() => pick(ALL_LEVELS)}
              activeOpacity={0.7}
            >
              <View style={[styles.icon, selectedId === ALL_LEVELS && styles.iconActive]}>
                <Ionicons
                  name="layers-outline"
                  size={16}
                  color={selectedId === ALL_LEVELS ? '#fff' : C.textSub}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowTitle, selectedId === ALL_LEVELS && styles.rowTitleActive]}>
                  Tous niveaux
                </Text>
                <View style={styles.rowSubRow}>
                  <Text style={styles.rowSub}>
                    {totalPlans} plan{totalPlans > 1 ? 's' : ''}
                  </Text>
                  {totalReserves > 0 && (
                    <>
                      <View style={styles.dotSep} />
                      <Text style={styles.rowSubReserve}>
                        {totalReserves} réserve{totalReserves > 1 ? 's' : ''}
                      </Text>
                    </>
                  )}
                </View>
              </View>
              {selectedId === ALL_LEVELS && <View style={styles.activeDot} />}
            </TouchableOpacity>
          )}

          {/* Récents */}
          {!query && recents.length > 0 && (
            <>
              <SectionHeader icon="time-outline" label="Récemment consultés" />
              {recents.map(l => (
                <LevelRow
                  key={`recent-${l.id}`}
                  l={l}
                  active={l.id === selectedId}
                  pinned
                  onPress={() => pick(l.id)}
                />
              ))}
            </>
          )}

          {/* Grille compacte des niveaux (codes courts comme RDC, R+1 …) */}
          {showGrid && sortedLevels.length > 0 && (
            <>
              <SectionHeader
                icon="grid-outline"
                label={`Tous les niveaux · ${sortedLevels.length}`}
              />
              <View style={styles.gridWrap}>
                {sortedLevels.map(l => {
                  const isActive = l.id === selectedId;
                  return (
                    <TouchableOpacity
                      key={l.id}
                      style={[styles.cell, isActive && styles.cellActive]}
                      onPress={() => pick(l.id)}
                      activeOpacity={0.7}
                    >
                      <Text
                        style={[styles.cellText, isActive && styles.cellTextActive]}
                        numberOfLines={1}
                      >
                        {l.name}
                      </Text>
                      {l.reserveCount > 0 && <View style={styles.cellDot} />}
                    </TouchableOpacity>
                  );
                })}
              </View>

              <SectionHeader icon="list-outline" label="Détails" />
              {sortedLevels.map(l => (
                <LevelRow
                  key={`detail-${l.id}`}
                  l={l}
                  active={l.id === selectedId}
                  onPress={() => pick(l.id)}
                />
              ))}
            </>
          )}

          {/* Résultats de recherche */}
          {query && (
            <>
              <SectionHeader icon="search-outline" label={`Résultats · ${filtered.length}`} />
              {filtered.length === 0 ? (
                <View style={styles.empty}>
                  <Ionicons name="search-outline" size={20} color={C.textMuted} />
                  <Text style={styles.emptyText}>
                    Aucun niveau ne correspond à « {query} »
                  </Text>
                </View>
              ) : (
                filtered.map(l => (
                  <LevelRow
                    key={l.id}
                    l={l}
                    active={l.id === selectedId}
                    onPress={() => pick(l.id)}
                  />
                ))
              )}
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

function SectionHeader({ icon, label }: { icon: any; label: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Ionicons name={icon} size={12} color={C.textMuted} />
      <Text style={styles.sectionLabel}>{label}</Text>
    </View>
  );
}

function LevelRow({
  l, active, pinned, onPress,
}: { l: LevelItem; active?: boolean; pinned?: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.row, active && styles.rowActive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.icon, active && styles.iconActive]}>
        <Text style={[styles.iconLabel, active && { color: '#fff' }]} numberOfLines={1}>
          {l.name.length > 4 ? l.name.slice(0, 4) : l.name}
        </Text>
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.rowTitleRow}>
          <Text
            style={[styles.rowTitle, active && styles.rowTitleActive]}
            numberOfLines={1}
          >
            {l.name}
          </Text>
          {pinned && (
            <Ionicons name="star" size={10} color={C.accent} style={{ marginLeft: 4 }} />
          )}
        </View>
        <View style={styles.rowSubRow}>
          <Text style={styles.rowSub}>
            {l.planCount} plan{l.planCount > 1 ? 's' : ''}
          </Text>
          {l.reserveCount > 0 && (
            <>
              <View style={styles.dotSep} />
              <Text style={styles.rowSubReserve}>
                {l.reserveCount} réserve{l.reserveCount > 1 ? 's' : ''}
              </Text>
            </>
          )}
        </View>
      </View>
      {active && <View style={styles.activeDot} />}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 8,
    height: '78%',
    ...Platform.select({
      web: { boxShadow: '0 -4px 24px rgba(0,0,0,0.12)' } as any,
      default: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.12,
        shadowRadius: 12,
        elevation: 16,
      },
    }),
  },
  handleHitArea: { alignSelf: 'stretch', alignItems: 'center', paddingVertical: 8 },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: C.border },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
    paddingTop: 4,
    paddingBottom: 12,
  },
  title: { fontSize: 17, fontFamily: 'Inter_700Bold', color: C.text },
  subtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
  closeBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: C.surface2,
    alignItems: 'center', justifyContent: 'center',
  },
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.surface2,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 4,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.text,
    paddingVertical: 0,
  },
  list: { marginTop: 4 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 6,
    paddingTop: 14,
    paddingBottom: 6,
  },
  sectionLabel: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    color: C.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderRadius: 12,
  },
  rowActive: { backgroundColor: C.primaryBg },
  icon: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: C.surface2,
    alignItems: 'center', justifyContent: 'center',
  },
  iconActive: { backgroundColor: C.primary },
  iconLabel: { fontSize: 11, fontFamily: 'Inter_700Bold', color: C.textSub },
  rowTitleRow: { flexDirection: 'row', alignItems: 'center' },
  rowTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text, flexShrink: 1 },
  rowTitleActive: { color: C.primary },
  rowSubRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  rowSub: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },
  rowSubReserve: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.open },
  dotSep: { width: 2, height: 2, borderRadius: 1, backgroundColor: C.textMuted },
  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.primary },
  empty: { paddingVertical: 28, alignItems: 'center', gap: 8 },
  emptyText: {
    fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted,
    textAlign: 'center', paddingHorizontal: 24,
  },
  gridWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  cell: {
    minWidth: 56,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  cellActive: { backgroundColor: C.primary, borderColor: C.primary },
  cellText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.text },
  cellTextActive: { color: '#fff' },
  cellDot: {
    position: 'absolute',
    top: 4, right: 4,
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: C.open,
  },
});
