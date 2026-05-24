import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Alert, Platform, KeyboardAvoidingView, Switch, Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Application from 'expo-application';
import * as IntentLauncher from 'expo-intent-launcher';
import { C } from '@/constants/colors';
import Header from '@/components/Header';
import { useSettings } from '@/context/SettingsContext';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useSubscription } from '@/context/SubscriptionContext';
import { AttendanceRecord, NotificationPreferences } from '@/constants/types';
import BottomNavBar from '@/components/BottomNavBar';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionFromStorage } from '@/lib/offlineCache';
import { useNetwork } from '@/context/NetworkContext';
import { useNotificationPreferences } from '@/context/NotificationPreferencesContext';
import { usePushNotifications } from '@/context/PushNotificationsContext';
import { useLanguage } from '@/context/LanguageContext';

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

type PwdStrength = 0 | 1 | 2 | 3;
const PWD_STRENGTH_COLORS: Record<PwdStrength, string> = { 0: '#E5E7EB', 1: '#EF4444', 2: '#F59E0B', 3: '#22C55E' };
const PWD_STRENGTH_LABELS: Record<PwdStrength, string> = { 0: '', 1: 'Faible', 2: 'Moyen', 3: 'Fort' };
function getPwdStrength(pwd: string): PwdStrength {
  if (!pwd) return 0;
  let score = 0;
  if (pwd.length >= 6) score++;
  if (pwd.length >= 10) score++;
  if (/[A-Z]/.test(pwd) && /[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd) && score >= 2) score++;
  return Math.min(3, score) as PwdStrength;
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
  const { t } = useTranslation();
  const router = useRouter();
  const { projectName, projectDescription, setProjectName, setProjectDescription, attendanceHistory, saveAttendanceSnapshot, clearAttendanceHistory, defaultArrivalTime, setDefaultArrivalTime, standardDayHours, setStandardDayHours } = useSettings();
  const { companies } = useApp();
  const { user, logout, permissions } = useAuth();
  const { organization, plan, subscription, seatUsed, seatMax } = useSubscription();
  const { queue, queueCount, isOnline, syncStatus, syncProgress, clearQueue, retrySync } = useNetwork();
  const { preferences: notifPrefs, updatePreferences, isLoading: notifLoading, lastError: notifError } = useNotificationPreferences();
  const { expoPushToken, permissionStatus, lastError: pushError, retryRegistration: retryPushRegistration } = usePushNotifications();
  const {
    deviceLanguage,
    effectiveLanguage,
    languagePreference,
    setLanguagePreference,
    supportedLanguages,
  } = useLanguage();

  const [nameInput, setNameInput] = useState(projectName);
  const [descInput, setDescInput] = useState(projectDescription);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'compte' | 'notifications' | 'project' | 'attendance' | 'integrations'>('compte');

  const [nameEdit, setNameEdit] = useState(user?.name ?? '');
  const [savingName, setSavingName] = useState(false);
  const [nameMsg, setNameMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [showCurrentPwd, setShowCurrentPwd] = useState(false);
  const [showNewPwd, setShowNewPwd] = useState(false);
  const [savingPwd, setSavingPwd] = useState(false);
  const [pwdMsg, setPwdMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
  const isSousTraitant = user?.role === 'sous_traitant';

  type DiagState = {
    loading: boolean;
    sessionUserId: string | null;
    sessionExpiresAt: number | null;
    serverRole: string | null;
    serverOrgId: string | null;
    error: string | null;
    sessionTimedOut?: boolean;
  } | null;
  const [diag, setDiag] = useState<DiagState>(null);
  const [diagOpen, setDiagOpen] = useState(false);

  useEffect(() => {
    if (queueCount > 0 && !diagOpen) {
      setDiagOpen(true);
      runDiagnostic();
    }
  }, [queueCount]);

  // Helper : ajoute un délai d'expiration à une promesse Supabase. Sans cela,
  // un appel auth/réseau qui ne répond jamais (verrou interne du client après
  // une mise en veille de l'app, websocket coincé, réseau bloqué…) laisse le
  // diagnostic en "Vérification en cours…" indéfiniment.
  function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error(`Connexion lente ou instable (${label}). Vérifiez votre réseau et réessayez.`)),
        ms,
      );
      p.then(
        v => { clearTimeout(t); resolve(v); },
        e => { clearTimeout(t); reject(e); },
      );
    });
  }

  async function runDiagnostic() {
    setDiag({ loading: true, sessionUserId: null, sessionExpiresAt: null, serverRole: null, serverOrgId: null, error: null });
    if (!isSupabaseConfigured) {
      setDiag({ loading: false, sessionUserId: null, sessionExpiresAt: null, serverRole: null, serverOrgId: null, error: 'Supabase non configuré (mode hors-ligne).' });
      return;
    }
    try {
      const { data: { session } } = await withTimeout(
        (supabase as any).auth.getSession(),
        15000,
        'session',
      ) as any;
      if (!session?.user?.id) {
        setDiag({ loading: false, sessionUserId: null, sessionExpiresAt: null, serverRole: null, serverOrgId: null, error: 'Aucune session active. Reconnectez-vous.' });
        return;
      }
      const { data: profile, error: profErr } = await withTimeout(
        (supabase as any)
          .from('profiles')
          .select('organization_id, role')
          .eq('id', session.user.id)
          .single(),
        15000,
        'profil',
      ) as any;
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
      // getSession() timed out (auth server slow or JWT-refresh call hanging).
      // The network may be perfectly fine — only the Supabase auth endpoint is slow.
      // Try to read the cached session from AsyncStorage to still show useful info.
      const isTimeout = err?.message?.includes('Connexion lente') || err?.message?.includes('lent') || err?.message?.includes('timeout');
      let cachedUserId: string | null = null;
      let cachedExpiresAt: number | null = null;
      let sessionStillValid = false;
      if (isTimeout || !!user?.id) {
        try {
          const cached = await getSessionFromStorage();
          if (cached?.user?.id) {
            cachedUserId = cached.user.id;
            cachedExpiresAt = cached.expires_at ?? null;
            if (typeof cached.expires_at === 'number') {
              sessionStillValid = cached.expires_at > Math.floor(Date.now() / 1000);
            }
          }
        } catch {}
      }
      setDiag({
        loading: false,
        sessionUserId: cachedUserId,
        sessionExpiresAt: cachedExpiresAt,
        serverRole: null,
        serverOrgId: null,
        error: isTimeout
          ? `Serveur auth lent (>${(15000 / 1000).toFixed(0)} s). Réseau local OK — seul le serveur Supabase est lent.${sessionStillValid ? ' Session locale encore valide.' : ' JWT expiré, reconnexion recommandée.'}`
          : (err?.message ?? 'Erreur inconnue.'),
        sessionTimedOut: isTimeout,
      });
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
  type NotificationBooleanKey = NonNullable<{
    [K in keyof NotificationPreferences]: NotificationPreferences[K] extends boolean ? K : never
  }[keyof NotificationPreferences]>;

  function setNotif<K extends keyof NotificationPreferences>(key: K, value: NotificationPreferences[K]) {
    void updatePreferences({ [key]: value } as Partial<NotificationPreferences>);
  }

  const pushStatus = pushError?.includes('Migration Supabase manquante')
    ? t('settings.pushStatus.missingTable')
    : pushError?.includes('Service push Android')
      ? t('settings.pushStatus.serviceUnavailable')
    : pushError
      ? t('settings.pushStatus.incomplete')
    : permissionStatus === 'granted'
    ? (expoPushToken ? t('settings.pushStatus.registered') : t('settings.pushStatus.granted'))
    : permissionStatus === 'denied'
      ? t('settings.pushStatus.denied')
      : permissionStatus === 'unsupported'
        ? t('settings.pushStatus.webUnavailable')
        : t('settings.pushStatus.requestPermission');

  const pushStatusColor = pushError
    ? '#F59E0B'
    : permissionStatus === 'granted' && notifPrefs.pushEnabled
    ? '#10B981'
    : permissionStatus === 'denied'
      ? '#EF4444'
      : '#F59E0B';
  const pushErrorIsActionable = Boolean(pushError)
    && !pushError?.includes('Migration Supabase manquante')
    && !pushError?.includes('Configuration Android FCM incompl');
  const showPushPermissionCta = Platform.OS !== 'web'
    && (pushErrorIsActionable || permissionStatus === 'undetermined' || permissionStatus === 'denied' || !notifPrefs.pushEnabled);
  const pushPermissionCtaTitle = pushErrorIsActionable
    ? t('settings.pushPermission.registrationTitle')
    : permissionStatus === 'denied'
    ? t('settings.pushPermission.deniedTitle')
    : t('settings.pushPermission.importantTitle');
  const pushPermissionCtaText = pushErrorIsActionable
    ? t('settings.pushPermission.registrationText')
    : permissionStatus === 'denied'
    ? t('settings.pushPermission.deniedText')
    : t('settings.pushPermission.importantText');
  const pushPermissionCtaLabel = pushErrorIsActionable
    ? t('settings.pushPermission.retry')
    : permissionStatus === 'denied'
    ? t('settings.pushPermission.openSettings')
    : t('settings.pushPermission.allow');

  function renderSwitchRow(
    key: NotificationBooleanKey,
    title: string,
    subtitle: string,
    disabled = false,
  ) {
    const value = Boolean(notifPrefs[key]);
    return (
      <View style={[styles.prefRow, disabled && styles.prefRowDisabled]}>
        <View style={{ flex: 1 }}>
          <Text style={styles.prefTitle}>{title}</Text>
          <Text style={styles.prefSub}>{subtitle}</Text>
        </View>
        <Switch
          value={value}
          disabled={disabled || notifLoading}
          onValueChange={next => setNotif(key, next as any)}
          trackColor={{ false: '#D1D5DB', true: C.primary + '66' }}
          thumbColor={value ? C.primary : '#F9FAFB'}
        />
      </View>
    );
  }

  function renderTimeChips(key: 'quietHoursStart' | 'quietHoursEnd', options: string[]) {
    return (
      <View style={styles.prefChipRow}>
        {options.map(option => {
          const active = notifPrefs[key] === option;
          return (
            <TouchableOpacity
              key={`${key}-${option}`}
              style={[styles.timeChip, active && styles.timeChipActive]}
              onPress={() => setNotif(key, option)}
            >
              <Text style={[styles.timeChipText, active && styles.timeChipTextActive]}>{option}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  }

  async function openBuildTrackNotificationSettings() {
    try {
      if (Platform.OS === 'android') {
        const packageName = Application.applicationId;
        if (packageName) {
          await IntentLauncher.startActivityAsync(IntentLauncher.ActivityAction.APP_NOTIFICATION_SETTINGS, {
            extra: {
              'android.provider.extra.APP_PACKAGE': packageName,
            },
          });
          retryPushRegistration();
          return;
        }
      }
      await Linking.openSettings();
      retryPushRegistration();
    } catch {
      try {
        await Linking.openSettings();
      } catch {
        Alert.alert(t('settings.pushPermission.settingsUnavailableTitle'), t('settings.pushPermission.settingsUnavailableText'));
      } finally {
        retryPushRegistration();
      }
    }
  }

  async function handlePushPermissionAction() {
    if (Platform.OS === 'web') return;
    if (permissionStatus === 'denied') {
      Alert.alert(
        t('settings.pushPermission.alertTitle'),
        t('settings.pushPermission.alertText'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('settings.pushPermission.openSettings'), onPress: openBuildTrackNotificationSettings },
        ],
      );
      return;
    }
    await updatePreferences({ pushEnabled: true });
    retryPushRegistration();
  }

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

  async function handleSaveName() {
    const trimmed = nameEdit.trim();
    if (!trimmed) { setNameMsg({ ok: false, text: 'Le nom ne peut pas être vide.' }); return; }
    if (trimmed === user?.name) { setNameMsg({ ok: false, text: 'Aucun changement détecté.' }); return; }
    if (!isSupabaseConfigured) { setNameMsg({ ok: false, text: 'Connexion au serveur requise.' }); return; }
    setSavingName(true);
    setNameMsg(null);
    const { error } = await (supabase as any).from('profiles').update({ name: trimmed }).eq('id', user?.id);
    setSavingName(false);
    if (error) {
      setNameMsg({ ok: false, text: 'Erreur lors de la mise à jour. Réessayez.' });
    } else {
      setNameMsg({ ok: true, text: 'Nom mis à jour avec succès.' });
    }
  }

  async function handleChangePassword() {
    setPwdMsg(null);
    if (!currentPwd) { setPwdMsg({ ok: false, text: 'Saisissez votre mot de passe actuel.' }); return; }
    if (newPwd.length < 6) { setPwdMsg({ ok: false, text: 'Le nouveau mot de passe doit faire au moins 6 caractères.' }); return; }
    if (newPwd !== confirmPwd) { setPwdMsg({ ok: false, text: 'Les mots de passe ne correspondent pas.' }); return; }
    if (!isSupabaseConfigured || !user?.email) { setPwdMsg({ ok: false, text: 'Connexion au serveur requise.' }); return; }
    setSavingPwd(true);
    const { error: authError } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPwd });
    if (authError) {
      setSavingPwd(false);
      setPwdMsg({ ok: false, text: 'Mot de passe actuel incorrect.' });
      return;
    }
    const { error: updateError } = await supabase.auth.updateUser({ password: newPwd });
    setSavingPwd(false);
    if (updateError) {
      setPwdMsg({ ok: false, text: 'Erreur lors du changement. Réessayez.' });
    } else {
      setCurrentPwd(''); setNewPwd(''); setConfirmPwd('');
      setPwdMsg({ ok: true, text: 'Mot de passe modifié. Un email de confirmation vous a été envoyé.' });
      if (user?.email) {
        const { sendPasswordChangedEmail } = await import('@/lib/email/client');
        sendPasswordChangedEmail({ email: user.email, name: user.name, language: user.preferredLanguage }).catch(() => {});
      }
    }
  }

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

  const pwdStrength = getPwdStrength(newPwd);
  const pwdStrengthColor = PWD_STRENGTH_COLORS[pwdStrength];
  const pwdStrengthLabel = PWD_STRENGTH_LABELS[pwdStrength];

  const statusCfg = subscription ? STATUS_COLORS[subscription.status] : STATUS_COLORS.trial;
  const seatRatio = seatMax === -1 ? 0 : seatUsed / seatMax;
  const seatBarColor = seatRatio >= 0.9 ? '#EF4444' : seatRatio >= 0.7 ? '#F59E0B' : '#10B981';
  const roleColor = ROLE_COLORS[user?.role ?? 'observateur'] ?? C.primary;
  const userInitials = user ? user.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() : '??';
  const activeLanguage = supportedLanguages.find(lang => lang.code === effectiveLanguage) ?? supportedLanguages[0];

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Header title={t('common.settings')} subtitle={t('settings.accountAndProject')} showBack />

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabScroll} contentContainerStyle={styles.tabRow}>
        {[
          { key: 'compte',       icon: 'person-circle-outline', label: t('settings.account'),          nav: false },
          { key: 'notifications', icon: 'notifications-outline', label: t('settings.notifications'),   nav: false },
          ...((user?.role === 'admin' || user?.role === 'super_admin') ? [{ key: 'abonnement', icon: 'card-outline', label: t('settings.subscription'), nav: true }] : []),
          { key: 'project',      icon: 'construct-outline',     label: t('settings.project'),          nav: false },
          ...(!isSousTraitant ? [{ key: 'attendance', icon: 'people-outline', label: t('settings.attendance', { count: totalDays }), nav: false }] : []),
          { key: 'integrations', icon: 'apps-outline',          label: t('settings.integrations'), nav: false },
        ].map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tabBtn, activeTab === tab.key && styles.tabBtnActive]}
            onPress={() => tab.nav ? router.push('/subscription') : setActiveTab(tab.key as any)}
          >
            <Ionicons name={tab.icon as any} size={14} color={activeTab === tab.key ? C.primary : C.textMuted} />
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>{tab.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {activeTab === 'compte' && (
          <View>
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

            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Ionicons name="language-outline" size={16} color={C.primary} />
                <Text style={styles.cardTitle}>{t('settings.language')}</Text>
              </View>
              <Text style={styles.prefSub}>{t('settings.languageDescription')}</Text>
              <View style={styles.languageSummary}>
                <View style={styles.languageBadge}>
                  <Text style={styles.languageBadgeText}>{activeLanguage.label}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.prefTitle}>{activeLanguage.nativeName}</Text>
                  <Text style={styles.prefSub}>
                    {languagePreference === 'auto'
                      ? `${t('common.automatic')} · ${t('settings.languageDevice')} ${deviceLanguage.toUpperCase()}`
                      : t('settings.languageSaved')}
                  </Text>
                </View>
              </View>
              <View style={styles.languageOptions}>
                <TouchableOpacity
                  style={[styles.languageOption, languagePreference === 'auto' && styles.languageOptionActive]}
                  onPress={() => { void setLanguagePreference('auto'); }}
                >
                  <Ionicons
                    name="phone-portrait-outline"
                    size={14}
                    color={languagePreference === 'auto' ? C.primary : C.textMuted}
                  />
                  <Text style={[styles.languageOptionText, languagePreference === 'auto' && styles.languageOptionTextActive]}>
                    {t('common.automatic')}
                  </Text>
                </TouchableOpacity>
                {supportedLanguages.map(lang => {
                  const active = languagePreference === lang.code;
                  return (
                    <TouchableOpacity
                      key={lang.code}
                      style={[styles.languageOption, active && styles.languageOptionActive]}
                      onPress={() => { void setLanguagePreference(lang.code); }}
                    >
                      <Text style={[styles.languageOptionCode, active && styles.languageOptionCodeActive]}>{lang.label}</Text>
                      <Text style={[styles.languageOptionText, active && styles.languageOptionTextActive]}>{lang.nativeName}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <Text style={styles.languageHint}>{t('settings.languageAutoHint')}</Text>
            </View>

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

            {/* ── Modifier mon profil ── */}
            <View style={styles.card}>
              <View style={styles.cardTitleRow}>
                <Ionicons name="person-outline" size={16} color={C.primary} />
                <Text style={styles.cardTitle}>Modifier mon profil</Text>
              </View>

              {/* Nom */}
              <Text style={styles.label}>Nom affiché</Text>
              <TextInput
                style={styles.input}
                value={nameEdit}
                onChangeText={v => { setNameEdit(v); setNameMsg(null); }}
                placeholder="Votre nom"
                placeholderTextColor={C.textMuted}
                autoCapitalize="words"
                autoCorrect={false}
              />
              {nameMsg && (
                <View style={[styles.profileMsg, nameMsg.ok ? styles.profileMsgOk : styles.profileMsgErr]}>
                  <Ionicons name={nameMsg.ok ? 'checkmark-circle' : 'alert-circle'} size={14} color={nameMsg.ok ? '#059669' : C.open} />
                  <Text style={[styles.profileMsgTxt, { color: nameMsg.ok ? '#059669' : C.open }]}>{nameMsg.text}</Text>
                </View>
              )}
              <TouchableOpacity
                style={[styles.profileBtn, savingName && { opacity: 0.6 }]}
                onPress={handleSaveName}
                disabled={savingName}
              >
                <Ionicons name={savingName ? 'sync' : 'checkmark-circle-outline'} size={16} color={C.primary} />
                <Text style={styles.profileBtnTxt}>{savingName ? 'Enregistrement…' : 'Enregistrer le nom'}</Text>
              </TouchableOpacity>

              <View style={styles.profileDivider} />

              {/* Mot de passe */}
              <View style={styles.cardTitleRow}>
                <Ionicons name="lock-closed-outline" size={15} color={C.primary} />
                <Text style={styles.cardTitle}>Changer le mot de passe</Text>
              </View>

              <Text style={styles.label}>Mot de passe actuel</Text>
              <View style={styles.pwdWrap}>
                <TextInput
                  style={styles.pwdInput}
                  value={currentPwd}
                  onChangeText={v => { setCurrentPwd(v); setPwdMsg(null); }}
                  placeholder="••••••••"
                  placeholderTextColor={C.textMuted}
                  secureTextEntry={!showCurrentPwd}
                />
                <TouchableOpacity onPress={() => setShowCurrentPwd(p => !p)} hitSlop={8}>
                  <Ionicons name={showCurrentPwd ? 'eye-off-outline' : 'eye-outline'} size={18} color={C.textMuted} />
                </TouchableOpacity>
              </View>

              <Text style={styles.label}>Nouveau mot de passe</Text>
              <View style={styles.pwdWrap}>
                <TextInput
                  style={styles.pwdInput}
                  value={newPwd}
                  onChangeText={v => { setNewPwd(v); setPwdMsg(null); }}
                  placeholder="••••••••"
                  placeholderTextColor={C.textMuted}
                  secureTextEntry={!showNewPwd}
                />
                <TouchableOpacity onPress={() => setShowNewPwd(p => !p)} hitSlop={8}>
                  <Ionicons name={showNewPwd ? 'eye-off-outline' : 'eye-outline'} size={18} color={C.textMuted} />
                </TouchableOpacity>
              </View>
              {newPwd.length > 0 && (
                <View style={styles.strengthWrap}>
                  <View style={styles.strengthBars}>
                    {([1, 2, 3] as PwdStrength[]).map(lvl => (
                      <View
                        key={lvl}
                        style={[styles.strengthBar, { backgroundColor: pwdStrength >= lvl ? pwdStrengthColor : '#E5E7EB' }]}
                      />
                    ))}
                  </View>
                  <Text style={[styles.strengthLabel, { color: pwdStrengthColor }]}>{pwdStrengthLabel}</Text>
                </View>
              )}

              <Text style={styles.label}>Confirmer le nouveau mot de passe</Text>
              <TextInput
                style={styles.input}
                value={confirmPwd}
                onChangeText={v => { setConfirmPwd(v); setPwdMsg(null); }}
                placeholder="••••••••"
                placeholderTextColor={C.textMuted}
                secureTextEntry
              />

              {pwdMsg && (
                <View style={[styles.profileMsg, pwdMsg.ok ? styles.profileMsgOk : styles.profileMsgErr]}>
                  <Ionicons name={pwdMsg.ok ? 'checkmark-circle' : 'alert-circle'} size={14} color={pwdMsg.ok ? '#059669' : C.open} />
                  <Text style={[styles.profileMsgTxt, { color: pwdMsg.ok ? '#059669' : C.open }]}>{pwdMsg.text}</Text>
                </View>
              )}

              <TouchableOpacity
                style={[styles.profileBtn, savingPwd && { opacity: 0.6 }]}
                onPress={handleChangePassword}
                disabled={savingPwd}
              >
                <Ionicons name={savingPwd ? 'sync' : 'shield-checkmark-outline'} size={16} color={C.primary} />
                <Text style={styles.profileBtnTxt}>{savingPwd ? 'Vérification…' : 'Changer le mot de passe'}</Text>
              </TouchableOpacity>
            </View>


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
                      <Text style={[
                        styles.diagValue,
                        diag.sessionTimedOut ? { color: '#F59E0B' } : undefined,
                      ]}>
                        {diag.sessionUserId
                          ? (diag.sessionExpiresAt && diag.sessionExpiresAt * 1000 > Date.now()
                              ? `${diag.sessionTimedOut ? '(cache) ' : ''}Active · expire ${new Date(diag.sessionExpiresAt * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} ${new Date(diag.sessionExpiresAt * 1000).toLocaleDateString('fr-FR')}`
                              : `${diag.sessionTimedOut ? '(cache) ' : ''}Expirée — reconnexion recommandée`)
                          : diag.sessionTimedOut
                          ? 'Serveur auth lent (cache vide)'
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
                            <View style={[styles.queueItemDot, op.lastError && styles.queueItemDotErr]} />
                            <View style={{ flex: 1 }}>
                              <Text style={styles.queueItemTitle} numberOfLines={1}>
                                {op.op.toUpperCase()} · {op.table}
                                {op.filter ? ` · ${String(op.filter.value).slice(0, 8)}…` : ''}
                              </Text>
                              <Text style={styles.queueItemMeta} numberOfLines={1}>
                                {new Date(op.queuedAt).toLocaleString('fr-FR')}
                                {op.attemptCount ? ` · ${op.attemptCount} échec${op.attemptCount > 1 ? 's' : ''}` : ''}
                              </Text>
                              {op.lastError && (
                                <Text style={styles.queueItemError} numberOfLines={3}>
                                  {op.lastError}
                                </Text>
                              )}
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

        {activeTab === 'notifications' && (
          <View>
            <View style={[styles.card, { marginBottom: 14 }]}>
              <View style={styles.cardTitleRow}>
                <Ionicons name="phone-portrait-outline" size={16} color={C.primary} />
                <Text style={styles.cardTitle}>{t('settings.deviceState')}</Text>
              </View>
              <View style={styles.prefStatusRow}>
                <View style={[styles.statusDot, { backgroundColor: pushStatusColor }]} />
                <Text style={[styles.prefTitle, { flex: 1 }]}>{pushStatus}</Text>
              </View>
              {!!(notifError || pushError) && (
                <View style={styles.diagAlertWarn}>
                  <Ionicons name="warning-outline" size={15} color="#92400E" />
                  <Text style={styles.diagAlertTextWarn}>{notifError || pushError}</Text>
                </View>
              )}
              {showPushPermissionCta && (
                <View style={styles.pushPermissionBox}>
                  <View style={styles.pushPermissionIcon}>
                    <Ionicons
                      name={pushErrorIsActionable ? 'sync-outline' : permissionStatus === 'denied' ? 'notifications-off-outline' : 'notifications-outline'}
                      size={18}
                      color={permissionStatus === 'denied' ? '#EF4444' : C.primary}
                    />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.pushPermissionTitle}>{pushPermissionCtaTitle}</Text>
                    <Text style={styles.pushPermissionText}>{pushPermissionCtaText}</Text>
                    <TouchableOpacity
                      style={[
                        styles.pushPermissionBtn,
                        permissionStatus === 'denied' && styles.pushPermissionBtnDanger,
                      ]}
                      onPress={handlePushPermissionAction}
                      activeOpacity={0.82}
                    >
                      <Ionicons
                        name={pushErrorIsActionable ? 'refresh-outline' : permissionStatus === 'denied' ? 'settings-outline' : 'checkmark-circle-outline'}
                        size={16}
                        color="#fff"
                      />
                      <Text style={styles.pushPermissionBtnText}>{pushPermissionCtaLabel}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}
            </View>

            <View style={[styles.card, { marginBottom: 14 }]}>
              <View style={styles.cardTitleRow}>
                <Ionicons name="options-outline" size={16} color={C.primary} />
                <Text style={styles.cardTitle}>{t('settings.channels')}</Text>
              </View>
              {renderSwitchRow('inAppEnabled', t('settings.notificationSwitches.inAppTitle'), t('settings.notificationSwitches.inAppText'))}
              {renderSwitchRow('pushEnabled', t('settings.notificationSwitches.pushTitle'), t('settings.notificationSwitches.pushText'))}
              {renderSwitchRow('emailEnabled', t('settings.notificationSwitches.emailTitle'), t('settings.notificationSwitches.emailText'))}
              {renderSwitchRow('quietHoursEnabled', t('settings.notificationSwitches.quietHoursTitle'), t('settings.notificationSwitches.quietHoursText'))}
              {notifPrefs.quietHoursEnabled && (
                <View style={styles.prefTimeBlock}>
                  <Text style={styles.label}>{t('settings.quietHoursStart')}</Text>
                  {renderTimeChips('quietHoursStart', ['18:00', '19:00', '20:00', '21:00'])}
                  <Text style={styles.label}>{t('settings.quietHoursEnd')}</Text>
                  {renderTimeChips('quietHoursEnd', ['06:00', '07:00', '08:00', '09:00'])}
                </View>
              )}
              {notifPrefs.emailAdminAction === 'disabled' && notifPrefs.emailEnabled === false && (
                <View style={styles.prefAdminNotice}>
                  <Ionicons name="information-circle-outline" size={15} color="#92400E" />
                  <Text style={styles.prefAdminNoticeText}>
                    {t('settings.notificationSwitches.adminEmailDisabled')}
                  </Text>
                </View>
              )}
            </View>

            <View style={[styles.card, { marginBottom: 14 }]}>
              <View style={styles.cardTitleRow}>
                <Ionicons name="chatbubbles-outline" size={16} color={C.primary} />
                <Text style={styles.cardTitle}>{t('settings.messages')}</Text>
              </View>
              {renderSwitchRow('messagesInApp', t('settings.notificationSwitches.messagesInAppTitle'), t('settings.notificationSwitches.messagesInAppText'), !notifPrefs.inAppEnabled)}
              {renderSwitchRow('messagesPush', t('settings.notificationSwitches.messagesPushTitle'), t('settings.notificationSwitches.messagesPushText'), !notifPrefs.pushEnabled)}
            </View>

            <View style={[styles.card, { marginBottom: 14 }]}>
              <View style={styles.cardTitleRow}>
                <Ionicons name="warning-outline" size={16} color={C.primary} />
                <Text style={styles.cardTitle}>{t('settings.reserves')}</Text>
              </View>
              {renderSwitchRow('reserveCreatedPush', t('settings.notificationSwitches.reserveCreatedPushTitle'), t('settings.notificationSwitches.reserveCreatedPushText'), !notifPrefs.pushEnabled)}
              {renderSwitchRow('reserveCreatedEmail', t('settings.notificationSwitches.reserveCreatedEmailTitle'), t('settings.notificationSwitches.reserveCreatedEmailText'), !notifPrefs.emailEnabled)}
              {renderSwitchRow('reserveStatusPush', t('settings.notificationSwitches.reserveStatusPushTitle'), t('settings.notificationSwitches.reserveStatusPushText'), !notifPrefs.pushEnabled)}
              {renderSwitchRow('reserveStatusEmail', t('settings.notificationSwitches.reserveStatusEmailTitle'), t('settings.notificationSwitches.reserveStatusEmailText'), !notifPrefs.emailEnabled)}
              {renderSwitchRow('reserveCriticalInApp', t('settings.notificationSwitches.reserveCriticalInAppTitle'), t('settings.notificationSwitches.reserveCriticalInAppText'), !notifPrefs.inAppEnabled)}
              {renderSwitchRow('reserveCriticalPush', t('settings.notificationSwitches.reserveCriticalPushTitle'), t('settings.notificationSwitches.reserveCriticalPushText'), !notifPrefs.pushEnabled)}
              {renderSwitchRow('reserveCriticalEmail', t('settings.notificationSwitches.reserveCriticalEmailTitle'), t('settings.notificationSwitches.reserveCriticalEmailText'), !notifPrefs.emailEnabled)}
              {renderSwitchRow('criticalAlwaysPush', t('settings.notificationSwitches.criticalAlwaysPushTitle'), t('settings.notificationSwitches.criticalAlwaysPushText'), !notifPrefs.pushEnabled || !notifPrefs.quietHoursEnabled)}
            </View>

            <View style={[styles.card, { marginBottom: 14 }]}>
              <View style={styles.cardTitleRow}>
                <Ionicons name="alarm-outline" size={16} color={C.primary} />
                <Text style={styles.cardTitle}>{t('settings.dueDatesAndOverdues')}</Text>
              </View>
              {renderSwitchRow('dueSoonInApp', t('settings.notificationSwitches.dueSoonInAppTitle'), t('settings.notificationSwitches.dueSoonInAppText'), !notifPrefs.inAppEnabled)}
              {renderSwitchRow('reserveOverdueInApp', t('settings.notificationSwitches.reserveOverdueInAppTitle'), t('settings.notificationSwitches.reserveOverdueInAppText'), !notifPrefs.inAppEnabled)}
              {renderSwitchRow('reserveOverduePush', t('settings.notificationSwitches.reserveOverduePushTitle'), t('settings.notificationSwitches.reserveOverduePushText'), !notifPrefs.pushEnabled)}
              {renderSwitchRow('reserveOverdueEmail', t('settings.notificationSwitches.reserveOverdueEmailTitle'), t('settings.notificationSwitches.reserveOverdueEmailText'), !notifPrefs.emailEnabled)}
              {renderSwitchRow('taskLateInApp', t('settings.notificationSwitches.taskLateInAppTitle'), t('settings.notificationSwitches.taskLateInAppText'), !notifPrefs.inAppEnabled)}
              <View style={styles.prefInfoBox}>
                <Ionicons name="shield-checkmark-outline" size={15} color={C.primary} />
                <Text style={styles.prefInfoText}>
                  {t('settings.notificationSwitches.overdueEmailInfo')}
                </Text>
              </View>
            </View>

            <View style={styles.infoCard}>
              <View style={styles.infoRow}>
                <Ionicons name="lock-closed-outline" size={16} color={C.primary} />
                <Text style={styles.infoText}>
                  {t('settings.securityEmailsNotice')}
                </Text>
              </View>
            </View>
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

  prefStatusRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.surface2, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: C.border,
  },
  pushPermissionBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: C.primaryBg,
    borderWidth: 1,
    borderColor: C.primary + '24',
  },
  pushPermissionIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: C.border,
  },
  pushPermissionTitle: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.text },
  pushPermissionText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, lineHeight: 17, marginTop: 3 },
  pushPermissionBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: C.primary,
  },
  pushPermissionBtnDanger: { backgroundColor: '#EF4444' },
  pushPermissionBtnText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#fff' },
  prefRow: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  prefRowDisabled: { opacity: 0.55 },
  prefTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  prefSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2, lineHeight: 17 },
  prefInfoBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: C.primaryBg,
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: C.primary + '25',
  },
  prefInfoText: { flex: 1, fontSize: 12, fontFamily: 'Inter_500Medium', color: C.primary, lineHeight: 17 },
  prefAdminNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FFFBEB',
    borderRadius: 10,
    padding: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#FCD34D',
  },
  prefAdminNoticeText: { flex: 1, fontSize: 12, fontFamily: 'Inter_500Medium', color: '#92400E', lineHeight: 17 },
  prefTimeBlock: { marginTop: 8, backgroundColor: C.surface2, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.border },
  prefChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },

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

  languageSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.surface2,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: C.border,
    marginTop: 10,
  },
  languageBadge: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  languageBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
    letterSpacing: 0.4,
  },
  languageOptions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  languageOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 11,
    paddingVertical: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.surface2,
  },
  languageOptionActive: {
    backgroundColor: C.primaryBg,
    borderColor: C.primary,
  },
  languageOptionCode: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    color: C.textMuted,
  },
  languageOptionCodeActive: { color: C.primary },
  languageOptionText: {
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
    color: C.textSub,
  },
  languageOptionTextActive: { color: C.primary },
  languageHint: {
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: C.textMuted,
    lineHeight: 16,
    marginTop: 8,
  },

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
  queueItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#FDE68A' },
  queueItemDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#F59E0B', marginTop: 6 },
  queueItemDotErr: { backgroundColor: '#EF4444' },
  queueItemTitle: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#92400E' },
  queueItemMeta: { fontSize: 10, fontFamily: 'Inter_400Regular', color: '#78350F', marginTop: 1 },
  queueItemError: { fontSize: 11, fontFamily: 'Inter_500Medium', color: '#991B1B', marginTop: 4, lineHeight: 15, backgroundColor: '#FEF2F2', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 4 },
  queueMore: { fontSize: 11, fontFamily: 'Inter_500Medium', color: '#78350F', textAlign: 'center', paddingVertical: 6 },
  queueActionsRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  queueRetryBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#A7F3D0', backgroundColor: '#ECFDF5' },
  queueRetryTxt: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#10B981' },
  queueBtnDisabled: { backgroundColor: '#F3F4F6', borderColor: '#E5E7EB' },
  queueBtnDisabledTxt: { color: '#9CA3AF' },
  queueClearBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: '#FCA5A5', backgroundColor: '#FEF2F2' },
  queueClearTxt: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#EF4444' },

  profileBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    backgroundColor: C.primaryBg, borderRadius: 10, paddingVertical: 11, marginTop: 10,
    borderWidth: 1, borderColor: C.primary + '40',
  },
  profileBtnTxt: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.primary },
  profileDivider: { height: 1, backgroundColor: C.border, marginVertical: 16 },
  profileMsg: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10, marginTop: 8,
    borderWidth: 1,
  },
  profileMsgOk: { backgroundColor: '#ECFDF5', borderColor: '#A7F3D0' },
  profileMsgErr: { backgroundColor: C.openBg, borderColor: '#FCA5A5' },
  profileMsgTxt: { fontSize: 12, fontFamily: 'Inter_500Medium', flex: 1, lineHeight: 17 },
  pwdWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.surface2, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1, borderColor: C.border, gap: 8,
  },
  pwdInput: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text },
  strengthWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  strengthBars: { flexDirection: 'row', gap: 4, flex: 1 },
  strengthBar: { flex: 1, height: 4, borderRadius: 2 },
  strengthLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', minWidth: 36, textAlign: 'right' },
});
