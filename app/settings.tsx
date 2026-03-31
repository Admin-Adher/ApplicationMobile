import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useState, useMemo } from 'react';
import { useRouter } from 'expo-router';
import { C } from '@/constants/colors';
import Header from '@/components/Header';
import { useSettings } from '@/context/SettingsContext';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useSubscription } from '@/context/SubscriptionContext';
import { AttendanceRecord } from '@/constants/types';

function groupByDate(records: AttendanceRecord[]): Record<string, AttendanceRecord[]> {
  const groups: Record<string, AttendanceRecord[]> = {};
  for (const r of records) {
    if (!groups[r.date]) groups[r.date] = [];
    groups[r.date].push(r);
  }
  return groups;
}

function formatDate(iso: string): string {
  const parts = iso.split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return iso;
}

const ROLE_COLORS: Record<string, string> = {
  super_admin: '#8B5CF6',
  admin:       '#EF4444',
  conducteur:  '#3B82F6',
  chef_equipe: '#10B981',
  observateur: '#6B7280',
};

const STATUS_COLORS = {
  trial:     { label: 'Essai',     color: '#F59E0B', bg: '#FFFBEB' },
  active:    { label: 'Actif',     color: '#10B981', bg: '#ECFDF5' },
  suspended: { label: 'Suspendu',  color: '#EF4444', bg: '#FEF2F2' },
  expired:   { label: 'Expiré',    color: '#6B7280', bg: '#F3F4F6' },
} as const;

