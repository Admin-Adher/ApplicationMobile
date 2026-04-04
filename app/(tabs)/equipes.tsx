import {
  View, Text, StyleSheet, ScrollView, Platform, TouchableOpacity,
  Alert, Modal, TextInput, Linking,
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

export default function EquipesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, permissions } = useAuth();
  const {
    companies, tasks, reserves, stats, chantiers, activeChantierId,
    updateCompanyWorkers, updateCompanyHours,
  } = useApp();
  const { saveAttendanceSnapshot } = useSettings();
  const topPad = insets.top;
  const bottomPad = Platform.OS === 'web' ? 34 : insets.bottom;

  const [workerModal, setWorkerModal] = useState<{ id: string; name: string; current: number; hours: number } | null>(null);
  const [workerInput, setWorkerInput] = useState('');
  const [hoursInput, setHoursInput] = useState('');

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

  const presencePct = stats.plannedWorkers > 0
    ? Math.round((stats.totalWorkers / stats.plannedWorkers) * 100)
    : 0;

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
            <TouchableOpacity
              style={styles.manageBtn}
              onPress={() => router.push('/(tabs)/admin' as any)}
            >
              <Ionicons name="settings-outline" size={14} color={C.primary} />
              <Text style={styles.manageBtnLabel}>Gérer</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: bottomPad + 32 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* ── Empty state ── */}
        {companies.length === 0 && (
          <View style={styles.equipeEmptyWrap}>
            <View style={styles.equipeEmptyIconCircle}>
              <Ionicons name="people" size={38} color="#EC4899" />
            </View>
            <Text style={styles.equipeEmptyTitle}>Aucune entreprise enregistrée</Text>
            <Text style={styles.equipeEmptySubtitle}>
              Ajoutez les entreprises intervenantes dans l'Admin pour suivre les présences et les réserves de chantier.
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
              <TouchableOpacity
                style={styles.equipeEmptyBtn}
                onPress={() => router.push('/(tabs)/admin' as any)}
              >
                <Ionicons name="settings-outline" size={18} color="#fff" />
                <Text style={styles.equipeEmptyBtnText}>Gérer les entreprises dans l'Admin</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ── Summary ── */}
        {companies.length > 0 && (
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
                <View style={[styles.summaryBarFill, { width: `${Math.min(presencePct, 100)}%` as any }]} />
              </View>
              <Text style={styles.summaryBarPct}>{presencePct}%</Text>
            </View>
          </View>
        )}

        {/* ── Intervenants ── */}
        {companies.length > 0 && (
          <Text style={styles.sectionTitle}>Intervenants sur chantier ({companies.length})</Text>
        )}

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
            </View>
          );
        })}

        {/* ── Sauvegarder les présences ── */}
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

        {/* ── Lien vers gestion Admin ── */}
        {companies.length > 0 && permissions.canManageTeams && (
          <TouchableOpacity
            style={styles.adminLinkBtn}
            onPress={() => router.push('/(tabs)/admin' as any)}
          >
            <Ionicons name="settings-outline" size={15} color={C.textSub} />
            <Text style={styles.adminLinkBtnText}>Gérer les entreprises dans l'Admin</Text>
            <Ionicons name="chevron-forward" size={14} color={C.textMuted} />
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* ══ Pointage Modal ══ */}
      <Modal visible={!!workerModal} transparent animationType="fade" onRequestClose={() => setWorkerModal(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{workerModal?.name}</Text>
              <TouchableOpacity onPress={() => setWorkerModal(null)} hitSlop={8}>
                <Ionicons name="close-circle" size={24} color={C.textMuted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.workerModalSub}>Mettre à jour les présences du jour</Text>

            <Text style={styles.fieldLabel}>Personnes présentes</Text>
            <View style={styles.stepperRow}>
              <TouchableOpacity style={styles.stepperBtn} onPress={() => stepWorker(-1)}>
                <Ionicons name="remove" size={20} color={C.primary} />
              </TouchableOpacity>
              <TextInput
                style={[styles.input, styles.stepperInput]}
                value={workerInput}
                onChangeText={setWorkerInput}
                keyboardType="number-pad"
              />
              <TouchableOpacity style={styles.stepperBtn} onPress={() => stepWorker(1)}>
                <Ionicons name="add" size={20} color={C.primary} />
              </TouchableOpacity>
            </View>

            <Text style={[styles.fieldLabel, { marginTop: 16 }]}>Heures travaillées</Text>
            <View style={styles.stepperRow}>
              <TouchableOpacity style={styles.stepperBtn} onPress={() => stepHours(-1)}>
                <Ionicons name="remove" size={20} color={C.primary} />
              </TouchableOpacity>
              <TextInput
                style={[styles.input, styles.stepperInput]}
                value={hoursInput}
                onChangeText={setHoursInput}
                keyboardType="number-pad"
              />
              <TouchableOpacity style={styles.stepperBtn} onPress={() => stepHours(1)}>
                <Ionicons name="add" size={20} color={C.primary} />
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={[styles.confirmBtn, { marginTop: 20, alignSelf: 'stretch' }]} onPress={handleSaveWorkers}>
              <Text style={styles.confirmBtnText}>Enregistrer</Text>
            </TouchableOpacity>
          </View>
        </View>
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
  manageBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 10, borderWidth: 1, borderColor: C.primary + '40',
    backgroundColor: C.primaryBg,
  },
  manageBtnLabel: { color: C.primary, fontSize: 13, fontFamily: 'Inter_600SemiBold' },
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

  sectionTitle: {
    fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.textSub,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10,
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

  saveAttendanceBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.primaryBg, borderRadius: 12, paddingVertical: 12, marginBottom: 12,
    borderWidth: 1, borderColor: C.primary + '40',
  },
  saveAttendanceBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.primary },

  adminLinkBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.surface, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 16,
    borderWidth: 1, borderColor: C.border,
  },
  adminLinkBtnText: { flex: 1, fontSize: 14, fontFamily: 'Inter_500Medium', color: C.textSub },

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

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  modalCard: { backgroundColor: C.surface, borderRadius: 18, padding: 20, width: '100%', maxWidth: 380, borderWidth: 1, borderColor: C.border },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  modalTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.text },
  workerModalSub: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, marginBottom: 12 },

  fieldLabel: {
    fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub,
    marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4,
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

  confirmBtn: { backgroundColor: C.primary, borderRadius: 12, paddingVertical: 13, alignItems: 'center' },
  confirmBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },
});
