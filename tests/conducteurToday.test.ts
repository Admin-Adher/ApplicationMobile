import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canAdminRestoreTab, canConducteurRestoreTab, isConducteurRole, isOrgAdminRole, isPlatformAdminRole, SUPERADMIN_HOME_ROUTE } from '../lib/roleNavigation';
import { ROLE_PERMISSIONS } from '../lib/permissions';
import { buildConducteurTodayQueue, isSameCalendarDay, pickTodayNowItems } from '../lib/conducteurToday';

/**
 * Horloge figee juste apres minuit, en heure LOCALE.
 *
 * Le test construisait la date du jour avec `toISOString().slice(0, 10)`, qui
 * renvoie la date UTC, alors que `isSameCalendarDay` compare des composantes
 * calendaires locales. Entre 00:00 et 02:00 en CEST, UTC est encore la veille :
 * le test echouait chez un developpeur travaillant tard, et jamais en CI, ou
 * les runners tournent en UTC.
 *
 * On fige donc l'instant le plus defavorable et on ecrit les dates en clair,
 * plutot que de forcer `TZ=UTC` — ce qui masquerait le defaut au lieu de le
 * corriger, et ferait passer le test sans jamais verifier le comportement local
 * reellement attendu par un conducteur sur le terrain.
 */
const LOCAL_MIDNIGHT_PLUS_ONE = new Date(2026, 7, 23, 0, 1, 0);
const TODAY_LOCAL = '2026-08-23';
const YESTERDAY_LOCAL = '2026-08-22';

describe('conducteur shell', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(LOCAL_MIDNIGHT_PLUS_ONE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not give the site manager more stock power than the storekeeper', () => {
    expect(ROLE_PERMISSIONS.conducteur.canAdjustInventory).toBe(false);
    expect(ROLE_PERMISSIONS.conducteur.canManageInventoryProducts).toBe(false);
    expect(ROLE_PERMISSIONS.magasinier.canAdjustInventory).toBe(false);
    expect(ROLE_PERMISSIONS.conducteur.canEditChantier).toBe(true);
  });

  it('sends the platform operator to a dedicated cockpit, not a tenant shell', () => {
    expect(isPlatformAdminRole('super_admin')).toBe(true);
    expect(isPlatformAdminRole('admin')).toBe(false);
    expect(isOrgAdminRole('super_admin')).toBe(false);
    expect(SUPERADMIN_HOME_ROUTE).toBe('/superadmin');
  });

  it('treats org admin as a site manager plus a Pilotage home', () => {
    expect(isOrgAdminRole('admin')).toBe(true);
    expect(isOrgAdminRole('super_admin')).toBe(false);
    expect(canAdminRestoreTab('/(tabs)/admin')).toBe(true);
    expect(canAdminRestoreTab('/(tabs)/messages')).toBe(false);
  });

  it('restores only operational tabs for the site manager', () => {
    expect(isConducteurRole('conducteur')).toBe(true);
    expect(canConducteurRestoreTab('/(tabs)/plans')).toBe(true);
    expect(canConducteurRestoreTab('/(tabs)/messages')).toBe(false);
    expect(canConducteurRestoreTab('/(tabs)/more')).toBe(false);
  });

  it('builds a morning queue with lifts first', () => {
    const queue = buildConducteurTodayQueue([
      { id: 'v1', title: 'Lift', status: 'verification', priority: 'high' },
      { id: 'c1', title: 'Leak', status: 'open', priority: 'critical' },
      { id: 'o1', title: 'Late', status: 'open', priority: 'high', deadline: '01/01/2020' },
      { id: 'x1', title: 'Done', status: 'closed', priority: 'critical' },
    ], [
      { id: 'visit', title: 'Tour', date: TODAY_LOCAL, status: 'planned' },
    ]);
    expect(queue.verification.map(item => item.id)).toEqual(['v1']);
    expect(queue.critical.map(item => item.id)).toEqual(['c1']);
    expect(queue.overdue.map(item => item.id)).toEqual(['o1']);
    expect(queue.todayVisits).toHaveLength(1);
    expect(buildConducteurTodayQueue([], [
      { id: 'done', title: 'Done', date: TODAY_LOCAL, status: 'completed' },
    ]).todayVisits).toHaveLength(0);
  });

  it('reads the calendar day locally, as the site manager does', () => {
    // A 00:01 heure locale, UTC est encore la veille. La journee de travail
    // suit le fuseau du conducteur, pas celui du serveur.
    expect(isSameCalendarDay(TODAY_LOCAL)).toBe(true);
    expect(isSameCalendarDay(YESTERDAY_LOCAL)).toBe(false);
    expect(isSameCalendarDay('2026-08-24')).toBe(false);
    // Volontairement AUCUNE assertion sur `toISOString()` : elle ne tiendrait
    // que dans un fuseau positif et echouerait sur un runner UTC — le miroir
    // exact du defaut corrige ici.
  });

  it('keeps the morning brief to a handful of next actions', () => {
    const queue = buildConducteurTodayQueue([
      ...Array.from({ length: 8 }, (_, i) => ({ id: `v${i}`, title: `Lift ${i}`, status: 'verification', priority: 'high' })),
      ...Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, title: `Crit ${i}`, status: 'open', priority: 'critical' })),
      ...Array.from({ length: 20 }, (_, i) => ({ id: `o${i}`, title: `Late ${i}`, status: 'open', priority: 'high', deadline: '01/01/2020' })),
    ], []);
    const now = pickTodayNowItems(queue);
    expect(now.lifts).toHaveLength(3);
    expect(now.critical).toHaveLength(2);
    expect(now.visits).toHaveLength(0);
    expect(queue.overdue).toHaveLength(20);
  });
});
