import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState, useMemo } from 'react';
import { C } from '@/constants/colors';
import { useApp, STANDARD_LOTS } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { Lot } from '@/constants/types';
import Header from '@/components/Header';
import BottomNavBar from '@/components/BottomNavBar';
import { genId } from '@/lib/utils';

const LOT_COLORS = [
  '#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899',
  '#06B6D4', '#F97316', '#6366F1', '#14B8A6', '#78716C', '#22C55E',
];

function LotCard({ lot, count, onDelete, canDelete }: { lot: Lot; count: number; onDelete: () => void; canDelete: boolean }) {
  return (
    <View style={[styles.lotCard, { borderLeftColor: lot.color }]}>
      <View style={styles.lotInfo}>
        <View style={[styles.lotCode, { backgroundColor: lot.color + '20' }]}>
          <Text style={[styles.lotCodeText, { color: lot.color }]}>{lot.code}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.lotName}>{lot.name}</Text>
          <Text style={styles.lotCount}>{count} réserve{count !== 1 ? 's' : ''}</Text>
        </View>
      </View>
      {canDelete && !STANDARD_LOTS.find(l => l.id === lot.id) && (
        <TouchableOpacity onPress={onDelete} hitSlop={8}>
          <Ionicons name="trash-outline" size={15} color={C.textMuted} />
        </TouchableOpacity>
      )}
    </View>
  );
}

export default function LotsScreen() {
  const router = useRouter();
  const { lots, reserves, addLot, deleteLot } = useApp();
  const { permissions } = useAuth();

  const [showForm, setShowForm] = useState(false);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(LOT_COLORS[0]);

  const lotStats = useMemo(() => {
    const map: Record<string, number> = {};
    reserves.forEach(r => { if (r.lotId) map[r.lotId] = (map[r.lotId] ?? 0) + 1; });
    return map;
  }, [reserves]);

  const assignedLots = lots.filter(l => (lotStats[l.id] ?? 0) > 0);
  const unassignedLots = lots.filter(l => (lotStats[l.id] ?? 0) === 0);

  function handleAdd() {
    if (!newCode.trim() || !newName.trim()) {
      Alert.alert('Champs requis', 'Code et nom du lot sont obligatoires.');
      return;
    }
    const lot: Lot = {
      id: 'lot-custom-' + genId().slice(0, 8),
      code: newCode.trim().toUpperCase(),
      name: newName.trim(),
      color: newColor,
    };
    addLot(lot);
    setNewCode('');
    setNewName('');
    setShowForm(false);
  }

  function handleDelete(lot: Lot) {
    Alert.alert('Supprimer le lot', `Supprimer le lot "${lot.name}" ?`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => deleteLot(lot.id) },
    ]);
  }

  return (
    <View style={styles.container}>
      <Header
        title="Lots de travaux"
        subtitle={`${lots.length} lot${lots.length !== 1 ? 's' : ''}`}
        showBack
        rightIcon={permissions.canCreate ? 'add-circle-outline' : undefined}
        onRightPress={permissions.canCreate ? () => setShowForm(v => !v) : undefined}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {showForm && (
          <View style={styles.formCard}>
            <Text style={styles.formTitle}>Nouveau lot personnalisé</Text>
            <View style={styles.formRow}>
              <View style={[styles.formField, { flex: 0.3 }]}>
                <Text style={styles.label}>Code</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Ex: 16"
                  placeholderTextColor={C.textMuted}
                  value={newCode}
                  onChangeText={setNewCode}
                  maxLength={4}
                  autoCapitalize="characters"
                />
              </View>
              <View style={[styles.formField, { flex: 1 }]}>
                <Text style={styles.label}>Nom</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Ex: Sécurité incendie"
                  placeholderTextColor={C.textMuted}
                  value={newName}
                  onChangeText={setNewName}
                />
              </View>
            </View>
            <Text style={styles.label}>Couleur</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.colorRow}>
                {LOT_COLORS.map(col => (
                  <TouchableOpacity
                    key={col}
                    style={[styles.colorDot, { backgroundColor: col }, newColor === col && styles.colorDotSelected]}
                    onPress={() => setNewColor(col)}
                  />
                ))}
              </View>
            </ScrollView>
            <View style={styles.formActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setShowForm(false)}>
                <Text style={styles.cancelBtnText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.addBtn} onPress={handleAdd}>
                <Ionicons name="add" size={16} color="#fff" />
                <Text style={styles.addBtnText}>Ajouter</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <View style={styles.infoCard}>
          <Ionicons name="information-circle-outline" size={16} color={C.primary} />
          <Text style={styles.infoText}>
            Les lots BTP standards sont pré-configurés. Vous pouvez ajouter vos propres lots métier.
          </Text>
        </View>

        {assignedLots.length > 0 && (
          <>
            <Text style={styles.sectionLabel}>LOTS AVEC RÉSERVES ({assignedLots.length})</Text>
            {assignedLots.map(lot => (
              <LotCard
                key={lot.id}
                lot={lot}
                count={lotStats[lot.id] ?? 0}
                onDelete={() => handleDelete(lot)}
                canDelete={permissions.canDelete}
              />
            ))}
          </>
        )}

        <Text style={styles.sectionLabel}>
          {assignedLots.length > 0 ? `TOUS LES LOTS (${unassignedLots.length} sans réserves)` : `LOTS BTP STANDARDS (${lots.length})`}
        </Text>
        {unassignedLots.map(lot => (
          <LotCard
            key={lot.id}
            lot={lot}
            count={0}
            onDelete={() => handleDelete(lot)}
            canDelete={permissions.canDelete}
          />
        ))}

        {permissions.canCreate && !showForm && (
          <TouchableOpacity style={styles.newLotBtn} onPress={() => setShowForm(true)}>
            <Ionicons name="add-circle-outline" size={18} color={C.primary} />
            <Text style={styles.newLotBtnText}>Ajouter un lot personnalisé</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      <BottomNavBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 100 },

  formCard: {
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: C.border, marginBottom: 16,
  },
  formTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 12 },
  formRow: { flexDirection: 'row', gap: 10 },
  formField: {},
  label: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub, marginBottom: 6 },
  input: {
    backgroundColor: C.inputBg, borderWidth: 1, borderColor: C.border,
    borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text, marginBottom: 10,
  },
  colorRow: { flexDirection: 'row', gap: 10, paddingVertical: 4 },
  colorDot: { width: 30, height: 30, borderRadius: 15 },
  colorDotSelected: { borderWidth: 3, borderColor: '#fff', transform: [{ scale: 1.15 }] },
  formActions: { flexDirection: 'row', gap: 10, marginTop: 6 },
  cancelBtn: { flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 10, borderWidth: 1, borderColor: C.border },
  cancelBtnText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.textSub },
  addBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: C.primary, paddingVertical: 11, borderRadius: 10 },
  addBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  infoCard: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: C.primary + '10', borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: C.primary + '20', marginBottom: 16,
  },
  infoText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, lineHeight: 18 },

  sectionLabel: {
    fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textSub,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, marginTop: 4,
  },

  lotCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.surface, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: C.border, borderLeftWidth: 4, marginBottom: 8,
  },
  lotInfo: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12 },
  lotCode: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  lotCodeText: { fontSize: 13, fontFamily: 'Inter_700Bold' },
  lotName: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.text },
  lotCount: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },

  newLotBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderColor: C.primary + '30',
    backgroundColor: C.primary + '08', marginTop: 8,
  },
  newLotBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.primary },
});
