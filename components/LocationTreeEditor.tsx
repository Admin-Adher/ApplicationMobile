import React, { useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/constants/colors';
import { ChantierBuilding, ChantierLevel, ChantierZone } from '@/constants/types';
import { genId } from '@/lib/utils';

function generateLevels(basements: number, floors: number): ChantierLevel[] {
  const levels: ChantierLevel[] = [];
  for (let i = basements; i >= 1; i--) {
    levels.push({ id: genId(), name: `SS${i}`, zones: [] });
  }
  levels.push({ id: genId(), name: 'RDC', zones: [] });
  for (let i = 1; i <= floors; i++) {
    levels.push({ id: genId(), name: `R+${i}`, zones: [] });
  }
  return levels;
}

interface Props {
  buildings: ChantierBuilding[];
  onChange: (buildings: ChantierBuilding[]) => void;
}

export default function LocationTreeEditor({ buildings, onChange }: Props) {
  const [basements, setBasements] = useState(1);
  const [floors, setFloors] = useState(3);
  const [expandedBuildingId, setExpandedBuildingId] = useState<string | null>(null);
  const [newBuildingName, setNewBuildingName] = useState('');
  const [newLevelName, setNewLevelName] = useState<Record<string, string>>({});
  const [newZoneName, setNewZoneName] = useState<Record<string, string>>({});

  function addBuilding() {
    const name = newBuildingName.trim();
    if (!name) return;
    const exists = buildings.some(b => b.name.toLowerCase() === name.toLowerCase());
    if (exists) { Alert.alert('Doublon', 'Ce bâtiment existe déjà.'); return; }
    const newBuilding: ChantierBuilding = {
      id: genId(), name,
      levels: generateLevels(basements, floors),
    };
    onChange([...buildings, newBuilding]);
    setNewBuildingName('');
    setExpandedBuildingId(newBuilding.id);
  }

  function removeBuilding(id: string) {
    Alert.alert('Supprimer', 'Supprimer ce bâtiment et tous ses niveaux ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => {
        onChange(buildings.filter(b => b.id !== id));
        if (expandedBuildingId === id) setExpandedBuildingId(null);
      }},
    ]);
  }

  function renameBuildingLevel(bId: string, lId: string, newName: string) {
    onChange(buildings.map(b => b.id !== bId ? b : {
      ...b,
      levels: b.levels.map(l => l.id !== lId ? l : { ...l, name: newName }),
    }));
  }

  function renameBuilding(bId: string, newName: string) {
    const trimmed = newName.trim();
    if (!trimmed) return;
    const current = buildings.find(b => b.id === bId);
    if (!current) return;
    if (current.name === trimmed) return;
    const exists = buildings.some(b => b.id !== bId && b.name.toLowerCase() === trimmed.toLowerCase());
    if (exists) {
      Alert.alert('Doublon', 'Un autre bâtiment porte déjà ce nom.');
      return;
    }
    onChange(buildings.map(b => b.id !== bId ? b : { ...b, name: trimmed }));
  }

  function removeLevel(bId: string, lId: string) {
    onChange(buildings.map(b => b.id !== bId ? b : {
      ...b,
      levels: b.levels.filter(l => l.id !== lId),
    }));
  }

  function addLevel(bId: string) {
    const name = (newLevelName[bId] ?? '').trim();
    if (!name) return;
    const building = buildings.find(b => b.id === bId);
    if (!building) return;
    if (building.levels.some(l => l.name.toLowerCase() === name.toLowerCase())) {
      Alert.alert('Doublon', 'Ce niveau existe déjà.');
      return;
    }
    const newLevel: ChantierLevel = { id: genId(), name, zones: [] };
    onChange(buildings.map(b => b.id !== bId ? b : { ...b, levels: [...b.levels, newLevel] }));
    setNewLevelName(prev => ({ ...prev, [bId]: '' }));
  }

  function addZone(bId: string, lId: string) {
    const key = `${bId}_${lId}`;
    const name = (newZoneName[key] ?? '').trim();
    if (!name) return;
    const building = buildings.find(b => b.id === bId);
    const level = building?.levels.find(l => l.id === lId);
    if (!level) return;
    if (level.zones.some(z => z.name.toLowerCase() === name.toLowerCase())) {
      Alert.alert('Doublon', 'Cette zone existe déjà.');
      return;
    }
    const newZone: ChantierZone = { id: genId(), name };
    onChange(buildings.map(b => b.id !== bId ? b : {
      ...b,
      levels: b.levels.map(l => l.id !== lId ? l : { ...l, zones: [...l.zones, newZone] }),
    }));
    setNewZoneName(prev => ({ ...prev, [key]: '' }));
  }

  function removeZone(bId: string, lId: string, zId: string) {
    onChange(buildings.map(b => b.id !== bId ? b : {
      ...b,
      levels: b.levels.map(l => l.id !== lId ? l : {
        ...l, zones: l.zones.filter(z => z.id !== zId),
      }),
    }));
  }

  function applyGenerator(bId: string) {
    const generatedLevels = generateLevels(basements, floors);
    onChange(buildings.map(b => b.id !== bId ? b : { ...b, levels: generatedLevels }));
  }

  return (
    <View>
      {/* Générateur rapide */}
      <View style={styles.generatorCard}>
        <View style={styles.generatorHeader}>
          <Ionicons name="flash-outline" size={14} color={C.primary} />
          <Text style={styles.generatorTitle}>Générateur rapide de niveaux</Text>
        </View>
        <View style={styles.generatorRow}>
          <View style={styles.counterGroup}>
            <Text style={styles.counterLabel}>Sous-sols</Text>
            <View style={styles.counterRow}>
              <TouchableOpacity
                style={styles.counterBtn}
                onPress={() => setBasements(Math.max(0, basements - 1))}
              >
                <Ionicons name="remove" size={14} color={C.text} />
              </TouchableOpacity>
              <Text style={styles.counterValue}>{basements}</Text>
              <TouchableOpacity
                style={styles.counterBtn}
                onPress={() => setBasements(basements + 1)}
              >
                <Ionicons name="add" size={14} color={C.text} />
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.counterSep} />
          <View style={styles.counterGroup}>
            <Text style={styles.counterLabel}>Étages</Text>
            <View style={styles.counterRow}>
              <TouchableOpacity
                style={styles.counterBtn}
                onPress={() => setFloors(Math.max(0, floors - 1))}
              >
                <Ionicons name="remove" size={14} color={C.text} />
              </TouchableOpacity>
              <Text style={styles.counterValue}>{floors}</Text>
              <TouchableOpacity
                style={styles.counterBtn}
                onPress={() => setFloors(floors + 1)}
              >
                <Ionicons name="add" size={14} color={C.text} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
        <Text style={styles.generatorPreview}>
          Génère : {basements > 0 ? Array.from({ length: basements }, (_, i) => `SS${basements - i}`).join(', ') + ', ' : ''}RDC{floors > 0 ? ', ' + Array.from({ length: Math.min(floors, 5) }, (_, i) => `R+${i + 1}`).join(', ') + (floors > 5 ? ` ... R+${floors}` : '') : ''}
        </Text>
        <Text style={styles.generatorHint}>
          Appliquer ce gabarit à un bâtiment via le bouton "Réinitialiser les niveaux"
        </Text>
      </View>

      {/* Liste des bâtiments */}
      {buildings.map(building => (
        <View key={building.id} style={styles.buildingCard}>
          <BuildingHeader
            building={building}
            expanded={expandedBuildingId === building.id}
            onToggle={() => setExpandedBuildingId(
              expandedBuildingId === building.id ? null : building.id
            )}
            onRename={(name) => renameBuilding(building.id, name)}
            onRemove={() => removeBuilding(building.id)}
          />

          {expandedBuildingId === building.id && (
            <View style={styles.buildingBody}>
              {/* Réinitialiser niveaux */}
              <TouchableOpacity
                style={styles.resetLevelsBtn}
                onPress={() => {
                  Alert.alert(
                    'Réinitialiser les niveaux',
                    `Remplacer les niveaux de "${building.name}" par le gabarit (${basements} SS + RDC + ${floors} étages) ?`,
                    [
                      { text: 'Annuler', style: 'cancel' },
                      { text: 'Appliquer', onPress: () => applyGenerator(building.id) },
                    ]
                  );
                }}
                activeOpacity={0.7}
              >
                <Ionicons name="refresh-outline" size={13} color={C.primary} />
                <Text style={styles.resetLevelsBtnText}>Réinitialiser les niveaux avec le générateur</Text>
              </TouchableOpacity>

              {/* Niveaux */}
              {building.levels.length === 0 && (
                <Text style={styles.emptyHint}>Aucun niveau — ajoutez-en ci-dessous</Text>
              )}
              {building.levels.map((level, idx) => (
                <LevelRow
                  key={level.id}
                  level={level}
                  buildingId={building.id}
                  newZoneName={newZoneName}
                  setNewZoneName={setNewZoneName}
                  onRename={(name) => renameBuildingLevel(building.id, level.id, name)}
                  onRemove={() => removeLevel(building.id, level.id)}
                  onAddZone={() => addZone(building.id, level.id)}
                  onRemoveZone={(zId) => removeZone(building.id, level.id, zId)}
                />
              ))}

              {/* Ajouter un niveau */}
              <View style={styles.addRow}>
                <TextInput
                  style={styles.addInput}
                  placeholder="Nouveau niveau (ex : Mezzanine, Toiture)"
                  placeholderTextColor={C.textMuted}
                  value={newLevelName[building.id] ?? ''}
                  onChangeText={v => setNewLevelName(prev => ({ ...prev, [building.id]: v }))}
                  onSubmitEditing={() => addLevel(building.id)}
                  returnKeyType="done"
                />
                <TouchableOpacity
                  style={[styles.addBtn, !(newLevelName[building.id] ?? '').trim() && styles.addBtnDisabled]}
                  onPress={() => addLevel(building.id)}
                  disabled={!(newLevelName[building.id] ?? '').trim()}
                >
                  <Ionicons name="add" size={16} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>
          )}
        </View>
      ))}

      {/* Ajouter un bâtiment */}
      <View style={styles.addBuildingRow}>
        <TextInput
          style={styles.addBuildingInput}
          placeholder="Nom du bâtiment (ex : Bât A, Tour Nord...)"
          placeholderTextColor={C.textMuted}
          value={newBuildingName}
          onChangeText={setNewBuildingName}
          onSubmitEditing={addBuilding}
          returnKeyType="done"
        />
        <TouchableOpacity
          style={[styles.addBuildingBtn, !newBuildingName.trim() && styles.addBtnDisabled]}
          onPress={addBuilding}
          disabled={!newBuildingName.trim()}
        >
          <Ionicons name="add" size={16} color="#fff" />
          <Text style={styles.addBuildingBtnText}>Ajouter</Text>
        </TouchableOpacity>
      </View>

      {buildings.length === 0 && (
        <View style={styles.emptyState}>
          <Ionicons name="business-outline" size={32} color={C.textMuted} />
          <Text style={styles.emptyStateText}>
            Aucun bâtiment configuré.{'\n'}Ajoutez au moins un bâtiment pour activer la localisation hiérarchique.
          </Text>
        </View>
      )}
    </View>
  );
}

