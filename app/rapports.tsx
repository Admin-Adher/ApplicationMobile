import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import Header from '@/components/Header';

function buildDailyHTML(reserves: any[], companies: any[], tasks: any[], stats: any, userName: string): string {
  const now = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const personnelRows = companies.map(c =>
    `<tr><td>${c.name}</td><td>${c.actualWorkers}</td><td>${c.plannedWorkers}</td></tr>`
  ).join('');
  const taskRows = tasks.filter((t: any) => t.status === 'in_progress').map((t: any) =>
    `<tr><td>${t.title}</td><td>${t.assignee}</td><td>${t.progress}%</td><td>${t.deadline}</td></tr>`
  ).join('');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; padding: 30px; color: #111; }
    h1 { color: #1A6FD8; font-size: 22px; }
    h2 { color: #333; font-size: 16px; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin-top: 24px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
    th { background: #1A6FD8; color: white; padding: 8px; text-align: left; }
    td { padding: 6px 8px; border-bottom: 1px solid #eee; }
    .meta { color: #666; font-size: 12px; margin-bottom: 20px; }
    .kpi { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 10px; }
    .kpi-card { border: 1px solid #ccc; border-radius: 8px; padding: 12px 20px; text-align: center; }
    .kpi-val { font-size: 28px; font-weight: bold; color: #1A6FD8; }
    .kpi-label { font-size: 12px; color: #666; }
  </style></head><body>
  <h1>BuildTrack — Rapport journalier</h1>
  <p class="meta">Date : ${now} | Rédigé par : ${userName}</p>
  <h2>Indicateurs chantier</h2>
  <div class="kpi">
    <div class="kpi-card"><div class="kpi-val">${stats.total}</div><div class="kpi-label">Réserves totales</div></div>
    <div class="kpi-card"><div class="kpi-val">${stats.open + stats.inProgress}</div><div class="kpi-label">En cours</div></div>
    <div class="kpi-card"><div class="kpi-val">${stats.closed}</div><div class="kpi-label">Clôturées</div></div>
    <div class="kpi-card"><div class="kpi-val">${stats.progress}%</div><div class="kpi-label">Avancement</div></div>
  </div>
  <h2>Personnel présent</h2>
  <table><thead><tr><th>Entreprise</th><th>Présents</th><th>Prévus</th></tr></thead>
  <tbody>${personnelRows}</tbody></table>
  <h2>Tâches en cours</h2>
  <table><thead><tr><th>Tâche</th><th>Responsable</th><th>Avancement</th><th>Échéance</th></tr></thead>
  <tbody>${taskRows || '<tr><td colspan="4">Aucune tâche en cours</td></tr>'}</tbody></table>
  </body></html>`;
}

function buildWeeklyHTML(reserves: any[], companies: any[], tasks: any[], stats: any, userName: string, weekNum: number): string {
  const criticalRows = reserves.filter((r: any) => r.priority === 'critical' && r.status !== 'closed').map((r: any) =>
    `<tr><td>${r.id}</td><td>${r.title}</td><td>Bât. ${r.building}</td><td>${r.deadline}</td></tr>`
  ).join('');
  const reserveByStatus = [
    { label: 'Ouvert', count: stats.open, color: '#EF4444' },
    { label: 'En cours', count: stats.inProgress, color: '#F59E0B' },
    { label: 'En attente', count: stats.waiting, color: '#6366F1' },
    { label: 'Vérification', count: stats.verification, color: '#3B82F6' },
    { label: 'Clôturé', count: stats.closed, color: '#10B981' },
  ];
  const statusRows = reserveByStatus.map(s =>
    `<tr><td style="color:${s.color};font-weight:bold">${s.label}</td><td>${s.count}</td><td>${stats.total ? Math.round((s.count / stats.total) * 100) : 0}%</td></tr>`
  ).join('');
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; padding: 30px; color: #111; }
    h1 { color: #1A6FD8; font-size: 22px; }
    h2 { color: #333; font-size: 16px; border-bottom: 1px solid #ccc; padding-bottom: 4px; margin-top: 24px; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 13px; }
    th { background: #1A6FD8; color: white; padding: 8px; text-align: left; }
    td { padding: 6px 8px; border-bottom: 1px solid #eee; }
    .meta { color: #666; font-size: 12px; margin-bottom: 20px; }
    .progress-bar { background: #eee; border-radius: 4px; height: 12px; margin-top: 8px; }
    .progress-fill { background: #1A6FD8; height: 12px; border-radius: 4px; width: ${stats.progress}%; }
  </style></head><body>
  <h1>BuildTrack — Rapport hebdomadaire — Semaine ${weekNum}</h1>
  <p class="meta">Rédigé par : ${userName}</p>
  <h2>Avancement global</h2>
  <p><strong>${stats.progress}%</strong> — ${stats.closed} / ${stats.total} réserves clôturées</p>
  <div class="progress-bar"><div class="progress-fill"></div></div>
  <h2>Répartition des réserves</h2>
  <table><thead><tr><th>Statut</th><th>Nombre</th><th>%</th></tr></thead>
  <tbody>${statusRows}</tbody></table>
  <h2>Réserves critiques ouvertes</h2>
  <table><thead><tr><th>ID</th><th>Titre</th><th>Bâtiment</th><th>Échéance</th></tr></thead>
  <tbody>${criticalRows || '<tr><td colspan="4">Aucune réserve critique ouverte</td></tr>'}</tbody></table>
  </body></html>`;
}

function buildCsvReport(reserves: any[]): string {
  const header = ['ID', 'Titre', 'Statut', 'Priorité', 'Bâtiment', 'Zone', 'Niveau', 'Entreprise', 'Date création', 'Échéance'];
  const statusMap: Record<string, string> = { open: 'Ouvert', in_progress: 'En cours', waiting: 'En attente', verification: 'Vérification', closed: 'Clôturé' };
  const priorityMap: Record<string, string> = { low: 'Faible', medium: 'Moyen', high: 'Élevé', critical: 'Critique' };
  const rows = reserves.map(r => [
    r.id, `"${r.title}"`, statusMap[r.status] ?? r.status, priorityMap[r.priority] ?? r.priority,
    r.building, r.zone, r.level, `"${r.company}"`, r.createdAt, r.deadline,
  ]);
  return [header, ...rows].map(row => row.join(';')).join('\n');
}

export default function RapportsScreen() {
  const { reserves, companies, tasks, stats } = useApp();
  const { user, permissions } = useAuth();
  const userName = user?.name ?? 'Équipe BuildTrack';

  const today = new Date().toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const weekNum = (() => {
    const d = new Date();
    const startOfYear = new Date(d.getFullYear(), 0, 1);
    return Math.ceil(((d.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7);
  })();

  async function exportPDF(type: 'daily' | 'weekly') {
    if (!permissions.canExport) {
      Alert.alert('Accès refusé', "Votre rôle ne permet pas d'exporter des rapports.");
      return;
    }
    try {
      const html = type === 'daily'
        ? buildDailyHTML(reserves, companies, tasks, stats, userName)
        : buildWeeklyHTML(reserves, companies, tasks, stats, userName, weekNum);

      if (Platform.OS === 'web') {
        const printWindow = window.open('', '_blank');
        if (printWindow) {
          printWindow.document.write(html);
          printWindow.document.close();
          printWindow.focus();
          setTimeout(() => printWindow.print(), 400);
        }
        return;
      }

      const { uri } = await Print.printToFileAsync({ html, base64: false });
      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Partager le rapport PDF' });
      } else {
        Alert.alert('PDF généré', `Fichier disponible : ${uri}`);
      }
    } catch (e: any) {
      Alert.alert('Erreur', `Impossible de générer le PDF : ${e?.message ?? e}`);
    }
  }

  async function exportCSV() {
    if (!permissions.canExport) {
      Alert.alert('Accès refusé', "Votre rôle ne permet pas d'exporter des rapports.");
      return;
    }
    try {
      const csv = buildCsvReport(reserves);

      if (Platform.OS === 'web') {
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `buildtrack_reserves_${new Date().toLocaleDateString('fr-FR').replace(/\//g, '-')}.csv`;
        link.click();
        URL.revokeObjectURL(url);
        return;
      }

      const filename = `buildtrack_reserves_${Date.now()}.csv`;
      const fileUri = FileSystem.cacheDirectory + filename;
      await FileSystem.writeAsStringAsync(fileUri, csv, { encoding: FileSystem.EncodingType.UTF8 });

      const canShare = await Sharing.isAvailableAsync();
      if (canShare) {
        await Sharing.shareAsync(fileUri, { mimeType: 'text/csv', dialogTitle: 'Partager le rapport CSV', UTI: 'public.comma-separated-values-text' });
      } else {
        Alert.alert('CSV généré', `${reserves.length} réserves exportées.\n${fileUri}`);
      }
    } catch (e: any) {
      Alert.alert('Erreur', `Impossible d'exporter : ${e?.message ?? e}`);
    }
  }

  return (
    <View style={styles.container}>
      <Header title="Rapports" subtitle="Journalier & hebdomadaire" showBack />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.reportCard}>
          <View style={styles.reportHeader}>
            <Ionicons name="document-text" size={20} color={C.inProgress} />
            <View style={{ flex: 1 }}>
              <Text style={styles.reportTitle}>Rapport journalier</Text>
              <Text style={styles.reportDate}>{today}</Text>
            </View>
            {permissions.canExport && (
              <TouchableOpacity style={styles.exportBtn} onPress={() => exportPDF('daily')}>
                <Ionicons name="download-outline" size={14} color={C.primary} />
                <Text style={styles.exportBtnText}>PDF</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.reportSection}>
            <Text style={styles.sectionTitle}>Personnel présent</Text>
            {companies.map(co => (
              <View key={co.id} style={styles.coRow}>
                <View style={[styles.coDot, { backgroundColor: co.color }]} />
                <Text style={styles.coName}>{co.name}</Text>
                <Text style={[styles.coVal, { color: co.color }]}>{co.actualWorkers} pers.</Text>
              </View>
            ))}
            <View style={[styles.coRow, styles.totalRow]}>
              <Text style={styles.totalLabel}>TOTAL</Text>
              <Text style={[styles.coVal, { color: C.primary }]}>{stats.totalWorkers} / {stats.plannedWorkers} prévus</Text>
            </View>
          </View>

          <View style={styles.reportSection}>
            <Text style={styles.sectionTitle}>Réserves</Text>
            <View style={styles.statRow}>
              <StatItem label="Ouvertes" val={stats.open} color={C.open} />
              <StatItem label="En cours" val={stats.inProgress} color={C.inProgress} />
              <StatItem label="Clôturées" val={stats.closed} color={C.closed} />
            </View>
          </View>

          <View style={styles.reportSection}>
            <Text style={styles.sectionTitle}>Tâches en cours</Text>
            {tasks.filter(t => t.status === 'in_progress').map(t => (
              <View key={t.id} style={styles.taskItem}>
                <View style={styles.taskDot} />
                <Text style={styles.taskText}>{t.title}</Text>
                <Text style={[styles.taskPct, { color: C.inProgress }]}>{t.progress}%</Text>
              </View>
            ))}
            {tasks.filter(t => t.status === 'in_progress').length === 0 && (
              <Text style={styles.emptyText}>Aucune tâche en cours</Text>
            )}
          </View>
        </View>

        <View style={styles.reportCard}>
          <View style={styles.reportHeader}>
            <Ionicons name="calendar" size={20} color={C.closed} />
            <View style={{ flex: 1 }}>
              <Text style={styles.reportTitle}>Rapport hebdomadaire</Text>
              <Text style={styles.reportDate}>Semaine {weekNum}</Text>
            </View>
            {permissions.canExport && (
              <TouchableOpacity style={styles.exportBtn} onPress={() => exportPDF('weekly')}>
                <Ionicons name="download-outline" size={14} color={C.primary} />
                <Text style={styles.exportBtnText}>PDF</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.reportSection}>
            <Text style={styles.sectionTitle}>Synthèse réserves</Text>
            <View style={styles.statRow}>
              <StatItem label="Total" val={stats.total} color={C.textSub} />
              <StatItem label="Ouvertes" val={stats.open + stats.inProgress} color={C.open} />
              <StatItem label="Clôturées" val={stats.closed} color={C.closed} />
            </View>
            <View style={styles.progressWrap}>
              <View style={styles.progressBg}>
                <View style={[styles.progressFill, { width: `${stats.progress}%` as any }]} />
              </View>
              <Text style={[styles.progressPct, { color: C.primary }]}>{stats.progress}%</Text>
            </View>
            <Text style={styles.progressLabel}>Avancement global du projet</Text>
          </View>

          <View style={styles.reportSection}>
            <Text style={styles.sectionTitle}>Réserves critiques ouvertes</Text>
            {reserves.filter(r => r.priority === 'critical' && r.status !== 'closed').map(r => (
              <View key={r.id} style={styles.critItem}>
                <Ionicons name="warning" size={14} color={C.critical} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.critTitle}>{r.id} — {r.title}</Text>
                  <Text style={styles.critSub}>Bât. {r.building} — Éch. : {r.deadline}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.reportCard}>
          <View style={styles.reportHeader}>
            <Ionicons name="warning" size={20} color={C.waiting} />
            <View style={{ flex: 1 }}>
              <Text style={styles.reportTitle}>Rapport réserves</Text>
              <Text style={styles.reportDate}>{stats.total} réserves au total</Text>
            </View>
            {permissions.canExport && (
              <TouchableOpacity style={styles.exportBtn} onPress={exportCSV}>
                <Ionicons name="download-outline" size={14} color={C.closed} />
                <Text style={[styles.exportBtnText, { color: C.closed }]}>CSV</Text>
              </TouchableOpacity>
            )}
          </View>

          {(['open', 'in_progress', 'waiting', 'verification', 'closed'] as const).map(s => {
            const labels: Record<string, string> = { open: 'Ouvert', in_progress: 'En cours', waiting: 'En attente', verification: 'Vérification', closed: 'Clôturé' };
            const colors: Record<string, string> = { open: C.open, in_progress: C.inProgress, waiting: C.waiting, verification: C.verification, closed: C.closed };
            const count = reserves.filter(r => r.status === s).length;
            return (
              <View key={s} style={styles.statusBreakRow}>
                <View style={[styles.statusDot, { backgroundColor: colors[s] }]} />
                <Text style={styles.statusLabel}>{labels[s]}</Text>
                <View style={styles.statusBarBg}>
                  <View style={[styles.statusBarFill, {
                    width: `${stats.total > 0 ? (count / stats.total) * 100 : 0}%` as any,
                    backgroundColor: colors[s],
                  }]} />
                </View>
                <Text style={[styles.statusCount, { color: colors[s] }]}>{count}</Text>
              </View>
            );
          })}

          {permissions.canExport && (
            <TouchableOpacity style={styles.fullExportBtn} onPress={exportCSV}>
              <Ionicons name="table-outline" size={16} color="#fff" />
              <Text style={styles.fullExportBtnText}>Exporter toutes les réserves (CSV)</Text>
            </TouchableOpacity>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function StatItem({ label, val, color }: { label: string; val: number; color: string }) {
  return (
    <View style={styles.statItem}>
      <Text style={[styles.statVal, { color }]}>{val}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 40 },
  reportCard: { backgroundColor: C.surface, borderRadius: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: C.border },
  reportHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  reportTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.text },
  reportDate: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  exportBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, padding: 8, backgroundColor: C.primaryBg, borderRadius: 8, borderWidth: 1, borderColor: C.primary + '40' },
  exportBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },
  reportSection: { marginBottom: 14, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  sectionTitle: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  coRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  coDot: { width: 8, height: 8, borderRadius: 4 },
  coName: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text },
  coVal: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  totalRow: { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 8, marginTop: 4 },
  totalLabel: { flex: 1, fontSize: 13, fontFamily: 'Inter_700Bold', color: C.text },
  statRow: { flexDirection: 'row', gap: 8 },
  statItem: { flex: 1, alignItems: 'center', backgroundColor: C.surface2, borderRadius: 10, padding: 10 },
  statVal: { fontSize: 20, fontFamily: 'Inter_700Bold' },
  statLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  taskItem: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  taskDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.inProgress },
  taskText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text },
  taskPct: { fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  emptyText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textMuted },
  progressWrap: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  progressBg: { flex: 1, height: 8, backgroundColor: C.border, borderRadius: 4, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: C.primary, borderRadius: 4 },
  progressPct: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  progressLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 4 },
  critItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  critTitle: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text },
  critSub: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  statusBreakRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusLabel: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, width: 82 },
  statusBarBg: { flex: 1, height: 6, backgroundColor: C.border, borderRadius: 3, overflow: 'hidden' },
  statusBarFill: { height: '100%', borderRadius: 3 },
  statusCount: { fontSize: 13, fontFamily: 'Inter_600SemiBold', width: 20, textAlign: 'right' },
  fullExportBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.primary, borderRadius: 12, paddingVertical: 12, marginTop: 10 },
  fullExportBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },
});
