import {
  View, Text, StyleSheet, Modal, TextInput, TouchableOpacity,
  ScrollView, Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState, useCallback } from 'react';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { useIncidents } from '@/context/IncidentsContext';

const STATUS_LABELS: Record<string, string> = {
  open: 'Ouvert', in_progress: 'En cours', waiting: 'En attente',
  verification: 'Vérification', closed: 'Clôturé',
};
const STATUS_COLORS: Record<string, string> = {
  open: C.open, in_progress: C.inProgress, waiting: C.waiting,
  verification: C.verification, closed: C.closed,
};
const SEV_LABELS: Record<string, string> = {
  minor: 'Mineur', moderate: 'Modéré', major: 'Majeur', critical: 'Critique',
};
const SEV_COLORS: Record<string, string> = {
  minor: '#6B7280', moderate: '#F59E0B', major: '#EF4444', critical: '#7F1D1D',
};

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function GlobalSearch({ visible, onClose }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { reserves, documents, companies } = useApp();
  const { user } = useAuth();
  const { incidents } = useIncidents();
  const [query, setQuery] = useState('');

  const isSousTraitant = user?.role === 'sous_traitant';
  const sousTraitantCompanyName = isSousTraitant && user?.companyId
    ? companies.find(c => c.id === user.companyId)?.name ?? null
    : null;

  const q = query.toLowerCase().trim();

  const results = useMemo(() => {
    if (q.length < 2) return { reserves: [], incidents: [], documents: [] };
    const s = (v: string | null | undefined) => (v ?? '').toLowerCase();

    const visibleReserves = isSousTraitant && sousTraitantCompanyName
      ? reserves.filter(r =>
          r.company === sousTraitantCompanyName ||
          (Array.isArray(r.companies) && r.companies.includes(sousTraitantCompanyName))
        )
      : reserves;

    return {
      reserves: visibleReserves.filter(r =>
        s(r.title).includes(q) ||
        s(r.id).includes(q) ||
        s(r.description).includes(q) ||
        s(r.building).includes(q) ||
        s(r.zone).includes(q) ||
        (r.companies ?? []).some(c => s(c).includes(q))
      ).slice(0, 8),
      incidents: isSousTraitant ? [] : incidents.filter(i =>
        s(i.title).includes(q) ||
        s(i.description).includes(q) ||
        s(i.location).includes(q) ||
        s(i.reportedBy).includes(q)
      ).slice(0, 5),
      documents: documents.filter(d =>
        s(d.name).includes(q) ||
        s(d.category).includes(q)
      ).slice(0, 5),
    };
  }, [q, reserves, isSousTraitant, sousTraitantCompanyName, incidents, documents]);

  const totalCount = results.reserves.length + results.incidents.length + results.documents.length;

  const handleClose = useCallback(() => {
    setQuery('');
    onClose();
  }, [onClose]);

  function navigate(path: any) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    handleClose();
    setTimeout(() => router.push(path), 150);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <View style={styles.overlay}>
        <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={handleClose} />
        <View style={[styles.sheet, { paddingTop: Platform.OS === 'web' ? 24 : insets.top + 12, paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.searchBar}>
            <Ionicons name="search-outline" size={18} color={C.primary} />
            <TextInput
              style={styles.input}
              placeholder="Chercher réserves, incidents, documents…"
              placeholderTextColor={C.textMuted}
              value={query}
              onChangeText={setQuery}
              autoFocus
              returnKeyType="search"
              clearButtonMode="while-editing"
            />
            <TouchableOpacity onPress={handleClose} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={C.textMuted} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
            {q.length < 2 ? (
              <View style={styles.hint}>
                <Ionicons name="search-outline" size={40} color={C.border} />
                <Text style={styles.hintText}>Saisissez au moins 2 caractères</Text>
              </View>
            ) : totalCount === 0 ? (
              <View style={styles.hint}>
                <Ionicons name="file-tray-outline" size={40} color={C.border} />
                <Text style={styles.hintText}>Aucun résultat pour « {query} »</Text>
              </View>
            ) : (
              <>
                {results.reserves.length > 0 && (
                  <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                      <Ionicons name="warning-outline" size={13} color={C.primary} />
                      <Text style={styles.sectionTitle}>Réserves</Text>
                      <Text style={styles.sectionCount}>{results.reserves.length}</Text>
                    </View>
                    {results.reserves.map(r => (
                      <TouchableOpacity
                        key={r.id}
                        style={styles.row}
                        onPress={() => navigate(`/reserve/${r.id}`)}
                        activeOpacity={0.75}
                      >
                        <View style={styles.rowLeft}>
                          <View style={styles.idTag}>
                            <Text style={styles.idText}>{r.id}</Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.rowTitle} numberOfLines={1}>{r.title}</Text>
                            <Text style={styles.rowMeta} numberOfLines={1}>Bât. {r.building} — {r.zone}</Text>
                          </View>
                        </View>
                        <View style={[styles.statusPill, { backgroundColor: (STATUS_COLORS[r.status] ?? C.textMuted) + '18' }]}>
                          <Text style={[styles.statusText, { color: STATUS_COLORS[r.status] ?? C.textMuted }]}>
                            {STATUS_LABELS[r.status] ?? r.status}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {results.incidents.length > 0 && (
                  <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                      <Ionicons name="alert-circle-outline" size={13} color={C.open} />
                      <Text style={styles.sectionTitle}>Incidents</Text>
                      <Text style={styles.sectionCount}>{results.incidents.length}</Text>
                    </View>
                    {results.incidents.map(i => (
                      <TouchableOpacity
                        key={i.id}
                        style={styles.row}
                        onPress={() => navigate('/(tabs)/incidents' as any)}
                        activeOpacity={0.75}
                      >
                        <View style={styles.rowLeft}>
                          <View style={[styles.sevDot, { backgroundColor: SEV_COLORS[i.severity] ?? C.textMuted }]} />
                          <View style={{ flex: 1 }}>
                            <Text style={styles.rowTitle} numberOfLines={1}>{i.title}</Text>
                            <Text style={styles.rowMeta} numberOfLines={1}>{i.location} · {SEV_LABELS[i.severity]}</Text>
                          </View>
                        </View>
                        <Ionicons name="chevron-forward" size={14} color={C.textMuted} />
                      </TouchableOpacity>
                    ))}
                  </View>
                )}

                {results.documents.length > 0 && (
                  <View style={styles.section}>
                    <View style={styles.sectionHeader}>
                      <Ionicons name="document-text-outline" size={13} color={C.textSub} />
                      <Text style={styles.sectionTitle}>Documents</Text>
                      <Text style={styles.sectionCount}>{results.documents.length}</Text>
                    </View>
                    {results.documents.map(d => (
                      <TouchableOpacity
                        key={d.id}
                        style={styles.row}
                        onPress={() => navigate('/(tabs)/more' as any)}
                        activeOpacity={0.75}
                      >
                        <View style={styles.rowLeft}>
                          <View style={styles.docIcon}>
                            <Ionicons name="document-outline" size={14} color={C.textSub} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.rowTitle} numberOfLines={1}>{d.name}</Text>
                            <Text style={styles.rowMeta} numberOfLines={1}>{d.category} · v{d.version}</Text>
                          </View>
                        </View>
                        <Ionicons name="chevron-forward" size={14} color={C.textMuted} />
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </>
            )}
            <View style={{ height: 32 }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-start',
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  sheet: {
    backgroundColor: C.bg,
    borderBottomLeftRadius: 20,
    borderBottomRightRadius: 20,
    maxHeight: '85%',
    paddingHorizontal: 16,
    ...Platform.select({
      web: { boxShadow: '0px 4px 24px rgba(0,0,0,0.16)' } as any,
      default: { shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.16, shadowRadius: 24, elevation: 12 },
    }),
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: C.surface,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: C.primary + '40',
    marginBottom: 12,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
    color: C.text,
    padding: 0,
  },
  hint: {
    alignItems: 'center',
    paddingVertical: 40,
    gap: 10,
  },
  hintText: {
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.textMuted,
  },
  section: {
    marginBottom: 8,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    marginBottom: 4,
  },
  sectionTitle: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'Inter_700Bold',
    color: C.textSub,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  sectionCount: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
    color: C.textMuted,
    backgroundColor: C.surface2,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: C.border + '60',
  },
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    marginRight: 8,
  },
  rowTitle: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: C.text,
    marginBottom: 2,
  },
  rowMeta: {
    fontSize: 12,
    fontFamily: 'Inter_400Regular',
    color: C.textMuted,
  },
  idTag: {
    backgroundColor: C.primaryBg,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 6,
    flexShrink: 0,
  },
  idText: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    color: C.primary,
    letterSpacing: 0.5,
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    flexShrink: 0,
  },
  statusText: {
    fontSize: 11,
    fontFamily: 'Inter_600SemiBold',
  },
  sevDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
    marginTop: 2,
  },
  docIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: C.surface2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: C.border,
    flexShrink: 0,
  },
});
