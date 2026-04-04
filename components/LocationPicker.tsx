import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/constants/colors';
import { ChantierBuilding } from '@/constants/types';

interface LocationPickerProps {
  buildings: ChantierBuilding[];
  building: string;
  level: string;
  zone: string;
  onBuildingChange: (b: string) => void;
  onLevelChange: (l: string) => void;
  onZoneChange: (z: string) => void;
  showZone?: boolean;
}

function ChipList({
  options,
  selected,
  onSelect,
  prefix,
}: {
  options: string[];
  selected: string;
  onSelect: (v: string) => void;
  prefix?: string;
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <View style={styles.chipRow}>
        {options.map(opt => (
          <TouchableOpacity
            key={opt}
            style={[styles.chip, selected === opt && styles.chipActive]}
            onPress={() => onSelect(opt)}
            activeOpacity={0.75}
          >
            <Text style={[styles.chipText, selected === opt && styles.chipTextActive]}>
              {prefix ? `${prefix} ${opt}` : opt}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
  );
}

export default function LocationPicker({
  buildings,
  building,
  level,
  zone,
  onBuildingChange,
  onLevelChange,
  onZoneChange,
  showZone = true,
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
        <View style={styles.freeTextHint}>
          <Ionicons name="information-circle-outline" size={13} color={C.textMuted} />
          <Text style={styles.freeTextHintText}>
            Aucune structure configurée pour ce chantier. Saisissez librement.
          </Text>
        </View>
        <Text style={styles.label}>Bâtiment</Text>
        <TextInput
          style={styles.freeInput}
          placeholder="Ex : Bât A, Tour Nord..."
          placeholderTextColor={C.textMuted}
          value={building}
          onChangeText={onBuildingChange}
        />
        <Text style={styles.label}>Niveau</Text>
        <TextInput
          style={styles.freeInput}
          placeholder="Ex : RDC, R+5, SS1..."
          placeholderTextColor={C.textMuted}
          value={level}
          onChangeText={onLevelChange}
        />
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
      <View style={styles.stepRow}>
        <View style={styles.stepBadge}>
          <Text style={styles.stepBadgeText}>1</Text>
        </View>
        <Text style={styles.stepLabel}>Bâtiment</Text>
      </View>
      <ChipList
        options={buildings.map(b => b.name)}
        selected={building}
        onSelect={handleBuildingChange}
      />

      {levelsForBuilding.length > 0 && (
        <>
          <View style={[styles.stepRow, { marginTop: 14 }]}>
            <View style={styles.stepBadge}>
              <Text style={styles.stepBadgeText}>2</Text>
            </View>
            <Text style={styles.stepLabel}>
              Niveau
              {selectedBuilding ? ` — ${selectedBuilding.name}` : ''}
            </Text>
          </View>
          <ChipList
            options={levelsForBuilding.map(l => l.name)}
            selected={level}
            onSelect={handleLevelChange}
          />
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
  chipText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub },
  chipTextActive: { color: C.primary, fontFamily: 'Inter_600SemiBold' },

  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  stepBadge: {
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
  },
  stepBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#fff' },
  stepLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.4 },

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
