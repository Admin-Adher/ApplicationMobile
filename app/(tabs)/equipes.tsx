import {
  View, Text, StyleSheet, ScrollView, Platform, TouchableOpacity,
  Alert, Modal, TextInput, TouchableWithoutFeedback, Linking, KeyboardAvoidingView,
} from 'react-native';
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
import BottomSheetMultiPicker from '@/components/BottomSheetMultiPicker';

const COMPANY_COLORS = [
  '#3B82F6', '#F59E0B', '#8B5CF6', '#EC4899', '#EF4444',
  '#06B6D4', '#84CC16', '#10B981', '#F97316', '#6366F1',
];

export default function EquipesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, permissions } = useAuth();
  const {
    companies, tasks, reserves, stats, chantiers, activeChantierId, lots: projectLots,
    updateCompanyWorkers, addCompany, updateCompanyFull, deleteCompany, updateCompanyHours,
  } = useApp();
  const { saveAttendanceSnapshot } = useSettings();
  const topPad = insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const [modalVisible, setModalVisible] = useState(false);
  const [editTarget, setEditTarget] = useState<Company | null>(null);
  const [nom, setNom] = useState('');
  const [nomCourt, setNomCourt] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [zone, setZone] = useState('');
  const [selectedLotIds, setSelectedLotIds] = useState<string[]>([]);
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
  const [submitted, setSubmitted] = useState(false);

  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

  const totalHours = useMemo(() => companies.reduce((s, c) => s + c.hoursWorked, 0), [companies]);

  const companyStats = useMemo(() => {
    const map: Record<string, { openReserves: number; activeTasks: number }> = {};
    for (const co of companies) {
      map[co.id] = {
        openReserves: reserves.filter(r => {
          const names = r.companies ?? (r.company ? [r.company] : []);
          return names.includes(co.name) && r.status !== 'closed';
        }).length,
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
    setNom(''); setNomCourt(''); setPhone(''); setEmail(''); setZone(''); setSelectedLotIds([]);
    setEffectif(''); setHeures(''); setSiret(''); setInsurance(''); setQualifications('');
    setSelectedColor(COMPANY_COLORS[companies.length % COMPANY_COLORS.length]);
    setSubmitted(false);
    setModalVisible(true);
  }

  function openEdit(co: Company) {
    setEditTarget(co);
    setNom(co.name); setNomCourt(co.shortName); setPhone(co.phone ?? '');
    setEmail(co.email ?? ''); setZone(co.zone);
    const matchedIds = (co.lots ?? [])
      .map(name => projectLots.find(l => l.name === name || l.id === name)?.id ?? '')
      .filter(Boolean);
    setSelectedLotIds(matchedIds);
    setEffectif(String(co.plannedWorkers)); setHeures(String(co.hoursWorked));
    setSiret(co.siret ?? ''); setInsurance(co.insurance ?? ''); setQualifications(co.qualifications ?? '');
    setSelectedColor(co.color);
    setSubmitted(false);
    setModalVisible(true);
  }

  function handleClose() {
    setModalVisible(false); setEditTarget(null); setSubmitted(false);
    setNom(''); setNomCourt(''); setPhone(''); setEmail(''); setZone(''); setSelectedLotIds([]);
    setEffectif(''); setHeures(''); setSiret(''); setInsurance(''); setQualifications('');
  }

  function stepEffectif(delta: number) {
    const n = Math.max(0, (parseInt(effectif, 10) || 0) + delta);
    setEffectif(String(n));
  }

  function handleSave() {
    setSubmitted(true);
    if (!nom.trim() || !nomCourt.trim() || !effectif.trim()) return;
    const planned = parseInt(effectif, 10);
    if (isNaN(planned) || planned < 0) return;
    const hours = parseInt(heures, 10);
    const parsedLots = selectedLotIds.length > 0
      ? selectedLotIds.map(id => projectLots.find(l => l.id === id)?.name ?? id).filter(Boolean)
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
        phone: phone.trim() || undefined,
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
        phone: phone.trim() || undefined,
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
        {companies.length === 0 && (
          <View style={styles.equipeEmptyWrap}>
            <View style={styles.equipeEmptyIconCircle}>
              <Ionicons name="people" size={38} color="#EC4899" />
            </View>
            <Text style={styles.equipeEmptyTitle}>Aucune entreprise enregistrée</Text>
            <Text style={styles.equipeEmptySubtitle}>
              Ajoutez les entreprises intervenantes pour suivre les présences, tâches et réserves de chantier.
            </Text>
            <View style={styles.equipeEmptyFeatures}>
              <View style={styles.equipeEmptyFeatureRow}>
                <View style={[styles.equipeEmptyFeatureDot, { backgroundColor: '#EC4899' }]}>
                  <Ionicons name="people-outline" size={14} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.equipeEmptyFeatureTitle}>Gestion des présences</Text>
                  <Text style={styles.equipeEmptyFeatureDesc}>Saisissez les arrivées et départs de chaque équipe au quotidien.</Text>
                </View>
              </View>
              <View style={styles.equipeEmptyFeatureRow}>
                <View style={[styles.equipeEmptyFeatureDot, { backgroundColor: '#059669' }]}>
                  <Ionicons name="checkmark-circle-outline" size={14} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.equipeEmptyFeatureTitle}>Suivi des tâches</Text>
                  <Text style={styles.equipeEmptyFeatureDesc}>Associez des tâches par entreprise et visualisez l'avancement en temps réel.</Text>
                </View>
              </View>
              <View style={[styles.equipeEmptyFeatureRow, { borderBottomWidth: 0 }]}>
                <View style={[styles.equipeEmptyFeatureDot, { backgroundColor: '#0891B2' }]}>
                  <Ionicons name="warning-outline" size={14} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.equipeEmptyFeatureTitle}>Réserves & responsabilités</Text>
                  <Text style={styles.equipeEmptyFeatureDesc}>Retrouvez les réserves ouvertes par entreprise pour coordonner les interventions.</Text>
                </View>
              </View>
            </View>
            {permissions.canManageTeams && (
              <TouchableOpacity style={styles.equipeEmptyBtn} onPress={openAdd}>
                <Ionicons name="add-circle-outline" size={18} color="#fff" />
                <Text style={styles.equipeEmptyBtnText}>Ajouter une entreprise</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {companies.length > 0 && <View style={styles.summaryCard}>
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
        </View>}

        {/* ── Entreprises ── */}
        {companies.length > 0 && <Text style={styles.sectionTitle}>Entreprises sur chantier ({companies.length})</Text>}
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
                {co.phone ? (
                  <TouchableOpacity
                    style={styles.coContactItem}
                    onPress={() => Linking.openURL(`tel:${co.phone}`)}
                  >
                    <Ionicons name="call-outline" size={12} color={C.primary} />
                    <Text style={[styles.coContactText, { color: C.primary }]}>{co.phone}</Text>
                  </TouchableOpacity>
                ) : null}
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

              {/* Chantiers liés */}
              {(() => {
                const linkedChantiers = chantiers.filter(ch => ch.companyIds?.includes(co.id));
                if (linkedChantiers.length === 0) return null;
                return (
                  <View style={styles.chantierPillsSection}>
                    <View style={styles.chantierPillsHeader}>
                      <Ionicons name="business-outline" size={11} color={C.textMuted} />
                      <Text style={styles.chantierPillsLabel}>Chantiers</Text>
                    </View>
                    <View style={styles.chantierPillsRow}>
                      {linkedChantiers.map(ch => (
                        <View key={ch.id} style={[styles.chantierPill, ch.id === activeChantierId && { borderColor: co.color + '80', backgroundColor: co.color + '12' }]}>
                          <Text style={[styles.chantierPillText, ch.id === activeChantierId && { color: co.color }]} numberOfLines={1}>
                            {ch.name}{ch.id === activeChantierId ? ' ●' : ''}
                          </Text>
                        </View>
                      ))}
                    </View>
                  </View>
                );
              })()}

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
        {companies.length > 0 && <>
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
        </>}
      </ScrollView>

      {/* ══ Add / Edit Company Modal ══ */}
      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={handleClose}>
        <KeyboardAvoidingView style={styles.modalOverlay} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <TouchableWithoutFeedback onPress={handleClose}>
            <View style={StyleSheet.absoluteFill} />
          </TouchableWithoutFeedback>
          <View style={styles.modalCard}>

            {/* ── Header ── */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editTarget ? 'Modifier l\'entreprise' : 'Nouvelle entreprise'}</Text>
              <TouchableOpacity onPress={handleClose} hitSlop={8}>
                <Ionicons name="close-circle" size={24} color={C.textMuted} />
              </TouchableOpacity>
            </View>

            {/* ── Live preview ── */}
            <View style={[styles.modalPreview, { borderLeftColor: selectedColor }]}>
              <View style={[styles.modalPreviewDot, { backgroundColor: selectedColor }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.modalPreviewName} numberOfLines={1}>
                  {nom.trim() || 'Nom de l\'entreprise'}
                </Text>
                {zone.trim() ? <Text style={styles.modalPreviewZone} numberOfLines={1}>{zone.trim()}</Text> : null}
              </View>
              {nomCourt.trim() ? (
                <View style={[styles.modalPreviewBadge, { backgroundColor: selectedColor + '22' }]}>
                  <Text style={[styles.modalPreviewBadgeText, { color: selectedColor }]}>
                    {nomCourt.trim().toUpperCase()}
                  </Text>
                </View>
              ) : null}
              {effectif.trim() && parseInt(effectif, 10) > 0 ? (
                <View style={styles.modalPreviewWorkersBadge}>
                  <Ionicons name="people-outline" size={11} color={C.textSub} />
                  <Text style={styles.modalPreviewWorkersText}>{effectif}</Text>
                </View>
              ) : null}
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

              {/* ── Section Identité ── */}
              <Text style={styles.modalSection}>Identité</Text>

              <Text style={styles.fieldLabel}>Couleur de l'entreprise</Text>
              <View style={styles.colorRow}>
                {COMPANY_COLORS.map(c => (
                  <TouchableOpacity
                    key={c}
                    style={[styles.colorDot, { backgroundColor: c }, selectedColor === c && styles.colorDotSelected]}
                    onPress={() => setSelectedColor(c)}
                  >
                    {selectedColor === c && <Ionicons name="checkmark" size={16} color="#fff" />}
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.fieldLabel}>
                Nom de l'entreprise <Text style={styles.fieldRequired}>*</Text>
              </Text>
              <TextInput
                style={[styles.input, submitted && !nom.trim() && styles.inputError]}
                placeholder="Ex: VINCI Construction"
                placeholderTextColor={C.textMuted}
                value={nom}
                onChangeText={setNom}
                returnKeyType="next"
              />
              {submitted && !nom.trim() && <Text style={styles.fieldError}>Ce champ est requis</Text>}

              <Text style={styles.fieldLabel}>
                Sigle / Nom court <Text style={styles.fieldRequired}>*</Text>
              </Text>
              <TextInput
                style={[styles.input, submitted && !nomCourt.trim() && styles.inputError]}
                placeholder="Ex: VINCI"
                placeholderTextColor={C.textMuted}
                value={nomCourt}
                onChangeText={setNomCourt}
                autoCapitalize="characters"
                returnKeyType="next"
              />
              {submitted && !nomCourt.trim() && <Text style={styles.fieldError}>Ce champ est requis</Text>}

              <Text style={styles.fieldLabel}>
                Effectif prévu <Text style={styles.fieldRequired}>*</Text>
              </Text>
              <View style={[styles.stepperRow, submitted && !effectif.trim() && { opacity: 1 }]}>
                <TouchableOpacity style={styles.stepperBtn} onPress={() => stepEffectif(-1)}>
                  <Ionicons name="remove" size={20} color={C.primary} />
                </TouchableOpacity>
                <TextInput
                  style={[styles.input, styles.stepperInput, submitted && !effectif.trim() && styles.inputError]}
                  placeholder="0"
                  placeholderTextColor={C.textMuted}
                  value={effectif}
                  onChangeText={setEffectif}
                  keyboardType="numeric"
                  textAlign="center"
                />
                <TouchableOpacity style={styles.stepperBtn} onPress={() => stepEffectif(1)}>
                  <Ionicons name="add" size={20} color={C.primary} />
                </TouchableOpacity>
              </View>
              {submitted && !effectif.trim() && <Text style={styles.fieldError}>Ce champ est requis</Text>}

              {/* ── Section Localisation ── */}
              <View style={styles.modalSeparator} />
              <Text style={styles.modalSection}>Localisation & Intervention</Text>

              <Text style={styles.fieldLabel}>Zone / Bâtiment</Text>
              <TextInput
                style={styles.input}
                placeholder="Ex: Bâtiment B, Zone Nord"
                placeholderTextColor={C.textMuted}
                value={zone}
                onChangeText={setZone}
                returnKeyType="next"
              />

              {projectLots.length > 0 ? (
                <BottomSheetMultiPicker
                  label="Corps d'état / Lots travaux"
                  options={projectLots.map(lot => ({
                    label: `${lot.number ? `${lot.number}. ` : ''}${lot.name}`,
                    value: lot.id,
                    color: lot.color,
                  }))}
                  values={selectedLotIds}
                  onChange={setSelectedLotIds}
                  placeholder="Sélectionner les lots…"
                />
              ) : (
                <View style={styles.noLotsHint}>
                  <Ionicons name="information-circle-outline" size={14} color={C.textMuted} />
                  <Text style={styles.noLotsHintText}>
                    Aucun lot défini sur ce chantier. Créez des lots dans la gestion du chantier pour les associer ici.
                  </Text>
                </View>
              )}

              {editTarget && (
                <>
                  <Text style={styles.fieldLabel}>Heures cumulées</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Ex: 120"
                    placeholderTextColor={C.textMuted}
                    value={heures}
                    onChangeText={setHeures}
                    keyboardType="numeric"
                    returnKeyType="next"
                  />
                </>
              )}

              {/* ── Section Contact ── */}
              <View style={styles.modalSeparator} />
              <Text style={styles.modalSection}>Contact</Text>

              <Text style={styles.fieldLabel}>Téléphone</Text>
              <TextInput
                style={styles.input}
                placeholder="Ex: 06 12 34 56 78"
                placeholderTextColor={C.textMuted}
                value={phone}
                onChangeText={setPhone}
                keyboardType="phone-pad"
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
                returnKeyType="next"
              />

              {/* ── Section Administratif ── */}
              <View style={styles.modalSeparator} />
              <Text style={styles.modalSection}>Administratif</Text>

              <Text style={styles.fieldLabel}>Numéro SIRET</Text>
              <TextInput
                style={styles.input}
                placeholder="Ex: 123 456 789 00012"
                placeholderTextColor={C.textMuted}
                value={siret}
                onChangeText={setSiret}
                returnKeyType="next"
              />

              <Text style={styles.fieldLabel}>Assurance décennale</Text>
              <TextInput
                style={styles.input}
                placeholder="Ex: AXA — Police n°12345"
                placeholderTextColor={C.textMuted}
                value={insurance}
                onChangeText={setInsurance}
                returnKeyType="next"
              />

              <Text style={styles.fieldLabel}>Qualifications / Certifications</Text>
              <TextInput
                style={[styles.input, { minHeight: 72, textAlignVertical: 'top' }]}
                placeholder="Ex: RGE, Qualibat 2111, MASE..."
                placeholderTextColor={C.textMuted}
                value={qualifications}
                onChangeText={setQualifications}
                multiline
                numberOfLines={3}
              />

              <View style={{ height: 8 }} />
            </ScrollView>

            {/* ── Sticky footer ── */}
            <View style={styles.modalFooter}>
              <TouchableOpacity style={[styles.modalCancelBtn, { flex: 1 }]} onPress={handleClose}>
                <Text style={styles.modalCancelBtnText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.confirmBtn, { flex: 1 }]} onPress={handleSave}>
                <Text style={styles.confirmBtnText}>
                  {editTarget ? 'Enregistrer' : 'Ajouter'}
                </Text>
              </TouchableOpacity>
            </View>

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

            <TouchableOpacity style={[styles.confirmBtn, { marginTop: 20, alignSelf: 'stretch' }]} onPress={handleSaveWorkers}>
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

  chantierPillsSection: { marginTop: 8, marginBottom: 4 },
  chantierPillsHeader: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 5 },
  chantierPillsLabel: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.5 },
  chantierPillsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chantierPill: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 10, borderWidth: 1, borderColor: C.border, backgroundColor: C.surface2 },
  chantierPillText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.textSub },

  filterToggleBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 10,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, alignSelf: 'flex-start',
    borderWidth: 1, borderColor: C.border, backgroundColor: C.bg,
  },
  filterToggleBtnText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.textMuted },

  emptyBox: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center' },

  equipeEmptyWrap: { alignItems: 'center', paddingTop: 32, paddingBottom: 24, paddingHorizontal: 8 },
  equipeEmptyIconCircle: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: '#EC489918',
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 20,
  },
  equipeEmptyTitle: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.text, textAlign: 'center', marginBottom: 8 },
  equipeEmptySubtitle: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textSub, textAlign: 'center', lineHeight: 20, marginBottom: 24, paddingHorizontal: 8 },
  equipeEmptyFeatures: {
    width: '100%', borderWidth: 1, borderColor: C.border, borderRadius: 14,
    backgroundColor: C.surface, overflow: 'hidden', marginBottom: 28,
  },
  equipeEmptyFeatureRow: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 14,
    paddingVertical: 14, paddingHorizontal: 16,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  equipeEmptyFeatureDot: {
    width: 32, height: 32, borderRadius: 16,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1,
  },
  equipeEmptyFeatureTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 2 },
  equipeEmptyFeatureDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, lineHeight: 17 },
  equipeEmptyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.primary, borderRadius: 14,
    paddingVertical: 14, paddingHorizontal: 28,
  },
  equipeEmptyBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },

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
  colorDot: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  colorDotSelected: { borderWidth: 3, borderColor: '#fff', ...Platform.select({ web: { boxShadow: '0 0 0 2px rgba(0,0,0,0.25)' } as any, default: { shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 4, shadowOffset: { width: 0, height: 2 } } }) },

  fieldLabel: {
    fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub,
    marginBottom: 6, marginTop: 12, textTransform: 'uppercase', letterSpacing: 0.4,
  },
  fieldRequired: { color: C.open, fontFamily: 'Inter_700Bold' },
  fieldHint: { color: C.textMuted, fontSize: 11, fontFamily: 'Inter_400Regular', textTransform: 'none', letterSpacing: 0 },
  fieldError: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.open, marginTop: 4 },

  input: {
    backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10, fontSize: 15, fontFamily: 'Inter_400Regular', color: C.text,
  },
  inputError: { borderColor: C.open, backgroundColor: '#FFF5F5' },

  modalSection: {
    fontSize: 11, fontFamily: 'Inter_700Bold', color: C.textMuted,
    textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 4, marginBottom: 2,
  },
  modalSeparator: { height: 1, backgroundColor: C.border, marginTop: 20, marginBottom: 16, marginHorizontal: -20 },

  modalPreview: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: C.surface2, borderRadius: 10, padding: 12, marginBottom: 16,
    borderLeftWidth: 4,
  },
  modalPreviewDot: { width: 36, height: 36, borderRadius: 18, flexShrink: 0 },
  modalPreviewName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  modalPreviewZone: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  modalPreviewBadge: { paddingHorizontal: 9, paddingVertical: 4, borderRadius: 8 },
  modalPreviewBadgeText: { fontSize: 12, fontFamily: 'Inter_700Bold' },
  modalPreviewWorkersBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: C.border, paddingHorizontal: 7, paddingVertical: 4, borderRadius: 8 },
  modalPreviewWorkersText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.textSub },

  modalFooter: {
    flexDirection: 'row', gap: 10, paddingTop: 14, paddingBottom: 2,
    borderTopWidth: 1, borderTopColor: C.border, marginTop: 4,
  },
  modalCancelBtn: {
    borderRadius: 12, paddingVertical: 13, alignItems: 'center',
    backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border,
  },
  modalCancelBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.textSub },

  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stepperBtn: {
    width: 44, height: 44, borderRadius: 12, backgroundColor: C.primaryBg,
    borderWidth: 1, borderColor: C.primary + '40',
    alignItems: 'center', justifyContent: 'center',
  },
  stepperInput: { flex: 1, textAlign: 'center', fontSize: 22, fontFamily: 'Inter_700Bold' },

  confirmBtn: { backgroundColor: C.primary, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  confirmBtnDisabled: { opacity: 0.4 },
  confirmBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  noLotsHint: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: C.surface2, borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: C.border, marginBottom: 14, marginTop: 8,
  },
  noLotsHintText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, lineHeight: 17 },
});
