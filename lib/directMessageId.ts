export function dmChannelIdByUserIds(userIdA: string, userIdB: string): string {
  return 'dm-' + [userIdA, userIdB].sort().join('__');
}
