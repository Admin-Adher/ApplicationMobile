import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, ActivityIndicator, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState, useMemo } from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { C } from '@/constants/colors';
import { useAuth, ROLE_PERMISSIONS } from '@/context/AuthContext';
import { useApp } from '@/context/AppContext';
import { useSubscription } from '@/context/SubscriptionContext';
import { UserRole, PermissionsOverride } from '@/constants/types';
import { ROLES, AVATAR_COLORS, FREE_ROLES, hashColor, ROLE_INFO } from '@/lib/adminUtils';
import {
  fetchUserEmailPreference,
  setUserEmailEnabled,
  type AdminEmailPreferenceState,
} from '@/lib/adminNotificationPreferences';

const PERMISSION_DEFS: { key: keyof PermissionsOverride }[] = [
  { key: 'canCreate' },
  { key: 'canEdit' },
  { key: 'canEditOwn' },
  { key: 'canDelete' },
  { key: 'canExport' },
  { key: 'canViewTeams' },
  { key: 'canUpdateAttendance' },
  { key: 'canMovePins' },
  { key: 'canEditChantier' },
  { key: 'canViewInventory' },
  { key: 'canRecordInventory' },
  { key: 'canManageInventoryProducts' },
  { key: 'canAdjustInventory' },
  { key: 'canExportInventory' },
];

function cycleOverride(current: boolean | undefined): boolean | undefined {
  if (current === undefined) return true;
  if (current === true) return false;
  return undefined;
}

function InitialAvatar({ name, color, size = 64 }: { name: string; color: string; size?: number }) {
  const initials = name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
  return (
    <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: color + '22' }]}>
      <Text style={[styles.avatarText, { color, fontSize: size * 0.34 }]}>{initials}</Text>
    </View>
  );
}