export default function SettingsScreen() {
  const router = useRouter();
  const { projectName, projectDescription, setProjectName, setProjectDescription, attendanceHistory, saveAttendanceSnapshot, clearAttendanceHistory } = useSettings();
  const { companies } = useApp();
  const { user, logout } = useAuth();
  const { organization, plan, subscription, seatUsed, seatMax } = useSubscription();

  const [nameInput, setNameInput] = useState(projectName);
  const [descInput, setDescInput] = useState(projectDescription);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'compte' | 'project' | 'attendance'>('compte');

  const grouped = useMemo(() => {
    const g = groupByDate(attendanceHistory);
    return Object.entries(g).sort(([a], [b]) => b.localeCompare(a));
  }, [attendanceHistory]);

  const totalDays = Object.keys(groupByDate(attendanceHistory)).length;

  async function handleSave() {
    if (!nameInput.trim()) {
      Alert.alert('Champ requis', 'Le nom du projet est obligatoire.');
      return;
    }
    setSaving(true);
    await setProjectName(nameInput.trim());
    await setProjectDescription(descInput.trim());
    setSaving(false);
    Alert.alert('Enregistré', 'Les paramètres du projet ont été mis à jour.');
  }

  async function handleSaveAttendance() {
    if (companies.length === 0) {
      Alert.alert('Aucune entreprise', "Ajoutez d'abord des entreprises dans l'onglet Équipes.");
      return;
    }
    Alert.alert(
      'Sauvegarder les présences',
      `Enregistrer les présences du jour (${companies.reduce((a, c) => a + c.actualWorkers, 0)} personnes au total) dans l'historique ?`,
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
  }

  function handleClearHistory() {
    Alert.alert(
      "Effacer l'historique",
      `Supprimer définitivement l'historique des présences (${attendanceHistory.length} enregistrements) ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Effacer', style: 'destructive', onPress: () => clearAttendanceHistory() },
      ]
    );
  }

  function handleLogout() {
    Alert.alert(
      'Déconnexion',
      'Voulez-vous vraiment vous déconnecter ?',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Déconnexion', style: 'destructive', onPress: () => logout() },
      ]
    );
  }

  const statusCfg = subscription ? STATUS_COLORS[subscription.status] : STATUS_COLORS.trial;
  const seatRatio = seatMax === -1 ? 0 : seatUsed / seatMax;
  const seatBarColor = seatRatio >= 0.9 ? '#EF4444' : seatRatio >= 0.7 ? '#F59E0B' : '#10B981';
  const roleColor = ROLE_COLORS[user?.role ?? 'observateur'] ?? C.primary;
  const userInitials = user ? user.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() : '??';

  return (
    <View style={styles.container}>
      <Header title="Paramètres" subtitle="Compte & projet" showBack />

      <View style={styles.tabRow}>
        {[
          { key: 'compte',     icon: 'person-circle-outline', label: 'Compte' },
          { key: 'project',    icon: 'construct-outline',     label: 'Projet' },
          { key: 'attendance', icon: 'people-outline',        label: `Présences (${totalDays})` },
        ].map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tabBtn, activeTab === tab.key && styles.tabBtnActive]}
            onPress={() => setActiveTab(tab.key as any)}
          >
            <Ionicons name={tab.icon as any} size={14} color={activeTab === tab.key ? C.primary : C.textMuted} />
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {activeTab === 'compte' && (
          <View>
            <View style={styles.profileCard}>
              <View style={[styles.avatar, { backgroundColor: roleColor + '22' }]}>
                <Text style={[styles.avatarTxt, { color: roleColor }]}>{userInitials}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.userName}>{user?.name ?? '—'}</Text>
                <Text style={styles.userEmail}>{user?.email ?? '—'}</Text>
              </View>
              <View style={[styles.roleBadge, { backgroundColor: roleColor + '18' }]}>
                <Text style={[styles.roleBadgeTxt, { color: roleColor }]}>{user?.roleLabel ?? '—'}</Text>
              </View>
            </View>

            {organization && (
              <View style={styles.card}>
                <View style={styles.cardTitleRow}>
                  <Ionicons name="business-outline" size={16} color={C.primary} />
                  <Text style={styles.cardTitle}>Organisation</Text>
                </View>
                <Text style={styles.orgName}>{organization.name}</Text>
                <Text style={styles.orgSlug}>/{organization.slug}</Text>
              </View>
            )}

            {(user?.role === 'admin' || user?.role === 'super_admin' || plan) && (
              <TouchableOpacity style={styles.navRow} onPress={() => router.push('/subscription')}>
                <View style={[styles.navIcon, { backgroundColor: '#EFF6FF' }]}>
                  <Ionicons name="card-outline" size={18} color="#3B82F6" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.navLabel}>Abonnement</Text>
                  {plan && subscription && (
                    <View style={styles.navSub}>
                      <View style={[styles.statusDot, { backgroundColor: statusCfg.color }]} />
                      <Text style={[styles.navSubTxt, { color: statusCfg.color }]}>
                        {plan.name} · {statusCfg.label}
                      </Text>
                    </View>
                  )}
                  {plan && (
                    <View style={styles.seatMini}>
                      <View style={styles.seatMiniBar}>
                        <View style={[
                          styles.seatMiniBarFill,
                          {
                            width: seatMax === -1 ? '30%' : `${Math.min(seatRatio * 100, 100)}%` as any,
                            backgroundColor: seatBarColor,
                          }
                        ]} />
                      </View>
                      <Text style={styles.seatMiniTxt}>
                        {seatUsed}{seatMax === -1 ? ' / ∞' : ` / ${seatMax}`} sièges
                      </Text>
                    </View>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
              </TouchableOpacity>
            )}

            {user?.role === 'super_admin' && (
              <TouchableOpacity style={[styles.navRow, styles.navRowSpecial]} onPress={() => router.push('/superadmin')}>
                <View style={[styles.navIcon, { backgroundColor: '#F3E8FF' }]}>
                  <Ionicons name="shield" size={18} color="#8B5CF6" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.navLabel, { color: '#8B5CF6' }]}>Super Admin Dashboard</Text>
                  <Text style={styles.navSubPlain}>Gérer organisations et formules</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#8B5CF6" />
              </TouchableOpacity>
            )}

            <TouchableOpacity style={[styles.navRow, styles.navRowDanger]} onPress={handleLogout}>
              <View style={[styles.navIcon, { backgroundColor: '#FEF2F2' }]}>
                <Ionicons name="log-out-outline" size={18} color="#EF4444" />
              </View>
              <Text style={[styles.navLabel, { color: '#EF4444', flex: 1 }]}>Déconnexion</Text>
              <Ionicons name="chevron-forward" size={16} color="#EF4444" />
            </TouchableOpacity>
          </View>
        )}

        {activeTab === 'project' && (
          <View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Informations du projet</Text>

              <Text style={styles.label}>Nom du projet *</Text>
              <TextInput
                style={styles.input}
                value={nameInput}
                onChangeText={setNameInput}
                placeholder="Ex : Résidence Les Pins"
                placeholderTextColor={C.textMuted}
                maxLength={60}
              />

              <Text style={styles.label}>Description</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={descInput}
                onChangeText={setDescInput}
                placeholder="Ex : Chantier de construction — 48 logements"
                placeholderTextColor={C.textMuted}
                multiline
                numberOfLines={3}
                maxLength={200}
              />

              <TouchableOpacity
                style={[styles.saveBtn, saving && { opacity: 0.6 }]}
                onPress={handleSave}
                disabled={saving}
              >
                <Ionicons name="checkmark-circle" size={18} color="#fff" />
                <Text style={styles.saveBtnText}>{saving ? 'Enregistrement...' : 'Enregistrer'}</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.infoCard}>
              <View style={styles.infoRow}>
                <Ionicons name="information-circle-outline" size={16} color={C.primary} />
                <Text style={styles.infoText}>
                  Le nom du projet s'affiche dans le tableau de bord, les rapports PDF et l'écran Plus.
                </Text>
              </View>
            </View>
          </View>
        )}

        {activeTab === 'attendance' && (
          <View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Présences aujourd'hui</Text>
              {companies.length === 0 ? (
                <Text style={styles.emptyText}>Aucune entreprise configurée.</Text>
              ) : (
                companies.map(co => (
                  <View key={co.id} style={styles.coRow}>
                    <View style={[styles.coDot, { backgroundColor: co.color }]} />
                    <Text style={styles.coName}>{co.name}</Text>
                    <Text style={[styles.coVal, { color: co.color }]}>{co.actualWorkers} / {co.plannedWorkers}</Text>
                    <Text style={styles.coHours}>{co.hoursWorked}h</Text>
                  </View>
                ))
              )}
              <TouchableOpacity style={styles.snapshotBtn} onPress={handleSaveAttendance}>
                <Ionicons name="save-outline" size={16} color={C.primary} />
                <Text style={styles.snapshotBtnText}>Sauvegarder l'instantané du jour</Text>
              </TouchableOpacity>
            </View>

            {grouped.length === 0 ? (
              <View style={styles.emptyHistory}>
                <Ionicons name="time-outline" size={40} color={C.border} />
                <Text style={styles.emptyTitle}>Aucun historique</Text>
                <Text style={styles.emptyText}>
                  Appuyez sur "Sauvegarder l'instantané du jour" pour commencer à suivre les présences quotidiennes.
                </Text>
              </View>
            ) : (
              <>
                <View style={styles.historyHeader}>
                  <Text style={styles.historyTitle}>Historique ({totalDays} jours)</Text>
                  <TouchableOpacity onPress={handleClearHistory}>
                    <Text style={styles.clearText}>Tout effacer</Text>
                  </TouchableOpacity>
                </View>
                {grouped.map(([date, records]) => {
                  const totalWorkers = records.reduce((a, r) => a + r.workers, 0);
                  const totalHours = records.reduce((a, r) => a + r.hoursWorked, 0);
                  return (
                    <View key={date} style={styles.dayCard}>
                      <View style={styles.dayHeader}>
                        <Text style={styles.dayDate}>{formatDate(date)}</Text>
                        <Text style={styles.dayTotal}>{totalWorkers} pers. · {totalHours}h</Text>
                      </View>
                      {records.map(r => (
                        <View key={r.id} style={styles.recRow}>
                          <View style={[styles.coDot, { backgroundColor: r.companyColor }]} />
                          <Text style={styles.recName}>{r.companyName}</Text>
                          <Text style={[styles.recVal, { color: r.companyColor }]}>{r.workers} pers.</Text>
                          <Text style={styles.recHours}>{r.hoursWorked}h</Text>
                        </View>
                      ))}
                    </View>
                  );
                })}
              </>
            )}
            <View style={{ height: 40 }} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  tabRow: {
    flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.surface,
  },
  tabBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingVertical: 7, borderRadius: 10, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
  },
  tabBtnActive: { backgroundColor: C.primaryBg, borderColor: C.primary },
  tabText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textMuted },
  tabTextActive: { color: C.primary },

  content: { padding: 16, gap: 12 },

  profileCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: C.border,
    ...Platform.select({
      web: { boxShadow: '0 1px 4px rgba(0,0,0,0.06)' } as any,
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
    }),
  },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  avatarTxt: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  userName: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.text },
  userEmail: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
  roleBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  roleBadgeTxt: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },

  card: {
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: C.border, gap: 4,
    ...Platform.select({
      web: { boxShadow: '0 1px 4px rgba(0,0,0,0.06)' } as any,
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
    }),
  },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  cardTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text },
  orgName: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.text },
  orgSlug: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted },

  navRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.surface, borderRadius: 14, padding: 14,
    borderWidth: 1, borderColor: C.border,
    ...Platform.select({
      web: { boxShadow: '0 1px 4px rgba(0,0,0,0.06)' } as any,
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.06, shadowRadius: 4, elevation: 2 },
    }),
  },
  navRowSpecial: { borderColor: '#C084FC55' },
  navRowDanger: { borderColor: '#FCA5A555' },
  navIcon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  navLabel: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text },
  navSub: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  navSubTxt: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  navSubPlain: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1 },

  seatMini: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 },
  seatMiniBar: { flex: 1, height: 4, backgroundColor: C.border, borderRadius: 2, overflow: 'hidden' },
  seatMiniBarFill: { height: 4, borderRadius: 2 },
  seatMiniTxt: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },

  label: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 4, marginTop: 8 },
  input: {
    backgroundColor: C.surface2, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text, borderWidth: 1, borderColor: C.border,
  },
  textArea: { minHeight: 80, textAlignVertical: 'top' },

  saveBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 13, marginTop: 16 },
  saveBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  infoCard: { backgroundColor: C.primaryBg, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.primary + '30' },
  infoRow: { flexDirection: 'row', gap: 8 },
  infoText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.primary, lineHeight: 18 },

  coRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  coDot: { width: 8, height: 8, borderRadius: 4 },
  coName: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text },
  coVal: { fontSize: 13, fontFamily: 'Inter_600SemiBold', minWidth: 60, textAlign: 'right' },
  coHours: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, minWidth: 36, textAlign: 'right' },

  snapshotBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    backgroundColor: C.primaryBg, borderRadius: 10, paddingVertical: 12, marginTop: 12,
    borderWidth: 1, borderColor: C.primary + '40',
  },
  snapshotBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.primary },

  emptyHistory: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  emptyTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.text },
  emptyText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', maxWidth: 280, lineHeight: 18 },

  historyHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  historyTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.4 },
  clearText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.open },

  dayCard: { backgroundColor: C.surface, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.border },
  dayHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  dayDate: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  dayTotal: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.primary },

  recRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 5 },
  recName: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text },
  recVal: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  recHours: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, minWidth: 36, textAlign: 'right' },
});
