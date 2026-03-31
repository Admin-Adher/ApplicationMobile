import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  Alert, Modal, ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useState, useMemo } from 'react';
import { C } from '@/constants/colors';
import { useAuth } from '@/context/AuthContext';
import { useIncidents } from '@/context/IncidentsContext';
import { Incident, IncidentSeverity, IncidentStatus } from '@/constants/types';
import Header from '@/components/Header';
import DateInput from '@/components/DateInput';
import { RESERVE_BUILDINGS } from '@/lib/reserveUtils';
import { genId } from '@/lib/utils';

const SEVERITY_CONFIG: Record<IncidentSeverity, { label: string; color: string; bg: string; icon: string }> = {
  minor:    { label: 'Mineur',   color: '#6B7280', bg: '#F3F4F6', icon: 'information-circle' },
  moderate: { label: 'Modéré',  color: '#F59E0B', bg: '#FFFBEB', icon: 'warning' },
  major:    { label: 'Majeur',   color: '#EF4444', bg: '#FEF2F2', icon: 'alert-circle' },
  critical: { label: 'Critique', color: '#7F1D1D', bg: '#FEE2E2', icon: 'nuclear' },
};

const STATUS_CONFIG: Record<IncidentStatus, { label: string; color: string; bg: string }> = {
  open:          { label: 'Ouvert',        color: C.open,       bg: C.open + '15'       },
  investigating: { label: 'En cours',      color: C.inProgress, bg: C.inProgress + '15' },
  resolved:      { label: 'Résolu',        color: C.closed,     bg: C.closed + '15'     },
};

const SEVERITIES: IncidentSeverity[] = ['minor', 'moderate', 'major', 'critical'];
const STATUSES: IncidentStatus[] = ['open', 'investigating', 'resolved'];

