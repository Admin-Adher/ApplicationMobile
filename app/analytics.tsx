import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useSettings } from '@/context/SettingsContext';
import Header from '@/components/Header';
import BottomNavBar from '@/components/BottomNavBar';
import { Reserve, ReserveWeekStat, CompanyClosureStat } from '@/constants/types';

function isOverdue(deadline: string, status: string): boolean {
  if (status === 'closed') return false;
  if (!deadline || deadline === '—') return false;
  const parts = deadline.split('/');
  if (parts.length !== 3) return false;
  return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`) < new Date();
}

function getWeekLabel(date: Date): string {
  const monday = new Date(date);
  monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  const dd = String(monday.getDate()).padStart(2, '0');
  const mm = String(monday.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}`;
}

function getISOWeek(date: Date): string {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  return d.getFullYear() + '-W' + String(1 + Math.round(((d.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7)).padStart(2, '0');
}

function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return (
    <View style={styles.barTrack}>
      <View style={[styles.barFill, { width: `${pct}%` as any, backgroundColor: color }]} />
    </View>
  );
}

function buildAnalyticsPDF(
  weekStats: ReserveWeekStat[],
  companyStats: CompanyClosureStat[],
  reserves: Reserve[],
  projectName: string,
  userName: string,
): string {
  const totalReserves = reserves.length;
  const closedReserves = reserves.filter(r => r.status === 'closed').length;
  const overdueReserves = reserves.filter(r => isOverdue(r.deadline, r.status)).length;
  const closureRate = totalReserves > 0 ? Math.round((closedReserves / totalReserves) * 100) : 0;

  const weekRows = weekStats.map(w =>
    `<tr><td>${w.label}</td><td style="color:#1A6FD8;font-weight:bold">${w.created}</td><td style="color:#10B981;font-weight:bold">${w.closed}</td><td>${w.created > 0 ? Math.round((w.closed / w.created) * 100) : 0}%</td></tr>`
  ).join('');

  const companyRows = companyStats.map(c =>
    `<tr>
      <td><strong>${c.companyName}</strong></td>
      <td>${c.total}</td>
      <td style="color:#10B981;font-weight:bold">${c.closed}</td>
      <td style="color:${c.rate >= 75 ? '#10B981' : c.rate >= 50 ? '#F59E0B' : '#EF4444'};font-weight:bold">${c.rate}%</td>
      <td style="color:${c.overdue > 0 ? '#EF4444' : '#10B981'}">${c.overdue}</td>
    </tr>`
  ).join('');

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; padding: 30px; color: #111; }
    h1 { color: #1A6FD8; font-size: 22px; }
    h2 { color: #333; font-size: 16px; border-bottom: 2px solid #1A6FD8; padding-bottom: 4px; margin-top: 28px; }
    .meta { color: #666; font-size: 12px; margin-bottom: 20px; }
    .kpi { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 10px; }
    .kpi-card { border: 2px solid #1A6FD8; border-radius: 10px; padding: 14px 22px; text-align: center; min-width: 120px; }
    .kpi-val { font-size: 30px; font-weight: bold; color: #1A6FD8; }
    .kpi-label { font-size: 12px; color: #666; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
    th { background: #1A6FD8; color: white; padding: 9px; text-align: left; }
    td { padding: 7px 9px; border-bottom: 1px solid #eee; }
    tr:nth-child(even) td { background: #f9fbff; }
    .footer { margin-top: 30px; border-top: 1px solid #ccc; padding-top: 12px; color: #999; font-size: 11px; text-align: center; }
  </style></head><body>
  <h1>${projectName} — Tableau de bord analytique</h1>
  <p class="meta">Généré le ${new Date().toLocaleDateString('fr-FR')} | ${userName}</p>

  <h2>Indicateurs clés</h2>
  <div class="kpi">
    <div class="kpi-card"><div class="kpi-val">${totalReserves}</div><div class="kpi-label">Réserves totales</div></div>
    <div class="kpi-card"><div class="kpi-val" style="color:#10B981">${closedReserves}</div><div class="kpi-label">Clôturées</div></div>
    <div class="kpi-card"><div class="kpi-val">${closureRate}%</div><div class="kpi-label">Taux de clôture</div></div>
    <div class="kpi-card"><div class="kpi-val" style="color:${overdueReserves > 0 ? '#EF4444' : '#10B981'}">${overdueReserves}</div><div class="kpi-label">En retard</div></div>
  </div>

  <h2>Évolution hebdomadaire — 8 dernières semaines</h2>
  <table>
    <thead><tr><th>Semaine</th><th>Créées</th><th>Clôturées</th><th>Taux levée</th></tr></thead>
    <tbody>${weekRows || '<tr><td colspan="4" style="text-align:center;color:#999">Aucune donnée</td></tr>'}</tbody>
  </table>

  <h2>Performance par entreprise</h2>
  <table>
    <thead><tr><th>Entreprise</th><th>Total</th><th>Clôturées</th><th>Taux</th><th>En retard</th></tr></thead>
    <tbody>${companyRows || '<tr><td colspan="5" style="text-align:center;color:#999">Aucune donnée</td></tr>'}</tbody>
  </table>

  <div class="footer">Rapport analytique généré par BuildTrack — ${projectName}</div>
  </body></html>`;
}

export default function AnalyticsScreen() {
  const { reserves, companies, lots } = useApp();
  const { user, permissions } = useAuth();
  const { projectName } = useSettings();
  const userName = user?.name ?? 'Équipe BuildTrack';

  const weekStats = useMemo<ReserveWeekStat[]>(() => {
    const now = new Date();
    const weeks: ReserveWeekStat[] = [];
    for (let i = 7; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i * 7);
      const week = getISOWeek(d);
      weeks.push({ week, label: `S. ${getWeekLabel(d)}`, created: 0, closed: 0 });
    }
    reserves.forEach(r => {
      const createdDate = new Date(r.createdAt);
      const createdWeek = getISOWeek(createdDate);
      const wi = weeks.findIndex(w => w.week === createdWeek);
      if (wi >= 0) weeks[wi].created++;
      if (r.status === 'closed' && r.closedAt) {
        const closedDate = new Date(r.closedAt);
        const closedWeek = getISOWeek(closedDate);
        const cWi = weeks.findIndex(w => w.week === closedWeek);
        if (cWi >= 0) weeks[cWi].closed++;
      }
    });
    return weeks;
  }, [reserves]);

  const companyStats = useMemo<CompanyClosureStat[]>(() => {
    return companies.map(co => {
      const compReserves = reserves.filter(r => r.company === co.name);
      const total = compReserves.length;
      const closed = compReserves.filter(r => r.status === 'closed').length;
      const overdue = compReserves.filter(r => isOverdue(r.deadline, r.status)).length;
      const rate = total > 0 ? Math.round((closed / total) * 100) : 0;
      return { companyName: co.name, color: co.color, total, closed, rate, overdue };
    }).sort((a, b) => b.total - a.total);
  }, [reserves, companies]);

  const totalReserves = reserves.length;
  const closedReserves = reserves.filter(r => r.status === 'closed').length;
  const openReserves = reserves.filter(r => r.status === 'open').length;
  const inProgressReserves = reserves.filter(r => r.status === 'in_progress').length;
  const criticalReserves = reserves.filter(r => r.priority === 'critical' && r.status !== 'closed').length;
  const overdueReserves = reserves.filter(r => isOverdue(r.deadline, r.status)).length;
  const closureRate = totalReserves > 0 ? Math.round((closedReserves / totalReserves) * 100) : 0;

  const maxWeekVal = Math.max(...weekStats.map(w => Math.max(w.created, w.closed)), 1);

  async function handleExportPDF() {
    if (!permissions.canExport) return;
    const html = buildAnalyticsPDF(weekStats, companyStats, reserves, projectName, userName);
    if (Platform.OS === 'web') {
      const w = window.open('', '_blank');
      if (w) { w.document.write(html); w.document.close(); w.focus(); setTimeout(() => w.print(), 400); }
      return;
    }
    try {
      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Tableau de bord analytique' });
    } catch {}
  }

  return (
    <View style={styles.container}>
      <Header
        title="Analytique"
        subtitle="Tendances & performance"
        showBack
        rightLabel={permissions.canExport ? 'PDF' : undefined}
        onRightPress={permissions.canExport ? handleExportPDF : undefined}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {/* KPI CARDS */}
        <View style={styles.kpiRow}>
          <View style={[styles.kpiCard, { borderLeftColor: C.primary }]}>
            <Text style={[styles.kpiVal, { color: C.primary }]}>{totalReserves}</Text>
            <Text style={styles.kpiLabel}>Total</Text>
          </View>
          <View style={[styles.kpiCard, { borderLeftColor: C.closed }]}>
            <Text style={[styles.kpiVal, { color: C.closed }]}>{closureRate}%</Text>
            <Text style={styles.kpiLabel}>Taux clôture</Text>
          </View>
          <View style={[styles.kpiCard, { borderLeftColor: overdueReserves > 0 ? C.open : C.closed }]}>
            <Text style={[styles.kpiVal, { color: overdueReserves > 0 ? C.open : C.closed }]}>{overdueReserves}</Text>
            <Text style={styles.kpiLabel}>En retard</Text>
          </View>
          <View style={[styles.kpiCard, { borderLeftColor: criticalReserves > 0 ? '#7C3AED' : C.closed }]}>
            <Text style={[styles.kpiVal, { color: criticalReserves > 0 ? '#7C3AED' : C.closed }]}>{criticalReserves}</Text>
            <Text style={styles.kpiLabel}>Critiques</Text>
          </View>
        </View>

        {/* Status breakdown */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Répartition par statut</Text>
          {[
            { label: 'Ouvertes', val: openReserves, color: C.open },
            { label: 'En cours', val: inProgressReserves, color: C.inProgress },
            { label: 'En attente', val: reserves.filter(r => r.status === 'waiting').length, color: C.waiting },
            { label: 'Vérification', val: reserves.filter(r => r.status === 'verification').length, color: C.verification },
            { label: 'Clôturées', val: closedReserves, color: C.closed },
          ].map(item => (
            <View key={item.label} style={styles.statRow}>
              <View style={[styles.statDot, { backgroundColor: item.color }]} />
              <Text style={styles.statLabel}>{item.label}</Text>
              <MiniBar value={item.val} max={totalReserves} color={item.color} />
              <Text style={[styles.statVal, { color: item.color }]}>{item.val}</Text>
              <Text style={styles.statPct}>
                {totalReserves > 0 ? `${Math.round((item.val / totalReserves) * 100)}%` : '0%'}
              </Text>
            </View>
          ))}
        </View>

        {/* Weekly trend chart */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Évolution hebdomadaire — 8 semaines</Text>
          <View style={styles.legend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: C.primary }]} />
              <Text style={styles.legendLabel}>Créées</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: C.closed }]} />
              <Text style={styles.legendLabel}>Clôturées</Text>
            </View>
          </View>
          <View style={styles.chartArea}>
            {weekStats.map((w, i) => (
              <View key={w.week} style={styles.weekCol}>
                <Text style={styles.weekNum}>{Math.max(w.created, w.closed)}</Text>
                <View style={styles.barsContainer}>
                  <View style={styles.barPair}>
                    <View style={[styles.weekBar, {
                      height: Math.max(4, (w.created / maxWeekVal) * 80),
                      backgroundColor: C.primary,
                    }]} />
                    <View style={[styles.weekBar, {
                      height: Math.max(4, (w.closed / maxWeekVal) * 80),
                      backgroundColor: C.closed,
                    }]} />
                  </View>
                </View>
                <Text style={styles.weekLabel}>{w.label}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* Company performance */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Performance par entreprise</Text>
          {companyStats.length === 0 ? (
            <Text style={styles.emptyText}>Aucune donnée entreprise</Text>
          ) : (
            companyStats.map(co => (
              <View key={co.companyName} style={styles.companyRow}>
                <View style={[styles.companyDot, { backgroundColor: co.color }]} />
                <View style={{ flex: 1 }}>
                  <View style={styles.companyHeader}>
                    <Text style={styles.companyName}>{co.companyName}</Text>
                    <Text style={[styles.companyRate, {
                      color: co.rate >= 75 ? C.closed : co.rate >= 50 ? C.inProgress : C.open
                    }]}>{co.rate}%</Text>
                  </View>
                  <View style={styles.companyBarTrack}>
                    <View style={[styles.companyBarFill, {
                      width: `${co.rate}%` as any,
                      backgroundColor: co.rate >= 75 ? C.closed : co.rate >= 50 ? C.inProgress : C.open,
                    }]} />
                  </View>
                  <View style={styles.companyMeta}>
                    <Text style={styles.companyMetaText}>{co.total} réserve{co.total !== 1 ? 's' : ''}</Text>
                    <Text style={styles.companyMetaText}>{co.closed} clôturée{co.closed !== 1 ? 's' : ''}</Text>
                    {co.overdue > 0 && (
                      <Text style={[styles.companyMetaText, { color: C.open }]}>
                        {co.overdue} en retard
                      </Text>
                    )}
                  </View>
                </View>
              </View>
            ))
          )}
        </View>

        {/* Priority breakdown */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Répartition par priorité (actives)</Text>
          {[
            { label: 'Critique', color: '#EF4444', key: 'critical' },
            { label: 'Haute', color: '#F97316', key: 'high' },
            { label: 'Moyenne', color: '#F59E0B', key: 'medium' },
            { label: 'Basse', color: '#22C55E', key: 'low' },
          ].map(p => {
            const cnt = reserves.filter(r => r.priority === p.key && r.status !== 'closed').length;
            const activeTotal = reserves.filter(r => r.status !== 'closed').length;
            return (
              <View key={p.key} style={styles.statRow}>
                <View style={[styles.statDot, { backgroundColor: p.color }]} />
                <Text style={styles.statLabel}>{p.label}</Text>
                <MiniBar value={cnt} max={activeTotal} color={p.color} />
                <Text style={[styles.statVal, { color: p.color }]}>{cnt}</Text>
                <Text style={styles.statPct}>
                  {activeTotal > 0 ? `${Math.round((cnt / activeTotal) * 100)}%` : '0%'}
                </Text>
              </View>
            );
          })}
        </View>

        {/* Building breakdown */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Répartition par bâtiment</Text>
          {(() => {
            const buildings = [...new Set(reserves.map(r => r.building))].sort();
            const maxBld = Math.max(...buildings.map(b => reserves.filter(r => r.building === b).length), 1);
            if (buildings.length === 0) return <Text style={styles.emptyText}>Aucune donnée</Text>;
            return buildings.map((b, i) => {
              const cnt = reserves.filter(r => r.building === b).length;
              const clsd = reserves.filter(r => r.building === b && r.status === 'closed').length;
              return (
                <View key={b} style={styles.statRow}>
                  <Text style={styles.buildingLabel}>Bât. {b}</Text>
                  <MiniBar value={cnt} max={maxBld} color={C.primary} />
                  <Text style={[styles.statVal, { color: C.primary }]}>{cnt}</Text>
                  <Text style={styles.statPct}>{cnt > 0 ? `${Math.round((clsd / cnt) * 100)}%` : '0%'} ✓</Text>
                </View>
              );
            });
          })()}
        </View>

        {/* Lot breakdown */}
        {lots.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.sectionTitle}>Répartition par lot (CCTP)</Text>
            {(() => {
              const lotsWithReserves = lots
                .map(lot => {
                  const lotReserves = reserves.filter(r => r.lotId === lot.id);
                  return { lot, total: lotReserves.length, closed: lotReserves.filter(r => r.status === 'closed').length };
                })
                .filter(x => x.total > 0)
                .sort((a, b) => b.total - a.total);
              if (lotsWithReserves.length === 0) return <Text style={styles.emptyText}>Aucune réserve avec lot attribué</Text>;
              const maxLot = Math.max(...lotsWithReserves.map(x => x.total), 1);
              return lotsWithReserves.map(({ lot, total, closed }) => (
                <View key={lot.id} style={styles.statRow}>
                  <View style={[styles.statDot, { backgroundColor: lot.color }]} />
                  <Text style={[styles.statLabel, { width: 90 }]} numberOfLines={1}>{lot.code} {lot.name}</Text>
                  <MiniBar value={total} max={maxLot} color={lot.color} />
                  <Text style={[styles.statVal, { color: lot.color }]}>{total}</Text>
                  <Text style={styles.statPct}>{total > 0 ? `${Math.round((closed / total) * 100)}%` : '0%'} ✓</Text>
                </View>
              ));
            })()}
          </View>
        )}

        {/* Week-over-week comparison */}
        {weekStats.length >= 2 && (() => {
          const current = weekStats[weekStats.length - 1];
          const previous = weekStats[weekStats.length - 2];
          const createdDelta = current.created - previous.created;
          const closedDelta = current.closed - previous.closed;
          return (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Semaine en cours vs précédente</Text>
              <View style={styles.wowRow}>
                <View style={styles.wowItem}>
                  <Text style={styles.wowLabel}>Créées cette semaine</Text>
                  <Text style={[styles.wowVal, { color: C.primary }]}>{current.created}</Text>
                  <View style={[styles.wowDelta, { backgroundColor: createdDelta > 0 ? '#FEF2F2' : createdDelta < 0 ? '#ECFDF5' : C.surface2 }]}>
                    <Ionicons
                      name={createdDelta > 0 ? 'trending-up' : createdDelta < 0 ? 'trending-down' : 'remove'}
                      size={11}
                      color={createdDelta > 0 ? '#DC2626' : createdDelta < 0 ? '#059669' : C.textMuted}
                    />
                    <Text style={[styles.wowDeltaText, { color: createdDelta > 0 ? '#DC2626' : createdDelta < 0 ? '#059669' : C.textMuted }]}>
                      {createdDelta > 0 ? '+' : ''}{createdDelta} vs S. préc.
                    </Text>
                  </View>
                </View>
                <View style={styles.wowDivider} />
                <View style={styles.wowItem}>
                  <Text style={styles.wowLabel}>Clôturées cette semaine</Text>
                  <Text style={[styles.wowVal, { color: C.closed }]}>{current.closed}</Text>
                  <View style={[styles.wowDelta, { backgroundColor: closedDelta > 0 ? '#ECFDF5' : closedDelta < 0 ? '#FEF2F2' : C.surface2 }]}>
                    <Ionicons
                      name={closedDelta > 0 ? 'trending-up' : closedDelta < 0 ? 'trending-down' : 'remove'}
                      size={11}
                      color={closedDelta > 0 ? '#059669' : closedDelta < 0 ? '#DC2626' : C.textMuted}
                    />
                    <Text style={[styles.wowDeltaText, { color: closedDelta > 0 ? '#059669' : closedDelta < 0 ? '#DC2626' : C.textMuted }]}>
                      {closedDelta > 0 ? '+' : ''}{closedDelta} vs S. préc.
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          );
        })()}

      </ScrollView>
      <BottomNavBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 40 },

  kpiRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  kpiCard: {
    flex: 1, backgroundColor: C.surface, borderRadius: 12,
    padding: 12, borderWidth: 1, borderColor: C.border,
    borderLeftWidth: 3, alignItems: 'center',
  },
  kpiVal: { fontSize: 22, fontFamily: 'Inter_700Bold' },
  kpiLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2, textAlign: 'center' },

  card: {
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    marginBottom: 14, borderWidth: 1, borderColor: C.border,
  },
  sectionTitle: {
    fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 14,
  },

  statRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  statDot: { width: 10, height: 10, borderRadius: 5 },
  statLabel: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.text, width: 80 },
  statVal: { fontSize: 14, fontFamily: 'Inter_700Bold', width: 28, textAlign: 'right' },
  statPct: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub, width: 32, textAlign: 'right' },
  barTrack: {
    flex: 1, height: 8, backgroundColor: C.border,
    borderRadius: 4, overflow: 'hidden',
  },
  barFill: { height: 8, borderRadius: 4, minWidth: 4 },

  legend: { flexDirection: 'row', gap: 16, marginBottom: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 2 },
  legendLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub },

  chartArea: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 130 },
  weekCol: { flex: 1, alignItems: 'center' },
  weekNum: { fontSize: 9, fontFamily: 'Inter_400Regular', color: C.textMuted, marginBottom: 2 },
  barsContainer: { height: 80, justifyContent: 'flex-end' },
  barPair: { flexDirection: 'row', gap: 2, alignItems: 'flex-end' },
  weekBar: { width: 8, borderRadius: 3, minHeight: 4 },
  weekLabel: { fontSize: 8, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 4, textAlign: 'center' },

  companyRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 14 },
  companyDot: { width: 12, height: 12, borderRadius: 6, marginTop: 3 },
  companyHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  companyName: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text },
  companyRate: { fontSize: 14, fontFamily: 'Inter_700Bold' },
  companyBarTrack: { height: 8, backgroundColor: C.border, borderRadius: 4, overflow: 'hidden', marginBottom: 4 },
  companyBarFill: { height: 8, borderRadius: 4, minWidth: 4 },
  companyMeta: { flexDirection: 'row', gap: 12 },
  companyMetaText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub },

  buildingLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.text, width: 50 },
  emptyText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', paddingVertical: 12 },
  wowRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  wowItem: { flex: 1, alignItems: 'center', gap: 4 },
  wowLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub, textAlign: 'center' },
  wowVal: { fontSize: 28, fontFamily: 'Inter_700Bold' },
  wowDivider: { width: 1, backgroundColor: C.border, alignSelf: 'stretch', marginVertical: 4 },
  wowDelta: { flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  wowDeltaText: { fontSize: 11, fontFamily: 'Inter_500Medium' },
});
