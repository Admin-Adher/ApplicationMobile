import React, { useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Modal, Platform, PanResponder,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/constants/colors';
import { Company } from '@/constants/types';

const STATUSES = [
  { key: 'all',          label: 'Tout',      color: '#003082' },
  { key: 'open',         label: 'Ouvert',    color: '#EF4444' },
  { key: 'in_progress',  label: 'En cours',  color: '#F59E0B' },
  { key: 'waiting',      label: 'Attente',   color: '#6B7280' },
  { key: 'verification', label: 'Vérif.',    color: '#8B5CF6' },
  { key: 'closed',       label: 'Clôturé',   color: '#10B981' },
] as const;

interface FiltersSheetProps {
  visible: boolean;
  onClose: () => void;
  statusFilter: string;
  onStatusFilterChange: (s: string) => void;
  buildings: string[];
  selectedBuilding: string;
  onBuildingChange: (b: string) => void;
  planLevels: string[];
  selectedLevel: string;
  onLevelChange: (l: string) => void;
  companies: Company[];
  companyFilter: string;
  onCompanyChange: (c: string) => void;
  reserveLevels: string[];
  levelFilter: string;
  onLevelFilterChange: (l: string) => void;
  dxfLayers: string[];
  visibleLayers: string[];
  onLayersChange: (layers: string[]) => void;
  onReset: () => void;
  activeFiltersCount: number;
}

export default function FiltersSheet({
  visible, onClose,
  statusFilter, onStatusFilterChange,
  buildings, selectedBuilding, onBuildingChange,
  planLevels, selectedLevel, onLevelChange,
  companies, companyFilter, onCompanyChange,
  reserveLevels, levelFilter, onLevelFilterChange,
  dxfLayers, visibleLayers, onLayersChange,
  onReset, activeFiltersCount,
}: FiltersSheetProps) {
  const hasFilters = activeFiltersCount > 0;

  const handlePan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 8 && g.dy > Math.abs(g.dx),
      onPanResponderRelease: (_, g) => {
        if (g.dy > 60 || g.vy > 0.5) onClose();
      },
    })
  ).current;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity activeOpacity={1} style={styles.sheet} onPress={() => {}}>
          <View style={styles.handleHitArea} {...handlePan.panHandlers}>
            <View style={styles.handle} />
          </View>

          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Ionicons name="options-outline" size={18} color={C.primary} />
              <Text style={styles.title}>Filtres</Text>
              {hasFilters && (
                <View style={styles.activeBadge}>
                  <Text style={styles.activeBadgeText}>{activeFiltersCount}</Text>
                </View>
              )}
            </View>
            <View style={styles.headerRight}>
              {hasFilters && (
                <TouchableOpacity style={styles.resetBtn} onPress={onReset}>
                  <Ionicons name="refresh-outline" size={14} color={C.textSub} />
                  <Text style={styles.resetText}>Réinitialiser</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
                <Ionicons name="close" size={20} color={C.textMuted} />
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>

            {/* Status filter — always visible */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="flag-outline" size={13} color={C.textSub} />
                <Text style={styles.sectionTitle}>Statut</Text>
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.chipRow}>
                  {STATUSES.map(s => {
                    const isActive = statusFilter === s.key;
                    return (
                      <TouchableOpacity
                        key={s.key}
                        style={[
                          styles.chip,
                          isActive && { backgroundColor: s.color + '20', borderColor: s.color },
                        ]}
                        onPress={() => onStatusFilterChange(s.key)}
                        accessibilityLabel={`Filtre statut : ${s.label}`}
                        accessibilityState={{ selected: isActive }}
                      >
                        <View style={[styles.statusDot, { backgroundColor: s.color }]} />
                        <Text style={[styles.chipText, isActive && { color: s.color, fontFamily: 'Inter_600SemiBold' }]}>
                          {s.label}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </ScrollView>
            </View>

            {buildings.length >= 2 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="business-outline" size={13} color={C.textSub} />
                  <Text style={styles.sectionTitle}>Bâtiment</Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.chipRow}>
                    <TouchableOpacity
                      style={[styles.chip, selectedBuilding === 'all' && styles.chipActive]}
                      onPress={() => onBuildingChange('all')}
                      accessibilityLabel="Tous les bâtiments"
                    >
                      <Ionicons name="grid-outline" size={12} color={selectedBuilding === 'all' ? '#fff' : C.textSub} />
                      <Text style={[styles.chipText, selectedBuilding === 'all' && styles.chipTextActive]}>Tous</Text>
                    </TouchableOpacity>
                    {buildings.map(b => (
                      <TouchableOpacity
                        key={b}
                        style={[styles.chip, selectedBuilding === b && styles.chipActive]}
                        onPress={() => onBuildingChange(b)}
                        accessibilityLabel={`Bâtiment ${b}`}
                      >
                        <Ionicons name="business-outline" size={12} color={selectedBuilding === b ? '#fff' : C.textSub} />
                        <Text style={[styles.chipText, selectedBuilding === b && styles.chipTextActive]} numberOfLines={1}>{b}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </View>
            )}

            {planLevels.length >= 2 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="layers-outline" size={13} color={C.textSub} />
                  <Text style={styles.sectionTitle}>Niveau du plan</Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.chipRow}>
                    <TouchableOpacity
                      style={[styles.chip, styles.levelChip, selectedLevel === 'all' && styles.levelChipActive]}
                      onPress={() => onLevelChange('all')}
                    >
                      <Text style={[styles.chipText, selectedLevel === 'all' && { color: '#8B5CF6' }]}>Tous</Text>
                    </TouchableOpacity>
                    {planLevels.map(lvl => (
                      <TouchableOpacity
                        key={lvl}
                        style={[styles.chip, styles.levelChip, selectedLevel === lvl && styles.levelChipActive]}
                        onPress={() => onLevelChange(lvl)}
                      >
                        <Text style={[styles.chipText, selectedLevel === lvl && { color: '#8B5CF6' }]}>{lvl}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </View>
            )}

            {companies.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="construct-outline" size={13} color={C.textSub} />
                  <Text style={styles.sectionTitle}>Entreprise</Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.chipRow}>
                    <TouchableOpacity
                      style={[styles.chip, companyFilter === 'all' && styles.chipActive]}
                      onPress={() => onCompanyChange('all')}
                    >
                      <Text style={[styles.chipText, companyFilter === 'all' && styles.chipTextActive]}>Toutes</Text>
                    </TouchableOpacity>
                    {companies.map(c => (
                      <TouchableOpacity
                        key={c.id}
                        style={[styles.chip, companyFilter === c.name && { backgroundColor: c.color + '20', borderColor: c.color }]}
                        onPress={() => onCompanyChange(companyFilter === c.name ? 'all' : c.name)}
                        accessibilityLabel={c.name}
                      >
                        <View style={[styles.dot, { backgroundColor: c.color }]} />
                        <Text style={[styles.chipText, companyFilter === c.name && { color: c.color }]}>{c.shortName}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </View>
            )}

            {reserveLevels.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="albums-outline" size={13} color={C.textSub} />
                  <Text style={styles.sectionTitle}>Niveau des réserves</Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.chipRow}>
                    <TouchableOpacity
                      style={[styles.chip, styles.levelChip, levelFilter === 'all' && styles.levelChipActive]}
                      onPress={() => onLevelFilterChange('all')}
                    >
                      <Text style={[styles.chipText, levelFilter === 'all' && { color: '#8B5CF6' }]}>Tous</Text>
                    </TouchableOpacity>
                    {reserveLevels.map(lvl => (
                      <TouchableOpacity
                        key={lvl}
                        style={[styles.chip, styles.levelChip, levelFilter === lvl && styles.levelChipActive]}
                        onPress={() => onLevelFilterChange(levelFilter === lvl ? 'all' : lvl)}
                      >
                        <Text style={[styles.chipText, levelFilter === lvl && { color: '#8B5CF6' }]}>{lvl}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </ScrollView>
              </View>
            )}

            {dxfLayers.length > 0 && (
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Ionicons name="layers" size={13} color={C.primary} />
                  <Text style={styles.sectionTitle}>Calques DXF</Text>
                  <Text style={styles.sectionCount}>{dxfLayers.length} calque{dxfLayers.length !== 1 ? 's' : ''}</Text>
                </View>
                <View style={styles.layerGrid}>
                  <TouchableOpacity
                    style={[styles.layerChip, visibleLayers.length === 0 && styles.layerChipActive]}
                    onPress={() => onLayersChange([])}
                  >
                    <Text style={[styles.chipText, visibleLayers.length === 0 && styles.chipTextActive]}>Tous</Text>
                  </TouchableOpacity>
                  {dxfLayers.map(layer => {
                    const isActive = visibleLayers.includes(layer);
                    return (
                      <TouchableOpacity
                        key={layer}
                        style={[styles.layerChip, isActive && styles.layerChipActive]}
                        onPress={() => {
                          const next = isActive ? visibleLayers.filter(l => l !== layer) : [...visibleLayers, layer];
                          onLayersChange(next);
                        }}
                      >
                        <View style={[styles.layerDot, { backgroundColor: isActive ? C.primary : C.textMuted }]} />
                        <Text style={[styles.chipText, isActive && styles.chipTextActive]} numberOfLines={1}>{layer || '(défaut)'}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            )}

          </ScrollView>

          <TouchableOpacity style={styles.applyBtn} onPress={onClose} accessibilityLabel="Appliquer les filtres">
            <Text style={styles.applyBtnText}>Appliquer</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
    paddingBottom: Platform.OS === 'ios' ? 32 : 16,
  },
  handleHitArea: { alignSelf: 'stretch', alignItems: 'center', paddingVertical: 10 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: C.border, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.text },
  activeBadge: { backgroundColor: C.primary, borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  activeBadgeText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#fff' },
  resetBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border },
  resetText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub },
  closeBtn: { padding: 4 },
  content: { padding: 16, gap: 20, paddingBottom: 8 },
  section: { gap: 10 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sectionTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text, flex: 1 },
  sectionCount: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },
  chipRow: { flexDirection: 'row', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20, backgroundColor: C.surface2, borderWidth: 1.5, borderColor: C.border },
  chipActive: { backgroundColor: C.primary, borderColor: C.primary },
  chipText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub },
  chipTextActive: { color: '#fff', fontFamily: 'Inter_600SemiBold' },
  levelChip: { backgroundColor: C.surface2, borderColor: C.border },
  levelChipActive: { backgroundColor: '#8B5CF620', borderColor: '#8B5CF6' },
  dot: { width: 8, height: 8, borderRadius: 4 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  layerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  layerChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 16, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border },
  layerChipActive: { backgroundColor: C.primaryBg, borderColor: C.primary + '60' },
  layerDot: { width: 7, height: 7, borderRadius: 4 },
  applyBtn: { marginHorizontal: 16, marginTop: 12, backgroundColor: C.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  applyBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },
});
