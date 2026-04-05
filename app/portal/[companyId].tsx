import { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, ActivityIndicator,
  TouchableOpacity, Linking, Platform,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/constants/colors';
import { useAuth } from '@/context/AuthContext';
import { useApp } from '@/context/AppContext';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';

interface PortalReserve {
  id: string;
  title: string;
  status: string;
  priority?: string;
  building?: string;
  level?: string;
  deadline?: string;
  description?: string;
  lotId?: string;
}

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  open: { label: 'Ouvert', color: '#EF4444' },
  in_progress: { label: 'En cours', color: '#F59E0B' },
  waiting: { label: 'Attente', color: '#6B7280' },
  verification: { label: 'Vérification', color: '#8B5CF6' },
  closed: { label: 'Clôturé', color: '#10B981' },
};

export default function PortalScreen() {
  const { companyId } = useLocalSearchParams<{ companyId: string }>();
  const { isAuthenticated, user } = useAuth();
  const { reserves, companies } = useApp();
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [remoteReserves, setRemoteReserves] = useState<PortalReserve[]>([]);
  const [companyName, setCompanyName] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const isSupabase = isSupabaseConfigured;

  useEffect(() => {
    if (!companyId) return;

    if (isAuthenticated) {
      const company = companies.find(c => c.id === companyId);
      setCompanyName(company?.name ?? companyId);
      const companyReserves = reserves
        .filter(r => r.company === (company?.name ?? companyId))
        .map(r => ({
          id: r.id,
          title: r.title,
          status: r.status,
          priority: r.priority,
          building: r.building,
          level: r.level,
          deadline: r.deadline,
          description: r.description,
          lotId: r.lotId,
        }));
      setRemoteReserves(companyReserves);
      return;
    }

    if (isSupabase) {
      setLoading(true);
      supabase.from('companies').select('name').eq('id', companyId).single()
        .then(async ({ data: companyData, error: companyError }) => {
          if (companyError || !companyData?.name) {
            setError("Impossible de charger les données de l'entreprise. Vérifiez votre connexion.");
            return;
          }
          const name = companyData.name;
          setCompanyName(name);
          const { data: reservesData, error: reservesError } = await supabase
            .from('reserves')
            .select('id,title,status,priority,building,level,deadline,description,lot_id')
            .or(`company.eq.${name},companies.cs.["${name}"]`);
          if (reservesError) {
            setError("Impossible de charger les réserves. Vérifiez votre connexion.");
            return;
          }
          if (Array.isArray(reservesData)) {
            setRemoteReserves(reservesData.map((r: Record<string, string>) => ({
              id: r.id, title: r.title, status: r.status,
              priority: r.priority, building: r.building,
              level: r.level, deadline: r.deadline, description: r.description,
              lotId: r.lot_id,
            })));
          }
        })
        .catch(() => {
          setError("Impossible de charger les données. Vérifiez votre connexion.");
        })
        .finally(() => setLoading(false));
    }
  }, [companyId, isAuthenticated]);

  const displayReserves = remoteReserves;
  const filtered = statusFilter === 'all' ? displayReserves : displayReserves.filter(r => r.status === statusFilter);
  const openCount = displayReserves.filter(r => r.status !== 'closed').length;
  const closedCount = displayReserves.filter(r => r.status === 'closed').length;

  if (isAuthenticated && user?.role === 'sous_traitant' && user?.companyId !== companyId) {
    return (
      <View style={styles.centerContainer}>
        <Ionicons name="lock-closed-outline" size={48} color={C.textMuted} />
        <Text style={styles.lockedTitle}>Accès restreint</Text>
        <Text style={styles.lockedSub}>Vous n'avez accès qu'au portail de votre propre entreprise.</Text>
        <TouchableOpacity style={styles.loginBtn} onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/' as any)}>
          <Text style={styles.loginBtnText}>Retour</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!isAuthenticated && !isSupabase) {
    return (
      <View style={styles.centerContainer}>
        <Ionicons name="lock-closed-outline" size={48} color={C.textMuted} />
        <Text style={styles.lockedTitle}>Portail sous-traitant</Text>
        <Text style={styles.lockedSub}>Ce portail nécessite une connexion Supabase configurée. Contactez l'administrateur du projet.</Text>
        <TouchableOpacity style={styles.loginBtn} onPress={() => router.replace('/login')}>
          <Text style={styles.loginBtnText}>Se connecter</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.canGoBack() ? router.back() : router.replace('/login')} style={styles.backBtn}>
          <Ionicons name="arrow-back" size={20} color={C.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Portail sous-traitant</Text>
          {companyName ? <Text style={styles.headerSub}>{companyName}</Text> : null}
        </View>
        <View style={styles.badgeRow}>
          <View style={[styles.badge, { backgroundColor: '#FEF2F2' }]}>
            <Text style={[styles.badgeText, { color: '#EF4444' }]}>{openCount} ouvert{openCount !== 1 ? 's' : ''}</Text>
          </View>
          <View style={[styles.badge, { backgroundColor: '#ECFDF5' }]}>
            <Text style={[styles.badgeText, { color: '#10B981' }]}>{closedCount} clôt.</Text>
          </View>
        </View>
      </View>

      {loading && (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={C.primary} />
          <Text style={styles.loadingText}>Chargement des réserves...</Text>
        </View>
      )}

      {error && (
        <View style={styles.errorBanner}>
          <Ionicons name="warning-outline" size={16} color="#92400E" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterBar} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingVertical: 8 }}>
        {[
          { key: 'all', label: 'Toutes' },
          { key: 'open', label: 'Ouvert' },
          { key: 'in_progress', label: 'En cours' },
          { key: 'closed', label: 'Clôturé' },
        ].map(f => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterChip, statusFilter === f.key && styles.filterChipActive]}
            onPress={() => setStatusFilter(f.key)}
          >
            <Text style={[styles.filterChipText, statusFilter === f.key && styles.filterChipTextActive]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView style={styles.list} contentContainerStyle={{ padding: 16, gap: 10 }}>
        {filtered.length === 0 && !loading && (
          <View style={styles.emptyState}>
            <Ionicons name="checkmark-circle-outline" size={40} color={C.textMuted} />
            <Text style={styles.emptyText}>Aucune réserve {statusFilter !== 'all' ? 'avec ce statut' : ''}</Text>
          </View>
        )}
        {filtered.map(r => {
          const sc = STATUS_LABEL[r.status] ?? { label: r.status, color: C.textMuted };
          return (
            <View key={r.id} style={styles.reserveCard}>
              <View style={styles.reserveTop}>
                <View style={[styles.statusDot, { backgroundColor: sc.color }]} />
                <Text style={styles.reserveTitle} numberOfLines={2}>{r.title}</Text>
                <View style={[styles.statusBadge, { backgroundColor: sc.color + '20', borderColor: sc.color + '40' }]}>
                  <Text style={[styles.statusBadgeText, { color: sc.color }]}>{sc.label}</Text>
                </View>
              </View>
              {(r.building || r.level) && (
                <View style={styles.reserveMeta}>
                  <Ionicons name="business-outline" size={11} color={C.textMuted} />
                  <Text style={styles.reserveMetaText}>{[r.building, r.level].filter(Boolean).join(' — ')}</Text>
                </View>
              )}
              {r.deadline && (
                <View style={styles.reserveMeta}>
                  <Ionicons name="calendar-outline" size={11} color={C.textMuted} />
                  <Text style={styles.reserveMetaText}>Échéance : {r.deadline}</Text>
                </View>
              )}
              {r.description && (
                <Text style={styles.reserveDesc} numberOfLines={2}>{r.description}</Text>
              )}
            </View>
          );
        })}
      </ScrollView>

      <View style={styles.footer}>
        <Text style={styles.footerText}>Portail BuildTrack — Lecture seule</Text>
        {!isAuthenticated && (
          <TouchableOpacity onPress={() => router.replace('/login')}>
            <Text style={styles.footerLink}>Connexion complète →</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  centerContainer: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 16 },
  lockedTitle: { fontSize: 20, fontFamily: 'Inter_700Bold', color: C.text, textAlign: 'center' },
  lockedSub: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textSub, textAlign: 'center', lineHeight: 20 },
  loginBtn: { backgroundColor: C.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, marginTop: 8 },
  loginBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border, paddingHorizontal: 16, paddingVertical: 14, paddingTop: Platform.OS === 'ios' ? 54 : 14 },
  backBtn: { padding: 4 },
  headerTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.text },
  headerSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 1 },
  badgeRow: { flexDirection: 'row', gap: 6 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 20 },
  badgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 16 },
  loadingText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub },
  errorBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FFFBEB', borderBottomWidth: 1, borderBottomColor: '#FDE68A', padding: 12, paddingHorizontal: 16 },
  errorText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: '#92400E', flex: 1 },
  filterBar: { backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border, maxHeight: 48 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 5, borderRadius: 20, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border },
  filterChipActive: { backgroundColor: C.primaryBg, borderColor: C.primary },
  filterChipText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub },
  filterChipTextActive: { color: C.primary, fontFamily: 'Inter_600SemiBold' },
  list: { flex: 1 },
  reserveCard: { backgroundColor: C.surface, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.border, gap: 6 },
  reserveTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginTop: 5, flexShrink: 0 },
  reserveTitle: { flex: 1, fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text, lineHeight: 20 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, borderWidth: 1 },
  statusBadgeText: { fontSize: 11, fontFamily: 'Inter_500Medium' },
  reserveMeta: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingLeft: 16 },
  reserveMetaText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },
  reserveDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, lineHeight: 18, paddingLeft: 16 },
  emptyState: { alignItems: 'center', paddingTop: 48, gap: 12 },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textMuted },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, paddingHorizontal: 16, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.surface },
  footerText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },
  footerLink: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.primary },
});
