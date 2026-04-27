import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert, Platform, KeyboardAvoidingView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'expo-router';
import { C } from '@/constants/colors';
import Header from '@/components/Header';
import { useSettings } from '@/context/SettingsContext';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useSubscription } from '@/context/SubscriptionContext';
import { AttendanceRecord } from '@/constants/types';
import BottomNavBar from '@/components/BottomNavBar';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { useNetwork } from '@/context/NetworkContext';

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
  super_admin:  '#8B5CF6',
  admin:        '#EF4444',
  conducteur:   '#3B82F6',
  chef_equipe:  '#F59E0B',
  observateur:  '#6B7280',
  sous_traitant:'#10B981',
};

const STATUS_COLORS = {
  trial:     { label: 'Essai',     color: '#F59E0B', bg: '#FFFBEB' },
  active:    { label: 'Actif',     color: '#10B981', bg: '#ECFDF5' },
  suspended: { label: 'Suspendu',  color: '#EF4444', bg: '#FEF2F2' },
  expired:   { label: 'Expiré',    color: '#6B7280', bg: '#F3F4F6' },
} as const;

export default function SettingsScreen() {
  const router = useRouter();
  const { projectName, projectDescription, setProjectName, setProjectDescription, attendanceHistory, saveAttendanceSnapshot, clearAttendanceHistory, defaultArrivalTime, setDefaultArrivalTime, standardDayHours, setStandardDayHours } = useSettings();
  const { companies } = useApp();
  const { user, logout, permissions } = useAuth();
  const { organization, plan, subscription, seatUsed, seatMax } = useSubscription();
  const { queue, queueCount, isOnline, syncStatus, syncProgress, clearQueue, retrySync } = useNetwork();

  const [nameInput, setNameInput] = useState(projectName);
  const [descInput, setDescInput] = useState(projectDescription);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'compte' | 'project' | 'attendance' | 'integrations'>('compte');
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const isSousTraitant = user?.role === 'sous_traitant';

  type DiagState = {
    loading: boolean;
    sessionUserId: string | null;
    sessionExpiresAt: number | null;
    serverRole: string | null;
    serverOrgId: string | null;
    error: string | null;
  } | null;
  const [diag, setDiag] = useState<DiagState>(null);
  const [diagOpen, setDiagOpen] = useState(false);

  useEffect(() => {
    if (queueCount > 0 && !diagOpen) {
      setDiagOpen(true);
      runDiagnostic();
    }
  }, [queueCount]);

  async function runDiagnostic() {
    setDiag({ loading: true, sessionUserId: null, sessionExpiresAt: null, serverRole: null, serverOrgId: null, error: null });
    if (!isSupabaseConfigured) {
      setDiag({ loading: false, sessionUserId: null, sessionExpiresAt: null, serverRole: null, serverOrgId: null, error: 'Supabase non configuré (mode hors-ligne).' });
      return;
    }
    try {
      const { data: { session } } = await (supabase as any).auth.getSession();
      if (!session?.user?.id) {
        setDiag({ loading: false, sessionUserId: null, sessionExpiresAt: null, serverRole: null, serverOrgId: null, error: 'Aucune session active. Reconnectez-vous.' });
        return;
      }
      const { data: profile, error: profErr } = await (supabase as any)
        .from('profiles')
        .select('organization_id, role')
        .eq('id', session.user.id)
        .single();
      if (profErr) {
        setDiag({ loading: false, sessionUserId: session.user.id, sessionExpiresAt: session.expires_at ?? null, serverRole: null, serverOrgId: null, error: `Profil introuvable côté serveur (${profErr.message}).` });
        return;
      }
      setDiag({
        loading: false,
        sessionUserId: session.user.id,
        sessionExpiresAt: session.expires_at ?? null,
        serverRole: profile?.role ?? null,
        serverOrgId: profile?.organization_id ?? null,
        error: null,
      });
    } catch (err: any) {
      setDiag({ loading: false, sessionUserId: null, sessionExpiresAt: null, serverRole: null, serverOrgId: null, error: err?.message ?? 'Erreur inconnue.' });
    }
  }

  function toggleDiag() {
    if (!diagOpen) {
      setDiagOpen(true);
      runDiagnostic();
    } else {
      setDiagOpen(false);
    }
  }

  const diagIssues: { level: 'error' | 'warn'; msg: string }[] = [];
  if (diag && !diag.loading && !diag.error) {
    const allowedRoles = ['admin', 'conducteur', 'chef_equipe', 'super_admin'];
    if (diag.serverOrgId && user?.organizationId && diag.serverOrgId !== user.organizationId) {
      diagIssues.push({ level: 'error', msg: `Organisation locale (${user.organizationId.slice(0, 8)}…) ≠ serveur (${diag.serverOrgId.slice(0, 8)}…). Reconnectez-vous.` });
    }
    if (!diag.serverOrgId && diag.serverRole !== 'super_admin') {
      diagIssues.push({ level: 'error', msg: "Votre profil serveur n'a pas d'organisation. Vous ne pouvez ni créer ni voir de réserves." });
    }
    if (diag.serverRole && diag.serverRole !== user?.role) {
      diagIssues.push({ level: 'warn', msg: `Rôle local (${user?.role}) ≠ rôle serveur (${diag.serverRole}). Reconnectez-vous pour rafraîchir.` });
    }
    if (diag.serverRole && !allowedRoles.includes(diag.serverRole)) {
      diagIssues.push({ level: 'warn', msg: `Rôle ${diag.serverRole} : lecture seule (création de réserves/tâches impossible).` });
    }
    if (diag.sessionExpiresAt && diag.sessionExpiresAt * 1000 < Date.now()) {
      diagIssues.push({ level: 'error', msg: 'Session JWT expirée. Reconnectez-vous.' });
    }
  }
  if (queueCount > 0) {
    diagIssues.push({
      level: 'warn',
      msg: `${queueCount} opération${queueCount > 1 ? 's' : ''} en attente de synchronisation${!isOnline ? ' (hors ligne)' : ''}.`,
    });
  }
  const diagOk = diag && !diag.loading && !diag.error && diagIssues.length === 0;

  function handleClearQueue() {
    if (queueCount === 0) return;
    Alert.alert(
      'Vider la file de synchronisation',
      `${queueCount} opération${queueCount > 1 ? 's' : ''} bloquée${queueCount > 1 ? 's' : ''} ${queueCount > 1 ? 'seront supprimées' : 'sera supprimée'} sans être envoyée${queueCount > 1 ? 's' : ''} au serveur. Cette action est irréversible.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Vider',
          style: 'destructive',
          onPress: async () => {
            await clearQueue();
            Alert.alert('File vidée', 'Les opérations en attente ont été supprimées.');
          },
        },
      ],
    );
  }

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
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Header title="Paramètres" subtitle="Compte & projet" showBack />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroll} contentContainerStyle={styles.tabRow}>
        {[
          { key: 'compte',       icon: 'person-circle-outline', label: 'Compte' },
          { key: 'project',      icon: 'construct-outline',     label: 'Projet' },
          ...(!isSousTraitant ? [{ key: 'attendance', icon: 'people-outline', label: `Présences (${totalDays})` }] : []),
          { key: 'integrations', icon: 'apps-outline',          label: 'Intégrations BTP' },
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
      </ScrollView>

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

            {(user?.role === 'admin' || user?.role === 'super_admin') && (
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

            <TouchableOpacity style={styles.navRow} onPress={toggleDiag}>
              <View style={[styles.navIcon, { backgroundColor: diagOk ? '#ECFDF5' : (diag && (diag.error || diagIssues.length > 0) ? '#FEF2F2' : '#F3F4F6') }]}>
                <Ionicons
                  name={diagOk ? 'checkmark-circle' : (diag && (diag.error || diagIssues.length > 0) ? 'warning' : 'pulse-outline')}
                  size={18}
                  color={diagOk ? '#10B981' : (diag && (diag.error || diagIssues.length > 0) ? '#EF4444' : C.textMuted)}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.navLabel}>Diagnostic du compte</Text>
                <Text style={styles.navSubPlain}>
                  {diagOk ? 'Tout est synchronisé avec le serveur'
                    : diag?.error ? diag.error
                    : diag && diagIssues.length > 0 ? `${diagIssues.length} problème${diagIssues.length > 1 ? 's' : ''} détecté${diagIssues.length > 1 ? 's' : ''}`
                    : 'Vérifier la cohérence local ↔ serveur'}
                </Text>
              </View>
              <Ionicons name={diagOpen ? 'chevron-up' : 'chevron-down'} size={16} color={C.textMuted} />
            </TouchableOpacity>

            {diagOpen && (
              <View style={[styles.card, { marginTop: 8 }]}>
                {diag?.loading && (
                  <Text style={styles.emptyText}>Vérification en cours…</Text>
                )}
                {diag && !diag.loading && (
                  <>
                    <View style={styles.diagRow}>
                      <Text style={styles.diagLabel}>ID utilisateur</Text>
                      <Text style={styles.diagValue} numberOfLines={1}>{user?.id ?? '—'}</Text>
                    </View>
                    <View style={styles.diagRow}>
                      <Text style={styles.diagLabel}>Rôle (local)</Text>
                      <Text style={styles.diagValue}>{user?.role ?? '—'}</Text>
                    </View>
                    <View style={styles.diagRow}>
                      <Text style={styles.diagLabel}>Rôle (serveur)</Text>
                      <Text style={styles.diagValue}>{diag.serverRole ?? '—'}</Text>
                    </View>
                    <View style={styles.diagRow}>
                      <Text style={styles.diagLabel}>Organisation (local)</Text>
                      <Text style={styles.diagValue} numberOfLines={1}>{user?.organizationId ?? '—'}</Text>
                    </View>
                    <View style={styles.diagRow}>
                      <Text style={styles.diagLabel}>Organisation (serveur)</Text>
                      <Text style={styles.diagValue} numberOfLines={1}>{diag.serverOrgId ?? '—'}</Text>
                    </View>
                    <View style={styles.diagRow}>
                      <Text style={styles.diagLabel}>Session</Text>
                      <Text style={styles.diagValue}>
                        {diag.sessionUserId
                          ? (diag.sessionExpiresAt && diag.sessionExpiresAt * 1000 > Date.now()
                              ? `Active (expire ${new Date(diag.sessionExpiresAt * 1000).toLocaleString('fr-FR')})`
                              : 'Expirée')
                          : 'Aucune'}
                      </Text>
                    </View>

                    {diag.error && (
                      <View style={styles.diagAlertError}>
                        <Ionicons name="close-circle" size={16} color="#EF4444" />
                        <Text style={styles.diagAlertTextError}>{diag.error}</Text>
                      </View>
                    )}
                    {diagIssues.map((issue, i) => (
                      <View key={i} style={issue.level === 'error' ? styles.diagAlertError : styles.diagAlertWarn}>
                        <Ionicons name={issue.level === 'error' ? 'close-circle' : 'alert-circle'} size={16} color={issue.level === 'error' ? '#EF4444' : '#F59E0B'} />
                        <Text style={issue.level === 'error' ? styles.diagAlertTextError : styles.diagAlertTextWarn}>{issue.msg}</Text>
                      </View>
                    ))}
                    {diagOk && (
                      <View style={styles.diagAlertOk}>
                        <Ionicons name="checkmark-circle" size={16} color="#10B981" />
                        <Text style={styles.diagAlertTextOk}>Profil local et serveur synchronisés. Création de réserves autorisée.</Text>
                      </View>
                    )}

                    {queueCount > 0 && (
                      <View style={styles.queueBlock}>
                        <View style={styles.queueHeaderRow}>
                          <Ionicons
                            name={syncStatus === 'syncing' ? 'sync' : (isOnline ? 'cloud-upload-outline' : 'cloud-offline-outline')}
                            size={14}
                            color="#F59E0B"
                          />
                          <Text style={styles.queueHeaderTxt}>
                            File de synchronisation ({queueCount})
                          </Text>
                        </View>
                        <Text style={styles.queueHint}>
                          {isOnline
                            ? 'Ces opérations attendent d\'être envoyées au serveur. Si elles restent bloquées, elles ont probablement été refusées (ex. permission RLS, données invalides) et peuvent être vidées.'
                            : 'Hors ligne — les opérations seront envoyées dès le retour de la connexion.'}
                        </Text>
                        {queue.slice(0, 5).map((op) => (
                          <View key={op.id} style={styles.queueItem}>
                            <View style={styles.queueItemDot} />
                            <View style={{ flex: 1 }}>
                              <Text style={styles.queueItemTitle} numberOfLines={1}>
                                {op.op.toUpperCase()} · {op.table}
                              </Text>
                              <Text style={styles.queueItemMeta} numberOfLines={1}>
                                {new Date(op.queuedAt).toLocaleString('fr-FR')}
                              </Text>
                            </View>
                          </View>
                        ))}
                        {queue.length > 5 && (
                          <Text style={styles.queueMore}>+ {queue.length - 5} autre{queue.length - 5 > 1 ? 's' : ''}…</Text>
                        )}
                        <View style={styles.queueActionsRow}>
                          <TouchableOpacity
                            style={[styles.queueRetryBtn, (!isOnline || syncStatus === 'syncing') && styles.queueBtnDisabled]}
                            onPress={() => { if (isOnline && syncStatus !== 'syncing') retrySync(); }}
                            disabled={!isOnline || syncStatus === 'syncing'}
                          >
                            <Ionicons
                              name={syncStatus === 'syncing' ? 'sync' : 'refresh'}
                              size={14}
                              color={!isOnline || syncStatus === 'syncing' ? '#9CA3AF' : '#10B981'}
                            />
                            <Text style={[styles.queueRetryTxt, (!isOnline || syncStatus === 'syncing') && styles.queueBtnDisabledTxt]}>
                              {syncStatus === 'syncing'
                                ? (syncProgress.total > 0 ? `Sync ${syncProgress.done}/${syncProgress.total}` : 'Sync…')
                                : !isOnline ? 'Hors ligne' : 'Réessayer'}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity style={styles.queueClearBtn} onPress={handleClearQueue}>
                            <Ionicons name="trash-outline" size={14} color="#EF4444" />
                            <Text style={styles.queueClearTxt}>Vider</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    )}

                    <TouchableOpacity style={styles.diagRefreshBtn} onPress={runDiagnostic}>
                      <Ionicons name="refresh" size={14} color={C.primary} />
                      <Text style={styles.diagRefreshTxt}>Relancer le diagnostic</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
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
            {isAdmin && (
              <View style={styles.statsGrid}>
                {[
                  { icon: 'warning-outline', label: 'Réserves', val: companies.length > 0 ? '—' : '0', color: C.waiting },
                  { icon: 'people-outline', label: 'Entreprises', val: String(companies.length), color: C.primary },
                  { icon: 'folder-open-outline', label: 'Documents', val: '—', color: C.inProgress },
                  { icon: 'shield-outline', label: 'Incidents', val: '—', color: '#EF4444' },
                ].map(s => (
                  <View key={s.label} style={styles.statBox}>
                    <Ionicons name={s.icon as any} size={20} color={s.color} />
                    <Text style={[styles.statNum, { color: s.color }]}>{s.val}</Text>
                    <Text style={styles.statLbl}>{s.label}</Text>
                  </View>
                ))}
              </View>
            )}

            {isAdmin && (
              <View style={[styles.card, { marginBottom: 14 }]}>
                <Text style={styles.cardTitle}>Accès rapide</Text>
                {[
                  { icon: 'people', label: 'Gérer les équipes', route: '/(tabs)/equipes', color: '#EC4899' },
                  { icon: 'document-text', label: 'Rapports chantier', route: '/rapports', color: C.verification },
                  { icon: 'map', label: 'Plans interactifs', route: '/(tabs)/plans', color: C.closed },
                  { icon: 'calendar', label: 'Planning des tâches', route: '/planning', color: C.primary },
                ].map(item => (
                  <TouchableOpacity key={item.label} style={styles.quickRow} onPress={() => router.push(item.route as any)}>
                    <View style={[styles.quickIcon, { backgroundColor: item.color + '18' }]}>
                      <Ionicons name={item.icon as any} size={16} color={item.color} />
                    </View>
                    <Text style={styles.quickLabel}>{item.label}</Text>
                    <Ionicons name="chevron-forward" size={14} color={C.textMuted} />
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {isAdmin ? (
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
            ) : (
              <View style={[styles.card, { alignItems: 'center', paddingVertical: 28 }]}>
                <Ionicons name="lock-closed-outline" size={32} color={C.textMuted} />
                <Text style={[styles.cardTitle, { marginTop: 10, textAlign: 'center' }]}>Paramètres projet réservés aux administrateurs</Text>
                <Text style={[styles.emptyText, { textAlign: 'center', marginTop: 4 }]}>Nom du projet : {projectName}</Text>
              </View>
            )}

            <View style={styles.infoCard}>
              <View style={styles.infoRow}>
                <Ionicons name="information-circle-outline" size={16} color={C.primary} />
                <Text style={styles.infoText}>
                  Le nom du projet s'affiche dans le tableau de bord, les rapports PDF et l'écran Modules.
                </Text>
              </View>
            </View>
          </View>
        )}

        {activeTab === 'attendance' && !isSousTraitant && (
          <View>
            <View style={[styles.card, { marginBottom: 14 }]}>
              <Text style={styles.cardTitle}>Préférences pointage</Text>

              <Text style={styles.label}>Heure d'arrivée par défaut</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                {['06:30', '07:00', '07:30', '08:00', '08:30'].map(t => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.timeChip, defaultArrivalTime === t && styles.timeChipActive]}
                    onPress={() => setDefaultArrivalTime(t)}
                  >
                    <Text style={[styles.timeChipText, defaultArrivalTime === t && styles.timeChipTextActive]}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={[styles.emptyText, { marginTop: 6 }]}>Utilisée comme valeur pré-remplie dans le formulaire de pointage.</Text>

              <View style={{ height: 1, backgroundColor: C.border, marginVertical: 14 }} />

              <Text style={styles.label}>Durée journée standard</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
                {[6, 7, 8, 9, 10].map(h => (
                  <TouchableOpacity
                    key={h}
                    style={[styles.timeChip, standardDayHours === h && styles.timeChipActive]}
                    onPress={() => setStandardDayHours(h)}
                  >
                    <Text style={[styles.timeChipText, standardDayHours === h && styles.timeChipTextActive]}>{h}h</Text>
                  </TouchableOpacity>
                ))}
              </View>
              <Text style={[styles.emptyText, { marginTop: 6 }]}>
                Utilisée pour estimer automatiquement les heures lors du pointage rapide — les heures s'affichent en lecture seule (présents × durée journée).
              </Text>
            </View>

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
              {permissions.canUpdateAttendance && (
                <TouchableOpacity style={styles.snapshotBtn} onPress={handleSaveAttendance}>
                  <Ionicons name="save-outline" size={16} color={C.primary} />
                  <Text style={styles.snapshotBtnText}>Sauvegarder l'instantané du jour</Text>
                </TouchableOpacity>
              )}
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
                  {permissions.canUpdateAttendance && (
                    <TouchableOpacity onPress={handleClearHistory}>
                      <Text style={styles.clearText}>Tout effacer</Text>
                    </TouchableOpacity>
                  )}
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

        {activeTab === 'integrations' && (
          <View>
            {!isAdmin ? (
              <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 60, paddingHorizontal: 32 }}>
                <Ionicons name="lock-closed-outline" size={40} color={C.textMuted} />
                <Text style={[styles.cardTitle, { marginTop: 14, textAlign: 'center' }]}>Accès réservé aux administrateurs</Text>
                <Text style={[styles.emptyText, { textAlign: 'center', marginTop: 6 }]}>
                  La gestion des intégrations BTP requiert les droits administrateur.
                </Text>
              </View>
            ) : (<>
            {(subscription?.status === 'suspended' || subscription?.status === 'expired') && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#FEF2F2', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#FCA5A5', marginBottom: 12 }}>
                <Ionicons name={subscription.status === 'expired' ? 'time-outline' : 'pause-circle-outline'} size={20} color="#EF4444" />
                <Text style={{ flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: '#EF4444', lineHeight: 18 }}>
                  {subscription.status === 'expired'
                    ? 'Votre abonnement a expiré. Renouvelez-le pour configurer les intégrations.'
                    : 'Votre abonnement est suspendu. Contactez le support pour le réactiver.'}
                </Text>
              </View>
            )}
            <View style={styles.integroBanner}>
              <Ionicons name="apps" size={28} color={C.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.introBannerTitle}>Écosystème BTP</Text>
                <Text style={styles.introBannerSub}>10 intégrations disponibles — Procore, Revit, Kizeo, Météo-France…</Text>
              </View>
            </View>
            {[
              { icon: 'construct-outline',        label: 'Gestion de projet',              desc: 'Procore',               color: C.primary },
              { icon: 'cube-outline',             label: 'BIM / CAO',                     desc: 'ArchiCAD, Autodesk Revit', color: '#7C3AED' },
              { icon: 'document-text-outline',    label: 'Documents réglementaires',      desc: 'e-Diffusion BTP',       color: '#0891B2' },
              { icon: 'location-outline',         label: 'Géolocalisation',               desc: 'Géosat GPS',            color: '#059669' },
              { icon: 'receipt-outline',          label: 'Formulaires terrain',           desc: 'Kizeo Forms',           color: C.inProgress },
              { icon: 'cloud-outline',            label: 'GED & Signature',               desc: 'DocuWare, Signaturit',  color: '#BE185D' },
              { icon: 'partly-sunny-outline',     label: 'Météo & RH',                    desc: 'Météo-France, URSSAF',  color: '#F59E0B' },
            ].map(item => (
              <View key={item.label} style={[styles.integroCard, { marginBottom: 8 }]}>
                <View style={[styles.integroSectionIcon, { backgroundColor: item.color + '18', marginRight: 10 }]}>
                  <Ionicons name={item.icon as any} size={14} color={item.color} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.integroName}>{item.label}</Text>
                  <Text style={styles.integroDesc}>{item.desc}</Text>
                </View>
              </View>
            ))}
            <TouchableOpacity
              style={[styles.saveBtn, { marginTop: 8 }]}
              onPress={() => router.push('/integrations')}
            >
              <Ionicons name="apps-outline" size={18} color="#fff" />
              <Text style={styles.saveBtnText}>Gérer les intégrations</Text>
            </TouchableOpacity>
            <View style={{ height: 40 }} />
            </>
            )}
          </View>
        )}
      </ScrollView>
      <BottomNavBar />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  tabScroll: {
    borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.surface,
    height: 52, flexShrink: 0, flexGrow: 0,
  },
  tabRow: {
    flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingVertical: 8,
    alignItems: 'center',
  },
  tabBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    paddingVertical: 7, paddingHorizontal: 12, borderRadius: 10, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
    flexShrink: 0,
  },
  tabBtnActive: { backgroundColor: C.primaryBg, borderColor: C.primary },
  tabText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textMuted },
  tabTextActive: { color: C.primary },

  integroBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: C.primaryBg, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: C.primary + '30', marginBottom: 16,
  },
  introBannerTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.text },
  introBannerSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },

  integroSection: { marginBottom: 16 },
  integroSectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  integroSectionIcon: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  integroSectionTitle: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.4 },

  integroCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.surface, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: C.border, marginBottom: 8, gap: 10,
  },
  integroCardLeft: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 },
  integroBadge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, alignItems: 'center', justifyContent: 'center', minWidth: 44 },
  integroBadgeText: { fontSize: 9, fontFamily: 'Inter_700Bold', textTransform: 'uppercase', letterSpacing: 0.4 },
  integroName: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text },
  integroDesc: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2, lineHeight: 15 },
  integroToggle: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.bg,
  },
  integroToggleText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textMuted },

  integroFooter: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 8,
    backgroundColor: C.surface, borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: C.border, marginTop: 4,
  },
  integroFooterText: { flex: 1, fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, lineHeight: 16 },

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

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 },
  statBox: { flex: 1, minWidth: '44%', backgroundColor: C.surface, borderRadius: 14, padding: 14, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: C.border },
  statNum: { fontSize: 22, fontFamily: 'Inter_700Bold' },
  statLbl: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub },
  quickRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  quickIcon: { width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  quickLabel: { flex: 1, fontSize: 14, fontFamily: 'Inter_500Medium', color: C.text },
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

  timeChip: {
    paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  timeChipActive: { backgroundColor: C.primaryBg, borderColor: C.primary },
  timeChipText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub },
  timeChipTextActive: { color: C.primary, fontFamily: 'Inter_700Bold' },

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

  diagRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: C.border, gap: 12 },
  diagLabel: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textMuted, flexShrink: 0 },
  diagValue: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.text, flex: 1, textAlign: 'right' },
  diagAlertOk: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#ECFDF5', borderRadius: 10, padding: 12, marginTop: 12, borderWidth: 1, borderColor: '#A7F3D0' },
  diagAlertWarn: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#FFFBEB', borderRadius: 10, padding: 12, marginTop: 12, borderWidth: 1, borderColor: '#FCD34D' },
  diagAlertError: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#FEF2F2', borderRadius: 10, padding: 12, marginTop: 12, borderWidth: 1, borderColor: '#FCA5A5' },
  diagAlertTextOk: { flex: 1, fontSize: 12, fontFamily: 'Inter_500Medium', color: '#065F46', lineHeight: 17 },
  diagAlertTextWarn: { flex: 1, fontSize: 12, fontFamily: 'Inter_500Medium', color: '#92400E', lineHeight: 17 },
  diagAlertTextError: { flex: 1, fontSize: 12, fontFamily: 'Inter_500Medium', color: '#991B1B', lineHeight: 17 },
  diagRefreshBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, marginTop: 10, borderRadius: 10, backgroundColor: C.primaryBg, borderWidth: 1, borderColor: C.primary + '40' },
  diagRefreshTxt: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.primary },
  queueBlock: { marginTop: 12, padding: 12, borderRadius: 10, backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A' },
  queueHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  queueHeaderTxt: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#92400E' },
  queueHint: { fontSize: 11, fontFamily: 'Inter_400Regular', color: '#78350F', lineHeight: 16, marginBottom: 8 },
  queueItem: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, borderTopWidth: 1, borderTopColor: '#FDE68A' },
  queueItemDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#F59E0B' },
  queueItemTitle: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#92400E' },
  queueItemMeta: { fontSize: 10, fontFamily: 'Inter_400Regular', color: '#78350F', marginTop: 1 },
  queueMore: { fontSize: 11, fontFamily: 'Inter_500Medium', color: '#78350F', textAlign: 'center', paddingVertical: 6 },
  queueActionsRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  queueRetryBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#A7F3D0', backgroundColor: '#ECFDF5' },
  queueRetryTxt: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#10B981' },
  queueBtnDisabled: { backgroundColor: '#F3F4F6', borderColor: '#E5E7EB' },
  queueBtnDisabledTxt: { color: '#9CA3AF' },
  queueClearBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#FCA5A5', backgroundColor: '#FEF2F2' },
  queueClearTxt: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#EF4444' },
});