export default function UserEditScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const topPad = Platform.OS === 'web' ? 67 : insets.top;
  const bottomPad = Platform.OS === 'web' ? 20 : insets.bottom;

  const { user: currentUser, users, updateUserRole, updateUserCompany, updateUserPermissions } = useAuth();
  const { companies } = useApp();
  const { canInvite, seatMax, orgUsers } = useSubscription();

  const target = useMemo(() => users.find(u => u.id === id) ?? null, [users, id]);

  const isSuperAdmin = currentUser?.role === 'super_admin';
  const isAdmin = currentUser?.role === 'admin';

  const canAccessScreen = useMemo(() => {
    if (!target || !currentUser) return false;
    if (isSuperAdmin) return true;
    if (isAdmin) return target.role !== 'admin' && target.role !== 'super_admin';
    return false;
  }, [target, currentUser, isSuperAdmin, isAdmin]);

  const assignableRoles = useMemo<typeof ROLES>(() => {
    if (isSuperAdmin) return ROLES;
    return ROLES.filter(r => r.value !== 'admin');
  }, [isSuperAdmin]);

  const avatarColor = target ? hashColor(target.id, AVATAR_COLORS) : AVATAR_COLORS[0];
  const roleInfo = target ? (ROLE_INFO[target.role] ?? ROLE_INFO.observateur) : null;

  const [localRole, setLocalRole] = useState<UserRole>(target?.role ?? 'observateur');
  const [localCompanyId, setLocalCompanyId] = useState<string>(target?.companyId ?? '');
  const [localOverride, setLocalOverride] = useState<PermissionsOverride>(target?.permissionsOverride ?? {});
  const [emailPref, setEmailPref] = useState<AdminEmailPreferenceState | null>(null);
  const [emailPrefLoading, setEmailPrefLoading] = useState(false);
  const [emailPrefSaving, setEmailPrefSaving] = useState(false);
  const [emailPrefError, setEmailPrefError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!target || !canAccessScreen) return;
    let cancelled = false;
    setEmailPrefLoading(true);
    setEmailPrefError(null);
    fetchUserEmailPreference(target.id)
      .then(pref => {
        if (!cancelled) setEmailPref(pref);
      })
      .catch(err => {
        if (!cancelled) setEmailPrefError(err?.message ?? t('adminUserEdit.changeImpossible'));
      })
      .finally(() => {
        if (!cancelled) setEmailPrefLoading(false);
      });
    return () => { cancelled = true; };
  }, [canAccessScreen, target?.id]);

  if (!target || !canAccessScreen) {
    return (
      <View style={[styles.root, { paddingTop: topPad }]}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={24} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{t('adminUserEdit.title')}</Text>
        </View>
        <View style={styles.accessDenied}>
          <Ionicons name="lock-closed-outline" size={40} color={C.textMuted} />
          <Text style={styles.accessDeniedTitle}>{t('adminUserEdit.accessDenied')}</Text>
          <Text style={styles.accessDeniedDesc}>
            {!target
              ? t('adminUserEdit.userNotFound')
              : t('adminUserEdit.cannotEditAdmin')}
          </Text>
        </View>
      </View>
    );
  }

  const roleDefault = ROLE_PERMISSIONS[localRole];

  function togglePermission(key: keyof PermissionsOverride) {
    setLocalOverride(prev => {
      const next = { ...prev };
      const nextVal = cycleOverride(prev[key]);
      if (nextVal === undefined) {
        delete next[key];
      } else {
        next[key] = nextVal;
      }
      return next;
    });
  }

  function resetPermissions() {
    Alert.alert(
      t('adminUserEdit.resetPermissionsTitle'),
      t('adminUserEdit.resetPermissionsMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('adminUserEdit.reset'),
          style: 'destructive',
          onPress: () => setLocalOverride({}),
        },
      ]
    );
  }

  function handleToggleEmails() {
    if (!target || emailPrefSaving) return;
    const currentlyEnabled = emailPref?.emailEnabled !== false;
    const nextEnabled = !currentlyEnabled;
    Alert.alert(
      nextEnabled ? t('adminUserEdit.enableEmails') : t('adminUserEdit.disableEmails'),
      nextEnabled
        ? t('adminUserEdit.enableEmailsMessage', { name: target.name })
        : t('adminUserEdit.disableEmailsMessage', { name: target.name }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: nextEnabled ? t('adminUserEdit.enableEmails') : t('adminUserEdit.disableEmails'),
          style: nextEnabled ? 'default' : 'destructive',
          onPress: async () => {
            setEmailPrefSaving(true);
            setEmailPrefError(null);
            try {
              const pref = await setUserEmailEnabled(target.id, nextEnabled);
              setEmailPref(pref);
            } catch (err: any) {
              setEmailPrefError(err?.message ?? t('adminUserEdit.changeImpossible'));
              Alert.alert(t('common.error'), err?.message ?? t('adminUserEdit.emailChangeFailed'));
            } finally {
              setEmailPrefSaving(false);
            }
          },
        },
      ],
    );
  }

  const isDirty = useMemo(() => {
    if (localRole !== target.role) return true;
    if ((localCompanyId || undefined) !== (target.companyId ?? undefined)) return true;
    const orig = target.permissionsOverride ?? {};
    const origKeys = Object.keys(orig);
    const newKeys = Object.keys(localOverride);
    if (origKeys.length !== newKeys.length) return true;
    return newKeys.some(k => (localOverride as any)[k] !== (orig as any)[k]);
  }, [localRole, localCompanyId, localOverride, target]);

  async function handleSave() {
    if (!target) return;
    if (!isDirty) { router.back(); return; }

    const roleChanged = localRole !== target.role;
    const companyChanged = (localCompanyId || null) !== (target.companyId ?? null);
    const overrideChanged = isDirty && !roleChanged && !companyChanged ? true :
      JSON.stringify(localOverride) !== JSON.stringify(target.permissionsOverride ?? {});

    if (roleChanged && target.id === currentUser?.id && localRole !== 'admin') {
      Alert.alert(t('common.error'), t('adminUserEdit.cannotRemoveOwnAdmin'));
      return;
    }

    if (roleChanged) {
      const isPaid = !FREE_ROLES.includes(localRole);
      const wasFree = FREE_ROLES.includes(target.role);
      if (isPaid && wasFree && !canInvite) {
        Alert.alert(
          t('adminUserEdit.seatsTitle'),
          t('adminUserEdit.seatsMessage', { count: seatMax }),
          [{ text: 'OK', style: 'cancel' }]
        );
        return;
      }
      if (target.role === 'admin' && localRole !== 'admin') {
        const remaining = orgUsers.filter(u => u.role === 'admin' && u.id !== target.id).length;
        if (remaining === 0) {
          Alert.alert(
            t('adminUserEdit.lastAdminTitle'),
            t('adminUserEdit.lastAdminMessage', { name: target.name }),
            [
              { text: t('common.cancel'), style: 'cancel' },
              { text: t('adminUserEdit.changeAnyway'), style: 'destructive', onPress: () => doSave(roleChanged, companyChanged, overrideChanged) },
            ]
          );
          return;
        }
      }
    }

    await doSave(roleChanged, companyChanged, overrideChanged);
  }

  async function doSave(roleChanged: boolean, companyChanged: boolean, overrideChanged: boolean) {
    if (!target) return;
    setSaving(true);
    try {
      if (roleChanged) await updateUserRole(target.id, localRole);
      if (companyChanged) await updateUserCompany(target.id, localCompanyId || null);
      if (overrideChanged) await updateUserPermissions(target.id, localOverride);
      router.back();
    } catch (err: any) {
      console.warn('[UserEditScreen] save failed:', err?.message ?? err);
      if (err?.message) {
        Alert.alert(t('common.error'), err.message);
        return;
      }
      Alert.alert(t('common.error'), t('adminUserEdit.saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  const overrideCount = Object.keys(localOverride).length;

  return (
    <View style={[styles.root, { paddingTop: topPad }]}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} accessibilityLabel={t('adminUserEdit.back')}>
          <Ionicons name="chevron-back" size={24} color={C.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{t('adminUserEdit.title')}</Text>
        {isDirty && !saving && (
          <View style={styles.dirtyPill}>
            <Text style={styles.dirtyPillTxt}>{t('adminUserEdit.unsaved')}</Text>
          </View>
        )}
        {saving && <ActivityIndicator size="small" color={C.primary} style={{ marginLeft: 8 }} />}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: bottomPad + 24 }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.userCard}>
          <InitialAvatar name={target.name} color={avatarColor} size={64} />
          <View style={styles.userCardInfo}>
            <Text style={styles.userName}>{target.name}</Text>
            <Text style={styles.userEmail}>{target.email}</Text>
            <View style={styles.userCardBadgesRow}>
              <View style={[styles.roleBadge, { backgroundColor: (roleInfo?.bg ?? '#F3F4F6') }]}>
                <Text style={[styles.roleBadgeTxt, { color: roleInfo?.color ?? C.textSub }]}>
                  {t(`roles.${target.role}`, { defaultValue: roleInfo?.label ?? target.roleLabel })}
                </Text>
              </View>
              {(() => {
                const co = companies.find(c => c.id === (localCompanyId || target.companyId));
                if (!co) return null;
                return (
                  <View style={styles.userCardCompanyPill}>
                    <Ionicons name="business-outline" size={10} color={co.color || C.textMuted} />
                    <Text style={styles.userCardCompanyPillText} numberOfLines={1}>{co.name}</Text>
                  </View>
                );
              })()}
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.emailAdminHeader}>
            <View style={[
              styles.emailAdminIcon,
              { backgroundColor: emailPref?.emailEnabled === false ? '#FEF2F2' : '#ECFDF5' },
            ]}>
              <Ionicons
                name={emailPref?.emailEnabled === false ? 'mail-unread-outline' : 'mail-outline'}
                size={18}
                color={emailPref?.emailEnabled === false ? '#EF4444' : '#059669'}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionTitle}>{t('adminUserEdit.emailTitle')}</Text>
              <Text style={styles.sectionHint}>
                {t('adminUserEdit.emailHint')}
              </Text>
            </View>
          </View>

          <View style={styles.emailAdminStateRow}>
            <View style={[
              styles.emailStateDot,
              { backgroundColor: emailPref?.emailEnabled === false ? '#EF4444' : '#10B981' },
            ]} />
            <Text style={styles.emailAdminStateText}>
              {emailPrefLoading
                ? t('adminUserEdit.emailLoading')
                : emailPref?.emailEnabled === false
                  ? t('adminUserEdit.emailsDisabled')
                  : t('adminUserEdit.emailsAllowed')}
            </Text>
          </View>

          <Text style={styles.emailAdminDesc}>
            {t('adminUserEdit.emailDesc')}
          </Text>

          {!!emailPrefError && (
            <View style={styles.emailAdminError}>
              <Ionicons name="warning-outline" size={14} color="#991B1B" />
              <Text style={styles.emailAdminErrorText}>{emailPrefError}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[
              styles.emailAdminBtn,
              emailPref?.emailEnabled === false ? styles.emailAdminBtnEnable : styles.emailAdminBtnDisable,
              (emailPrefLoading || emailPrefSaving) && styles.emailAdminBtnDisabled,
            ]}
            onPress={handleToggleEmails}
            disabled={emailPrefLoading || emailPrefSaving}
            activeOpacity={0.75}
          >
            {emailPrefSaving ? (
              <ActivityIndicator size="small" color={emailPref?.emailEnabled === false ? C.primary : '#fff'} />
            ) : (
              <>
                <Ionicons
                  name={emailPref?.emailEnabled === false ? 'mail-outline' : 'mail-unread-outline'}
                  size={16}
                  color={emailPref?.emailEnabled === false ? C.primary : '#fff'}
                />
                <Text style={[
                  styles.emailAdminBtnText,
                  emailPref?.emailEnabled === false && { color: C.primary },
                ]}>
                  {emailPref?.emailEnabled === false ? t('adminUserEdit.enableEmails') : t('adminUserEdit.disableEmails')}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('adminUserEdit.role')}</Text>
          <View style={styles.roleList}>
            {assignableRoles.map(r => {
              const selected = localRole === r.value;
              return (
                <TouchableOpacity
                  key={r.value}
                  style={[styles.roleOption, selected && { borderColor: r.color, backgroundColor: r.bg }]}
                  onPress={() => setLocalRole(r.value as UserRole)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.roleOptionDot, { backgroundColor: r.color }]} />
                  <View style={styles.roleOptionBody}>
                    <Text style={[styles.roleOptionName, { color: selected ? r.color : C.text }]}>
                      {t(`roles.${r.value}`, { defaultValue: r.label })}
                    </Text>
                    <Text style={styles.roleOptionDesc} numberOfLines={2}>
                      {t(`roleDescriptions.${r.value}`, { defaultValue: r.description })}
                    </Text>
                  </View>
                  <View style={[
                    styles.radioCircle,
                    selected && { borderColor: r.color, backgroundColor: r.color },
                  ]}>
                    {selected && <View style={styles.radioDot} />}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('adminUserEdit.company')}</Text>
          <Text style={styles.sectionHint}>{t('adminUserEdit.companyHint')}</Text>
          <View style={styles.companyGrid}>
            <TouchableOpacity
              style={[styles.companyChip, !localCompanyId && styles.companyChipSelected]}
              onPress={() => setLocalCompanyId('')}
              activeOpacity={0.7}
            >
              <Ionicons name="close-circle-outline" size={14} color={!localCompanyId ? C.primary : C.textMuted} />
              <Text style={[styles.companyChipTxt, !localCompanyId && { color: C.primary }]}>{t('adminUserEdit.none')}</Text>
            </TouchableOpacity>
            {companies.map(co => {
              const selected = localCompanyId === co.id;
              return (
                <TouchableOpacity
                  key={co.id}
                  style={[
                    styles.companyChip,
                    selected && { borderColor: co.color, backgroundColor: co.color + '15' },
                  ]}
                  onPress={() => setLocalCompanyId(co.id)}
                  activeOpacity={0.7}
                >
                  <View style={[styles.companyDot, { backgroundColor: co.color }]} />
                  <Text style={[styles.companyChipTxt, selected && { color: co.color }]} numberOfLines={1}>
                    {co.shortName}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        <View style={styles.section}>
          <View style={styles.permHeaderRow}>
            <View style={styles.permHeaderLeft}>
              <Text style={styles.sectionTitle}>{t('adminUserEdit.advancedPermissions')}</Text>
              {overrideCount > 0 && (
                <View style={styles.overrideBadge}>
                  <Text style={styles.overrideBadgeTxt}>{t('adminUserEdit.overload', { count: overrideCount })}</Text>
                </View>
              )}
            </View>
            {overrideCount > 0 && (
              <TouchableOpacity style={styles.resetBtn} onPress={resetPermissions} activeOpacity={0.7}>
                <Ionicons name="refresh-outline" size={13} color={C.textSub} />
                <Text style={styles.resetBtnTxt}>{t('adminUserEdit.reset')}</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.legendRow}>
            <LegendItem icon="ellipse" color={C.border} label={t('adminUserEdit.roleDefault')} />
            <LegendItem icon="checkmark-circle" color="#10B981" label={t('adminUserEdit.manuallyEnabled')} />
            <LegendItem icon="close-circle" color="#EF4444" label={t('adminUserEdit.manuallyDisabled')} />
          </View>

          <View style={styles.permList}>
            {PERMISSION_DEFS.map(perm => {
              const overrideVal = localOverride[perm.key];
              const roleVal = roleDefault[perm.key];
              const effective = overrideVal !== undefined ? overrideVal : roleVal;
              const isOverridden = overrideVal !== undefined;

              let stateIcon: any;
              let stateColor: string;
              let stateLabel: string;

              if (!isOverridden) {
                stateIcon = 'ellipse';
                stateColor = C.border;
                stateLabel = roleVal ? t('adminUserEdit.enabledByRole') : t('adminUserEdit.disabledByRole');
              } else if (overrideVal === true) {
                stateIcon = 'checkmark-circle';
                stateColor = '#10B981';
                stateLabel = t('adminUserEdit.manuallyEnabled');
              } else {
                stateIcon = 'close-circle';
                stateColor = '#EF4444';
                stateLabel = t('adminUserEdit.manuallyDisabled');
              }

              return (
                <TouchableOpacity
                  key={perm.key}
                  style={[styles.permRow, isOverridden && styles.permRowOverridden]}
                  onPress={() => togglePermission(perm.key)}
                  activeOpacity={0.7}
                >
                  <View style={styles.permRowLeft}>
                    <View style={[styles.permEffectiveDot, { backgroundColor: effective ? '#10B981' : '#E5E7EB' }]} />
                    <View style={styles.permRowBody}>
                      <Text style={styles.permLabel}>{t(`adminUserEdit.permissions.${perm.key}.0`)}</Text>
                      <Text style={styles.permDesc} numberOfLines={1}>{t(`adminUserEdit.permissions.${perm.key}.1`)}</Text>
                    </View>
                  </View>
                  <View style={styles.permRowRight}>
                    {isOverridden && (
                      <View style={styles.overriddenPill}>
                        <Text style={styles.overriddenPillTxt}>{t('adminUserEdit.overload')}</Text>
                      </View>
                    )}
                    <Ionicons name={stateIcon} size={22} color={stateColor} />
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          <Text style={styles.permHint}>
            {t('adminUserEdit.permissionsHint')}
          </Text>
        </View>
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: bottomPad + 8 }]}>
        <TouchableOpacity style={styles.cancelBtn} onPress={() => router.back()} activeOpacity={0.7}>
          <Text style={styles.cancelBtnTxt}>{t('common.cancel')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.saveBtn, (!isDirty || saving) && styles.saveBtnDisabled]}
          onPress={handleSave}
          disabled={!isDirty || saving}
          activeOpacity={0.7}
        >
          {saving
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={styles.saveBtnTxt}>{t('adminUserEdit.save')}</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

function LegendItem({ icon, color, label }: { icon: any; color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <Ionicons name={icon} size={13} color={color} />
      <Text style={styles.legendLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },

  header: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingBottom: 12,
    backgroundColor: C.surface,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  backBtn: { padding: 4, marginRight: 2 },
  headerTitle: { flex: 1, fontSize: 17, fontFamily: 'Inter_700Bold', color: C.text },
  dirtyPill: {
    backgroundColor: '#FFF3CD', borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 3,
  },
  dirtyPillTxt: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#92400E' },

  scroll: { flex: 1 },
  scrollContent: { padding: 16, gap: 16 },

  userCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: C.surface, borderRadius: 14,
    padding: 16, borderWidth: 1, borderColor: C.border,
  },
  avatar: { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarText: { fontFamily: 'Inter_700Bold' },
  userCardInfo: { flex: 1, gap: 4 },
  userName: { fontSize: 17, fontFamily: 'Inter_700Bold', color: C.text },
  userEmail: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted },
  roleBadge: {
    alignSelf: 'flex-start', borderRadius: 6,
    paddingHorizontal: 8, paddingVertical: 3, marginTop: 2,
  },
  roleBadgeTxt: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },
  userCardBadgesRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  userCardCompanyPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 3,
    maxWidth: 200,
  },
  userCardCompanyPillText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: '#374151' },

  section: {
    backgroundColor: C.surface, borderRadius: 14,
    padding: 16, borderWidth: 1, borderColor: C.border, gap: 12,
  },
  sectionTitle: { fontSize: 14, fontFamily: 'Inter_700Bold', color: C.text },
  sectionHint: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: -6 },
  emailAdminHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  emailAdminIcon: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  emailAdminStateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: C.surface2,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  emailStateDot: { width: 8, height: 8, borderRadius: 4 },
  emailAdminStateText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: C.text },
  emailAdminDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, lineHeight: 17 },
  emailAdminError: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FEF2F2',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: '#FCA5A5',
  },
  emailAdminErrorText: { flex: 1, fontSize: 12, fontFamily: 'Inter_500Medium', color: '#991B1B', lineHeight: 16 },
  emailAdminBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 11,
    paddingVertical: 12,
    borderWidth: 1,
  },
  emailAdminBtnDisable: { backgroundColor: '#EF4444', borderColor: '#EF4444' },
  emailAdminBtnEnable: { backgroundColor: C.primaryBg, borderColor: C.primary + '40' },
  emailAdminBtnDisabled: { opacity: 0.6 },
  emailAdminBtnText: { fontSize: 13, fontFamily: 'Inter_700Bold', color: '#fff' },

  roleList: { gap: 8 },
  roleOption: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1.5, borderColor: C.border, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10, backgroundColor: C.surface,
  },
  roleOptionDot: { width: 9, height: 9, borderRadius: 5, flexShrink: 0 },
  roleOptionBody: { flex: 1 },
  roleOptionName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  roleOptionDesc: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
  radioCircle: {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 1.5, borderColor: C.border,
    alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },

  companyGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  companyChip: {
    flexDirection: 'row', alignItems: 'center', gap: 5,
    borderWidth: 1.5, borderColor: C.border, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 7, backgroundColor: C.surface,
  },
  companyChipSelected: { borderColor: C.primary, backgroundColor: C.primaryBg },
  companyChipTxt: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub, maxWidth: 90 },
  companyDot: { width: 7, height: 7, borderRadius: 4 },

  permHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  permHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  overrideBadge: {
    backgroundColor: '#EFF6FF', borderRadius: 6,
    paddingHorizontal: 7, paddingVertical: 2,
  },
  overrideBadgeTxt: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.primary },
  resetBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 7, backgroundColor: C.surface2,
    borderWidth: 1, borderColor: C.border,
  },
  resetBtnTxt: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub },

  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: -4 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },

  permList: { gap: 6 },
  permRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 12, paddingVertical: 11,
    backgroundColor: C.surface, borderRadius: 10,
    borderWidth: 1, borderColor: C.border,
  },
  permRowOverridden: { borderColor: C.primary + '44', backgroundColor: C.primaryBg + '66' },
  permRowLeft: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 },
  permEffectiveDot: { width: 8, height: 8, borderRadius: 4, flexShrink: 0 },
  permRowBody: { flex: 1 },
  permLabel: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text },
  permDesc: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1 },
  permRowRight: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 8 },
  overriddenPill: {
    backgroundColor: C.primary + '18', borderRadius: 5,
    paddingHorizontal: 5, paddingVertical: 2,
  },
  overriddenPillTxt: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.primary },

  permHint: {
    fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted,
    lineHeight: 16, marginTop: -4,
  },

  footer: {
    flexDirection: 'row', gap: 10,
    paddingHorizontal: 16, paddingTop: 12,
    backgroundColor: C.surface,
    borderTopWidth: 1, borderTopColor: C.border,
  },
  cancelBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 14, borderRadius: 11, backgroundColor: C.surface2,
    borderWidth: 1, borderColor: C.border,
  },
  cancelBtnTxt: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  saveBtn: {
    flex: 2, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 14, borderRadius: 11, backgroundColor: C.primary,
  },
  saveBtnDisabled: { opacity: 0.45 },
  saveBtnTxt: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },

  accessDenied: {
    flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 40,
  },
  accessDeniedTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: C.text },
  accessDeniedDesc: {
    fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textMuted,
    textAlign: 'center', lineHeight: 20,
  },
});
