import {
  View, Text, StyleSheet, ScrollView, Platform, TouchableOpacity,
  Alert, Modal, TextInput, TouchableWithoutFeedback, Linking,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useState, useMemo } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useSettings } from '@/context/SettingsContext';
import { Company } from '@/constants/types';
import { useRouter } from 'expo-router';
import { genId } from '@/lib/utils';

const COMPANY_COLORS = [
  '#3B82F6', '#F59E0B', '#8B5CF6', '#EC4899', '#EF4444',
  '#06B6D4', '#84CC16', '#10B981', '#F97316', '#6366F1',
];

export default function EquipesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, permissions } = useAuth();
  const {
    companies, tasks, reserves, stats,
    updateCompanyWorkers, addCompany, updateCompanyFull, deleteCompany, updateCompanyHours,
  } = useApp();
  const { saveAttendanceSnapshot } = useSettings();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const [modalVisible, setModalVisible] = useState(false);
  const [editTarget, setEditTarget] = useState<Company | null>(null);
  const [nom, setNom] = useState('');
  const [nomCourt, setNomCourt] = useState('');
  const [contact, setContact] = useState('');
  const [email, setEmail] = useState('');
  const [zone, setZone] = useState('');
  const [lots, setLots] = useState('');
  const [effectif, setEffectif] = useState('');
  const [heures, setHeures] = useState('');
  const [siret, setSiret] = useState('');
  const [insurance, setInsurance] = useState('');
  const [qualifications, setQualifications] = useState('');
  const [selectedColor, setSelectedColor] = useState(COMPANY_COLORS[0]);

  const [workerModal, setWorkerModal] = useState<{ id: string; name: string; current: number; hours: number } | null>(null);
  const [workerInput, setWorkerInput] = useState('');
  const [hoursInput, setHoursInput] = useState('');

  const [filterCompanyId, setFilterCompanyId] = useState<string | null>(null);

  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

  const totalHours = useMemo(() => companies.reduce((s, c) => s + c.hoursWorked, 0), [companies]);

  const companyStats = useMemo(() => {
    const map: Record<string, { openReserves: number; activeTasks: number }> = {};
    for (const co of companies) {
      map[co.id] = {
        openReserves: reserves.filter(r => r.company === co.name && r.status !== 'closed').length,
        activeTasks: tasks.filter(t =>
          (t.company === co.id || t.company === co.name) &&
          (t.status === 'in_progress' || t.status === 'delayed')
        ).length,
      };
    }
    return map;
  }, [companies, reserves, tasks]);

  const filteredTasks = useMemo(() => {
    return tasks
      .filter(t => t.status === 'in_progress' || t.status === 'delayed')
      .filter(t => user?.role !== 'chef_equipe' || t.assignee === user.name)
      .filter(t => {
        if (!filterCompanyId) return true;
        const co = companies.find(c => c.id === filterCompanyId);
        return co ? (t.company === co.id || t.company === co.name) : true;
      });
  }, [tasks, user, filterCompanyId, companies]);

  if (user && !permissions.canViewTeams) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg, padding: 32 }}>
        <Ionicons name="lock-closed-outline" size={48} color={C.textMuted} />
        <Text style={{ fontSize: 17, fontFamily: 'Inter_600SemiBold', color: C.text, marginTop: 16, textAlign: 'center' }}>
          Accès restreint
        </Text>
        <Text style={{ fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 8, textAlign: 'center' }}>
          Votre rôle ne donne pas accès à la gestion des équipes.
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
    setNom(''); setNomCourt(''); setContact(''); setEmail(''); setZone(''); setLots('');
    setEffectif(''); setHeures(''); setSiret(''); setInsurance(''); setQualifications('');
    setSelectedColor(COMPANY_COLORS[companies.length % COMPANY_COLORS.length]);
    setModalVisible(true);
  }

  function openEdit(co: Company) {
    setEditTarget(co);
    setNom(co.name); setNomCourt(co.shortName); setContact(co.contact);
    setEmail(co.email ?? ''); setZone(co.zone);
    setLots((co.lots ?? []).join(', '));
    setEffectif(String(co.plannedWorkers)); setHeures(String(co.hoursWorked));
    setSiret(co.siret ?? ''); setInsurance(co.insurance ?? ''); setQualifications(co.qualifications ?? '');
    setSelectedColor(co.color);
    setModalVisible(true);
  }

  function handleClose() {
    setModalVisible(false); setEditTarget(null);
    setNom(''); setNomCourt(''); setContact(''); setEmail(''); setZone(''); setLots('');
    setEffectif(''); setHeures(''); setSiret(''); setInsurance(''); setQualifications('');
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
    const parsedLots = lots.trim()
      ? lots.split(',').map(l => l.trim()).filter(Boolean)
      : undefined;

    if (editTarget) {
      updateCompanyFull({
        ...editTarget,
        name: nom.trim(),
        shortName: nomCourt.trim().toUpperCase(),
        color: selectedColor,
        plannedWorkers: planned,
        hoursWorked: isNaN(hours) ? editTarget.hoursWorked : hours,
        zone: zone.trim() || 'À définir',
        contact: contact.trim() || '—',
        email: email.trim() || undefined,
        lots: parsedLots,
        siret: siret.trim() || undefined,
        insurance: insurance.trim() || undefined,
        qualifications: qualifications.trim() || undefined,
      });
    } else {
      const company: Company = {
        id: genId(),
        name: nom.trim(),
        shortName: nomCourt.trim().toUpperCase(),
        color: selectedColor,
        plannedWorkers: planned,
        actualWorkers: 0,
        hoursWorked: 0,
        zone: zone.trim() || 'À définir',
        contact: contact.trim() || '—',
        email: email.trim() || undefined,
        lots: parsedLots,
        siret: siret.trim() || undefined,
        insurance: insurance.trim() || undefined,
        qualifications: qualifications.trim() || undefined,
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
        { text: 'Supprimer', style: 'destructive', onPress: () => deleteCompany(co.id) },
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

  function stepWorker(delta: number) {
    const n = Math.max(0, (parseInt(workerInput, 10) || 0) + delta);
    setWorkerInput(String(n));
  }

  function stepHours(delta: number) {
    const h = Math.max(0, (parseInt(hoursInput, 10) || 0) + delta);
    setHoursInput(String(h));
  }

  const presencePct = stats.plannedWorkers > 0
    ? Math.round((stats.totalWorkers / stats.plannedWorkers) * 100)
    : 0;

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <View style={styles.headerTopRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8}>
            <Ionicons name="chevron-back" size={22} color={C.text} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Équipes</Text>
            <Text style={styles.subtitle}>{today}</Text>
          </View>
          {permissions.canManageTeams && (
            <TouchableOpacity style={styles.addBtn} onPress={openAdd}>
              <Ionicons name="add" size={18} color="#fff" />
              <Text style={styles.addBtnLabel}>Ajouter</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Summary ── */}
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
                {stats.plannedWorkers - stats.totalWorkers > 0 ? `-${stats.plannedWorkers - stats.totalWorkers}` : '✓'}
              </Text>
              <Text style={styles.summaryLabel}>Écart</Text>
            </View>
            <View style={styles.divider} />
            <View style={styles.summaryItem}>
              <Text style={[styles.summaryValue, { color: C.inProgress, fontSize: 22 }]}>{totalHours}h</Text>
              <Text style={styles.summaryLabel}>Heures tot.</Text>
            </View>
          </View>
          <View style={styles.summaryBarRow}>
            <View style={styles.summaryBarBg}>
              <View style={[styles.summaryBarFill, {
                width: `${Math.min(presencePct, 100)}%` as any,
              }]} />
            </View>
            <Text style={styles.summaryBarPct}>{presencePct}%</Text>
          </View>
        </View>

        {/* ── Entreprises ── */}
        <Text style={styles.sectionTitle}>Entreprises sur chantier ({companies.length})</Text>
        {companies.map(co => {
          const pct = co.plannedWorkers > 0 ? Math.round((co.actualWorkers / co.plannedWorkers) * 100) : 0;
          const ecart = co.plannedWorkers - co.actualWorkers;
          const cs = companyStats[co.id] ?? { openReserves: 0, activeTasks: 0 };
          return (
            <View key={co.id} style={styles.coCard}>
              <View style={styles.coTop}>
                <View style={[styles.coColorBar, { backgroundColor: co.color }]} />
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    <Text style={styles.coName}>{co.name}</Text>
                    {cs.openReserves > 0 && (
                      <View style={styles.reserveBadge}>
                        <Text style={styles.reserveBadgeText}>{cs.openReserves} réserve{cs.openReserves > 1 ? 's' : ''}</Text>
                      </View>
                    )}
                    {cs.activeTasks > 0 && (
                      <View style={styles.taskBadge}>
                        <Text style={styles.taskBadgeText}>{cs.activeTasks} tâche{cs.activeTasks > 1 ? 's' : ''}</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.coZone}>{co.zone}{co.lots && co.lots.length > 0 ? ` · ${co.lots.join(', ')}` : ''}</Text>
                </View>
                {permissions.canUpdateAttendance && (
                  <TouchableOpacity
                    style={styles.iconBtn}
                    onPress={() => openWorkerModal(co)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="people-outline" size={16} color={C.primary} />
                  </TouchableOpacity>
                )}
                {permissions.canManageTeams && (
                  <>
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
                  </>
                )}
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

              <View style={styles.coBarRow}>
                <View style={styles.coBarBg}>
                  <View style={[styles.coBarFill, { width: `${Math.min(pct, 100)}%` as any, backgroundColor: co.color }]} />
                </View>
                <Text style={[styles.coBarPct, { color: co.color }]}>{pct}%</Text>
              </View>

              <View style={styles.coFooter}>
                <View style={styles.coContactItem}>
                  <Ionicons name="call-outline" size={12} color={C.textMuted} />
                  <Text style={styles.coContactText}>{co.contact}</Text>
                </View>
                {co.email ? (
                  <TouchableOpacity
                    style={styles.coContactItem}
                    onPress={() => Linking.openURL(`mailto:${co.email}`)}
                  >
                    <Ionicons name="mail-outline" size={12} color={C.primary} />
                    <Text style={[styles.coContactText, { color: C.primary }]}>{co.email}</Text>
                  </TouchableOpacity>
                ) : null}
                {co.siret ? (
                  <View style={styles.coContactItem}>
                    <Ionicons name="document-text-outline" size={12} color={C.textMuted} />
                    <Text style={styles.coContactText}>SIRET {co.siret}</Text>
                  </View>
                ) : null}
              </View>

              {/* Filter toggle */}
              <TouchableOpacity
                style={[styles.filterToggleBtn, filterCompanyId === co.id && { backgroundColor: co.color + '20', borderColor: co.color }]}
                onPress={() => setFilterCompanyId(filterCompanyId === co.id ? null : co.id)}
              >
                <Ionicons name="filter-outline" size={12} color={filterCompanyId === co.id ? co.color : C.textMuted} />
                <Text style={[styles.filterToggleBtnText, filterCompanyId === co.id && { color: co.color }]}>
                  {filterCompanyId === co.id ? 'Voir toutes les tâches' : 'Filtrer les tâches'}
                </Text>
              </TouchableOpacity>
            </View>
          );
        })}

        {companies.length === 0 && (
          <View style={styles.emptyBox}>
            <Ionicons name="business-outline" size={32} color={C.textMuted} />
            <Text style={styles.emptyText}>Aucune entreprise — appuyez sur + pour en ajouter une</Text>
          </View>
        )}

        {/* ── Save attendance ── */}
        {permissions.canUpdateAttendance && companies.length > 0 && (
          <TouchableOpacity
            style={styles.saveAttendanceBtn}
            onPress={() => {
              const total = companies.reduce((a, c) => a + c.actualWorkers, 0);
              Alert.alert(
                'Sauvegarder les présences',
                `Enregistrer les présences du jour (${total} personnes au total) dans l'historique ?`,
                [
                  { text: 'Annuler', style: 'cancel' },
                  {
                    text: 'Sauvegarder',
                    onPress: async () => {
                      await saveAttendanceSnapshot(companies, user?.name ?? 'Système');
                      Alert.alert('Présences sauvegardées', "L'instantané a été enregistré dans l'historique.");
                    },
                  },
                ]
              );
            }}
          >
            <Ionicons name="save-outline" size={16} color={C.primary} />
            <Text style={styles.saveAttendanceBtnText}>Sauvegarder les présences du jour</Text>
          </TouchableOpacity>
        )}

        {/* ── Tasks ── */}
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>
            Tâches en cours{user?.role === 'chef_equipe' ? ' (mes tâches)' : ''}
            {filterCompanyId ? ` · ${companies.find(c => c.id === filterCompanyId)?.shortName ?? ''}` : ''}
          </Text>
          {filterCompanyId && (
            <TouchableOpacity onPress={() => setFilterCompanyId(null)}>
              <Ionicons name="close-circle" size={18} color={C.textMuted} />
            </TouchableOpacity>
          )}
        </View>

        {filteredTasks.map(task => {
          const co = companies.find(c => c.id === task.company || c.name === task.company);
          return (
            <TouchableOpacity
              key={task.id}
              style={styles.taskCard}
              onPress={() => router.push(`/task/${task.id}` as any)}
              activeOpacity={0.75}
            >
              <View style={styles.taskTop}>
                <View style={[styles.taskDot, { backgroundColor: task.status === 'delayed' ? C.waiting : C.inProgress }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.taskTitle}>{task.title}</Text>
                  <Text style={styles.taskSub}>
                    {task.assignee}
                    {co ? ` — ${co.shortName}` : task.company ? ` — ${task.company}` : ''}
                    {task.deadline ? ` · Échéance ${task.deadline}` : ''}
                  </Text>
                </View>
                <Text style={[styles.taskPct, { color: task.status === 'delayed' ? C.waiting : C.inProgress }]}>
                  {task.progress}%
                </Text>
                <Ionicons name="chevron-forward" size={14} color={C.textMuted} />
              </View>
              <View style={styles.taskBarBg}>
                <View style={[styles.taskBarFill, {
                  width: `${task.progress}%` as any,
                  backgroundColor: task.status === 'delayed' ? C.waiting : C.inProgress,
                }]} />
              </View>
              {task.status === 'delayed' && (
                <View style={styles.delayedBadge}>
                  <Ionicons name="warning-outline" size={11} color={C.waiting} />
                  <Text style={styles.delayedBadgeText}>En retard</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}

        {filteredTasks.length === 0 && (
          <View style={styles.emptyBox}>
            <Ionicons name="checkmark-circle-outline" size={28} color={C.closed} />
            <Text style={styles.emptyText}>
              {filterCompanyId
                ? 'Aucune tâche en cours pour cette entreprise'
                : user?.role === 'chef_equipe'
                  ? 'Aucune tâche assignée en cours'
                  : 'Aucune tâche en cours ou en retard'}
            </Text>
          </View>
        )}
      </ScrollView>

      {/* ══ Add / Edit Company Modal ══ */}
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

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

              {/* Color picker */}
              <Text style={styles.fieldLabel}>Couleur</Text>
              <View style={styles.colorRow}>
                {COMPANY_COLORS.map(c => (
                  <TouchableOpacity
                    key={c}
                    style={[styles.colorDot, { backgroundColor: c }, selectedColor === c && styles.colorDotSelected]}
                    onPress={() => setSelectedColor(c)}
                  >
                    {selectedColor === c && <Ionicons name="checkmark" size={14} color="#fff" />}
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.fieldLabel}>Nom de l'entreprise *</Text>
              <TextInput
                style={styles.input}
                placeholder="Ex: VINCI Construction"
                placeholderTextColor={C.textMuted}
                value={nom}
                onChangeText={setNom}
              />

              <Text style={styles.fieldLabel}>Nom court / Sigle *</Text>
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
                  <Text style={styles.fieldLabel}>Heures travaillées cumulées</Text>
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

              <Text style={styles.fieldLabel}>Lots (séparés par des virgules)</Text>
              <TextInput
                style={styles.input}
                placeholder="Ex: Gros œuvre, Menuiserie"
                placeholderTextColor={C.textMuted}
                value={lots}
                onChangeText={setLots}
              />

              <Text style={styles.fieldLabel}>Contact (nom & téléphone)</Text>
              <TextInput
                style={styles.input}
                placeholder="Ex: Jean Dupont — 06 12 34 56 78"
                placeholderTextColor={C.textMuted}
                value={contact}
                onChangeText={setContact}
              />

              <Text style={styles.fieldLabel}>Email</Text>
              <TextInput
                style={styles.input}
                placeholder="Ex: contact@entreprise.fr"
                placeholderTextColor={C.textMuted}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />

              <Text style={[styles.fieldLabel, { marginTop: 4 }]}>SIRET</Text>
              <TextInput
                style={styles.input}
                placeholder="Ex: 123 456 789 00012"
                placeholderTextColor={C.textMuted}
                value={siret}
                onChangeText={setSiret}
                keyboardType="numeric"
              />

              <Text style={styles.fieldLabel}>Assurance décennale</Text>
              <TextInput
                style={styles.input}
                placeholder="Ex: AXA — Police n°12345"
                placeholderTextColor={C.textMuted}
                value={insurance}
                onChangeText={setInsurance}
              />

              <Text style={styles.fieldLabel}>Qualifications / Certifications</Text>
              <TextInput
                style={[styles.input, { minHeight: 60 }]}
                placeholder="Ex: RGE, Qualibat 2111..."
                placeholderTextColor={C.textMuted}
                value={qualifications}
                onChangeText={setQualifications}
                multiline
                numberOfLines={2}
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
              <View style={{ height: 8 }} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ══ Worker Quick-Update Modal ══ */}
      <Modal visible={!!workerModal} transparent animationType="fade" onRequestClose={() => setWorkerModal(null)}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableWithoutFeedback onPress={() => setWorkerModal(null)}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>
          <View style={[styles.modalCard, { maxHeight: undefined }]}>
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
            <View style={styles.stepperRow}>
              <TouchableOpacity style={styles.stepperBtn} onPress={() => stepWorker(-1)}>
                <Ionicons name="remove" size={20} color={C.primary} />
              </TouchableOpacity>
              <TextInput
                style={[styles.input, styles.stepperInput]}
                placeholder="0"
                placeholderTextColor={C.textMuted}
                value={workerInput}
                onChangeText={setWorkerInput}
                keyboardType="numeric"
                textAlign="center"
              />
              <TouchableOpacity style={styles.stepperBtn} onPress={() => stepWorker(1)}>
                <Ionicons name="add" size={20} color={C.primary} />
              </TouchableOpacity>
            </View>

            <Text style={styles.fieldLabel}>Heures travaillées aujourd'hui</Text>
            <View style={styles.stepperRow}>
              <TouchableOpacity style={styles.stepperBtn} onPress={() => stepHours(-1)}>
                <Ionicons name="remove" size={20} color={C.primary} />
              </TouchableOpacity>
              <TextInput
                style={[styles.input, styles.stepperInput]}
                placeholder="0"
                placeholderTextColor={C.textMuted}
                value={hoursInput}
                onChangeText={setHoursInput}
                keyboardType="numeric"
                textAlign="center"
              />
              <TouchableOpacity style={styles.stepperBtn} onPress={() => stepHours(1)}>
                <Ionicons name="add" size={20} color={C.primary} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={[styles.confirmBtn, { marginTop: 20 }]} onPress={handleSaveWorkers}>
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
    backgroundColor: C.surface,
  },
  headerTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  backBtn: { padding: 2 },
  title: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.text },
  subtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  addBtn: { backgroundColor: C.primary, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  addBtnLabel: { color: '#fff', fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  content: { padding: 16 },

  summaryCard: { backgroundColor: C.surface, borderRadius: 14, padding: 16, marginBottom: 20, borderWidth: 1, borderColor: C.border },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-around', marginBottom: 14 },
  summaryItem: { alignItems: 'center' },
  summaryValue: { fontSize: 28, fontFamily: 'Inter_700Bold', color: C.primary },
  summaryLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  divider: { width: 1, backgroundColor: C.border, marginVertical: 4 },
  summaryBarRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  summaryBarBg: { flex: 1, height: 8, backgroundColor: C.border, borderRadius: 4, overflow: 'hidden' },
  summaryBarFill: { height: '100%', backgroundColor: C.primary, borderRadius: 4 },
  summaryBarPct: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary, width: 36, textAlign: 'right' },

  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, marginTop: 4 },
  sectionTitle: {
    fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.textSub,
    textTransform: 'uppercase', letterSpacing: 0.5,
  },

  coCard: { backgroundColor: C.surface, borderRadius: 14, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: C.border },
  coTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  coColorBar: { width: 4, height: 40, borderRadius: 2 },
  coName: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text },
  coZone: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  iconBtn: { padding: 6, backgroundColor: C.primaryBg, borderRadius: 8 },

  reserveBadge: { backgroundColor: '#FEE2E2', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  reserveBadgeText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.open },
  taskBadge: { backgroundColor: C.primaryBg, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 6 },
  taskBadgeText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.primary },

  coStats: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 },
  coStat: { alignItems: 'center', flex: 1 },
  coStatVal: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.text },
  coStatLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },

  coBarRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  coBarBg: { flex: 1, height: 6, backgroundColor: C.border, borderRadius: 3, overflow: 'hidden' },
  coBarFill: { height: '100%', borderRadius: 3 },
  coBarPct: { fontSize: 11, fontFamily: 'Inter_600SemiBold', width: 36, textAlign: 'right' },

  coFooter: { gap: 4 },
  coContactItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  coContactText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted },

  filterToggleBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, alignSelf: 'flex-start',
    borderWidth: 1, borderColor: C.border, backgroundColor: C.bg,
  },
  filterToggleBtnText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.textMuted },

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
  delayedBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 8 },
  delayedBadgeText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.waiting },

  saveAttendanceBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.primaryBg, borderRadius: 12, paddingVertical: 12, marginBottom: 16,
    borderWidth: 1, borderColor: C.primary + '40',
  },
  saveAttendanceBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.primary },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalCard: { backgroundColor: C.surface, borderRadius: 18, padding: 20, width: '100%', maxWidth: 440, maxHeight: '88%', borderWidth: 1, borderColor: C.border },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  modalTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.text },
  workerModalSub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, marginBottom: 12 },

  colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 4 },
  colorDot: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  colorDotSelected: { borderWidth: 2.5, borderColor: '#fff', shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } },

  fieldLabel: {
    fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub,
    marginBottom: 6, marginTop: 12, textTransform: 'uppercase', letterSpacing: 0.4,
  },
  input: {
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, fontFamily: 'Inter_400Regular', color: C.text,
  },

  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepperBtn: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: C.primaryBg,
    borderWidth: 1, borderColor: C.primary + '40',
    alignItems: 'center', justifyContent: 'center',
  },
  stepperInput: { flex: 1, textAlign: 'center', fontSize: 22, fontFamily: 'Inter_700Bold' },

  confirmBtn: { backgroundColor: C.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 20 },
  confirmBtnDisabled: { opacity: 0.4 },
  confirmBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },
});
