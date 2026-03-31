import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { Visite, VisiteStatus } from '@/constants/types';
import Header from '@/components/Header';
import BottomNavBar from '@/components/BottomNavBar';

const STATUS_CFG: Record<VisiteStatus, { label: string; color: string; icon: string }> = {
  planned: { label: 'Planifiée', color: '#6366F1', icon: 'calendar-outline' },
  in_progress: { label: 'En cours', color: C.inProgress, icon: 'walk-outline' },
  completed: { label: 'Terminée', color: C.closed, icon: 'checkmark-circle-outline' },
};

function VisiteCard({
  visite, reserveCount, onPress, onDelete, canDelete,
}: {
  visite: Visite; reserveCount: number; onPress: () => void; onDelete: () => void; canDelete: boolean;
}) {
  const cfg = STATUS_CFG[visite.status];
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.cardHeader}>
        <View style={[styles.statusBadge, { backgroundColor: cfg.color + '20' }]}>
          <Ionicons name={cfg.icon as any} size={13} color={cfg.color} />
          <Text style={[styles.statusText, { color: cfg.color }]}>{cfg.label}</Text>
        </View>
        <View style={styles.cardActions}>
          <Text style={styles.cardDate}>{visite.date}</Text>
          {canDelete && (
            <TouchableOpacity onPress={onDelete} hitSlop={8} style={{ marginLeft: 8 }}>
              <Ionicons name="trash-outline" size={15} color={C.textMuted} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      <Text style={styles.cardTitle}>{visite.title}</Text>

      <View style={styles.cardMeta}>
        <Ionicons name="person-outline" size={12} color={C.textMuted} />
        <Text style={styles.cardMetaText}>{visite.conducteur}</Text>
        {visite.building && (
          <>
            <Ionicons name="business-outline" size={12} color={C.textMuted} style={{ marginLeft: 10 }} />
            <Text style={styles.cardMetaText}>Bât. {visite.building} — {visite.level}</Text>
          </>
        )}
      </View>

      {visite.notes ? (
        <Text style={styles.cardNotes} numberOfLines={2}>{visite.notes}</Text>
      ) : null}

      <View style={styles.cardFooter}>
        <View style={styles.reservesPill}>
          <Ionicons name="warning-outline" size={12} color={C.open} />
          <Text style={styles.reservesPillText}>{reserveCount} réserve{reserveCount !== 1 ? 's' : ''}</Text>
        </View>
        <Ionicons name="chevron-forward" size={14} color={C.textMuted} />
      </View>
    </TouchableOpacity>
  );
}

export default function VisitesScreen() {
  const router = useRouter();
  const { visites, reserves, deleteVisite, activeChantierId } = useApp();
  const { permissions } = useAuth();

  const chantierVisites = useMemo(
    () => visites.filter(v => !activeChantierId || v.chantierId === activeChantierId)
      .sort((a, b) => b.date.localeCompare(a.date)),
    [visites, activeChantierId]
  );

  const stats = useMemo(() => ({
    total: chantierVisites.length,
    planned: chantierVisites.filter(v => v.status === 'planned').length,
    inProgress: chantierVisites.filter(v => v.status === 'in_progress').length,
    completed: chantierVisites.filter(v => v.status === 'completed').length,
  }), [chantierVisites]);

  function handleDelete(v: Visite) {
    Alert.alert('Supprimer la visite', `Supprimer "${v.title}" ?`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => deleteVisite(v.id) },
    ]);
  }

  return (
    <View style={styles.container}>
      <Header
        title="Visites"
        subtitle={`${stats.total} visite${stats.total !== 1 ? 's' : ''}`}
        showBack
        rightIcon={permissions.canCreate ? 'add-circle-outline' : undefined}
        onRightPress={permissions.canCreate ? () => router.push('/visite/new' as any) : undefined}
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.statsRow}>
          {[
            { label: 'Planifiées', count: stats.planned, color: '#6366F1' },
            { label: 'En cours', count: stats.inProgress, color: C.inProgress },
            { label: 'Terminées', count: stats.completed, color: C.closed },
          ].map(s => (
            <View key={s.label} style={[styles.statCard, { borderTopColor: s.color }]}>
              <Text style={[styles.statVal, { color: s.color }]}>{s.count}</Text>
              <Text style={styles.statLabel}>{s.label}</Text>
            </View>
          ))}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Toutes les visites</Text>
          {permissions.canCreate && (
            <TouchableOpacity style={styles.newBtn} onPress={() => router.push('/visite/new' as any)}>
              <Ionicons name="add" size={15} color={C.primary} />
              <Text style={styles.newBtnText}>Nouvelle visite</Text>
            </TouchableOpacity>
          )}
        </View>

        {chantierVisites.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="walk-outline" size={40} color={C.textMuted} />
            <Text style={styles.emptyTitle}>Aucune visite</Text>
            <Text style={styles.emptyText}>Créez une visite terrain pour grouper vos réserves</Text>
            {permissions.canCreate && (
              <TouchableOpacity style={styles.emptyBtn} onPress={() => router.push('/visite/new' as any)}>
                <Text style={styles.emptyBtnText}>Créer une visite</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          chantierVisites.map(v => (
            <VisiteCard
              key={v.id}
              visite={v}
              reserveCount={v.reserveIds.length}
              onPress={() => router.push(`/visite/${v.id}` as any)}
              onDelete={() => handleDelete(v)}
              canDelete={permissions.canDelete}
            />
          ))
        )}
      </ScrollView>

      <BottomNavBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 100 },

  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 20 },
  statCard: {
    flex: 1, backgroundColor: C.surface, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: C.border, borderTopWidth: 3, alignItems: 'center',
  },
  statVal: { fontSize: 22, fontFamily: 'Inter_700Bold' },
  statLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2, textAlign: 'center' },

  section: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  newBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  newBtnText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.primary },

  card: {
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: C.border, marginBottom: 12,
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 20 },
  statusText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  cardActions: { flexDirection: 'row', alignItems: 'center' },
  cardDate: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted },

  cardTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 8 },
  cardMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 6 },
  cardMetaText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub },
  cardNotes: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, lineHeight: 18, marginBottom: 10, fontStyle: 'italic' },

  cardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: C.border },
  reservesPill: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  reservesPillText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.open },

  empty: { alignItems: 'center', paddingVertical: 48, gap: 10 },
  emptyTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.text },
  emptyText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, textAlign: 'center' },
  emptyBtn: { backgroundColor: C.primary, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12, marginTop: 8 },
  emptyBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },
});
