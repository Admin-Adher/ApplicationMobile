import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal,
  ScrollView, TextInput, Platform, PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '@/constants/colors';

export interface BuildingItem {
  id: string;
  name: string;
  planCount: number;
  reserveCount: number;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  buildings: BuildingItem[];
  selectedId: string;
  recentIds: string[];
  onSelect: (id: string) => void;
  hasOrphanPlans?: boolean;
  onSelectOrphans?: () => void;
  orphansSelected?: boolean;
  orphansLabel?: string;
}

const ALL_FAMILY = '__all__';
const OTHERS_FAMILY = '__others__';
// Activer le regroupement uniquement si au moins 2 familles "réelles" et un volume utile.
const GROUPING_MIN_FAMILIES = 2;
const GROUPING_MIN_BUILDINGS = 8;

type ParsedName = { prefix: string; suffix: string };

function parseBuildingName(name: string): ParsedName | null {
  const t = name.trim();
  if (!t) return null;

  // Stratégie : on coupe le nom au PREMIER bloc de chiffres rencontré.
  // Tout ce qui précède (lettres + espaces + ponctuations légères) devient
  // le préfixe (ex. "GuestBlock", "One bedroom", "Service building zone").
  // Le bloc de chiffres et tout ce qui suit (ex. " izquierda", "-niv2",
  // " derecha") devient le suffixe — ce qui permet de rassembler dans la
  // même famille des noms comme "Lockoff1 derecha", "Lockoff 4 izquierda"
  // et "Lockoff8 izquierda" sous la famille "Lockoff".
  //
  // Exemples couverts :
  //   "Villa1"                 → prefix="Villa",                suffix="1"
  //   "Villa 1"                → prefix="Villa",                suffix="1"
  //   "GuestBlock 12"          → prefix="GuestBlock",           suffix="12"
  //   "Guestblock 3-niv2"      → prefix="Guestblock",           suffix="3-niv2"
  //   "Lockoff1 derecha"       → prefix="Lockoff",              suffix="1 derecha"
  //   "Lockoff 4 izquierda"    → prefix="Lockoff",              suffix="4 izquierda"
  //   "One bedroom6"           → prefix="One bedroom",          suffix="6"
  //   "One bedroom duplex2"    → prefix="One bedroom duplex",   suffix="2"
  //   "Service building zone1" → prefix="Service building zone", suffix="1"
  let m = t.match(/^([^\d]*?[A-Za-zÀ-ÖØ-öø-ÿ])[\s\-_.#]*(\d+.*)$/);
  if (m) {
    const prefix = m[1].trim().replace(/[\s\-_.#]+$/, '');
    const suffix = m[2].trim();
    if (prefix.length > 0) return { prefix, suffix };
  }

  // Cas alternatif : "Bâtiment A", "Tour B" — suffixe = lettre majuscule isolée.
  m = t.match(/^(.+?)[\s\-_.#]+([A-Z])(?:\s*[—\-:·].*)?$/);
  if (m) return { prefix: m[1].trim(), suffix: m[2].toUpperCase() };

  return null;
}

// Clé de regroupement insensible à la casse et aux espaces redondants, pour
// fusionner "GuestBlock" et "Guestblock" dans la même famille.
function familyKey(prefix: string): string {
  return prefix.toLowerCase().replace(/\s+/g, ' ').trim();
}

// Distance de Levenshtein (édition de chaînes) — utilisée pour rattacher
// les noms tapés avec une coquille (ex. "Lockoof" → famille "Lockoff")
// à la famille la plus proche. Implémentation itérative O(n·m).
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

// Cherche dans `realKeys` la famille la plus proche de `key` au sens
// de Levenshtein. Tolérance : ~20% de la longueur du mot le plus long,
// avec un minimum de 1 (donc une coquille d'1 caractère est toujours
// rattrapée). Renvoie null si aucune correspondance n'est assez proche.
function findClosestFamily(key: string, realKeys: Iterable<string>): string | null {
  let best: string | null = null;
  let bestDist = Infinity;
  for (const rk of realKeys) {
    const longest = Math.max(key.length, rk.length);
    const threshold = Math.max(1, Math.floor(longest * 0.2));
    const d = levenshtein(key, rk);
    if (d <= threshold && d < bestDist) {
      best = rk;
      bestDist = d;
    }
  }
  return best;
}

type ItemWithSuffix = BuildingItem & { suffix: string | null };
type Family = { key: string; label: string; items: ItemWithSuffix[] };

function buildFamilies(buildings: BuildingItem[]): {
  families: Family[];
  useGrouping: boolean;
  familyOf: Map<string, string>;
} {
  type Bucket = { items: ItemWithSuffix[]; labelCounts: Map<string, number> };
  const groups = new Map<string, Bucket>();
  const others: ItemWithSuffix[] = [];

  for (const b of buildings) {
    const parsed = parseBuildingName(b.name);
    if (parsed) {
      const key = familyKey(parsed.prefix);
      let bucket = groups.get(key);
      if (!bucket) {
        bucket = { items: [], labelCounts: new Map() };
        groups.set(key, bucket);
      }
      bucket.items.push({ ...b, suffix: parsed.suffix });
      bucket.labelCounts.set(parsed.prefix, (bucket.labelCounts.get(parsed.prefix) ?? 0) + 1);
    } else {
      others.push({ ...b, suffix: null });
    }
  }

  // Identifie les familles "réelles" (≥ 2 items) avant d'essayer d'absorber
  // les singletons (probables coquilles) dans la famille la plus proche.
  const realKeys: string[] = [];
  for (const [key, bucket] of groups) {
    if (bucket.items.length >= 2) realKeys.push(key);
  }

  // Coquilles : tout singleton dont la clé est à 1-2 caractères près d'une
  // famille réelle (ex. "Lockoof" → "Lockoff") est rapatrié dans cette
  // famille. Les singletons restants finissent dans "Autres".
  for (const [key, bucket] of [...groups.entries()]) {
    if (bucket.items.length >= 2) continue;
    const target = findClosestFamily(key, realKeys);
    if (target) {
      const tBucket = groups.get(target)!;
      for (const it of bucket.items) tBucket.items.push(it);
      // On n'incrémente PAS labelCounts : la graphie correcte de la famille
      // existante reste prioritaire pour l'étiquette affichée.
      groups.delete(key);
    }
  }

  const families: Family[] = [];
  for (const [key, bucket] of groups) {
    if (bucket.items.length >= 2) {
      bucket.items.sort(sortBySuffix);
      // Étiquette affichée : graphie d'origine la plus fréquente (ex. on
      // privilégie "GuestBlock" si vu 4 fois plutôt que "Guestblock").
      let label = '';
      let bestCount = -1;
      for (const [lbl, count] of bucket.labelCounts) {
        if (count > bestCount || (count === bestCount && lbl < label)) {
          label = lbl;
          bestCount = count;
        }
      }
      families.push({ key, label, items: bucket.items });
    } else {
      // Famille singleton sans correspondance proche → on la rejette dans "Autres".
      for (const it of bucket.items) others.push({ ...it, suffix: null });
    }
  }

  families.sort((a, b) => b.items.length - a.items.length || a.label.localeCompare(b.label));

  if (others.length > 0) {
    others.sort((a, b) => a.name.localeCompare(b.name, 'fr', { numeric: true }));
    families.push({ key: OTHERS_FAMILY, label: 'Autres', items: others });
  }

  const realFamilies = families.filter(f => f.key !== OTHERS_FAMILY);
  const useGrouping =
    realFamilies.length >= GROUPING_MIN_FAMILIES && buildings.length >= GROUPING_MIN_BUILDINGS;

  const familyOf = new Map<string, string>();
  for (const fam of families) {
    for (const it of fam.items) familyOf.set(it.id, fam.key);
  }

  return { families, useGrouping, familyOf };
}

function sortBySuffix(a: ItemWithSuffix, b: ItemWithSuffix) {
  const ax = a.suffix ?? '';
  const bx = b.suffix ?? '';
  // Comparaison numérique d'abord (ex. "2" < "12"), puis lexicale (ex. "A" < "B").
  const an = parseInt(ax.replace(/[^\d]/g, ''), 10);
  const bn = parseInt(bx.replace(/[^\d]/g, ''), 10);
  const aHas = !isNaN(an);
  const bHas = !isNaN(bn);
  if (aHas && bHas && an !== bn) return an - bn;
  if (aHas !== bHas) return aHas ? -1 : 1;
  return ax.localeCompare(bx, 'fr', { numeric: true });
}

export default function BuildingPickerSheet({
  visible, onClose, buildings, selectedId, recentIds, onSelect,
  hasOrphanPlans, onSelectOrphans, orphansSelected, orphansLabel = 'Général',
}: Props) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [activeFamily, setActiveFamily] = useState<string>(ALL_FAMILY);

  const handlePan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 8 && g.dy > Math.abs(g.dx),
      onPanResponderRelease: (_, g) => {
        if (g.dy > 60 || g.vy > 0.5) onClose();
      },
    })
  ).current;

  const recents = useMemo(() => {
    const map = new Map(buildings.map(b => [b.id, b]));
    return recentIds.map(id => map.get(id)).filter(Boolean) as BuildingItem[];
  }, [buildings, recentIds]);

  const { families, useGrouping, familyOf } = useMemo(
    () => buildFamilies(buildings),
    [buildings]
  );

  // À l'ouverture, présélectionner la famille du bâtiment actif (si grouping).
  useEffect(() => {
    if (!visible) return;
    if (!useGrouping) { setActiveFamily(ALL_FAMILY); return; }
    const fam = familyOf.get(selectedId);
    setActiveFamily(fam ?? ALL_FAMILY);
  }, [visible, useGrouping, familyOf, selectedId]);

  const filteredFlat = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return buildings;
    return buildings.filter(b => b.name.toLowerCase().includes(q));
  }, [buildings, query]);

  const familyView = useMemo(() => {
    if (!useGrouping || query) return null;
    if (activeFamily === ALL_FAMILY) return null;
    return families.find(f => f.key === activeFamily) ?? null;
  }, [useGrouping, query, activeFamily, families]);

  function pick(id: string) {
    onSelect(id);
    setQuery('');
    onClose();
  }

  function pickOrphans() {
    onSelectOrphans?.();
    setQuery('');
    onClose();
  }

  const bottomPad = Platform.OS === 'web' ? 24 : Math.max(insets.bottom + 16, 32);
  const showRecents = !query && !familyView && recents.length > 0;
  const showOrphansEntry = !query && !familyView && hasOrphanPlans;

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
            <Text style={styles.title}>Choisir un bâtiment</Text>
            <Text style={styles.subtitle}>
              {buildings.length} bâtiment{buildings.length > 1 ? 's' : ''} dans ce chantier
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
            placeholder="Rechercher par nom (ex. GuestBlock 7)"
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

        {/* Familles auto-détectées (préfixes) */}
        {useGrouping && !query && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.familiesRow}
          >
            <FamilyChip
              label="Toutes"
              count={buildings.length}
              active={activeFamily === ALL_FAMILY}
              onPress={() => setActiveFamily(ALL_FAMILY)}
            />
            {families.map(f => (
              <FamilyChip
                key={f.key}
                label={f.label}
                count={f.items.length}
                active={activeFamily === f.key}
                onPress={() => setActiveFamily(f.key)}
              />
            ))}
          </ScrollView>
        )}

        <ScrollView
          showsVerticalScrollIndicator={false}
          style={styles.list}
          contentContainerStyle={{ paddingBottom: bottomPad }}
          keyboardShouldPersistTaps="handled"
        >
          {showRecents && (
            <>
              <SectionHeader icon="time-outline" label="Récemment consultés" />
              {recents.map(b => (
                <BuildingRow
                  key={`recent-${b.id}`}
                  b={b}
                  active={b.id === selectedId}
                  pinned
                  onPress={() => pick(b.id)}
                />
              ))}
            </>
          )}

          {showOrphansEntry && (
            <>
              <SectionHeader icon="layers-outline" label="Plans non rattachés" />
              <TouchableOpacity
                style={[styles.row, orphansSelected && styles.rowActive]}
                onPress={pickOrphans}
                activeOpacity={0.7}
              >
                <View style={[styles.icon, orphansSelected && styles.iconActive]}>
                  <Ionicons
                    name="layers-outline"
                    size={16}
                    color={orphansSelected ? '#fff' : C.textSub}
                  />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.rowTitle, orphansSelected && styles.rowTitleActive]}>
                    {orphansLabel}
                  </Text>
                  <Text style={styles.rowSub}>Plans sans bâtiment ni niveau</Text>
                </View>
                {orphansSelected && <View style={styles.activeDot} />}
              </TouchableOpacity>
            </>
          )}

          {/* Vue famille : grille compacte de pastilles (numéros / lettres) + détails */}
          {familyView && (() => {
            const gridItems = familyView.items.filter(b => b.suffix !== null);
            // Grille n'est utile que si on a au moins 3 vrais suffixes COURTS
            // ET si tous les items en ont un. On exclut les suffixes contenant
            // un mot (ex. "1 izquierda", "3-niv2") pour éviter les pastilles
            // tronquées et préférer la vue liste, plus lisible.
            const allShort = gridItems.every(b => {
              const s = b.suffix ?? '';
              return s.length <= 4 && /^[\w]+$/.test(s);
            });
            const showGrid =
              gridItems.length >= 3 &&
              gridItems.length === familyView.items.length &&
              allShort;
            return (
              <>
                {showGrid && (
                  <>
                    <SectionHeader
                      icon="grid-outline"
                      label={`${familyView.label} · ${familyView.items.length}`}
                    />
                    <View style={styles.suffixGrid}>
                      {gridItems.map(b => {
                        const isActive = b.id === selectedId;
                        return (
                          <TouchableOpacity
                            key={b.id}
                            style={[styles.suffixCell, isActive && styles.suffixCellActive]}
                            onPress={() => pick(b.id)}
                            activeOpacity={0.7}
                          >
                            <Text
                              style={[styles.suffixCellText, isActive && styles.suffixCellTextActive]}
                              numberOfLines={1}
                            >
                              {b.suffix}
                            </Text>
                            {b.reserveCount > 0 && (
                              <View style={styles.suffixDot} />
                            )}
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    <SectionHeader icon="list-outline" label="Détails" />
                  </>
                )}
                {!showGrid && (
                  <SectionHeader
                    icon="business-outline"
                    label={`${familyView.label} · ${familyView.items.length}`}
                  />
                )}
                {familyView.items.map(b => (
                  <BuildingRow
                    key={`detail-${b.id}`}
                    b={b}
                    active={b.id === selectedId}
                    onPress={() => pick(b.id)}
                  />
                ))}
              </>
            );
          })()}

          {/* Vue à plat : liste complète (ou résultats de recherche) */}
          {!familyView && (
            <>
              <SectionHeader
                icon="business-outline"
                label={query
                  ? `Résultats · ${filteredFlat.length}`
                  : `Tous les bâtiments · ${buildings.length}`}
              />
              {filteredFlat.length === 0 ? (
                <View style={styles.empty}>
                  <Ionicons name="search-outline" size={20} color={C.textMuted} />
                  <Text style={styles.emptyText}>
                    Aucun bâtiment ne correspond à « {query} »
                  </Text>
                </View>
              ) : (
                filteredFlat.map(b => (
                  <BuildingRow
                    key={b.id}
                    b={b}
                    active={b.id === selectedId}
                    onPress={() => pick(b.id)}
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

function FamilyChip({
  label, count, active, onPress,
}: { label: string; count: number; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.familyChip, active && styles.familyChipActive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.familyChipText, active && styles.familyChipTextActive]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[styles.familyChipCount, active && styles.familyChipCountActive]}>
        {count}
      </Text>
    </TouchableOpacity>
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

function BuildingRow({
  b, active, pinned, onPress,
}: { b: BuildingItem; active?: boolean; pinned?: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.row, active && styles.rowActive]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.icon, active && styles.iconActive]}>
        <Ionicons
          name="business-outline"
          size={16}
          color={active ? '#fff' : C.textSub}
        />
      </View>
      <View style={{ flex: 1 }}>
        <View style={styles.rowTitleRow}>
          <Text
            style={[styles.rowTitle, active && styles.rowTitleActive]}
            numberOfLines={1}
          >
            {b.name}
          </Text>
          {pinned && (
            <Ionicons name="star" size={10} color={C.accent} style={{ marginLeft: 4 }} />
          )}
        </View>
        <View style={styles.rowSubRow}>
          <Text style={styles.rowSub}>
            {b.planCount} plan{b.planCount > 1 ? 's' : ''}
          </Text>
          {b.reserveCount > 0 && (
            <>
              <View style={styles.dotSep} />
              <Text style={styles.rowSubReserve}>
                {b.reserveCount} réserve{b.reserveCount > 1 ? 's' : ''}
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
  familiesRow: {
    flexDirection: 'row',
    gap: 6,
    paddingTop: 10,
    paddingBottom: 4,
    paddingHorizontal: 2,
  },
  familyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
  },
  familyChipActive: { backgroundColor: C.primary, borderColor: C.primary },
  familyChipText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  familyChipTextActive: { color: '#fff' },
  familyChipCount: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    color: C.textMuted,
    backgroundColor: C.surface,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 8,
    overflow: 'hidden',
  },
  familyChipCountActive: { color: C.primary, backgroundColor: '#fff' },
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
  rowTitleRow: { flexDirection: 'row', alignItems: 'center' },
  rowTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text, flexShrink: 1 },
  rowTitleActive: { color: C.primary },
  rowSubRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  rowSub: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },
  rowSubReserve: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.open },
  dotSep: { width: 2, height: 2, borderRadius: 1, backgroundColor: C.textMuted },
  activeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.primary },
  empty: {
    paddingVertical: 28,
    alignItems: 'center',
    gap: 8,
  },
  emptyText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', paddingHorizontal: 24 },
  suffixGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  suffixCell: {
    minWidth: 48,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: C.surface2,
    borderWidth: 1,
    borderColor: C.border,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  suffixCellActive: { backgroundColor: C.primary, borderColor: C.primary },
  suffixCellText: { fontSize: 14, fontFamily: 'Inter_700Bold', color: C.text },
  suffixCellTextActive: { color: '#fff' },
  suffixDot: {
    position: 'absolute',
    top: 4, right: 4,
    width: 6, height: 6, borderRadius: 3,
    backgroundColor: C.open,
  },
});
