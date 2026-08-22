import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Platform, KeyboardAvoidingView, Switch, Linking,
} from 'react-native';
import { showAlert } from '@/lib/appAlert';
import { Ionicons } from '@expo/vector-icons';
import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Application from 'expo-application';
import * as IntentLauncher from 'expo-intent-launcher';
import { C } from '@/constants/colors';
import Header from '@/components/Header';
import PageContainer from '@/components/PageContainer';
import { useSettings } from '@/context/SettingsContext';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useSubscription } from '@/context/SubscriptionContext';
import { AttendanceRecord, NotificationPreferences } from '@/constants/types';
import BottomNavBar from '@/components/BottomNavBar';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import { getSessionFromStorage } from '@/lib/offlineCache';
import { supabaseRestSelect } from '@/lib/supabaseRest';
import { useNetwork } from '@/context/NetworkContext';
import { useNotificationPreferences } from '@/context/NotificationPreferencesContext';
import { usePushNotifications } from '@/context/PushNotificationsContext';
import { useLanguage } from '@/context/LanguageContext';
import {
  getSyncQueueOperationDomain,
  inventoryOutcomeTranslationKey,
  type SyncQueueTerminalOutcome,
} from '@/lib/syncQueuePolicy';
import type { QueuedOperation } from '@/context/NetworkContext';

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
  magasinier:   '#0F766E',
  observateur:  '#6B7280',
  sous_traitant:'#10B981',
};

const STATUS_COLORS = {
  trial:     { labelKey: 'adminScreen.subscriptionStatus.trial.label',     color: '#F59E0B', bg: '#FFFBEB' },
  active:    { labelKey: 'adminScreen.subscriptionStatus.active.label',    color: '#10B981', bg: '#ECFDF5' },
  suspended: { labelKey: 'adminScreen.subscriptionStatus.suspended.label', color: '#EF4444', bg: '#FEF2F2' },
  expired:   { labelKey: 'adminScreen.subscriptionStatus.expired.label',   color: '#6B7280', bg: '#F3F4F6' },
} as const;

const DIAGNOSTIC_SDK_TIMEOUT_MS = 8000;
const DIAGNOSTIC_REST_FAST_TIMEOUT_MS = 5000;

type InventoryQueueSummary = {
  direction: 'in' | 'out' | 'update';
  productName?: string;
  productReference?: string;
  quantity?: number;
  unit?: string;
  chantierId?: string;
  chantierName?: string;
  occurredAt: string;
  serverStock?: number;
};

function firstText(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    if (value === null || value === undefined || value === '') continue;
    const numeric = typeof value === 'number' ? value : Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return undefined;
}

function inventoryQueueSummary(operation: QueuedOperation): InventoryQueueSummary | null {
  const outcome: Partial<SyncQueueTerminalOutcome> = operation.terminalOutcome ?? {};
  const args = operation.rpc?.args ?? {};
  const movement = (args.p_movement ?? {}) as Record<string, any>;
  const product = (args.p_product ?? operation.data ?? {}) as Record<string, any>;
  if (getSyncQueueOperationDomain(operation) !== 'inventory') return null;

  const rawDirection = firstText(outcome.direction, movement.movement_type);
  const direction: InventoryQueueSummary['direction'] = rawDirection === 'out'
    ? 'out'
    : rawDirection === 'in'
      ? 'in'
      : 'update';

  return {
    direction,
    productName: firstText(outcome.productName, product.designation, product.name),
    productReference: firstText(outcome.productReference, movement.reference, product.reference),
    quantity: firstNumber(outcome.quantity, movement.quantity),
    unit: firstText(outcome.unit, product.unit),
    chantierId: firstText(outcome.chantierId, movement.chantier_id),
    chantierName: firstText(outcome.chantierName),
    occurredAt: firstText(outcome.occurredAt, movement.created_at, operation.queuedAt) ?? operation.queuedAt,
    serverStock: firstNumber(outcome.serverStock, outcome.stockAfter),
  };
}

