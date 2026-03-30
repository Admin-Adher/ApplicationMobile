import {
  View, Text, StyleSheet, ScrollView, Platform, TouchableOpacity,
  Alert, Modal, TextInput, TouchableWithoutFeedback,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { Company } from '@/constants/types';
import { useRouter } from 'expo-router';

const COMPANY_COLORS = ['#3B82F6', '#F59E0B', '#8B5CF6', '#EC4899', '#EF4444', '#06B6D4', '#84CC16'];

function genId(): string {
  return Date.now().toString() + Math.random().toString(36).substring(2, 8);
}

export default function EquipesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, permissions } = useAuth();
  const {
    companies, tasks, stats,
    updateCompanyWorkers, addCompany, updateCompanyFull, deleteCompany, updateCompanyHours,
  } = useApp();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const [modalVisible, setModalVisible] = useState(false);
  const [editTarget, setEditTarget] = useState<Company | null>(null);
  const [nom, setNom] = useState('');
  const [nomCourt, setNomCourt] = useState('');
  const [contact, setContact] = useState('');
  const [zone, setZone] = useState('');
  const [effectif, setEffectif] = useState('');
  const [heures, setHeures] = useState('');

  const [workerModal, setWorkerModal] = useState<{ id: string; name: string; current: number; hours: number } | null>(null);
  const [workerInput, setWorkerInput] = useState('');
  const [hoursInput, setHoursInput] = useState('');

  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

  if (user && !permissions.canManageTeams) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg, padding: 32 }}>
        <Ionicons name="lock-closed-outline" size={48} color={C.textMuted} />
        <Text style={{ fontSize: 17, fontFamily: 'Inter_600SemiBold', color: C.text, marginTop: 16, textAlign: 'center' }}>
          Accès restreint
        </Text>
        <Text style={{ fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 8, textAlign: 'center' }}>
          Seuls les administrateurs et conducteurs de travaux ont accès à la gestion des équipes.
        </Text>
        <TouchableOpacity
          onPress={() => router.replace('/(tabs)' as any)}
          style={{ marginTop: 24, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: C.primary, borderRadius: 10 }}
        >
          <Text style={{ color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>Retour au tableau de bord</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function openAdd() {
    setEditTarget(null);
    setNom('');
    setNomCourt('');
    setContact('');
    setZone('');
    setEffectif('');
    setHeures('');
    setModalVisible(true);
  }

  function openEdit(co: Company) {
    setEditTarget(co);
    setNom(co.name);
    setNomCourt(co.shortName);
    setContact(co.contact);
    setZone(co.zone);
    setEffectif(String(co.plannedWorkers));
    setHeures(String(co.hoursWorked));
    setModalVisible(true);
  }

  function handleClose() {
    setModalVisible(false);
    setEditTarget(null);
    setNom('');
    setNomCourt('');
    setContact('');
    setZone('');
    setEffectif('');
    setHeures('');
  }

  function handleSave() {
    if (!nom.trim() || !nomCourt.trim() || !effectif.trim()) {
      Alert.alert('Champs requis', 'Le nom, le sigle et l\'effectif prévu sont obligatoires.');
      return;
    }
    const planned = parseInt(effectif, 10);
    if (isNaN(planned) || planned < 0) {
      Alert.alert('Valeur invalide', 'L\'effectif prévu doit être un nombre entier positif.');
      return;
    }
    const hours = parseInt(heures, 10);

    if (editTarget) {
      updateCompanyFull({
        ...editTarget,
        name: nom.trim(),
        shortName: nomCourt.trim().toUpperCase(),
        plannedWorkers: planned,
        hoursWorked: isNaN(hours) ? editTarget.hoursWorked : hours,
        zone: zone.trim() || 'À définir',
        contact: contact.trim() || '—',
      });
    } else {
      const color = COMPANY_COLORS[companies.length % COMPANY_COLORS.length];
      const company: Company = {
        id: genId(),
        name: nom.trim(),
        shortName: nomCourt.trim().toUpperCase(),
        color,
        plannedWorkers: planned,
        actualWorkers: 0,
        hoursWorked: 0,
        zone: zone.trim() || 'À définir',
        contact: contact.trim() || '—',
      };
      addCompany(company);
    }
    handleClose();
  }

  function handleDeleteCompany(co: Company) {
    Alert.alert(
      'Supprimer l\'entreprise',
      `Voulez-vous vraiment supprimer "${co.name}" ? Cette action est irréversible.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer', style: 'destructive',
          onPress: () => deleteCompany(co.id),
        },
      ]
    );
  }

  function openWorkerModal(co: Company) {
    setWorkerModal({ id: co.id, name: co.name, current: co.actualWorkers, hours: co.hoursWorked });
    setWorkerInput(String(co.actualWorkers));
    setHoursInput(String(co.hoursWorked));
  }

  function handleSaveWorkers() {
    if (!workerModal) return;
    const n = parseInt(workerInput, 10);
    const h = parseInt(hoursInput, 10);
    if (isNaN(n) || n < 0) {
      Alert.alert('Valeur invalide', 'Le nombre de personnes présentes doit être un entier positif.');
      return;
    }
    if (isNaN(h) || h < 0) {
      Alert.alert('Valeur invalide', 'Les heures travaillées doivent être un entier positif.');
      return;
    }
    updateCompanyWorkers(workerModal.id, n);
    updateCompanyHours(workerModal.id, h);
    setWorkerModal(null);
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Équipes</Text>
          <Text style={styles.subtitle}>{today}</Text>
        </View>
        <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
          <Ionicons name="add" size={22} color="#fff" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.summaryCard}>
          <View style={styles.summaryRow}>
            <View style={styles.summaryItem}>
              <Text style={styles.summaryValue}>{stats.totalWorkers}</Text>
              <Text style={styles.summaryLabel}>Présents</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryValue, { color: C.textSub }]}>{stats.plannedWorkers}</Text>
              <Text style={styles.summaryLabel}>Prévus</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryValue, { color: stats.plannedWorkers - stats.totalWorkers > 0 ? C.waiting : C.closed }]}>
                {stats.plannedWorkers - stats.totalWorkers}
              </Text>
              <Text style={styles.summaryLabel}>Écart</Text>
            </View>
          </View>
          <View style={styles.summaryBarBg}>
            <View style={[styles.summaryBarFill, {
              width: `${Math.min(stats.plannedWorkers > 0 ? (stats.totalWorkers / stats.plannedWorkers) * 100 : 0, 100)}%` as any,
            }]} />
          </View>
        </View>

        <Text style={styles.sectionTitle}>Entreprises sur chantier</Text>
        {companies.map(co => {
          const pct = co.plannedWorkers > 0 ? (co.actualWorkers / co.plannedWorkers) * 100 : 0;
          const ecart = co.plannedWorkers - co.actualWorkers;
          return (
            <View key={co.id} style={styles.coCard}>
              <View style={styles.coTop}>
                <View style={[styles.coColorBar, { backgroundColor: co.color }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.coName}>{co.name}</Text>
                  <Text style={styles.coZone}>{co.zone}</Text>
                </View>
                <TouchableOpacity
                  style={styles.iconBtn}
                  onPress={() => openWorkerModal(co)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="people-outline" size={16} color={C.primary} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.iconBtn}
                  onPress={() => openEdit(co)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="pencil-outline" size={16} color={C.primary} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.iconBtn, { backgroundColor: C.openBg }]}
                  onPress={() => handleDeleteCompany(co)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Ionicons name="trash-outline" size={16} color={C.open} />
                </TouchableOpacity>
              </View>

              <View style={styles.coStats}>
                <View style={styles.coStat}>
                  <Text style={[styles.coStatVal, { color: co.color }]}>{co.actualWorkers}</Text>
                  <Text style={styles.coStatLabel}>Présents</Text>
                </View>
                <View style={styles.coStat}>
                  <Text style={styles.coStatVal}>{co.plannedWorkers}</Text>
                  <Text style={styles.coStatLabel}>Prévus</Text>
                </View>
                <View style={styles.coStat}>
                  <Text style={[styles.coStatVal, { color: ecart > 0 ? C.waiting : C.closed }]}>
                    {ecart > 0 ? `-${ecart}` : '✓'}
                  </Text>
                  <Text style={styles.coStatLabel}>Écart</Text>
                </View>
                <View style={styles.coStat}>
                  <Text style={styles.coStatVal}>{co.hoursWorked}h</Text>
                  <Text style={styles.coStatLabel}>Heures</Text>
                </View>
              </View>

              <View style={styles.coBarBg}>
                <View style={[styles.coBarFill, { width: `${Math.min(pct, 100)}%` as any, backgroundColor: co.color }]} />
              </View>

              <View style={styles.coContact}>
                <Ionicons name="call-outline" size={12} color={C.textMuted} />
                <Text style={styles.coContactText}>{co.contact}</Text>
              </View>
            </View>
          );
        })}

        {companies.length === 0 && (
          <View style={styles.emptyBox}>
            <Ionicons name="business-outline" size={32} color={C.textMuted} />
            <Text style={styles.emptyText}>Aucune entreprise — appuyez sur + pour en ajouter une</Text>
          </View>
        )}

        <Text style={styles.sectionTitle}>Tâches en cours</Text>
        {tasks.filter(t => t.status === 'in_progress' || t.status === 'delayed').map(task => (
          <View key={task.id} style={styles.taskCard}>
            <View style={styles.taskTop}>
              <View style={[styles.taskDot, { backgroundColor: task.status === 'delayed' ? C.waiting : C.inProgress }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.taskTitle}>{task.title}</Text>
                <Text style={styles.taskSub}>{task.assignee}</Text>
              </View>
              <Text style={[styles.taskPct, { color: task.status === 'delayed' ? C.waiting : C.inProgress }]}>
                {task.progress}%
              </Text>
            </View>
            <View style={styles.taskBarBg}>
              <View style={[styles.taskBarFill, {
                width: `${task.progress}%` as any,
                backgroundColor: task.status === 'delayed' ? C.waiting : C.inProgress,
              }]} />
            </View>
          </View>
        ))}
      </ScrollView>

      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={handleClose}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableWithoutFeedback onPress={handleClose}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editTarget ? 'Modifier l\'entreprise' : 'Nouvelle entreprise'}</Text>
              <TouchableOpacity onPress={handleClose}>
                <Ionicons name="close" size={22} color={C.textSub} />
              </TouchableOpacity>
            </View>

            <Text style={styles.fieldLabel}>Nom de l'entreprise *</Text>
            <TextInput
              style={styles.input}
              placeholder="Ex: VINCI Construction"
              placeholderTextColor={C.textMuted}
              value={nom}
              onChangeText={setNom}
            />

            <Text style={styles.fieldLabel}>Nom court *</Text>
            <TextInput
              style={styles.input}
              placeholder="Ex: VINCI"
              placeholderTextColor={C.textMuted}
              value={nomCourt}
              onChangeText={setNomCourt}
              autoCapitalize="characters"
            />

            <Text style={styles.fieldLabel}>Effectif prévu *</Text>
            <TextInput
              style={styles.input}
              placeholder="Ex: 20"
              placeholderTextColor={C.textMuted}
              value={effectif}
              onChangeText={setEffectif}
              keyboardType="numeric"
            />

            {editTarget && (
              <>
                <Text style={styles.fieldLabel}>Heures travaillées</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Ex: 120"
                  placeholderTextColor={C.textMuted}
                  value={heures}
                  onChangeText={setHeures}
                  keyboardType="numeric"
                />
              </>
            )}

            <Text style={styles.fieldLabel}>Zone / Bâtiment</Text>
            <TextInput
              style={styles.input}
              placeholder="Ex: Bâtiment B"
              placeholderTextColor={C.textMuted}
              value={zone}
              onChangeText={setZone}
            />

            <Text style={styles.fieldLabel}>Contact</Text>
            <TextInput
              style={styles.input}
              placeholder="Ex: Jean Dupont — 06 12 34 56 78"
              placeholderTextColor={C.textMuted}
              value={contact}
              onChangeText={setContact}
            />

            <TouchableOpacity
              style={[styles.confirmBtn, (!nom.trim() || !nomCourt.trim() || !effectif.trim()) && styles.confirmBtnDisabled]}
              onPress={handleSave}
              disabled={!nom.trim() || !nomCourt.trim() || !effectif.trim()}
            >
              <Text style={styles.confirmBtnText}>
                {editTarget ? 'Enregistrer les modifications' : 'Ajouter l\'entreprise'}
              </Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={!!workerModal} transparent animationType="fade" onRequestClose={() => setWorkerModal(null)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableWithoutFeedback onPress={() => setWorkerModal(null)}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Présence du jour</Text>
              <TouchableOpacity onPress={() => setWorkerModal(null)}>
                <Ionicons name="close" size={22} color={C.textSub} />
              </TouchableOpacity>
            </View>
            {workerModal && (
              <Text style={styles.workerModalSub}>{workerModal.name}</Text>
            )}

            <Text style={styles.fieldLabel}>Personnel présent</Text>
            <TextInput
              style={styles.input}
              placeholder="Nombre de personnes"
              placeholderTextColor={C.textMuted}
              value={workerInput}
              onChangeText={setWorkerInput}
              keyboardType="numeric"
              autoFocus
            />

            <Text style={styles.fieldLabel}>Heures travaillées</Text>
            <TextInput
              style={styles.input}
              placeholder="Total heures"
              placeholderTextColor={C.textMuted}
              value={hoursInput}
              onChangeText={setHoursInput}
              keyboardType="numeric"
            />

            <TouchableOpacity style={styles.confirmBtn} onPress={handleSaveWorkers}>
              <Text style={styles.confirmBtnText}>Enregistrer</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    paddingHorizontal: 16, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
    flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8,
    backgroundColor: C.surface,
  },
  backBtn: { paddingBottom: 2 },
  title: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.text },
  subtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  addBtn: { backgroundColor: C.primary, width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16 },
  summaryCard: { backgroundColor: C.surface, borderRadius: 14, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: C.border },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 14 },
  summaryItem: { alignItems: 'center' },
  summaryValue: { fontSize: 28, fontFamily: 'Inter_700Bold', color: C.primary },
  summaryLabel: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  divider: { width: 1, backgroundColor: C.border, marginVertical: 4 },
  summaryBarBg: { height: 8, backgroundColor: C.border, borderRadius: 4, overflow: 'hidden' },
  summaryBarFill: { height: '100%', backgroundColor: C.primary, borderRadius: 4 },
  sectionTitle: {
    fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.textSub,
    marginBottom: 10, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5,
  },
  coCard: { backgroundColor: C.surface, borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: C.border },
  coTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  coColorBar: { width: 4, height: 36, borderRadius: 2 },
  coName: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text },
  coZone: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  iconBtn: { padding: 6, backgroundColor: C.primaryBg, borderRadius: 8 },
  coStats: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  coStat: { alignItems: 'center', flex: 1 },
  coStatVal: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.text },
  coStatLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
  coBarBg: { height: 6, backgroundColor: C.border, borderRadius: 3, overflow: 'hidden', marginBottom: 10 },
  coBarFill: { height: '100%', borderRadius: 3 },
  coContact: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  coContactText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted },
  emptyBox: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center' },
  taskCard: { backgroundColor: C.surface, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: C.border },
  taskTop: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  taskDot: { width: 8, height: 8, borderRadius: 4 },
  taskTitle: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.text },
  taskSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  taskPct: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  taskBarBg: { height: 5, backgroundColor: C.border, borderRadius: 3, overflow: 'hidden' },
  taskBarFill: { height: '100%', borderRadius: 3 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalCard: { backgroundColor: C.surface, borderRadius: 18, padding: 20, width: '100%', maxWidth: 440, borderWidth: 1, borderColor: C.border },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  modalTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.text },
  workerModalSub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, marginBottom: 12 },
  fieldLabel: {
    fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub,
    marginBottom: 6, marginTop: 12, textTransform: 'uppercase', letterSpacing: 0.4,
  },
  input: {
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, fontFamily: 'Inter_400Regular', color: C.text,
  },
  confirmBtn: { backgroundColor: C.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 20 },
  confirmBtnDisabled: { opacity: 0.4 },
  confirmBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },
});