function BuildingHeader({
  building,
  expanded,
  onToggle,
  onRename,
  onRemove,
}: {
  building: ChantierBuilding;
  expanded: boolean;
  onToggle: () => void;
  onRename: (name: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(building.name);

  function commit() {
    const next = editName.trim();
    if (next && next !== building.name) {
      onRename(next);
    } else {
      setEditName(building.name);
    }
    setEditing(false);
  }

  return (
    <View style={styles.buildingHeader}>
      <TouchableOpacity
        onPress={onToggle}
        activeOpacity={0.8}
        style={styles.buildingIconWrap}
      >
        <Ionicons name="business-outline" size={16} color={C.primary} />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        {editing ? (
          <TextInput
            style={styles.buildingNameInput}
            value={editName}
            onChangeText={setEditName}
            autoFocus
            onBlur={commit}
            onSubmitEditing={commit}
            returnKeyType="done"
            selectTextOnFocus
          />
        ) : (
          <TouchableOpacity
            onPress={() => { setEditName(building.name); setEditing(true); }}
            activeOpacity={0.7}
          >
            <View style={styles.buildingNameRow}>
              <Text style={styles.buildingName}>{building.name}</Text>
              <Ionicons name="pencil-outline" size={12} color={C.textMuted} />
            </View>
          </TouchableOpacity>
        )}
        <TouchableOpacity onPress={onToggle} activeOpacity={0.8}>
          <Text style={styles.buildingMeta}>
            {building.levels.length} niveau{building.levels.length !== 1 ? 'x' : ''}
            {building.levels.length > 0
              ? ` · ${building.levels[0].name} → ${building.levels[building.levels.length - 1].name}`
              : ''}
          </Text>
        </TouchableOpacity>
      </View>
      <TouchableOpacity
        onPress={onRemove}
        hitSlop={10}
        style={styles.buildingDeleteBtn}
      >
        <Ionicons name="trash-outline" size={15} color={C.critical} />
      </TouchableOpacity>
      <TouchableOpacity onPress={onToggle} hitSlop={8}>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={C.textMuted}
        />
      </TouchableOpacity>
    </View>
  );
}

function LevelRow({
  level,
  buildingId,
  newZoneName,
  setNewZoneName,
  onRename,
  onRemove,
  onAddZone,
  onRemoveZone,
}: {
  level: ChantierLevel;
  buildingId: string;
  newZoneName: Record<string, string>;
  setNewZoneName: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onRename: (name: string) => void;
  onRemove: () => void;
  onAddZone: () => void;
  onRemoveZone: (zId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(level.name);
  const key = `${buildingId}_${level.id}`;

  return (
    <View style={styles.levelRow}>
      <View style={styles.levelHeader}>
        <View style={styles.levelDot} />
        {editing ? (
          <TextInput
            style={styles.levelEditInput}
            value={editName}
            onChangeText={setEditName}
            autoFocus
            onBlur={() => {
              if (editName.trim()) onRename(editName.trim());
              else setEditName(level.name);
              setEditing(false);
            }}
            returnKeyType="done"
            onSubmitEditing={() => {
              if (editName.trim()) onRename(editName.trim());
              else setEditName(level.name);
              setEditing(false);
            }}
          />
        ) : (
          <TouchableOpacity onPress={() => setEditing(true)} style={{ flex: 1 }}>
            <Text style={styles.levelName}>{level.name}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          onPress={() => setExpanded(!expanded)}
          hitSlop={8}
          style={styles.levelZoneBtn}
        >
          <Ionicons name="layers-outline" size={13} color={C.textMuted} />
          {level.zones.length > 0 && (
            <Text style={styles.levelZoneCount}>{level.zones.length}</Text>
          )}
        </TouchableOpacity>
        <TouchableOpacity onPress={onRemove} hitSlop={8} style={styles.levelDeleteBtn}>
          <Ionicons name="close" size={13} color={C.textMuted} />
        </TouchableOpacity>
      </View>

      {expanded && (
        <View style={styles.zoneContainer}>
          {level.zones.map(zone => (
            <View key={zone.id} style={styles.zoneRow}>
              <Ionicons name="navigate-circle-outline" size={11} color={C.textMuted} />
              <Text style={styles.zoneName}>{zone.name}</Text>
              <TouchableOpacity onPress={() => onRemoveZone(zone.id)} hitSlop={8}>
                <Ionicons name="close" size={11} color={C.textMuted} />
              </TouchableOpacity>
            </View>
          ))}
          <View style={styles.zoneAddRow}>
            <TextInput
              style={styles.zoneInput}
              placeholder="Ajouter une zone..."
              placeholderTextColor={C.textMuted}
              value={newZoneName[key] ?? ''}
              onChangeText={v => setNewZoneName(prev => ({ ...prev, [key]: v }))}
              onSubmitEditing={onAddZone}
              returnKeyType="done"
            />
            <TouchableOpacity
              style={[styles.zoneAddBtn, !(newZoneName[key] ?? '').trim() && styles.addBtnDisabled]}
              onPress={onAddZone}
              disabled={!(newZoneName[key] ?? '').trim()}
            >
              <Ionicons name="add" size={13} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  generatorCard: {
    backgroundColor: C.primaryBg, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: C.primary + '30', marginBottom: 16,
  },
  generatorHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
  generatorTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.primary },
  generatorRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  counterGroup: { flex: 1, alignItems: 'center' },
  counterLabel: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.textSub, marginBottom: 6 },
  counterRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  counterBtn: {
    width: 28, height: 28, borderRadius: 14, backgroundColor: C.surface,
    borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center',
  },
  counterValue: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.text, minWidth: 32, textAlign: 'center' },
  counterSep: { width: 1, height: 40, backgroundColor: C.border, marginHorizontal: 12 },
  generatorPreview: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub, lineHeight: 15, marginBottom: 4 },
  generatorHint: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textMuted, lineHeight: 14 },

  buildingCard: {
    backgroundColor: C.surface, borderRadius: 12, borderWidth: 1,
    borderColor: C.border, marginBottom: 10, overflow: 'hidden',
  },
  buildingHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14,
  },
  buildingIconWrap: {
    width: 32, height: 32, borderRadius: 8,
    backgroundColor: C.primaryBg, alignItems: 'center', justifyContent: 'center',
  },
  buildingNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  buildingName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  buildingNameInput: {
    fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text,
    borderBottomWidth: 1, borderBottomColor: C.primary, paddingVertical: 2, paddingHorizontal: 0,
  },
  buildingMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1 },
  buildingDeleteBtn: { padding: 6 },
  buildingBody: { borderTopWidth: 1, borderTopColor: C.border, padding: 14, paddingTop: 12 },

  resetLevelsBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8,
    paddingHorizontal: 12, backgroundColor: C.primaryBg, borderRadius: 8,
    borderWidth: 1, borderColor: C.primary + '30', marginBottom: 12,
    alignSelf: 'flex-start',
  },
  resetLevelsBtnText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.primary },

  emptyHint: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', paddingVertical: 8 },

  levelRow: { marginBottom: 2 },
  levelHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  levelDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.primary + '60' },
  levelName: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text },
  levelEditInput: {
    flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text,
    borderBottomWidth: 1, borderBottomColor: C.primary, paddingBottom: 2,
  },
  levelZoneBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, padding: 4 },
  levelZoneCount: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.textMuted },
  levelDeleteBtn: { padding: 4 },

  zoneContainer: { paddingLeft: 18, marginBottom: 6 },
  zoneRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 4 },
  zoneName: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub },
  zoneAddRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  zoneInput: {
    flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: C.text,
    backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.border,
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
  },
  zoneAddBtn: {
    width: 28, height: 28, borderRadius: 8,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
  },

  addRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  addInput: {
    flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text,
    backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.border,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
  },
  addBtn: {
    width: 36, height: 36, borderRadius: 10,
    backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center',
  },
  addBtnDisabled: { backgroundColor: C.border },

  addBuildingRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  addBuildingInput: {
    flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text,
    backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.border,
    borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
  },
  addBuildingBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14,
    paddingVertical: 10, borderRadius: 10, backgroundColor: C.primary,
  },
  addBuildingBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  emptyState: { alignItems: 'center', paddingVertical: 24, gap: 10 },
  emptyStateText: {
    fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted,
    textAlign: 'center', lineHeight: 18,
  },
});
