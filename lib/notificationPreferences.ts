import type { NotificationPreferences } from '@/constants/types';

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  inAppEnabled: true,
  pushEnabled: true,
  emailEnabled: true,
  messagesInApp: true,
  messagesPush: true,
  messagesEmail: false,
  reserveCreatedInApp: true,
  reserveCreatedPush: true,
  reserveCreatedEmail: true,
  reserveStatusInApp: true,
  reserveStatusPush: true,
  reserveStatusEmail: true,
  reserveCriticalInApp: true,
  reserveCriticalPush: true,
  reserveCriticalEmail: true,
  reserveOverdueInApp: true,
  reserveOverduePush: true,
  reserveOverdueEmail: true,
  dueSoonInApp: true,
  taskLateInApp: true,
  criticalAlwaysPush: true,
  quietHoursEnabled: false,
  quietHoursStart: '19:00',
  quietHoursEnd: '07:00',
  quietHoursTimezone: 'Europe/Paris',
};

export function withDefaultNotificationPreferences(
  value?: Partial<NotificationPreferences> | null,
): NotificationPreferences {
  const defined = Object.fromEntries(
    Object.entries(value ?? {}).filter(([, v]) => v !== undefined),
  ) as Partial<NotificationPreferences>;
  return {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    ...defined,
  };
}

export function toNotificationPreferences(row: any): NotificationPreferences {
  return withDefaultNotificationPreferences({
    userId: row?.user_id ?? row?.userId,
    organizationId: row?.organization_id ?? row?.organizationId ?? null,
    inAppEnabled: row?.in_app_enabled,
    pushEnabled: row?.push_enabled,
    emailEnabled: row?.email_enabled,
    messagesInApp: row?.messages_in_app,
    messagesPush: row?.messages_push,
    messagesEmail: row?.messages_email,
    reserveCreatedInApp: row?.reserve_created_in_app,
    reserveCreatedPush: row?.reserve_created_push,
    reserveCreatedEmail: row?.reserve_created_email,
    reserveStatusInApp: row?.reserve_status_in_app,
    reserveStatusPush: row?.reserve_status_push,
    reserveStatusEmail: row?.reserve_status_email,
    reserveCriticalInApp: row?.reserve_critical_in_app,
    reserveCriticalPush: row?.reserve_critical_push,
    reserveCriticalEmail: row?.reserve_critical_email,
    reserveOverdueInApp: row?.reserve_overdue_in_app,
    reserveOverduePush: row?.reserve_overdue_push,
    reserveOverdueEmail: row?.reserve_overdue_email,
    dueSoonInApp: row?.due_soon_in_app,
    taskLateInApp: row?.task_late_in_app,
    criticalAlwaysPush: row?.critical_always_push,
    quietHoursEnabled: row?.quiet_hours_enabled,
    quietHoursStart: row?.quiet_hours_start,
    quietHoursEnd: row?.quiet_hours_end,
    quietHoursTimezone: row?.quiet_hours_timezone,
    emailAdminUpdatedAt: row?.email_admin_updated_at ?? row?.emailAdminUpdatedAt ?? null,
    emailAdminUpdatedBy: row?.email_admin_updated_by ?? row?.emailAdminUpdatedBy ?? null,
    emailAdminAction: row?.email_admin_action ?? row?.emailAdminAction ?? null,
    updatedAt: row?.updated_at ?? row?.updatedAt,
  });
}

export function fromNotificationPreferences(
  preferences: NotificationPreferences,
): Record<string, unknown> {
  const row: Record<string, unknown> = {
    user_id: preferences.userId,
    organization_id: preferences.organizationId ?? null,
    in_app_enabled: preferences.inAppEnabled,
    push_enabled: preferences.pushEnabled,
    email_enabled: preferences.emailEnabled,
    messages_in_app: preferences.messagesInApp,
    messages_push: preferences.messagesPush,
    messages_email: preferences.messagesEmail,
    reserve_created_in_app: preferences.reserveCreatedInApp,
    reserve_created_push: preferences.reserveCreatedPush,
    reserve_created_email: preferences.reserveCreatedEmail,
    reserve_status_in_app: preferences.reserveStatusInApp,
    reserve_status_push: preferences.reserveStatusPush,
    reserve_status_email: preferences.reserveStatusEmail,
    reserve_critical_in_app: preferences.reserveCriticalInApp,
    reserve_critical_push: preferences.reserveCriticalPush,
    reserve_critical_email: preferences.reserveCriticalEmail,
    reserve_overdue_in_app: preferences.reserveOverdueInApp,
    reserve_overdue_push: preferences.reserveOverduePush,
    reserve_overdue_email: preferences.reserveOverdueEmail,
    due_soon_in_app: preferences.dueSoonInApp,
    task_late_in_app: preferences.taskLateInApp,
    critical_always_push: preferences.criticalAlwaysPush,
    quiet_hours_enabled: preferences.quietHoursEnabled,
    quiet_hours_start: preferences.quietHoursStart,
    quiet_hours_end: preferences.quietHoursEnd,
    quiet_hours_timezone: preferences.quietHoursTimezone,
    updated_at: new Date().toISOString(),
  };
  if (preferences.emailAdminUpdatedAt !== undefined) {
    row.email_admin_updated_at = preferences.emailAdminUpdatedAt;
  }
  if (preferences.emailAdminUpdatedBy !== undefined) {
    row.email_admin_updated_by = preferences.emailAdminUpdatedBy;
  }
  if (preferences.emailAdminAction !== undefined) {
    row.email_admin_action = preferences.emailAdminAction;
  }
  return row;
}
