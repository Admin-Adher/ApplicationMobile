import React, { useState, useMemo } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, FlatList,
  TextInput, ScrollView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/constants/colors';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export type LinkedItemType = 'reserve' | 'plan' | 'task' | 'incident' | 'visite' | 'opr';

export interface LinkedItem {
  type: LinkedItemType;
  id: string;
  title: string;
  subtitle?: string;
}

export function getLinkedItemIcon(type?: string | null): string {
  switch (type) {
    case 'reserve': return 'alert-circle-outline';
    case 'plan': return 'map-outline';
    case 'task': return 'checkmark-circle-outline';
    case 'incident': return 'warning-outline';
    case 'visite': return 'walk-outline';
    case 'opr': return 'clipboard-outline';
    default: return 'link-outline';
  }
}

export function getLinkedItemLabel(type?: string | null): string {
  switch (type) {
    case 'reserve': return 'Réserve';
    case 'plan': return 'Plan';
    case 'task': return 'Tâche';
    case 'incident': return 'Incident';
    case 'visite': return 'Visite';
    case 'opr': return 'OPR';
    default: return 'Élément lié';
  }
}

export function getLinkedItemColor(type?: string | null): string {
  switch (type) {
    case 'reserve': return C.open;
    case 'plan': return C.primary;
    case 'task': return C.inProgress;
    case 'incident': return C.waiting;
    case 'visite': return C.closed;
    case 'opr': return C.verification;
    default: return C.primary;
  }
}

const CATEGORIES: Array<{ type: LinkedItemType; label: string; icon: string }> = [
  { type: 'reserve', label: 'Réserves', icon: 'alert-circle-outline' },
  { type: 'plan', label: 'Plans', icon: 'map-outline' },
  { type: 'task', label: 'Tâches', icon: 'checkmark-circle-outline' },
  { type: 'incident', label: 'Incidents', icon: 'warning-outline' },
  { type: 'visite', label: 'Visites', icon: 'walk-outline' },
  { type: 'opr', label: 'OPRs', icon: 'clipboard-outline' },
];

interface Props {
  visible: boolean;
  onClose: () => void;
  onSelect: (item: LinkedItem) => void;
  reserves: LinkedItem[];
  plans: LinkedItem[];
  tasks: LinkedItem[];
  incidents: LinkedItem[];
  visites: LinkedItem[];
  oprs: LinkedItem[];
}

export default function AttachItemModal({ visible, onClose, onSelect, reserves, plans, tasks, incidents, visites, oprs }: Props) {
  const insets = useSafeAreaInsets();
  const [activeCategory, setActiveCategory] = useState<LinkedItemType>('reserve');
  const [search, setSearch] = useState('');

  const itemsByCategory: Record<LinkedItemType, LinkedItem[]> = {
    reserve: reserves,
    plan: plans,
    task: tasks,
    incident: incidents,
    visite: visites,
    opr: oprs,
  };

  const items = useMemo(() => {
    const all = itemsByCategory[activeCategory] ?? [];
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter(i => i.title.toLowerCase().includes(q) || i.id.toLowerCase().includes(q) || (i.subtitle ?? '').toLowerCase().includes(q));
  }, [activeCategory, search, reserves, plans, tasks, incidents, visites, oprs]);

  const color = getLinkedItemColor(activeCategory);

  function handleClose() {
    setSearch('');
    onClose();
  }

  function handleSelect(item: LinkedItem) {
    setSearch('');
    onSelect(item);
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={handleClose} />
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 8 }]}>
        <View style={styles.handle} />

        <View style={styles.header}>
          <Text style={styles.title}>Insérer un élément</Text>
          <TouchableOpacity onPress={handleClose} hitSlop={8}>
            <Ionicons name="close" size={22} color={C.textSub} />
          </TouchableOpacity>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
          {CATEGORIES.map(cat => {
            const count = itemsByCategory[cat.type]?.length ?? 0;
            const isActive = activeCategory === cat.type;
            const catColor = getLinkedItemColor(cat.type);
            return (
              <TouchableOpacity
                key={cat.type}
                style={[styles.tab, isActive && { backgroundColor: catColor + '18', borderColor: catColor }]}
                onPress={() => { setActiveCategory(cat.type); setSearch(''); }}
              >
                <Ionicons name={cat.icon as any} size={14} color={isActive ? catColor : C.textMuted} />
                <Text style={[styles.tabLabel, isActive && { color: catColor }]}>{cat.label}</Text>
                {count > 0 && (
                  <View style={[styles.tabBadge, isActive && { backgroundColor: catColor }]}>
                    <Text style={[styles.tabBadgeText, isActive && { color: '#fff' }]}>{count}</Text>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <View style={styles.searchRow}>
          <Ionicons name="search-outline" size={14} color={C.textMuted} />
          <TextInput
            style={styles.searchInput}
            placeholder={`Rechercher dans ${CATEGORIES.find(c => c.type === activeCategory)?.label ?? ''}...`}
            placeholderTextColor={C.textMuted}
            value={search}
            onChangeText={setSearch}
          />
          {search.length > 0 && (
            <TouchableOpacity onPress={() => setSearch('')} hitSlop={8}>
              <Ionicons name="close-circle" size={14} color={C.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {items.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name={getLinkedItemIcon(activeCategory) as any} size={36} color={C.border} />
            <Text style={styles.emptyText}>{search ? 'Aucun résultat' : `Aucun élément disponible`}</Text>
          </View>
        ) : (
          <FlatList
            data={items}
            keyExtractor={i => i.id}
            style={styles.list}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <TouchableOpacity style={styles.item} onPress={() => handleSelect(item)}>
                <View style={[styles.itemIcon, { backgroundColor: color + '15' }]}>
                  <Ionicons name={getLinkedItemIcon(activeCategory) as any} size={18} color={color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitle} numberOfLines={1}>{item.title}</Text>
                  {item.subtitle && <Text style={styles.itemSub} numberOfLines={1}>{item.subtitle}</Text>}
                </View>
                <Text style={[styles.itemId, { color }]}>{item.id}</Text>
                <Ionicons name="add-circle-outline" size={18} color={color} />
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '75%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 24,
  },
  handle: { width: 36, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center', marginTop: 10, marginBottom: 4 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 12 },
  title: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.text },

  tabs: { maxHeight: 48, marginBottom: 8 },
  tab: {
    flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface2,
  },
  tabLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textMuted },
  tabBadge: { backgroundColor: C.border, borderRadius: 8, paddingHorizontal: 5, paddingVertical: 1 },
  tabBadgeText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.textSub },

  searchRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: C.surface2, borderRadius: 10, borderWidth: 1, borderColor: C.border,
  },
  searchInput: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text, padding: 0 },

  list: { maxHeight: 320 },
  item: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: C.borderLight,
  },
  itemIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  itemTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  itemSub: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1 },
  itemId: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },

  empty: { alignItems: 'center', gap: 8, paddingVertical: 40 },
  emptyText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted },
});
