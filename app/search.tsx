import { View, Text, StyleSheet, TextInput, ScrollView, TouchableOpacity, Platform } from 'react-native';
import { useState, useMemo } from 'react';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useIncidents } from '@/context/IncidentsContext';
import Header from '@/components/Header';
import StatusBadge from '@/components/StatusBadge';
import PriorityBadge from '@/components/PriorityBadge';
import BottomNavBar from '@/components/BottomNavBar';

const STATUS_LABELS: Record<string, string> = {
  open: 'Ouvert', in_progress: 'En cours', waiting: 'En attente',
  verification: 'Vérification', closed: 'Clôturé',
  todo: 'À faire', done: 'Terminé', delayed: 'En retard',
};

const STATUS_COLORS: Record<string, string> = {
  open: C.open, in_progress: C.inProgress, waiting: C.waiting,
  verification: C.verification, closed: C.closed,
  todo: C.textMuted, done: C.closed, delayed: C.waiting,
};

const INCIDENT_SEVERITY_LABELS: Record<string, string> = {
  minor: 'Mineur', moderate: 'Modéré', major: 'Majeur', critical: 'Critique',
};
const INCIDENT_SEVERITY_COLORS: Record<string, string> = {
  minor: '#6B7280', moderate: '#F59E0B', major: '#EF4444', critical: '#7F1D1D',
};