function SeverityBadge({ severity }: { severity: IncidentSeverity }) {
  const cfg = SEVERITY_CONFIG[severity];
  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
      <Ionicons name={cfg.icon as any} size={11} color={cfg.color} />
      <Text style={[styles.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

function StatusBadge({ status }: { status: IncidentStatus }) {
  const cfg = STATUS_CONFIG[status];
  return (
    <View style={[styles.badge, { backgroundColor: cfg.bg }]}>
      <Text style={[styles.badgeText, { color: cfg.color }]}>{cfg.label}</Text>
    </View>
  );
}

const EMPTY_FORM: Omit<Incident, 'id' | 'reportedBy'> = {
  title: '',
  description: '',
  severity: 'moderate',
  location: '',
  building: 'A',
  reportedAt: new Date().toLocaleDateString('fr-FR').replace(/\//g, '/'),
  status: 'open',
  witnesses: '',
  actions: '',
};

type FilterSeverity = IncidentSeverity | 'all';
type FilterStatus = IncidentStatus | 'all';

export default function IncidentsScreen() {
  const { user, permissions } = useAuth();
  const { incidents, addIncident, updateIncident, deleteIncident } = useIncidents();

  const [search, setSearch] = useState('');
  const [filterSeverity, setFilterSeverity] = useState<FilterSeverity>('all');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');

  const [modalMode, setModalMode] = useState<'add' | 'edit' | null>(null);
  const [editTarget, setEditTarget] = useState<Incident | null>(null);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState(EMPTY_FORM);

  const filtered = useMemo(() => {
    return incidents.filter(i => {
      if (filterSeverity !== 'all' && i.severity !== filterSeverity) return false;
      if (filterStatus !== 'all' && i.status !== filterStatus) return false;
      if (search && !i.title.toLowerCase().includes(search.toLowerCase()) &&
          !i.location.toLowerCase().includes(search.toLowerCase()) &&
          !i.description.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    }).sort((a, b) => b.reportedAt.localeCompare(a.reportedAt));
  }, [incidents, filterSeverity, filterStatus, search]);

  const openCount = incidents.filter(i => i.status !== 'resolved').length;

  function openAdd() {
    const todayStr = (() => {
      const d = new Date();
      return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
    })();
    setForm({ ...EMPTY_FORM, reportedAt: todayStr });
    setEditTarget(null);
    setModalMode('add');
  }

  function openEdit(i: Incident) {
    setForm({
      title: i.title,
      description: i.description,
      severity: i.severity,
      location: i.location,
      building: i.building,
      reportedAt: i.reportedAt,
      status: i.status,
      witnesses: i.witnesses,
      actions: i.actions,
    });
    setEditTarget(i);
    setModalMode('edit');
  }

  async function handleSave() {
    if (!form.title.trim()) {
      Alert.alert('Champ requis', 'Le titre est obligatoire.');
      return;
    }
    if (!form.location.trim()) {
      Alert.alert('Champ requis', 'Le lieu est obligatoire.');
      return;
    }
    setSaving(true);
    if (modalMode === 'edit' && editTarget) {
      await updateIncident({ ...editTarget, ...form });
    } else {
      await addIncident({
        id: 'inc-' + genId(),
        ...form,
        reportedBy: user?.name ?? 'Inconnu',
      });
    }
    setSaving(false);
    setModalMode(null);
  }

  function handleDelete(i: Incident) {
    Alert.alert(
      'Supprimer l\'incident',
      `Supprimer "${i.title}" définitivement ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Supprimer', style: 'destructive', onPress: () => deleteIncident(i.id) },
      ]
    );
  }

  return (
    <View style={styles.container}>
      <Header
        title="Sécurité & Incidents"
        subtitle={`${openCount} non résolu${openCount !== 1 ? 's' : ''}`}
        rightLabel={permissions.canCreate ? 'Signaler' : undefined}
        onRightPress={permissions.canCreate ? openAdd : undefined}
      />

      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={15} color={C.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Rechercher un incident..."
          placeholderTextColor={C.textMuted}
          value={search}
          onChangeText={setSearch}
        />
        {search.length > 0 && (
          <TouchableOpacity onPress={() => setSearch('')}>
            <Ionicons name="close-circle" size={15} color={C.textMuted} />
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.filtersRow}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.filterChips}>
            <TouchableOpacity
              style={[styles.fChip, filterStatus === 'all' && styles.fChipActive]}
              onPress={() => setFilterStatus('all')}
            >
              <Text style={[styles.fChipText, filterStatus === 'all' && styles.fChipTextActive]}>Tous</Text>
            </TouchableOpacity>
            {STATUSES.map(s => (
              <TouchableOpacity
                key={s}
                style={[styles.fChip, filterStatus === s && { borderColor: STATUS_CONFIG[s].color, backgroundColor: STATUS_CONFIG[s].bg }]}
                onPress={() => setFilterStatus(s)}
              >
                <Text style={[styles.fChipText, filterStatus === s && { color: STATUS_CONFIG[s].color }]}>
                  {STATUS_CONFIG[s].label}
                </Text>
              </TouchableOpacity>
            ))}
            <View style={styles.filterDivider} />
            {SEVERITIES.map(s => (
              <TouchableOpacity
                key={s}
                style={[styles.fChip, filterSeverity === s && { borderColor: SEVERITY_CONFIG[s].color, backgroundColor: SEVERITY_CONFIG[s].bg }]}
                onPress={() => setFilterSeverity(prev => prev === s ? 'all' : s)}
              >
                <Ionicons name={SEVERITY_CONFIG[s].icon as any} size={12} color={SEVERITY_CONFIG[s].color} />
                <Text style={[styles.fChipText, filterSeverity === s && { color: SEVERITY_CONFIG[s].color }]}>
                  {SEVERITY_CONFIG[s].label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={styles.list} showsVerticalScrollIndicator={false}>
        {filtered.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="shield-checkmark-outline" size={48} color={C.closed} />
            <Text style={styles.emptyTitle}>Aucun incident</Text>
            <Text style={styles.emptyText}>
              {incidents.length === 0
                ? 'Aucun incident signalé sur ce chantier.'
                : 'Aucun incident ne correspond aux filtres sélectionnés.'}
            </Text>
          </View>
        ) : (
          filtered.map(incident => {
            const scfg = SEVERITY_CONFIG[incident.severity];
            return (
              <TouchableOpacity
                key={incident.id}
                style={[styles.incCard, { borderLeftColor: scfg.color }]}
                onPress={() => openEdit(incident)}
                activeOpacity={0.8}
              >
                <View style={styles.incHeader}>
                  <View style={styles.incBadges}>
                    <SeverityBadge severity={incident.severity} />
                    <StatusBadge status={incident.status} />
                  </View>
                  {permissions.canDelete && (
                    <TouchableOpacity
                      onPress={() => handleDelete(incident)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="trash-outline" size={16} color={C.open} />
                    </TouchableOpacity>
                  )}
                </View>
                <Text style={styles.incTitle}>{incident.title}</Text>
                <Text style={styles.incDesc} numberOfLines={2}>{incident.description}</Text>
                <View style={styles.incMeta}>
                  <View style={styles.incMetaItem}>
                    <Ionicons name="location-outline" size={12} color={C.textMuted} />
                    <Text style={styles.incMetaText}>Bât. {incident.building} — {incident.location}</Text>
                  </View>
                  <View style={styles.incMetaItem}>
                    <Ionicons name="calendar-outline" size={12} color={C.textMuted} />
                    <Text style={styles.incMetaText}>{incident.reportedAt}</Text>
                  </View>
                  <View style={styles.incMetaItem}>
                    <Ionicons name="person-outline" size={12} color={C.textMuted} />
                    <Text style={styles.incMetaText}>{incident.reportedBy}</Text>
                  </View>
                </View>
                {incident.actions ? (
                  <View style={styles.actionsRow}>
                    <Ionicons name="checkmark-circle-outline" size={12} color={C.inProgress} />
                    <Text style={styles.actionsText} numberOfLines={1}>{incident.actions}</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            );
          })
        )}
        <View style={{ height: 32 }} />
      </ScrollView>

      <Modal
        visible={!!modalMode}
        transparent
        animationType="slide"
        onRequestClose={() => setModalMode(null)}
      >
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setModalMode(null)}>
          <TouchableOpacity activeOpacity={1} style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={styles.sheetTitle}>
                {modalMode === 'edit' ? 'Modifier l\'incident' : 'Signaler un incident'}
              </Text>

              <Text style={styles.fieldLabel}>Titre *</Text>
              <TextInput
                style={styles.fieldInput}
                value={form.title}
                onChangeText={v => setForm(f => ({ ...f, title: v }))}
                placeholder="Ex : Chute de matériaux"
                placeholderTextColor={C.textMuted}
              />

              <Text style={styles.fieldLabel}>Description</Text>
              <TextInput
                style={[styles.fieldInput, styles.textArea]}
                value={form.description}
                onChangeText={v => setForm(f => ({ ...f, description: v }))}
                placeholder="Décrivez les circonstances..."
                placeholderTextColor={C.textMuted}
                multiline
                numberOfLines={3}
              />

              <Text style={styles.fieldLabel}>Lieu *</Text>
              <TextInput
                style={styles.fieldInput}
                value={form.location}
                onChangeText={v => setForm(f => ({ ...f, location: v }))}
                placeholder="Ex : Échafaudage Est, Niveau R+2"
                placeholderTextColor={C.textMuted}
              />

              <Text style={styles.fieldLabel}>Bâtiment</Text>
              <View style={styles.chipRow}>
                {RESERVE_BUILDINGS.map(b => (
                  <TouchableOpacity
                    key={b}
                    style={[styles.chip, form.building === b && styles.chipActive]}
                    onPress={() => setForm(f => ({ ...f, building: b }))}
                  >
                    <Text style={[styles.chipText, form.building === b && styles.chipTextActive]}>Bât. {b}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.fieldLabel}>Gravité</Text>
              <View style={styles.chipRow}>
                {SEVERITIES.map(s => {
                  const cfg = SEVERITY_CONFIG[s];
                  const active = form.severity === s;
                  return (
                    <TouchableOpacity
                      key={s}
                      style={[styles.chip, active && { borderColor: cfg.color, backgroundColor: cfg.bg }]}
                      onPress={() => setForm(f => ({ ...f, severity: s }))}
                    >
                      <Ionicons name={cfg.icon as any} size={12} color={active ? cfg.color : C.textMuted} />
                      <Text style={[styles.chipText, active && { color: cfg.color }]}>{cfg.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.fieldLabel}>Statut</Text>
              <View style={styles.chipRow}>
                {STATUSES.map(s => {
                  const cfg = STATUS_CONFIG[s];
                  const active = form.status === s;
                  return (
                    <TouchableOpacity
                      key={s}
                      style={[styles.chip, active && { borderColor: cfg.color, backgroundColor: cfg.bg }]}
                      onPress={() => setForm(f => ({ ...f, status: s }))}
                    >
                      <Text style={[styles.chipText, active && { color: cfg.color }]}>{cfg.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <View style={{ marginTop: 4, marginBottom: 4 }}>
                <DateInput
                  label="Date de l'incident"
                  value={form.reportedAt}
                  onChange={v => setForm(f => ({ ...f, reportedAt: v }))}
                  optional
                />
              </View>

              <Text style={styles.fieldLabel}>Témoins</Text>
              <TextInput
                style={styles.fieldInput}
                value={form.witnesses}
                onChangeText={v => setForm(f => ({ ...f, witnesses: v }))}
                placeholder="Noms des témoins (optionnel)"
                placeholderTextColor={C.textMuted}
              />

              <Text style={styles.fieldLabel}>Actions correctives</Text>
              <TextInput
                style={[styles.fieldInput, styles.textArea]}
                value={form.actions}
                onChangeText={v => setForm(f => ({ ...f, actions: v }))}
                placeholder="Mesures prises ou planifiées..."
                placeholderTextColor={C.textMuted}
                multiline
                numberOfLines={3}
              />

              {saving ? (
                <ActivityIndicator size="large" color={C.primary} style={{ marginVertical: 16 }} />
              ) : (
                <TouchableOpacity style={styles.saveBtn} onPress={handleSave}>
                  <Text style={styles.saveBtnText}>
                    {modalMode === 'edit' ? 'Enregistrer' : 'Signaler l\'incident'}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalMode(null)}>
                <Text style={styles.cancelBtnText}>Annuler</Text>
              </TouchableOpacity>
              <View style={{ height: 20 }} />
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 16, marginTop: 12, marginBottom: 8,
    backgroundColor: C.surface, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 9,
    borderWidth: 1, borderColor: C.border,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text },

  filtersRow: { paddingBottom: 10 },
  filterChips: { flexDirection: 'row', gap: 6, paddingHorizontal: 16, alignItems: 'center' },
  filterDivider: { width: 1, height: 20, backgroundColor: C.border, marginHorizontal: 4 },
  fChip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 16,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.surface,
  },
  fChipActive: { borderColor: C.primary, backgroundColor: C.primaryBg },
  fChipText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub },
  fChipTextActive: { color: C.primary },

  list: { paddingHorizontal: 16, paddingTop: 4 },

  empty: { alignItems: 'center', paddingVertical: 60, gap: 12 },
  emptyTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', color: C.text },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', maxWidth: 280 },

  incCard: {
    backgroundColor: C.surface, borderRadius: 14, padding: 14, marginBottom: 12,
    borderWidth: 1, borderColor: C.border, borderLeftWidth: 4,
  },
  incHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  incBadges: { flexDirection: 'row', gap: 6 },
  badge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  badgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  incTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 4 },
  incDesc: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, lineHeight: 18, marginBottom: 8 },
  incMeta: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  incMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  incMetaText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },
  actionsRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, backgroundColor: C.inProgress + '12', borderRadius: 8, padding: 8 },
  actionsText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: C.inProgress },

  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 20, maxHeight: '90%',
  },
  sheetHandle: { width: 36, height: 4, backgroundColor: C.border, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  sheetTitle: { fontSize: 18, fontFamily: 'Inter_700Bold', color: C.text, marginBottom: 16 },

  fieldLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 6, marginTop: 12 },
  fieldInput: {
    backgroundColor: C.surface2, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 11,
    fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text, borderWidth: 1, borderColor: C.border,
  },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 2 },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 12, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.surface2,
  },
  chipActive: { borderColor: C.primary, backgroundColor: C.primaryBg },
  chipText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub },
  chipTextActive: { color: C.primary },

  saveBtn: { backgroundColor: C.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center', marginTop: 16 },
  saveBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  cancelBtn: { alignItems: 'center', paddingVertical: 14 },
  cancelBtnText: { fontSize: 15, fontFamily: 'Inter_400Regular', color: C.textMuted },
});