export default function SettingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { projectName, projectDescription, setProjectName, setProjectDescription, attendanceHistory, saveAttendanceSnapshot, clearAttendanceHistory, defaultArrivalTime, setDefaultArrivalTime, standardDayHours, setStandardDayHours } = useSettings();
  const { companies, chantiers } = useApp();
  const { user, logout, permissions, reconnectExpiredSession } = useAuth();
  const { organization, plan, subscription, seatUsed, seatMax } = useSubscription();
  const {
    queue,
    queueCount,
    rejectedCount,
    isOnline,
    syncStatus,
    syncProgress,
    syncAuthBlocked,
    clearQueue,
    dismissRejectedOperations,
    retrySync,
  } = useNetwork();
  const totalQueueCount = queue.length;
  const rejectedOperations = queue.filter(operation => operation.terminal);
  const rejectedInventoryCount = rejectedOperations.filter(operation => inventoryQueueSummary(operation) !== null).length;
  const rejectedNonInventoryCount = rejectedCount - rejectedInventoryCount;
  // Stuck operations whose error points to an expired/invalid session: writes
  // went out with the read-only anon key and RLS rejected them. The cure is a
  // fresh login, not a retry — so we surface a "reconnect" affordance.
  // `syncAuthBlocked` covers the same situation before any failure is recorded
  // (the sync engine now holds the queue instead of replaying as anon).
  const queueHasAuthError = syncAuthBlocked || queue.some(op => {
    const e = (op.lastError ?? '').toLowerCase();
    return e.includes('42501')
      || e.includes('permission denied')
      || e.includes('jwt')
      || e.includes('refresh token')
      || e.includes('row-level security')
      || e.includes('401');
  });
  const queueErrorText = (operation: QueuedOperation) => {
    const fallback = operation.terminalOutcome?.message ?? operation.lastError ?? '';
    const key = inventoryOutcomeTranslationKey(operation);
    return key ? t(key as any, { defaultValue: fallback }) : fallback;
  };
  const { preferences: notifPrefs, updatePreferences, isLoading: notifLoading, lastError: notifError } = useNotificationPreferences();
  const { expoPushToken, permissionStatus, lastError: pushError, retryRegistration: retryPushRegistration } = usePushNotifications();
  const {
    deviceLanguage,
    effectiveLanguage,
    exportLanguage,
    languagePreference,
    setExportLanguage,
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
  const canManageProject = isAdmin || permissions.canEditChantier;
  const isSousTraitant = user?.role === 'sous_traitant';
  const isWarehouseUser = user?.role === 'magasinier';

  useEffect(() => {
    if (isWarehouseUser && activeTab !== 'compte' && activeTab !== 'notifications') {
      setActiveTab('compte');
    }
  }, [activeTab, isWarehouseUser]);

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
  const [diagTechnicalOpen, setDiagTechnicalOpen] = useState(false);
  const [expandedOperationIds, setExpandedOperationIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (totalQueueCount > 0 && !diagOpen) {
      setDiagOpen(true);
      runDiagnostic();
    }
  }, [totalQueueCount]);

  // Helper : ajoute un délai d'expiration à une promesse Supabase. Sans cela,
  // un appel auth/réseau qui ne répond jamais (verrou interne du client après
  // une mise en veille de l'app, websocket coincé, réseau bloqué…) laisse le
  // diagnostic en "Vérification en cours…" indéfiniment.
  function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(t('settings.diagnostic.timeout', { label }))),
        ms,
      );
      p.then(
        v => { clearTimeout(timer); resolve(v); },
        e => { clearTimeout(timer); reject(e); },
      );
    });
  }

  // Récupération automatique quand le SDK supabase-js est coincé (socket mort
  // du pool HTTP après une mise en veille) : relit le profil via une requête
  // REST brute — connexion neuve, token lu/rafraîchi hors du SDK
  // (getSupabaseRestAccessToken → cache AsyncStorage → forceRefreshSession).
  // Si elle aboutit, le diagnostic affiche un état serveur complet au lieu de
  // demander à l'utilisateur de redémarrer l'application.
  async function recoverDiagnosticViaRest(userId: string): Promise<boolean> {
    try {
      const { data: rows, error: restErr } = await supabaseRestSelect<{ organization_id: string | null; role: string | null }>(
        'profiles',
        'organization_id,role',
        { column: 'id', value: userId },
        1,
      );
      const profile = rows?.[0];
      if (restErr || !profile) return false;
      const stored = await getSessionFromStorage().catch(() => null);
      setDiag({
        loading: false,
        sessionUserId: userId,
        sessionExpiresAt: stored?.expires_at ?? null,
        serverRole: profile.role ?? null,
        serverOrgId: profile.organization_id ?? null,
        error: null,
      });
      return true;
    } catch {
      return false;
    }
  }

  async function recoverDiagnosticFromCachedSession(timeoutMs = DIAGNOSTIC_REST_FAST_TIMEOUT_MS): Promise<boolean> {
    const cached = await getSessionFromStorage().catch(() => null);
    const cachedUserId = cached?.user?.id ?? user?.id ?? null;
    if (!cachedUserId) return false;
    try {
      return await withTimeout(
        recoverDiagnosticViaRest(cachedUserId),
        timeoutMs,
        'profil REST',
      );
    } catch {
      return false;
    }
  }

  async function runDiagnostic() {
    setDiag({ loading: true, sessionUserId: null, sessionExpiresAt: null, serverRole: null, serverOrgId: null, error: null });
    if (!isSupabaseConfigured) {
      setDiag({ loading: false, sessionUserId: null, sessionExpiresAt: null, serverRole: null, serverOrgId: null, error: t('settings.diagnostic.supabaseNotConfigured') });
      return;
    }
    // Resume-after-inactivity path: avoid waiting on supabase-js auth locks
    // when the persisted JWT can already read the profile through REST.
    if (await recoverDiagnosticFromCachedSession()) return;
    try {
      const { data: { session } } = await withTimeout(
        (supabase as any).auth.getSession(),
        DIAGNOSTIC_SDK_TIMEOUT_MS,
        'session',
      ) as any;
      if (!session?.user?.id) {
        setDiag({ loading: false, sessionUserId: null, sessionExpiresAt: null, serverRole: null, serverOrgId: null, error: t('settings.diagnostic.noSession') });
        return;
      }
      const { data: profile, error: profErr } = await withTimeout(
        (supabase as any)
          .from('profiles')
          .select('organization_id, role')
          .eq('id', session.user.id)
          .single(),
        DIAGNOSTIC_SDK_TIMEOUT_MS,
        'profil',
      ) as any;
      if (profErr) {
        // Le SDK a échoué (souvent : timeout sur socket mort) — nouvelle
        // tentative en REST brut avant d'afficher une erreur.
        if (await recoverDiagnosticViaRest(session.user.id)) return;
        setDiag({ loading: false, sessionUserId: session.user.id, sessionExpiresAt: session.expires_at ?? null, serverRole: null, serverOrgId: null, error: t('settings.diagnostic.profileMissing', { message: profErr.message }) });
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
      const message = String(err?.message ?? '').toLowerCase();
      const localizedTimeoutPrefix = t('settings.diagnostic.timeout', { label: '' })
        .split('(')[0]
        .trim()
        .toLowerCase();
      const isTimeout = (!!localizedTimeoutPrefix && message.includes(localizedTimeoutPrefix))
        || message.includes('slow')
        || message.includes('lenta')
        || message.includes('lent')
        || message.includes('timeout')
        || message.includes('instable')
        || message.includes('unstable');
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
      // Avant d'afficher "serveur auth lent" : tentative de récupération en
      // REST brut (connexion neuve). Si le serveur répond, le diagnostic
      // affiche l'état complet — plus besoin de redémarrer l'application.
      if (isTimeout && cachedUserId) {
        try {
          if (await withTimeout(
            recoverDiagnosticViaRest(cachedUserId),
            DIAGNOSTIC_SDK_TIMEOUT_MS,
            'profil REST',
          )) return;
        } catch {}
      }
      setDiag({
        loading: false,
        sessionUserId: cachedUserId,
        sessionExpiresAt: cachedExpiresAt,
        serverRole: null,
        serverOrgId: null,
        error: isTimeout
          ? t('settings.diagnostic.authSlow', { seconds: (DIAGNOSTIC_SDK_TIMEOUT_MS / 1000).toFixed(0), state: sessionStillValid ? t('settings.diagnostic.localSessionValid') : t('settings.diagnostic.jwtExpired') })
          : (err?.message ?? t('settings.diagnostic.unknownError')),
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

  function toggleOperationDetails(operationId: string) {
    setExpandedOperationIds(previous => {
      const next = new Set(previous);
      if (next.has(operationId)) next.delete(operationId);
      else next.add(operationId);
      return next;
    });
  }

  const diagIssues: { level: 'error' | 'warn'; msg: string }[] = [];
  if (diag && !diag.loading && !diag.error) {
    const allowedRoles = ['admin', 'conducteur', 'chef_equipe', 'magasinier', 'super_admin'];
    if (diag.serverOrgId && user?.organizationId && diag.serverOrgId !== user.organizationId) {
      diagIssues.push({ level: 'error', msg: t('settings.diagnostic.orgMismatch', { local: user.organizationId.slice(0, 8), server: diag.serverOrgId.slice(0, 8) }) });
    }
    if (!diag.serverOrgId && diag.serverRole !== 'super_admin') {
      diagIssues.push({ level: 'error', msg: t('settings.diagnostic.noServerOrg') });
    }
    if (diag.serverRole && diag.serverRole !== user?.role) {
      diagIssues.push({ level: 'warn', msg: t('settings.diagnostic.roleMismatch', { local: user?.role, server: diag.serverRole }) });
    }
    if (diag.serverRole && !allowedRoles.includes(diag.serverRole)) {
      diagIssues.push({ level: 'warn', msg: t('settings.diagnostic.readOnlyRole', { role: diag.serverRole }) });
    }
    if (diag.sessionExpiresAt && diag.sessionExpiresAt * 1000 < Date.now()) {
      diagIssues.push({ level: 'error', msg: t('settings.diagnostic.sessionExpired') });
    }
  }
  const diagnosticProblemCount = diagIssues.length + (totalQueueCount > 0 ? 1 : 0);
  const diagOk = diag && !diag.loading && !diag.error && diagnosticProblemCount === 0;
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
        showAlert(t('settings.pushPermission.settingsUnavailableTitle'), t('settings.pushPermission.settingsUnavailableText'));
      } finally {
        retryPushRegistration();
      }
    }
  }

  async function handlePushPermissionAction() {
    if (Platform.OS === 'web') return;
    if (permissionStatus === 'denied') {
      showAlert(
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
    if (totalQueueCount === 0) return;
    showAlert(
      t('settings.syncQueue.clearTitle'),
      t('settings.syncQueue.clearMessage', { count: totalQueueCount }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.syncQueue.clearAction'),
          style: 'destructive',
          onPress: async () => {
            await clearQueue();
            showAlert(t('settings.syncQueue.clearedTitle'), t('settings.syncQueue.clearedText'));
          },
        },
      ],
    );
  }

  function handleDismissRejectedOperations() {
    if (rejectedCount === 0) return;
    showAlert(
      t('settings.syncQueue.dismissRejectedTitle'),
      t('settings.syncQueue.dismissRejectedMessage', { count: rejectedCount }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.syncQueue.dismissRejectedAction', { count: rejectedCount }),
          onPress: async () => {
            try {
              await dismissRejectedOperations();
              showAlert(t('settings.syncQueue.dismissedTitle'), t('settings.syncQueue.dismissedText'));
            } catch {
              showAlert(t('settings.syncQueue.dismissFailedTitle'), t('settings.syncQueue.dismissFailedText'));
            }
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
    if (!trimmed) { setNameMsg({ ok: false, text: t('settings.profile.nameRequired') }); return; }
    if (trimmed === user?.name) { setNameMsg({ ok: false, text: t('settings.profile.noChange') }); return; }
    if (!isSupabaseConfigured) { setNameMsg({ ok: false, text: t('settings.profile.serverRequired') }); return; }
    setSavingName(true);
    setNameMsg(null);
    const { error } = await (supabase as any).from('profiles').update({ name: trimmed }).eq('id', user?.id);
    setSavingName(false);
    if (error) {
      setNameMsg({ ok: false, text: t('settings.profile.updateError') });
    } else {
      setNameMsg({ ok: true, text: t('settings.profile.nameUpdated') });
    }
  }

  async function handleChangePassword() {
    setPwdMsg(null);
    if (!currentPwd) { setPwdMsg({ ok: false, text: t('settings.profile.currentPasswordRequired') }); return; }
    if (newPwd.length < 6) { setPwdMsg({ ok: false, text: t('settings.profile.passwordTooShort') }); return; }
    if (newPwd !== confirmPwd) { setPwdMsg({ ok: false, text: t('settings.profile.passwordMismatch') }); return; }
    if (!isSupabaseConfigured || !user?.email) { setPwdMsg({ ok: false, text: t('settings.profile.serverRequired') }); return; }
    setSavingPwd(true);
    const { error: authError } = await supabase.auth.signInWithPassword({ email: user.email, password: currentPwd });
    if (authError) {
      setSavingPwd(false);
      setPwdMsg({ ok: false, text: t('settings.profile.currentPasswordIncorrect') });
      return;
    }
    const { error: updateError } = await supabase.auth.updateUser({ password: newPwd });
    setSavingPwd(false);
    if (updateError) {
      setPwdMsg({ ok: false, text: t('settings.profile.passwordChangeError') });
    } else {
      setCurrentPwd(''); setNewPwd(''); setConfirmPwd('');
      setPwdMsg({ ok: true, text: t('settings.profile.passwordChanged') });
      if (user?.email) {
        const { sendPasswordChangedEmail } = await import('@/lib/email/client');
        sendPasswordChangedEmail({ email: user.email, name: user.name, language: effectiveLanguage }).catch(() => {});
      }
    }
  }

  async function handleSave() {
    if (!nameInput.trim()) {
      showAlert(t('settings.projectTab.requiredTitle'), t('settings.projectTab.nameRequired'));
      return;
    }
    setSaving(true);
    await setProjectName(nameInput.trim());
    await setProjectDescription(descInput.trim());
    setSaving(false);
    showAlert(t('settings.projectTab.savedTitle'), t('settings.projectTab.savedText'));
  }

  async function handleSaveAttendance() {
    if (companies.length === 0) {
      showAlert(t('settings.attendanceTab.noCompanyTitle'), t('settings.attendanceTab.noCompanyText'));
      return;
    }
    showAlert(
      t('settings.attendanceTab.saveSnapshotTitle'),
      t('settings.attendanceTab.saveSnapshotText', { count: companies.reduce<number>((a, c) => a + c.actualWorkers, 0) }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.attendanceTab.saveSnapshotAction'),
          onPress: async () => {
            await saveAttendanceSnapshot(companies, user?.name ?? t('settings.systemUser'));
            showAlert(t('settings.attendanceTab.snapshotSavedTitle'), t('settings.attendanceTab.snapshotSavedText'));
          },
        },
      ]
    );
  }

  function handleClearHistory() {
    showAlert(
      t('settings.attendanceTab.clearHistoryTitle'),
      t('settings.attendanceTab.clearHistoryText', { count: attendanceHistory.length }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('settings.attendanceTab.clearHistoryAction'), style: 'destructive', onPress: () => clearAttendanceHistory() },
      ]
    );
  }

  function handleLogout() {
    showAlert(
      t('settings.logoutTitle'),
      t('settings.logoutMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('settings.logoutAction'), style: 'destructive', onPress: () => logout() },
      ]
    );
  }

  const pwdStrength = getPwdStrength(newPwd);
  const pwdStrengthColor = PWD_STRENGTH_COLORS[pwdStrength];
  const pwdStrengthLabel = pwdStrength === 0 ? '' : t(`settings.profile.strength.${pwdStrength}`);

  const statusCfg = subscription ? STATUS_COLORS[subscription.status] : STATUS_COLORS.trial;
  const seatRatio = seatMax === -1 ? 0 : seatUsed / seatMax;
  const seatBarColor = seatRatio >= 0.9 ? '#EF4444' : seatRatio >= 0.7 ? '#F59E0B' : '#10B981';
  const roleColor = ROLE_COLORS[user?.role ?? 'observateur'] ?? C.primary;
  const userInitials = user ? user.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase() : '??';
  const activeLanguage = supportedLanguages.find(lang => lang.code === effectiveLanguage) ?? supportedLanguages[0];
  const activeExportLanguage = supportedLanguages.find(lang => lang.code === exportLanguage) ?? supportedLanguages[0];
  const appLocale = effectiveLanguage === 'en' ? 'en-US' : effectiveLanguage === 'es' ? 'es-ES' : 'fr-FR';

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Header
        title={t('common.settings')}
        subtitle={isWarehouseUser ? user?.roleLabel : t('settings.accountAndProject')}
        showBack
        onBack={isWarehouseUser ? () => router.replace('/inventory' as any) : undefined}
      />

      <PageContainer maxWidth={820}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator
        persistentScrollbar
        style={styles.tabScroll}
        contentContainerStyle={styles.tabRow}
        accessibilityRole="tablist"
        accessibilityLabel={t('settings.tabsLabel')}
        accessibilityHint={t('settings.tabsScrollHint')}
      >
        {[
          { key: 'compte',       icon: 'person-circle-outline', label: t('settings.account'),          nav: false },
          { key: 'notifications', icon: 'notifications-outline', label: t('settings.notifications'),   nav: false },
          ...(!isWarehouseUser ? [
            ...((user?.role === 'admin' || user?.role === 'super_admin') ? [{ key: 'abonnement', icon: 'card-outline', label: t('settings.subscription'), nav: true }] : []),
            { key: 'project',      icon: 'construct-outline',     label: t('settings.project'),          nav: false },
            ...(!isSousTraitant ? [{ key: 'attendance', icon: 'people-outline', label: t('settings.attendance', { count: totalDays }), nav: false }] : []),
            { key: 'integrations', icon: 'apps-outline',          label: t('settings.integrations'), nav: false },
          ] : []),
        ].map(tab => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tabBtn, activeTab === tab.key && styles.tabBtnActive]}
            onPress={() => tab.nav ? router.push('/subscription') : setActiveTab(tab.key as any)}
            accessibilityRole="tab"
            accessibilityLabel={tab.label}
            accessibilityState={{ selected: activeTab === tab.key }}
          >
            <Ionicons name={tab.icon as any} size={16} color={activeTab === tab.key ? C.primary : C.textSub} />
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
                  <Text style={styles.cardTitle}>{t('settings.organization')}</Text>
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

              <View style={styles.languageDivider} />
              <View style={styles.cardTitleRow}>
                <Ionicons name="document-text-outline" size={16} color={C.primary} />
                <Text style={styles.cardTitle}>{t('settings.exportLanguage')}</Text>
              </View>
              <Text style={styles.prefSub}>{t('settings.exportLanguageDescription')}</Text>
              <View style={styles.languageSummary}>
                <View style={styles.languageBadge}>
                  <Text style={styles.languageBadgeText}>{activeExportLanguage.label}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.prefTitle}>{activeExportLanguage.nativeName}</Text>
                  <Text style={styles.prefSub}>{t('settings.exportLanguageSaved')}</Text>
                </View>
              </View>
              <View style={styles.languageOptions} accessibilityRole="radiogroup" accessibilityLabel={t('settings.exportLanguage')}>
                {supportedLanguages.map(lang => {
                  const active = exportLanguage === lang.code;
                  return (
                    <TouchableOpacity
                      key={`export-${lang.code}`}
                      accessibilityRole="radio"
                      accessibilityState={{ checked: active }}
                      style={[styles.languageOption, active && styles.languageOptionActive]}
                      onPress={() => { void setExportLanguage(lang.code); }}
                    >
                      <Text style={[styles.languageOptionCode, active && styles.languageOptionCodeActive]}>{lang.label}</Text>
                      <Text style={[styles.languageOptionText, active && styles.languageOptionTextActive]}>{lang.nativeName}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
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
                <Text style={styles.cardTitle}>{t('settings.profile.title')}</Text>
              </View>

              {/* Nom */}
              <Text style={styles.label}>{t('settings.profile.displayName')}</Text>
              <TextInput
                style={styles.input}
                value={nameEdit}
                onChangeText={v => { setNameEdit(v); setNameMsg(null); }}
                placeholder={t('settings.profile.displayNamePlaceholder')}
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
                <Text style={styles.profileBtnTxt}>{savingName ? t('settings.profile.saving') : t('settings.profile.saveName')}</Text>
              </TouchableOpacity>

              <View style={styles.profileDivider} />

              {/* Mot de passe */}
              <View style={styles.cardTitleRow}>
                <Ionicons name="lock-closed-outline" size={15} color={C.primary} />
                <Text style={styles.cardTitle}>{t('settings.profile.changePassword')}</Text>
              </View>

              <Text style={styles.label}>{t('settings.profile.currentPassword')}</Text>
              <View style={styles.pwdWrap}>
                <TextInput
                  style={styles.pwdInput}
                  value={currentPwd}
                  onChangeText={v => { setCurrentPwd(v); setPwdMsg(null); }}
                  placeholder=""
                  placeholderTextColor={C.textMuted}
                  secureTextEntry={!showCurrentPwd}
                />
                <TouchableOpacity onPress={() => setShowCurrentPwd(p => !p)} hitSlop={8}>
                  <Ionicons name={showCurrentPwd ? 'eye-off-outline' : 'eye-outline'} size={18} color={C.textMuted} />
                </TouchableOpacity>
              </View>

              <Text style={styles.label}>{t('settings.profile.newPassword')}</Text>
              <View style={styles.pwdWrap}>
                <TextInput
                  style={styles.pwdInput}
                  value={newPwd}
                  onChangeText={v => { setNewPwd(v); setPwdMsg(null); }}
                  placeholder=""
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

              <Text style={styles.label}>{t('settings.profile.confirmPassword')}</Text>
              <TextInput
                style={styles.input}
                value={confirmPwd}
                onChangeText={v => { setConfirmPwd(v); setPwdMsg(null); }}
                placeholder=""
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
                <Text style={styles.profileBtnTxt}>{savingPwd ? t('settings.profile.checking') : t('settings.profile.changePasswordAction')}</Text>
              </TouchableOpacity>
            </View>


            {user?.role === 'super_admin' && (
              <TouchableOpacity style={[styles.navRow, styles.navRowSpecial]} onPress={() => router.push('/superadmin')}>
                <View style={[styles.navIcon, { backgroundColor: '#F3E8FF' }]}>
                  <Ionicons name="shield" size={18} color="#8B5CF6" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={[styles.navLabel, { color: '#8B5CF6' }]}>{t('settings.superAdmin.title')}</Text>
                  <Text style={styles.navSubPlain}>{t('settings.superAdmin.subtitle', { defaultValue: 'Cockpit clients BuildTrack' })}</Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color="#8B5CF6" />
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.navRow}
              onPress={toggleDiag}
              accessibilityRole="button"
              accessibilityLabel={t('settings.diagnostic.title')}
              accessibilityHint={t(diagOpen ? 'settings.diagnostic.collapseHint' : 'settings.diagnostic.expandHint')}
              accessibilityState={{ expanded: diagOpen }}
            >
              <View style={[styles.navIcon, { backgroundColor: diag?.loading ? C.primaryBg : diagOk ? '#ECFDF5' : (diag && (diag.error || diagnosticProblemCount > 0) ? '#FFFBEB' : '#F3F4F6') }]}>
                <Ionicons
                  name={diag?.loading ? 'sync' : diagOk ? 'checkmark-circle' : (diag && (diag.error || diagnosticProblemCount > 0) ? 'warning' : 'pulse-outline')}
                  size={18}
                  color={diag?.loading ? C.primary : diagOk ? '#10B981' : (diag && (diag.error || diagnosticProblemCount > 0) ? '#B45309' : C.textSub)}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.navLabel}>{t('settings.diagnostic.title')}</Text>
                <Text style={styles.navSubPlain}>
                  {diag?.loading ? t('settings.diagnostic.checking')
                    : diagOk ? t('settings.diagnostic.allSynced')
                    : diag?.error ? diag.error
                    : diag && diagnosticProblemCount > 0 ? t('settings.diagnostic.problemCount', { count: diagnosticProblemCount })
                    : t('settings.diagnostic.checkConsistency')}
                </Text>
              </View>
              <Ionicons name={diagOpen ? 'chevron-up' : 'chevron-down'} size={16} color={C.textMuted} />
            </TouchableOpacity>

            {diagOpen && (
              <View style={[styles.card, { marginTop: 8 }]}>
                {diag?.loading && (
                  <Text style={styles.emptyText} accessibilityLiveRegion="polite">{t('settings.diagnostic.checking')}</Text>
                )}
                {diag && !diag.loading && (
                  <>
                    {diag.error && (
                      <View style={styles.diagAlertError} accessibilityRole="alert" accessibilityLiveRegion="polite">
                        <Ionicons name="close-circle" size={16} color="#EF4444" />
                        <Text style={styles.diagAlertTextError}>{diag.error}</Text>
                      </View>
                    )}
                    {diagIssues.map((issue, i) => (
                      <View key={i} style={issue.level === 'error' ? styles.diagAlertError : styles.diagAlertWarn} accessibilityRole="alert" accessibilityLiveRegion="polite">
                        <Ionicons name={issue.level === 'error' ? 'close-circle' : 'alert-circle'} size={16} color={issue.level === 'error' ? '#EF4444' : '#F59E0B'} />
                        <Text style={issue.level === 'error' ? styles.diagAlertTextError : styles.diagAlertTextWarn}>{issue.msg}</Text>
                      </View>
                    ))}
                    {diagOk && (
                      <View style={styles.diagAlertOk}>
                        <Ionicons name="checkmark-circle" size={16} color="#10B981" />
                        <Text style={styles.diagAlertTextOk}>{t('settings.diagnostic.profileSynced')}</Text>
                      </View>
                    )}

                    <TouchableOpacity
                      style={styles.technicalToggle}
                      onPress={() => setDiagTechnicalOpen(open => !open)}
                      accessibilityRole="button"
                      accessibilityLabel={t('settings.diagnostic.technicalDetails')}
                      accessibilityState={{ expanded: diagTechnicalOpen }}
                    >
                      <Ionicons name="code-slash-outline" size={16} color={C.textSub} />
                      <Text style={styles.technicalToggleText}>
                        {t(diagTechnicalOpen ? 'settings.diagnostic.hideTechnicalDetails' : 'settings.diagnostic.technicalDetails')}
                      </Text>
                      <Ionicons name={diagTechnicalOpen ? 'chevron-up' : 'chevron-down'} size={16} color={C.textSub} />
                    </TouchableOpacity>

                    {diagTechnicalOpen && (
                      <View style={styles.technicalPanel}>
                        <View style={styles.diagRow}>
                          <Text style={styles.diagLabel}>{t('settings.diagnostic.userId')}</Text>
                          <Text style={styles.diagValue} selectable numberOfLines={1}>{user?.id ?? '—'}</Text>
                        </View>
                        <View style={styles.diagRow}>
                          <Text style={styles.diagLabel}>{t('settings.diagnostic.localRole')}</Text>
                          <Text style={styles.diagValue}>{user?.role ?? '—'}</Text>
                        </View>
                        <View style={styles.diagRow}>
                          <Text style={styles.diagLabel}>{t('settings.diagnostic.serverRole')}</Text>
                          <Text style={styles.diagValue}>{diag.serverRole ?? '—'}</Text>
                        </View>
                        <View style={styles.diagRow}>
                          <Text style={styles.diagLabel}>{t('settings.diagnostic.localOrg')}</Text>
                          <Text style={styles.diagValue} selectable numberOfLines={1}>{user?.organizationId ?? '—'}</Text>
                        </View>
                        <View style={styles.diagRow}>
                          <Text style={styles.diagLabel}>{t('settings.diagnostic.serverOrg')}</Text>
                          <Text style={styles.diagValue} selectable numberOfLines={1}>{diag.serverOrgId ?? '—'}</Text>
                        </View>
                        <View style={styles.diagRow}>
                          <Text style={styles.diagLabel}>{t('settings.diagnostic.session')}</Text>
                          <Text style={[styles.diagValue, diag.sessionTimedOut ? { color: '#B45309' } : undefined]}>
                            {diag.sessionUserId
                              ? (diag.sessionExpiresAt && diag.sessionExpiresAt * 1000 > Date.now()
                                  ? t('settings.diagnostic.sessionActive', { cache: diag.sessionTimedOut ? t('settings.diagnostic.cachePrefix') : '', time: new Date(diag.sessionExpiresAt * 1000).toLocaleTimeString(appLocale, { hour: '2-digit', minute: '2-digit' }), date: new Date(diag.sessionExpiresAt * 1000).toLocaleDateString(appLocale) })
                                  : t('settings.diagnostic.sessionExpiredCached', { cache: diag.sessionTimedOut ? t('settings.diagnostic.cachePrefix') : '' }))
                              : diag.sessionTimedOut
                              ? t('settings.diagnostic.authSlowNoCache')
                              : t('settings.diagnostic.none')}
                          </Text>
                        </View>
                      </View>
                    )}

                    {totalQueueCount > 0 && (
                      <View style={styles.queueBlock} accessibilityRole="alert" accessibilityLiveRegion="polite">
                        <View style={styles.queueHeaderRow}>
                          <Ionicons
                            name={syncStatus === 'syncing' ? 'sync' : (isOnline ? 'cloud-upload-outline' : 'cloud-offline-outline')}
                            size={14}
                            color="#B45309"
                          />
                          <Text style={styles.queueHeaderTxt}>
                            {queueCount > 0 && rejectedCount > 0
                              ? t('settings.syncQueue.mixedTitle', { pending: queueCount, rejected: rejectedCount })
                              : rejectedCount > 0
                                ? t('settings.syncQueue.rejectedTitleWithCount', { count: rejectedCount })
                                : t('settings.syncQueue.titleWithCount', { count: queueCount })}
                          </Text>
                        </View>
                        <Text style={styles.queueHint}>
                          {queueCount === 0
                            ? t(rejectedInventoryCount > 0 && rejectedNonInventoryCount === 0
                              ? 'settings.syncQueue.inventoryRejectedHint'
                              : 'settings.syncQueue.rejectedHint')
                            : isOnline
                            ? t('settings.syncQueue.onlineHint')
                            : t('settings.syncQueue.offlineHint')}
                        </Text>
                        {queueHasAuthError && (
                          <View style={styles.queueAuthBanner} accessibilityRole="alert" accessibilityLiveRegion="polite">
                            <Ionicons name="lock-closed-outline" size={14} color="#B45309" />
                            <Text style={styles.queueAuthBannerTxt}>
                              {t('settings.syncQueue.authErrorHint')}
                            </Text>
                          </View>
                        )}
                        {queue.slice(0, 5).map((op) => {
                          const inventorySummary = inventoryQueueSummary(op);
                          const detailsOpen = expandedOperationIds.has(op.id);
                          const userMessage = queueErrorText(op)
                            || (op.terminal ? t('settings.syncQueue.genericRejectedMessage') : '');
                          const movementTitle = inventorySummary
                            ? t(`settings.syncQueue.inventoryMovement.${inventorySummary.direction}` as any)
                            : t(op.terminal
                              ? 'settings.syncQueue.genericRejectedTitle'
                              : 'settings.syncQueue.genericPendingTitle');
                          const productTitle = inventorySummary
                            ? inventorySummary.productName
                              ?? inventorySummary.productReference
                              ?? t('settings.syncQueue.inventoryProductFallback')
                            : undefined;
                          const chantierName = inventorySummary?.chantierName
                            ?? chantiers.find(chantier => chantier.id === inventorySummary?.chantierId)?.name;
                          const businessMeta = inventorySummary
                            ? [
                                inventorySummary.productReference && inventorySummary.productReference !== productTitle
                                  ? t('settings.syncQueue.inventoryReference', { reference: inventorySummary.productReference })
                                  : null,
                                inventorySummary.quantity !== undefined
                                  ? t('settings.syncQueue.inventoryQuantity', {
                                      quantity: inventorySummary.quantity.toLocaleString(appLocale),
                                      unit: inventorySummary.unit ? ` ${inventorySummary.unit}` : '',
                                    })
                                  : null,
                                chantierName
                                  ? t('settings.syncQueue.inventorySite', { site: chantierName })
                                  : null,
                              ].filter(Boolean).join(' · ')
                            : '';

                          return (
                            <View key={op.id} style={styles.queueItem}>
                              <View style={[styles.queueItemDot, op.lastError && styles.queueItemDotErr]} />
                              <View style={{ flex: 1 }}>
                                <Text style={styles.queueItemTitle}>{movementTitle}</Text>
                                {productTitle && <Text style={styles.queueItemProduct}>{productTitle}</Text>}
                                {!!businessMeta && <Text style={styles.queueItemMeta}>{businessMeta}</Text>}
                                <Text style={styles.queueItemMeta}>
                                  {new Date(inventorySummary?.occurredAt ?? op.queuedAt).toLocaleString(appLocale)}
                                  {op.terminal ? ` · ${t('settings.syncQueue.rejectedStatus')}` : ''}
                                </Text>
                                {!!userMessage && <Text style={styles.queueItemError}>{userMessage}</Text>}
                                {inventorySummary?.serverStock !== undefined && (
                                  <Text style={styles.queueServerStock}>
                                    {t('settings.syncQueue.inventoryServerStock', {
                                      stock: inventorySummary.serverStock.toLocaleString(appLocale),
                                      unit: inventorySummary.unit ? ` ${inventorySummary.unit}` : '',
                                    })}
                                  </Text>
                                )}
                                <TouchableOpacity
                                  style={styles.operationTechnicalToggle}
                                  onPress={() => toggleOperationDetails(op.id)}
                                  accessibilityRole="button"
                                  accessibilityLabel={t('settings.syncQueue.technicalDetails')}
                                  accessibilityState={{ expanded: detailsOpen }}
                                >
                                  <Text style={styles.operationTechnicalToggleText}>
                                    {t(detailsOpen
                                      ? 'settings.syncQueue.hideTechnicalDetails'
                                      : 'settings.syncQueue.technicalDetails')}
                                  </Text>
                                  <Ionicons name={detailsOpen ? 'chevron-up' : 'chevron-down'} size={14} color={C.textSub} />
                                </TouchableOpacity>
                                {detailsOpen && (
                                  <View style={styles.operationTechnicalPanel}>
                                    <Text style={styles.operationTechnicalText} selectable>
                                      {op.op.toUpperCase()} · {op.rpc?.fn ?? op.table}
                                    </Text>
                                    <Text style={styles.operationTechnicalText} selectable>
                                      {t('settings.syncQueue.technicalStatus')}: {op.terminalStatus ?? syncStatus}
                                      {op.attemptCount ? ` · ${t('settings.syncQueue.failures', { count: op.attemptCount })}` : ''}
                                    </Text>
                                    {!!op.lastError && (
                                      <Text style={styles.operationTechnicalText} selectable>
                                        {t('settings.syncQueue.technicalError')}: {op.lastError}
                                      </Text>
                                    )}
                                    <Text style={styles.operationTechnicalText} selectable>
                                      {t('settings.syncQueue.technicalId')}: {op.id}
                                    </Text>
                                  </View>
                                )}
                              </View>
                            </View>
                          );
                        })}
                        {queue.length > 5 && (
                          <Text style={styles.queueMore}>{t('settings.syncQueue.more', { count: queue.length - 5 })}</Text>
                        )}
                        {queueHasAuthError && (
                          <TouchableOpacity
                            style={styles.queueReconnectBtn}
                            onPress={() => { void reconnectExpiredSession(); }}
                            accessibilityRole="button"
                            accessibilityLabel={t('settings.syncQueue.reconnectAction')}
                          >
                            <Ionicons name="log-in-outline" size={15} color="#fff" />
                            <Text style={styles.queueReconnectTxt}>{t('settings.syncQueue.reconnectAction')}</Text>
                          </TouchableOpacity>
                        )}
                        <View style={styles.queueActionsRow}>
                          {queueCount > 0 && (
                            <TouchableOpacity
                              style={[styles.queueRetryBtn, (!isOnline || syncStatus === 'syncing') && styles.queueBtnDisabled]}
                              onPress={() => { if (isOnline && syncStatus !== 'syncing') retrySync(); }}
                              disabled={!isOnline || syncStatus === 'syncing'}
                              accessibilityRole="button"
                              accessibilityLabel={t(rejectedCount > 0
                                ? 'settings.syncQueue.retryPendingAction'
                                : 'common.retry')}
                              accessibilityState={{ disabled: !isOnline || syncStatus === 'syncing', busy: syncStatus === 'syncing' }}
                            >
                              <Ionicons
                                name={syncStatus === 'syncing' ? 'sync' : 'refresh'}
                                size={16}
                                color={!isOnline || syncStatus === 'syncing' ? '#6B7280' : '#047857'}
                              />
                              <Text style={[styles.queueRetryTxt, (!isOnline || syncStatus === 'syncing') && styles.queueBtnDisabledTxt]}>
                                {syncStatus === 'syncing'
                                  ? (syncProgress.total > 0 ? t('settings.syncQueue.syncProgress', { done: syncProgress.done, total: syncProgress.total }) : t('settings.syncQueue.syncing'))
                                  : !isOnline
                                    ? t('common.offline')
                                    : t(rejectedCount > 0
                                      ? 'settings.syncQueue.retryPendingAction'
                                      : 'common.retry')}
                              </Text>
                            </TouchableOpacity>
                          )}
                          {rejectedCount > 0 ? (
                            <TouchableOpacity
                              style={styles.queueReviewBtn}
                              onPress={handleDismissRejectedOperations}
                              accessibilityRole="button"
                              accessibilityLabel={t('settings.syncQueue.dismissRejectedAction', { count: rejectedCount })}
                              accessibilityHint={t('settings.syncQueue.dismissRejectedHint')}
                            >
                              <Ionicons name="checkmark-done-outline" size={16} color={C.primary} />
                              <Text style={styles.queueReviewTxt}>{t('settings.syncQueue.dismissRejectedAction', { count: rejectedCount })}</Text>
                            </TouchableOpacity>
                          ) : queueCount > 0 ? (
                            <TouchableOpacity
                              style={styles.queueClearBtn}
                              onPress={handleClearQueue}
                              accessibilityRole="button"
                            >
                              <Ionicons name="trash-outline" size={16} color="#DC2626" />
                              <Text style={styles.queueClearTxt}>{t('settings.syncQueue.clearAction')}</Text>
                            </TouchableOpacity>
                          ) : null}
                        </View>
                      </View>
                    )}

                    <TouchableOpacity
                      style={styles.diagRefreshBtn}
                      onPress={runDiagnostic}
                      accessibilityRole="button"
                      accessibilityLabel={t('settings.diagnostic.refresh')}
                    >
                      <Ionicons name="refresh" size={14} color={C.primary} />
                      <Text style={styles.diagRefreshTxt}>{t('settings.diagnostic.refresh')}</Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            )}

            <TouchableOpacity style={[styles.navRow, styles.navRowDanger]} onPress={handleLogout}>
              <View style={[styles.navIcon, { backgroundColor: '#FEF2F2' }]}>
                <Ionicons name="log-out-outline" size={18} color="#EF4444" />
              </View>
              <Text style={[styles.navLabel, { color: '#EF4444', flex: 1 }]}>{t('settings.logoutAction')}</Text>
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
            {canManageProject && (
              <View style={styles.statsGrid}>
                {[
                  { icon: 'warning-outline', label: t('settings.projectTab.stats.reserves'), val: companies.length > 0 ? '—' : '0', color: C.waiting },
                  { icon: 'people-outline', label: t('settings.projectTab.stats.companies'), val: String(companies.length), color: C.primary },
                  { icon: 'folder-open-outline', label: t('settings.projectTab.stats.documents'), val: '—', color: C.inProgress },
                  { icon: 'shield-outline', label: t('settings.projectTab.stats.incidents'), val: '—', color: '#EF4444' },
                ].map(s => (
                  <View key={s.label} style={styles.statBox}>
                    <Ionicons name={s.icon as any} size={20} color={s.color} />
                    <Text style={[styles.statNum, { color: s.color }]}>{s.val}</Text>
                    <Text style={styles.statLbl}>{s.label}</Text>
                  </View>
                ))}
              </View>
            )}

            {canManageProject && (
              <View style={[styles.card, { marginBottom: 14 }]}>
                <Text style={styles.cardTitle}>{t('settings.projectTab.quickAccess')}</Text>
                {[
                  { icon: 'people', label: t('settings.projectTab.quickTeams'), route: '/(tabs)/equipes', color: '#EC4899' },
                  { icon: 'document-text', label: t('settings.projectTab.quickReports'), route: '/rapports', color: C.verification },
                  { icon: 'map', label: t('settings.projectTab.quickPlans'), route: '/(tabs)/plans', color: C.closed },
                  { icon: 'calendar', label: t('settings.projectTab.quickPlanning'), route: '/planning', color: C.primary },
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

            {canManageProject ? (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>{t('settings.projectTab.projectInfo')}</Text>

                <Text style={styles.label}>{t('settings.projectTab.projectName')}</Text>
                <TextInput
                  style={styles.input}
                  value={nameInput}
                  onChangeText={setNameInput}
                  placeholder={t('settings.projectTab.projectNamePlaceholder')}
                  placeholderTextColor={C.textMuted}
                  maxLength={60}
                />

                <Text style={styles.label}>{t('settings.projectTab.description')}</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  value={descInput}
                  onChangeText={setDescInput}
                  placeholder={t('settings.projectTab.descriptionPlaceholder')}
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
                  <Text style={styles.saveBtnText}>{saving ? t('settings.projectTab.saving') : t('common.save')}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={[styles.card, { alignItems: 'center', paddingVertical: 28 }]}>
                <Ionicons name="lock-closed-outline" size={32} color={C.textMuted} />
                <Text style={[styles.cardTitle, { marginTop: 10, textAlign: 'center' }]}>{t('settings.projectTab.adminOnly')}</Text>
                <Text style={[styles.emptyText, { textAlign: 'center', marginTop: 4 }]}>{t('settings.projectTab.projectNameReadOnly', { name: projectName })}</Text>
              </View>
            )}

            <View style={styles.infoCard}>
              <View style={styles.infoRow}>
                <Ionicons name="information-circle-outline" size={16} color={C.primary} />
                <Text style={styles.infoText}>
                  {t('settings.projectTab.projectNameInfo')}
                </Text>
              </View>
            </View>
          </View>
        )}

        {activeTab === 'attendance' && !isSousTraitant && (
          <View>
            <View style={[styles.card, { marginBottom: 14 }]}>
              <Text style={styles.cardTitle}>{t('settings.attendanceTab.preferences')}</Text>

              <Text style={styles.label}>{t('settings.attendanceTab.defaultArrival')}</Text>
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
              <Text style={[styles.emptyText, { marginTop: 6 }]}>{t('settings.attendanceTab.defaultArrivalHint')}</Text>

              <View style={{ height: 1, backgroundColor: C.border, marginVertical: 14 }} />

              <Text style={styles.label}>{t('settings.attendanceTab.standardDay')}</Text>
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
                {t('settings.attendanceTab.standardDayHint')}
              </Text>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>{t('settings.attendanceTab.todayAttendance')}</Text>
              {companies.length === 0 ? (
                <Text style={styles.emptyText}>{t('settings.attendanceTab.noConfiguredCompany')}</Text>
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
                  <Text style={styles.snapshotBtnText}>{t('settings.attendanceTab.saveSnapshotActionFull')}</Text>
                </TouchableOpacity>
              )}
            </View>

            {grouped.length === 0 ? (
              <View style={styles.emptyHistory}>
                <Ionicons name="time-outline" size={40} color={C.border} />
                <Text style={styles.emptyTitle}>{t('settings.attendanceTab.noHistory')}</Text>
                <Text style={styles.emptyText}>
                  {t('settings.attendanceTab.noHistoryText')}
                </Text>
              </View>
            ) : (
              <>
                <View style={styles.historyHeader}>
                  <Text style={styles.historyTitle}>{t('settings.attendanceTab.historyTitle', { count: totalDays })}</Text>
                  {permissions.canUpdateAttendance && (
                    <TouchableOpacity onPress={handleClearHistory}>
                      <Text style={styles.clearText}>{t('settings.attendanceTab.clearAll')}</Text>
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
                        <Text style={styles.dayTotal}>{t('settings.attendanceTab.dayTotal', { workers: totalWorkers, hours: totalHours })}</Text>
                      </View>
                      {records.map(r => (
                        <View key={r.id} style={styles.recRow}>
                          <View style={[styles.coDot, { backgroundColor: r.companyColor }]} />
                          <Text style={styles.recName}>{r.companyName}</Text>
                          <Text style={[styles.recVal, { color: r.companyColor }]}>{t('settings.attendanceTab.peopleShort', { count: r.workers })}</Text>
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
                <Text style={[styles.cardTitle, { marginTop: 14, textAlign: 'center' }]}>{t('settings.integrationsTab.adminOnly')}</Text>
                <Text style={[styles.emptyText, { textAlign: 'center', marginTop: 6 }]}>
                  {t('settings.integrationsTab.adminOnlyText')}
                </Text>
              </View>
            ) : (<>
            {(subscription?.status === 'suspended' || subscription?.status === 'expired') && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#FEF2F2', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#FCA5A5', marginBottom: 12 }}>
                <Ionicons name={subscription.status === 'expired' ? 'time-outline' : 'pause-circle-outline'} size={20} color="#EF4444" />
                <Text style={{ flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: '#EF4444', lineHeight: 18 }}>
                  {subscription.status === 'expired'
                    ? t('settings.integrationsTab.subscriptionExpired')
                    : t('settings.integrationsTab.subscriptionSuspended')}
                </Text>
              </View>
            )}
            <View style={styles.integroBanner}>
              <Ionicons name="apps" size={28} color={C.primary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.introBannerTitle}>{t('settings.integrationsTab.title')}</Text>
                <Text style={styles.introBannerSub}>{t('settings.integrationsTab.subtitle')}</Text>
              </View>
            </View>
            {[
              { icon: 'construct-outline',        label: t('settings.integrationsTab.projectManagement'), desc: 'Procore', color: C.primary },
              { icon: 'cube-outline',             label: t('settings.integrationsTab.bim'), desc: 'ArchiCAD, Autodesk Revit', color: '#7C3AED' },
              { icon: 'document-text-outline',    label: t('settings.integrationsTab.regulatoryDocs'), desc: 'e-Diffusion BTP', color: '#0891B2' },
              { icon: 'location-outline',         label: t('settings.integrationsTab.geolocation'), desc: 'Géosat GPS', color: '#059669' },
              { icon: 'receipt-outline',          label: t('settings.integrationsTab.fieldForms'), desc: 'Kizeo Forms', color: C.inProgress },
              { icon: 'cloud-outline',            label: t('settings.integrationsTab.documentsSignature'), desc: 'DocuWare, Signaturit', color: '#BE185D' },
              { icon: 'partly-sunny-outline',     label: t('settings.integrationsTab.weatherHr'), desc: 'Météo-France, URSSAF', color: '#F59E0B' },
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
              <Text style={styles.saveBtnText}>{t('settings.integrationsTab.manage')}</Text>
            </TouchableOpacity>
            <View style={{ height: 40 }} />
            </>
            )}
          </View>
        )}
      </ScrollView>
      </PageContainer>
      {!isWarehouseUser && <BottomNavBar />}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  tabScroll: {
    borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.surface,
    minHeight: 64, flexShrink: 0, flexGrow: 0,
  },
  tabRow: {
    flexDirection: 'row', gap: 6, paddingHorizontal: 12, paddingVertical: 8,
    alignItems: 'center',
  },
  tabBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    minHeight: 48, paddingVertical: 10, paddingHorizontal: 14, borderRadius: 10, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border,
    flexShrink: 0,
  },
  tabBtnActive: { backgroundColor: C.primaryBg, borderColor: C.primary },
  tabText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.textSub },
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
  languageDivider: { height: 1, backgroundColor: C.borderLight, marginVertical: 18 },

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
  diagLabel: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub, flexShrink: 0 },
  diagValue: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.text, flex: 1, textAlign: 'right' },
  diagAlertOk: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#ECFDF5', borderRadius: 10, padding: 12, marginTop: 12, borderWidth: 1, borderColor: '#A7F3D0' },
  diagAlertWarn: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#FFFBEB', borderRadius: 10, padding: 12, marginTop: 12, borderWidth: 1, borderColor: '#FCD34D' },
  diagAlertError: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: '#FEF2F2', borderRadius: 10, padding: 12, marginTop: 12, borderWidth: 1, borderColor: '#FCA5A5' },
  diagAlertTextOk: { flex: 1, fontSize: 12, fontFamily: 'Inter_500Medium', color: '#065F46', lineHeight: 17 },
  diagAlertTextWarn: { flex: 1, fontSize: 12, fontFamily: 'Inter_500Medium', color: '#92400E', lineHeight: 17 },
  diagAlertTextError: { flex: 1, fontSize: 12, fontFamily: 'Inter_500Medium', color: '#991B1B', lineHeight: 17 },
  diagRefreshBtn: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, marginTop: 10, borderRadius: 10, backgroundColor: C.primaryBg, borderWidth: 1, borderColor: C.primary + '40' },
  diagRefreshTxt: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.primary },
  technicalToggle: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, paddingHorizontal: 10, borderRadius: 8, backgroundColor: C.surface2 },
  technicalToggleText: { flex: 1, fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  technicalPanel: { marginTop: 4, paddingHorizontal: 4 },
  queueBlock: { marginTop: 12, padding: 12, borderRadius: 10, backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A' },
  queueHeaderRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  queueHeaderTxt: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#78350F' },
  queueHint: { fontSize: 12, fontFamily: 'Inter_400Regular', color: '#78350F', lineHeight: 18, marginBottom: 8 },
  queueItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 8, borderTopWidth: 1, borderTopColor: '#FDE68A' },
  queueItemDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#F59E0B', marginTop: 6 },
  queueItemDotErr: { backgroundColor: '#EF4444' },
  queueItemTitle: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#78350F' },
  queueItemProduct: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text, marginTop: 2 },
  queueItemMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: '#78350F', marginTop: 2, lineHeight: 16 },
  queueItemError: { fontSize: 12, fontFamily: 'Inter_500Medium', color: '#991B1B', marginTop: 6, lineHeight: 17, backgroundColor: '#FEF2F2', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 6 },
  queueServerStock: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: '#065F46', marginTop: 6 },
  queueMore: { fontSize: 11, fontFamily: 'Inter_500Medium', color: '#78350F', textAlign: 'center', paddingVertical: 6 },
  queueActionsRow: { flexDirection: 'row', gap: 8, marginTop: 10 },
  queueRetryBtn: { minHeight: 48, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: '#6EE7B7', backgroundColor: '#ECFDF5' },
  queueRetryTxt: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#047857', textAlign: 'center' },
  queueBtnDisabled: { backgroundColor: '#F3F4F6', borderColor: '#E5E7EB' },
  queueBtnDisabledTxt: { color: '#6B7280' },
  queueReviewBtn: { minHeight: 48, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: C.primary + '55', backgroundColor: C.primaryBg },
  queueReviewTxt: { fontSize: 12, fontFamily: 'Inter_700Bold', color: C.primary, textAlign: 'center' },
  queueClearBtn: { minHeight: 48, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: '#FCA5A5', backgroundColor: '#FEF2F2' },
  queueClearTxt: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#DC2626', textAlign: 'center' },
  operationTechnicalToggle: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
  operationTechnicalToggleText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  operationTechnicalPanel: { borderRadius: 6, backgroundColor: C.surface2, padding: 8, marginBottom: 4 },
  operationTechnicalText: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textSub, lineHeight: 15 },
  queueAuthBanner: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: '#FCD34D', backgroundColor: '#FFFBEB', marginBottom: 8 },
  queueAuthBannerTxt: { flex: 1, fontSize: 11, fontFamily: 'Inter_500Medium', color: '#B45309', lineHeight: 16 },
  queueReconnectBtn: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10, borderRadius: 8, backgroundColor: C.primary, marginTop: 10 },
  queueReconnectTxt: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#fff' },

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