export default function SearchScreen() {
  const router = useRouter();
  const { reserves, tasks, documents, visites, companies } = useApp();
  const { user } = useAuth();
  const { incidents } = useIncidents();
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase();

  const isSousTraitant = user?.role === 'sous_traitant';
  const userCompanyName = useMemo(() => {
    if (!isSousTraitant || !user?.companyId) return null;
    return companies.find(c => c.id === user.companyId)?.name ?? null;
  }, [isSousTraitant, user?.companyId, companies]);

  const scopedReserves = useMemo(() => {
    if (!isSousTraitant || !userCompanyName) return reserves;
    return reserves.filter(r =>
      r.company === userCompanyName ||
      (Array.isArray(r.companies) && r.companies.includes(userCompanyName))
    );
  }, [isSousTraitant, userCompanyName, reserves]);

  const scopedTasks = useMemo(() => {
    if (!isSousTraitant || !userCompanyName) return tasks;
    return tasks.filter(t => t.company === userCompanyName);
  }, [isSousTraitant, userCompanyName, tasks]);

  const filteredReserves = useMemo(() => {
    if (!q || q.length < 2) return [];
    return scopedReserves.filter(r =>
      r.title.toLowerCase().includes(q) ||
      r.id.toLowerCase().includes(q) ||
      r.description.toLowerCase().includes(q) ||
      r.company.toLowerCase().includes(q) ||
      r.zone.toLowerCase().includes(q)
    ).slice(0, 8);
  }, [scopedReserves, q]);

  const filteredTasks = useMemo(() => {
    if (!q || q.length < 2) return [];
    return scopedTasks.filter(t =>
      t.title.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      t.assignee.toLowerCase().includes(q)
    ).slice(0, 6);
  }, [scopedTasks, q]);

  const filteredDocuments = useMemo(() => {
    if (!q || q.length < 2) return [];
    return documents.filter(d =>
      d.name.toLowerCase().includes(q) ||
      d.category.toLowerCase().includes(q)
    ).slice(0, 5);
  }, [documents, q]);

  const filteredIncidents = useMemo(() => {
    if (isSousTraitant || !q || q.length < 2) return [];
    return incidents.filter(i =>
      i.title.toLowerCase().includes(q) ||
      i.description.toLowerCase().includes(q) ||
      i.location.toLowerCase().includes(q) ||
      i.reportedBy.toLowerCase().includes(q)
    ).slice(0, 6);
  }, [incidents, isSousTraitant, q]);

  const filteredVisites = useMemo(() => {
    if (isSousTraitant || !q || q.length < 2) return [];
    return (visites ?? []).filter(v =>
      v.title.toLowerCase().includes(q) ||
      v.conducteur.toLowerCase().includes(q) ||
      (v.notes ?? '').toLowerCase().includes(q) ||
      v.building.toLowerCase().includes(q)
    ).slice(0, 6);
  }, [visites, isSousTraitant, q]);

  const hasResults = filteredReserves.length > 0 || filteredTasks.length > 0 || filteredDocuments.length > 0 || filteredIncidents.length > 0 || filteredVisites.length > 0;
  const hasQuery = q.length >= 2;

  return (
    <View style={styles.container}>
      <Header title="Recherche globale" showBack />

      <View style={styles.searchWrap}>
        <Ionicons name="search" size={18} color={q.length >= 2 ? C.primary : C.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Réserves, tâches, documents..."
          placeholderTextColor={C.textMuted}
          value={query}
          onChangeText={setQuery}
          autoFocus
          returnKeyType="search"
        />
        {query.length > 0 && (
          <TouchableOpacity onPress={() => setQuery('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Ionicons name="close-circle" size={18} color={C.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      {!hasQuery && (
        <View style={styles.emptyState}>
          <Ionicons name="search-circle-outline" size={56} color={C.border} />
          <Text style={styles.hintTitle}>Recherche unifiée</Text>
          <Text style={styles.hintText}>
            Tapez au moins 2 caractères pour chercher dans les réserves, tâches, documents et incidents.
          </Text>
          <View style={styles.shortcutsWrap}>
            <Text style={styles.shortcutsLabel}>Suggestions rapides</Text>
            <View style={styles.shortcutsRow}>
              {[
                { icon: 'warning', label: 'Réserves ouvertes', q: 'ouvert', color: C.open },
                { icon: 'calendar', label: 'Planning', q: 'en cours', color: C.inProgress },
                { icon: 'folder-open', label: 'Plans', q: 'plan', color: C.closed },
                { icon: 'shield', label: 'Sécurité', q: 'incident', color: '#EF4444' },
              ].map(s => (
                <TouchableOpacity
                  key={s.q}
                  style={[styles.shortcutChip, { borderColor: s.color + '50' }]}
                  onPress={() => setQuery(s.q)}
                  activeOpacity={0.75}
                >
                  <Ionicons name={s.icon as any} size={13} color={s.color} />
                  <Text style={[styles.shortcutText, { color: s.color }]}>{s.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      )}

      {hasQuery && !hasResults && (
        <View style={styles.hint}>
          <Ionicons name="file-tray-outline" size={48} color={C.border} />
          <Text style={styles.hintTitle}>Aucun résultat</Text>
          <Text style={styles.hintText}>Aucun élément ne correspond à "{q}".</Text>
        </View>
      )}

      {hasQuery && hasResults && (
        <ScrollView contentContainerStyle={styles.results} showsVerticalScrollIndicator={false}>
          {filteredReserves.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="warning" size={14} color={C.open} />
                <Text style={styles.sectionTitle}>Réserves ({filteredReserves.length})</Text>
              </View>
              {filteredReserves.map(r => (
                <TouchableOpacity
                  key={r.id}
                  style={styles.resultCard}
                  onPress={() => router.push(`/reserve/${r.id}` as any)}
                  activeOpacity={0.75}
                >
                  <View style={styles.resultRow}>
                    <Text style={styles.resultId}>{r.id}</Text>
                    <View style={[styles.statusPill, { backgroundColor: STATUS_COLORS[r.status] + '20' }]}>
                      <Text style={[styles.statusPillText, { color: STATUS_COLORS[r.status] }]}>
                        {STATUS_LABELS[r.status]}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.resultTitle}>{r.title}</Text>
                  <View style={styles.resultMeta}>
                    <Text style={styles.resultMetaText}>Bât. {r.building} · {r.zone} · {r.company}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={14} color={C.textMuted} style={styles.chevron} />
                </TouchableOpacity>
              ))}
            </View>
          )}

          {filteredTasks.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="calendar" size={14} color={C.closed} />
                <Text style={styles.sectionTitle}>Tâches ({filteredTasks.length})</Text>
              </View>
              {filteredTasks.map(t => (
                <TouchableOpacity
                  key={t.id}
                  style={styles.resultCard}
                  onPress={() => router.push(`/task/${t.id}` as any)}
                  activeOpacity={0.75}
                >
                  <View style={styles.resultRow}>
                    <Text style={styles.resultTitle} numberOfLines={1}>{t.title}</Text>
                    <View style={[styles.statusPill, { backgroundColor: STATUS_COLORS[t.status] + '20' }]}>
                      <Text style={[styles.statusPillText, { color: STATUS_COLORS[t.status] }]}>
                        {STATUS_LABELS[t.status]}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.resultMeta}>
                    <Text style={styles.resultMetaText}>{t.assignee} · {t.progress}% · Éch. {t.deadline}</Text>
                  </View>
                  <View style={styles.progressBar}>
                    <View style={[styles.progressFill, { width: `${t.progress}%` as any, backgroundColor: STATUS_COLORS[t.status] }]} />
                  </View>
                  <Ionicons name="chevron-forward" size={14} color={C.textMuted} style={styles.chevron} />
                </TouchableOpacity>
              ))}
            </View>
          )}

          {filteredDocuments.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="folder-open" size={14} color={C.inProgress} />
                <Text style={styles.sectionTitle}>Documents ({filteredDocuments.length})</Text>
              </View>
              {filteredDocuments.map(d => (
                <TouchableOpacity
                  key={d.id}
                  style={styles.resultCard}
                  onPress={() => router.push('/documents' as any)}
                  activeOpacity={0.75}
                >
                  <View style={styles.resultRow}>
                    <Ionicons name="document-text-outline" size={16} color={C.inProgress} />
                    <Text style={[styles.resultTitle, { flex: 1 }]} numberOfLines={1}>{d.name}</Text>
                  </View>
                  <Text style={styles.resultMetaText}>{d.category} · {d.size} · {d.uploadedAt}</Text>
                  <Ionicons name="chevron-forward" size={14} color={C.textMuted} style={styles.chevron} />
                </TouchableOpacity>
              ))}
            </View>
          )}

          {filteredIncidents.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="shield-outline" size={14} color="#EF4444" />
                <Text style={styles.sectionTitle}>Incidents ({filteredIncidents.length})</Text>
              </View>
              {filteredIncidents.map(i => {
                const sevColor = INCIDENT_SEVERITY_COLORS[i.severity] ?? '#6B7280';
                return (
                  <TouchableOpacity
                    key={i.id}
                    style={styles.resultCard}
                    onPress={() => router.push('/incidents' as any)}
                    activeOpacity={0.75}
                  >
                    <View style={styles.resultRow}>
                      <View style={[styles.statusPill, { backgroundColor: sevColor + '20' }]}>
                        <Text style={[styles.statusPillText, { color: sevColor }]}>
                          {INCIDENT_SEVERITY_LABELS[i.severity]}
                        </Text>
                      </View>
                      <Text style={[styles.resultTitle, { flex: 1 }]} numberOfLines={1}>{i.title}</Text>
                    </View>
                    <Text style={styles.resultMetaText} numberOfLines={1}>{i.description}</Text>
                    <View style={[styles.resultMeta, { marginTop: 4 }]}>
                      <Text style={styles.resultMetaText}>Bât. {i.building} — {i.location} — {i.reportedAt}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={14} color={C.textMuted} style={styles.chevron} />
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          {filteredVisites.length > 0 && (
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <Ionicons name="eye-outline" size={14} color="#6366F1" />
                <Text style={styles.sectionTitle}>Visites ({filteredVisites.length})</Text>
              </View>
              {filteredVisites.map(v => {
                const vColor = v.status === 'completed' ? C.closed : v.status === 'in_progress' ? C.inProgress : '#6366F1';
                const vLabel = v.status === 'completed' ? 'Terminée' : v.status === 'in_progress' ? 'En cours' : 'Planifiée';
                return (
                  <TouchableOpacity
                    key={v.id}
                    style={styles.resultCard}
                    onPress={() => router.push(`/visite/${v.id}` as any)}
                    activeOpacity={0.75}
                  >
                    <View style={styles.resultRow}>
                      <Text style={styles.resultId}>{v.id.slice(0, 12)}</Text>
                      <View style={[styles.statusPill, { backgroundColor: vColor + '20' }]}>
                        <Text style={[styles.statusPillText, { color: vColor }]}>{vLabel}</Text>
                      </View>
                    </View>
                    <Text style={styles.resultTitle} numberOfLines={1}>{v.title}</Text>
                    <View style={styles.resultMeta}>
                      <Text style={styles.resultMetaText}>Bât. {v.building} · {v.date} · {v.conducteur}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={14} color={C.textMuted} style={styles.chevron} />
                  </TouchableOpacity>
                );
              })}
            </View>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      )}
      <BottomNavBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    margin: 16, backgroundColor: C.surface, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 12,
    borderWidth: 1.5, borderColor: C.primary + '60',
    ...Platform.select({
      web: { boxShadow: '0 2px 8px rgba(26,111,216,0.08)' } as any,
      default: { shadowColor: C.primary, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 8, elevation: 3 },
    }),
  },
  searchInput: { flex: 1, fontSize: 15, fontFamily: 'Inter_400Regular', color: C.text },

  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  hintTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', color: C.text },
  hintText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', maxWidth: 280, lineHeight: 20 },
  shortcutsWrap: { width: '100%', marginTop: 8 },
  shortcutsLabel: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textMuted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10, textAlign: 'center' },
  shortcutsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  shortcutChip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: 20, backgroundColor: C.surface, borderWidth: 1.5 },
  shortcutText: { fontSize: 13, fontFamily: 'Inter_500Medium' },
  hint: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },

  results: { paddingHorizontal: 16, paddingBottom: 24 },

  section: { marginBottom: 20 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  sectionTitle: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.5 },

  resultCard: {
    backgroundColor: C.surface, borderRadius: 12, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: C.border, position: 'relative',
  },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' },
  resultId: { fontSize: 12, fontFamily: 'Inter_700Bold', color: C.primary },
  resultTitle: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.text, flex: 1 },
  resultMeta: { marginTop: 2 },
  resultMetaText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  statusPillText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  progressBar: { height: 3, backgroundColor: C.border, borderRadius: 2, marginTop: 8, overflow: 'hidden' },
  progressFill: { height: 3, borderRadius: 2 },
  chevron: { position: 'absolute', right: 14, top: '50%' },
});
