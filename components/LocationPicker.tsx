import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/constants/colors';
import { ChantierBuilding } from '@/constants/types';

interface LocationPickerProps {
  buildings: ChantierBuilding[];
  building: string;
  onBuildingChange: (b: string) => void;
  level?: string;
  zone?: string;
  onLevelChange?: (l: string) => void;
  onZoneChange?: (z: string) => void;
  showLevel?: boolean;
  showZone?: boolean;
  lockedBuilding?: boolean;
  lockedLevel?: boolean;
}

const DESELECT_LABEL = '—';

function ChipList({
  options,
  selected,
  onSelect,
}: {
  options: string[];
  selected: string;
  onSelect: (v: string) => void;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={styles.chipRow}>
        {options.map(opt => {
          const label = opt === '' ? DESELECT_LABEL : opt;
          const isActive = selected === opt;
          return (
            <TouchableOpacity
              key={opt === '' ? '__none__' : opt}
              style={[styles.chip, isActive && styles.chipActive, opt === '' && styles.chipNone]}
              onPress={() => onSelect(opt)}
              activeOpacity={0.75}
            >
              <Text style={[styles.chipText, isActive && styles.chipTextActive, opt === '' && styles.chipNoneText]}>
                {label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </ScrollView>
  );
}

function LockedValue({ value, icon }: { value: string; icon: string }) {
  return (
    <View style={styles.lockedRow}>
      <View style={styles.lockedChip}>
        <Ionicons name={icon as any} size={12} color={C.primary} />
        <Text style={styles.lockedChipText}>{value}</Text>
      </View>
      <View style={styles.lockedBadge}>
        <Ionicons name="lock-closed" size={10} color={C.textMuted} />
        <Text style={styles.lockedBadgeText}>Défini par le plan</Text>
      </View>
    </View>
  );
}

export default function LocationPicker({
  buildings,
  building,
  level = '',
  zone = '',
  onBuildingChange,
  onLevelChange = () => {},
  onZoneChange = () => {},
  showLevel = true,
  showZone = true,
  lockedBuilding = false,
  lockedLevel = false,
}: LocationPickerProps) {
  const hasBuildingsConfig = buildings && buildings.length > 0;

  const selectedBuilding = useMemo(
    () => buildings.find(b => b.name === building) ?? null,
    [buildings, building]
  );

  const levelsForBuilding = useMemo(
    () => selectedBuilding?.levels ?? [],
    [selectedBuilding]
  );

  const selectedLevel = useMemo(
    () => levelsForBuilding.find(l => l.name === level) ?? null,
    [levelsForBuilding, level]
  );

  const zonesForLevel = useMemo(
    () => selectedLevel?.zones.map(z => z.name) ?? [],
    [selectedLevel]
  );

  function handleBuildingChange(b: string) {
    onBuildingChange(b);
    const newBuilding = buildings.find(bd => bd.name === b);
    const firstLevel = newBuilding?.levels[0]?.name ?? '';
    onLevelChange(firstLevel);
    onZoneChange('');
  }

  function handleLevelChange(l: string) {
    onLevelChange(l);
    onZoneChange('');
  }

  if (!hasBuildingsConfig) {
    return (
      <View style={styles.freeTextContainer}>
        {(lockedBuilding && building) || (lockedLevel && level) ? (
          <View style={styles.freeTextHint}>
            <Ionicons name="lock-closed-outline" size={13} color={C.primary} />
            <Text style={styles.freeTextHintText}>
              Localisation définie par le plan — non modifiable.
            </Text>
          </View>
        ) : (
          <View style={styles.freeTextHint}>
            <Ionicons name="information-circle-outline" size={13} color={C.textMuted} />
            <Text style={styles.freeTextHintText}>
              Aucune structure configurée pour ce chantier. Saisissez librement.
            </Text>
          </View>
        )}
        <Text style={styles.label}>Bâtiment</Text>
        {lockedBuilding && building ? (
          <LockedValue value={building} icon="business-outline" />
        ) : (
          <TextInput
            style={styles.freeInput}
            placeholder="Ex : Bât A, Tour Nord..."
            placeholderTextColor={C.textMuted}
            value={building}
            onChangeText={onBuildingChange}
          />
        )}
        {showLevel && (
          <>
            <Text style={styles.label}>Niveau</Text>
            {lockedLevel && level ? (
              <LockedValue value={level} icon="layers-outline" />
            ) : (
              <TextInput
                style={styles.freeInput}
                placeholder="Ex : RDC, R+5, SS1..."
                placeholderTextColor={C.textMuted}
                value={level}
                onChangeText={onLevelChange}
              />
            )}
          </>
        )}
        {showZone && (
          <>
            <Text style={styles.label}>Zone</Text>
            <TextInput
              style={[styles.freeInput, { marginBottom: 0 }]}
              placeholder="Ex : Zone Nord, Aile Est..."
              placeholderTextColor={C.textMuted}
              value={zone}
              onChangeText={onZoneChange}
            />
          </>
        )}
      </View>
    );
  }

  return (
    <View>
      {lockedBuilding && building && (
        <View style={styles.lockedHint}>
          <Ionicons name="lock-closed-outline" size={12} color={C.primary} />
          <Text style={styles.lockedHintText}>Localisation définie par le plan — non modifiable.</Text>
        </View>
      )}

      <View style={styles.stepRow}>
        <View style={[styles.stepBadge, lockedBuilding && building && styles.stepBadgeLocked]}>
          <Text style={styles.stepBadgeText}>1</Text>
        </View>
        <Text style={styles.stepLabel}>Bâtiment</Text>
      </View>
      {lockedBuilding && building ? (
        <LockedValue value={building} icon="business-outline" />
      ) : (
        <ChipList
          options={buildings.map(b => b.name)}
          selected={building}
          onSelect={handleBuildingChange}
        />
      )}

      {showLevel && (levelsForBuilding.length > 0 || (lockedLevel && level)) && (
        <>
          <View style={[styles.stepRow, { marginTop: 14 }]}>
            <View style={[styles.stepBadge, lockedLevel && level && styles.stepBadgeLocked]}>
              <Text style={styles.stepBadgeText}>2</Text>
            </View>
            <Text style={styles.stepLabel}>
              Niveau
              {selectedBuilding ? ` — ${selectedBuilding.name}` : ''}
            </Text>
          </View>
          {lockedLevel && level ? (
            <LockedValue value={level} icon="layers-outline" />
          ) : (
            <ChipList
              options={levelsForBuilding.map(l => l.name)}
              selected={level}
              onSelect={handleLevelChange}
            />
          )}
        </>
      )}

      {showZone && zonesForLevel.length > 0 && (
        <>
          <View style={[styles.stepRow, { marginTop: 14 }]}>
            <View style={styles.stepBadge}>
              <Text style={styles.stepBadgeText}>3</Text>
            </View>
            <Text style={styles.stepLabel}>
              Zone
              {selectedLevel ? ` — ${selectedLevel.name}` : ''}
            </Text>
          </View>
          <ChipList
            options={['', ...zonesForLevel]}
            selected={zone}
            onSelect={onZoneChange}
          />
        </>
      )}

      {showZone && zonesForLevel.length === 0 && (
        <>
          <View style={[styles.stepRow, { marginTop: 14 }]}>
            <View style={styles.stepBadge}>
              <Text style={styles.stepBadgeText}>3</Text>
            </View>
            <Text style={styles.stepLabel}>Zone (optionnel)</Text>
          </View>
          <TextInput
            style={styles.freeInput}
            placeholder="Ex : Zone Nord, Couloir Est..."
            placeholderTextColor={C.textMuted}
            value={zone}
            onChangeText={onZoneChange}
          />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  chipRow: { flexDirection: 'row', gap: 8, paddingVertical: 4 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.surface,
  },
  chipActive: { borderColor: C.primary, backgroundColor: C.primary + '15' },
  chipNone: { borderStyle: 'dashed', borderColor: C.border },
  chipText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub },
  chipTextActive: { color: C.primary, fontFamily: 'Inter_600SemiBold' },
  chipNoneText: { color: C.textMuted, fontSize: 12 },

  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  stepBadge: {
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
  },
  stepBadgeLocked: { backgroundColor: C.textMuted },
  stepBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#fff' },
  stepLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.4 },

  lockedHint: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.primary + '10', borderRadius: 8, padding: 9,
    borderWidth: 1, borderColor: C.primary + '30', marginBottom: 12,
  },
  lockedHintText: { flex: 1, fontSize: 11, fontFamily: 'Inter_400Regular', color: C.primary, lineHeight: 16 },

  lockedRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 4, paddingVertical: 2 },
  lockedChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.primary + '15', borderRadius: 20,
    borderWidth: 1, borderColor: C.primary + '40',
    paddingHorizontal: 14, paddingVertical: 7,
  },
  lockedChipText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.primary },
  lockedBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: C.surface2, borderRadius: 8,
    paddingHorizontal: 7, paddingVertical: 3,
    borderWidth: 1, borderColor: C.border,
  },
  lockedBadgeText: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textMuted },

  freeTextContainer: {},
  freeTextHint: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 6,
    backgroundColor: C.surface2, borderRadius: 8, padding: 10,
    borderWidth: 1, borderColor: C.border, marginBottom: 14,
  },
  freeTextHintText: { flex: 1, fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, lineHeight: 16 },

  label: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub, marginBottom: 6 },
  freeInput: {
    backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.border,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text, marginBottom: 12,
  },
});
