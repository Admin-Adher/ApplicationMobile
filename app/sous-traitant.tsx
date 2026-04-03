import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Image, Platform, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState, useMemo } from 'react';
import * as Clipboard from 'expo-clipboard';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { Reserve, Company, ReserveStatus } from '@/constants/types';
import Header from '@/components/Header';
import BottomNavBar from '@/components/BottomNavBar';

const STATUS_CFG: Record<string, { label: string; color: string }> = {
  open: { label: 'À traiter', color: C.open },
  in_progress: { label: 'En cours', color: C.inProgress },
  waiting: { label: 'En attente', color: C.waiting },
  verification: { label: 'Vérification', color: C.verification },
  closed: { label: 'Terminé', color: C.closed },
};

const PRIORITY_CFG: Record<string, { label: string; color: string }> = {
  low: { label: 'Faible', color: '#22C55E' },
  medium: { label: 'Moyen', color: '#F59E0B' },
  high: { label: 'Urgent', color: '#EF4444' },
  critical: { label: 'CRITIQUE', color: '#7C3AED' },
};

function ReserveCard({
  reserve,
  onPress,
  onMarkInProgress,
  onMarkDone,
  canEdit,
}: {
  reserve: Reserve;
  onPress: () => void;
  onMarkInProgress: () => void;
  onMarkDone: () => void;
  canEdit: boolean;
}) {
  const scfg = STATUS_CFG[reserve.status] ?? STATUS_CFG.open;
  const pcfg = PRIORITY_CFG[reserve.priority] ?? PRIORITY_CFG.medium;
  const isOverdue = reserve.deadline && reserve.deadline !== '—' && (() => {
    const parts = reserve.deadline.split('/');
    if (parts.length !== 3) return false;
    const d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
    return d < new Date();
  })();

  const isOpen = reserve.status === 'open';
  const isInProgress = reserve.status === 'in_progress';
  const isClosed = reserve.status === 'closed' || reserve.status === 'verification';
  const isObservation = reserve.kind === 'observation';

  return (
    <TouchableOpacity style={[styles.card, { borderLeftColor: pcfg.color }]} onPress={onPress} activeOpacity={0.75}>
      <View style={styles.cardTop}>
        <View style={[styles.statusPill, { backgroundColor: scfg.color + '20' }]}>
          <Text style={[styles.statusText, { color: scfg.color }]}>{scfg.label}</Text>
        </View>
        <View style={[styles.priorityPill, { backgroundColor: pcfg.color + '15' }]}>
          <Text style={[styles.priorityText, { color: pcfg.color }]}>{pcfg.label}</Text>
        </View>
        {isObservation && (
          <View style={styles.obsPill}>
            <Ionicons name="eye-outline" size={10} color="#0EA5E9" />
            <Text style={styles.obsText}>Obs.</Text>
          </View>
        )}
      </View>
      <Text style={styles.reserveId}>{reserve.id}</Text>
      <Text style={styles.reserveTitle}>{reserve.title}</Text>
      {reserve.description ? (
        <Text style={styles.reserveDesc} numberOfLines={2}>{reserve.description}</Text>
      ) : null}
      <View style={styles.cardBottom}>
        <Ionicons name="business-outline" size={12} color={C.textMuted} />
        <Text style={styles.metaText}>Bât. {reserve.building} — {reserve.level}</Text>
        <Ionicons name="calendar-outline" size={12} color={isOverdue ? C.open : C.textMuted} style={{ marginLeft: 8 }} />
        <Text style={[styles.metaText, isOverdue && { color: C.open, fontFamily: 'Inter_600SemiBold' }]}>
          {reserve.deadline}{isOverdue ? ' ⚠' : ''}
        </Text>
      </View>

      {canEdit && !isClosed && (
        <View style={styles.actionRow}>
          {isOpen && (
            <TouchableOpacity
              style={[styles.actionBtn, { borderColor: C.inProgress + '60', backgroundColor: C.inProgress + '10' }]}
              onPress={(e) => { e.stopPropagation?.(); onMarkInProgress(); }}
              activeOpacity={0.75}
            >
              <Ionicons name="play-outline" size={13} color={C.inProgress} />
              <Text style={[styles.actionBtnText, { color: C.inProgress }]}>Marquer en cours</Text>
            </TouchableOpacity>
          )}
          {(isOpen || isInProgress) && (
            <TouchableOpacity
              style={[styles.actionBtn, { borderColor: C.verification + '60', backgroundColor: C.verification + '10' }]}
              onPress={(e) => { e.stopPropagation?.(); onMarkDone(); }}
              activeOpacity={0.75}
            >
              <Ionicons name="checkmark-done-outline" size={13} color={C.verification} />
              <Text style={[styles.actionBtnText, { color: C.verification }]}>Demander la levée</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function SousTraitantScreen() {
  const router = useRouter();
  const { reserves, companies, activeChantierId, updateReserveStatus } = useApp();
  const { user, permissions } = useAuth();

  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);

  const myCompany = useMemo(
    () => user?.companyId ? companies.find(c => c.id === user.companyId) : null,
    [companies, user?.companyId]
  );

  const displayCompany = selectedCompanyId
    ? companies.find(c => c.id === selectedCompanyId)
    : myCompany ?? null;

  const companyReserves = useMemo(() => {
    let list = reserves.filter(r =>
      !activeChantierId || r.chantierId === activeChantierId
    );
    if (displayCompany) {
      list = list.filter(r => r.company === displayCompany.name);
    }
    if (!showClosed) {
      list = list.filter(r => r.status !== 'closed');
    }
    return list.sort((a, b) => {
      const priority = { critical: 0, high: 1, medium: 2, low: 3 };
      return (priority[a.priority] ?? 2) - (priority[b.priority] ?? 2);
    });
  }, [reserves, displayCompany, activeChantierId, showClosed]);

  const stats = useMemo(() => ({
    toTreat: companyReserves.filter(r => r.status === 'open').length,
    inProgress: companyReserves.filter(r => r.status === 'in_progress').length,
    done: reserves.filter(r =>
      r.status === 'closed' && (!displayCompany || r.company === displayCompany?.name)
    ).length,
  }), [companyReserves, reserves, displayCompany]);

  const authorName = user?.name ?? 'Sous-traitant';

  return (
    <View style={styles.container}>
      <Header
        title="Vue sous-traitant"
        subtitle={displayCompany ? displayCompany.name : 'Sélectionnez une entreprise'}
        showBack
      />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.companySection}>
          <Text style={styles.sectionLabel}>ENTREPRISE</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.companyRow}>
              {companies.map(co => (
                <TouchableOpacity
                  key={co.id}
                  style={[
                    styles.companyChip,
                    (selectedCompanyId === co.id || (!selectedCompanyId && myCompany?.id === co.id)) && {
                      borderColor: co.color, backgroundColor: co.color + '15',
                    },
                  ]}
                  onPress={() => setSelectedCompanyId(selectedCompanyId === co.id ? null : co.id)}
                >
                  <View style={[styles.companyDot, { backgroundColor: co.color }]} />
                  <Text style={[
                    styles.companyChipText,
                    (selectedCompanyId === co.id || (!selectedCompanyId && myCompany?.id === co.id)) && { color: co.color },
                  ]}>{co.shortName}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
        </View>

        {displayCompany ? (
          <>
            <View style={styles.companyCard}>
              <View style={[styles.companyAvatar, { backgroundColor: displayCompany.color + '20' }]}>
                <Ionicons name="business" size={24} color={displayCompany.color} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.companyName}>{displayCompany.name}</Text>
                {displayCompany.phone ? (
                  <TouchableOpacity onPress={() => Linking.openURL(`tel:${displayCompany.phone}`)}>
                    <Text style={[styles.companyContact, { color: C.primary }]}>{displayCompany.phone}</Text>
                  </TouchableOpacity>
                ) : null}
                {displayCompany.email ? (
                  <TouchableOpacity onPress={() => Linking.openURL(`mailto:${displayCompany.email}`)}>
                    <Text style={[styles.companyContact, { color: C.primary }]}>{displayCompany.email}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>

            <View style={styles.statsRow}>
              <View style={[styles.statCard, { borderTopColor: C.open }]}>
                <Text style={[styles.statVal, { color: C.open }]}>{stats.toTreat}</Text>
                <Text style={styles.statLabel}>À traiter</Text>
              </View>
              <View style={[styles.statCard, { borderTopColor: C.inProgress }]}>
                <Text style={[styles.statVal, { color: C.inProgress }]}>{stats.inProgress}</Text>
                <Text style={styles.statLabel}>En cours</Text>
              </View>
              <View style={[styles.statCard, { borderTopColor: C.closed }]}>
                <Text style={[styles.statVal, { color: C.closed }]}>{stats.done}</Text>
                <Text style={styles.statLabel}>Clôturées</Text>
              </View>
            </View>

            {(() => {
              const allCo = reserves.filter(r => displayCompany && r.company === displayCompany.name);
              const closedCo = allCo.filter(r => r.status === 'closed').length;
              const totalCo = allCo.length;
              const pct = totalCo > 0 ? Math.round((closedCo / totalCo) * 100) : 0;
              const overdue = allCo.filter(r => {
                if (r.status === 'closed') return false;
                if (!r.deadline || r.deadline === '—') return false;
                const parts = r.deadline.split('/');
                if (parts.length !== 3) return false;
                return new Date(`${parts[2]}-${parts[1]}-${parts[0]}`) < new Date();
              }).length;
              return (
                <View style={styles.progressCard}>
                  <View style={styles.progressHeader}>
                    <View>
                      <Text style={styles.progressTitle}>Taux de clôture global</Text>
                      <Text style={styles.progressSub}>{closedCo} / {totalCo} réserve{totalCo !== 1 ? 's' : ''}</Text>
                    </View>
                    <View style={styles.pctBadge}>
                      <Text style={[styles.pctText, { color: pct >= 70 ? C.closed : pct >= 40 ? C.inProgress : C.open }]}>{pct}%</Text>
                    </View>
                  </View>
                  <View style={styles.progressBarBg}>
                    <View style={[styles.progressBarFill, {
                      width: `${pct}%` as any,
                      backgroundColor: pct >= 70 ? C.closed : pct >= 40 ? C.inProgress : C.open,
                    }]} />
                  </View>
                  {overdue > 0 && (
                    <View style={styles.overdueWarning}>
                      <Ionicons name="alarm-outline" size={14} color={C.open} />
                      <Text style={styles.overdueText}>{overdue} réserve{overdue > 1 ? 's' : ''} en retard — action requise</Text>
                    </View>
                  )}
                </View>
              );
            })()}

            {/* SHAREABLE PORTAL LINK */}
            {(() => {
              const baseUrl = Platform.OS === 'web' && typeof window !== 'undefined'
                ? window.location.origin
                : 'https://buildtrack.replit.app';
              const portalUrl = `${baseUrl}/portal/${encodeURIComponent(displayCompany?.id ?? '')}`;
              const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(portalUrl)}&color=1E3A5F&bgcolor=FFFFFF&format=png&margin=4`;

              async function copyLink() {
                await Clipboard.setStringAsync(portalUrl);
                Alert.alert('Lien copié', 'Le lien du portail sous-traitant a été copié dans le presse-papiers.');
              }

              return (
                <View style={styles.portalCard}>
                  <View style={styles.portalHeader}>
                    <Ionicons name="share-social-outline" size={18} color={C.primary} />
                    <Text style={styles.portalTitle}>Portail sous-traitant</Text>
                    <View style={styles.portalBadge}>
                      <View style={styles.portalBadgeDot} />
                      <Text style={styles.portalBadgeText}>Partageable</Text>
                    </View>
                  </View>
                  <Text style={styles.portalDesc}>
                    Partagez ce lien avec {displayCompany?.name} pour qu'ils accèdent directement à leurs réserves sans avoir besoin de l'application.
                  </Text>
                  <View style={styles.portalBody}>
                    <Image
                      source={{ uri: qrUrl }}
                      style={styles.qrImage}
                      resizeMode="contain"
                    />
                    <View style={styles.portalLinkArea}>
                      <Text style={styles.portalLinkLabel}>Lien d'accès</Text>
                      <Text style={styles.portalLinkUrl} numberOfLines={2}>{portalUrl}</Text>
                      <TouchableOpacity style={styles.copyBtn} onPress={copyLink}>
                        <Ionicons name="copy-outline" size={14} color={C.primary} />
                        <Text style={styles.copyBtnText}>Copier le lien</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              );
            })()}

            {permissions.canEditOwn && (
              <View style={styles.infoHint}>
                <Ionicons name="information-circle-outline" size={13} color={C.primary} />
                <Text style={styles.infoHintText}>Appuyez sur "Marquer en cours" ou "Marquer traité" pour mettre à jour le statut directement.</Text>
              </View>
            )}

            <View style={styles.filterRow}>
              <Text style={styles.filterTitle}>
                {showClosed ? 'Toutes les réserves' : 'Réserves actives'} ({companyReserves.length})
              </Text>
              <TouchableOpacity style={styles.toggleBtn} onPress={() => setShowClosed(v => !v)}>
                <Ionicons name={showClosed ? 'eye-off-outline' : 'eye-outline'} size={14} color={C.primary} />
                <Text style={styles.toggleBtnText}>{showClosed ? 'Masquer clôturées' : 'Voir clôturées'}</Text>
              </TouchableOpacity>
            </View>

            {companyReserves.length === 0 ? (
              <View style={styles.empty}>
                <Ionicons name="checkmark-done-circle-outline" size={40} color={C.closed} />
                <Text style={styles.emptyTitle}>Tout est traité !</Text>
                <Text style={styles.emptyText}>Aucune réserve active pour cette entreprise</Text>
              </View>
            ) : (
              companyReserves.map(r => (
                <ReserveCard
                  key={r.id}
                  reserve={r}
                  onPress={() => router.push(`/reserve/${r.id}` as any)}
                  canEdit={permissions.canEditOwn}
                  onMarkInProgress={() => updateReserveStatus(r.id, 'in_progress', authorName)}
                  onMarkDone={() => updateReserveStatus(r.id, 'verification', authorName)}
                />
              ))
            )}
          </>
        ) : (
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={40} color={C.textMuted} />
            <Text style={styles.emptyTitle}>Sélectionnez une entreprise</Text>
            <Text style={styles.emptyText}>
              Cette vue présente les réserves d'une entreprise sous-traitante, triées par priorité
            </Text>
          </View>
        )}
      </ScrollView>

      <BottomNavBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 100 },

  companySection: { marginBottom: 14 },
  sectionLabel: {
    fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textSub,
    textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8,
  },
  companyRow: { flexDirection: 'row', gap: 8, paddingVertical: 2 },
  companyChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1, borderColor: C.border, backgroundColor: C.surface,
  },
  companyDot: { width: 8, height: 8, borderRadius: 4 },
  companyChipText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub },

  companyCard: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: C.border, marginBottom: 16,
  },
  companyAvatar: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  companyName: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.text },
  companyContact: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },

  statsRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  statCard: {
    flex: 1, backgroundColor: C.surface, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: C.border, borderTopWidth: 3, alignItems: 'center',
  },
  statVal: { fontSize: 22, fontFamily: 'Inter_700Bold' },
  statLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },

  infoHint: {
    flexDirection: 'row', alignItems: 'flex-start', gap: 7,
    backgroundColor: C.primaryBg, borderRadius: 10, padding: 10,
    borderWidth: 1, borderColor: C.primary + '30', marginBottom: 12,
  },
  infoHintText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: C.primary, lineHeight: 17 },

  portalCard: {
    backgroundColor: C.surface, borderRadius: 14, padding: 14,
    marginBottom: 14, borderWidth: 1, borderColor: C.primary + '30',
    borderLeftWidth: 3, borderLeftColor: C.primary,
  },
  portalHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  portalTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text, flex: 1 },
  portalBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: C.closed + '20', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  portalBadgeDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.closed },
  portalBadgeText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.closed },
  portalDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, lineHeight: 17, marginBottom: 12 },
  portalBody: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  qrImage: { width: 80, height: 80, borderRadius: 8, borderWidth: 1, borderColor: C.border },
  portalLinkArea: { flex: 1 },
  portalLinkLabel: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  portalLinkUrl: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub, lineHeight: 16, marginBottom: 10 },
  copyBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.primary + '15', borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 7, alignSelf: 'flex-start',
    borderWidth: 1, borderColor: C.primary + '30',
  },
  copyBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },

  filterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  filterTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  toggleBtn: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  toggleBtnText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.primary },

  card: {
    backgroundColor: C.surface, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: C.border, borderLeftWidth: 4, marginBottom: 10,
  },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  statusText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  priorityPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  priorityText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  obsPill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: '#0EA5E915', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 10, borderWidth: 1, borderColor: '#0EA5E930' },
  obsText: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: '#0EA5E9' },
  reserveId: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textMuted, marginBottom: 3 },
  reserveTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 4 },
  reserveDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, lineHeight: 18, marginBottom: 8 },
  cardBottom: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  metaText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub },

  actionRow: {
    flexDirection: 'row', gap: 8, marginTop: 12,
    paddingTop: 10, borderTopWidth: 1, borderTopColor: C.border,
  },
  actionBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 5, paddingVertical: 9, borderRadius: 10, borderWidth: 1,
  },
  actionBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold' },

  progressCard: {
    backgroundColor: C.surface, borderRadius: 14, padding: 16,
    borderWidth: 1, borderColor: C.border, marginBottom: 12,
  },
  progressHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  progressTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text },
  progressSub: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
  pctBadge: { backgroundColor: C.primaryBg, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: C.primary + '40' },
  pctText: { fontSize: 16, fontFamily: 'Inter_700Bold' },
  progressBarBg: { height: 8, backgroundColor: C.surface2, borderRadius: 6, overflow: 'hidden', marginBottom: 10 },
  progressBarFill: { height: 8, borderRadius: 6 },
  overdueWarning: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.open + '10', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1, borderColor: C.open + '30' },
  overdueText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.open, flex: 1 },

  empty: { alignItems: 'center', paddingVertical: 48, gap: 10 },
  emptyTitle: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.text },
  emptyText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, textAlign: 'center', paddingHorizontal: 20 },
});
