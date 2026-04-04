import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform,
  Modal, KeyboardAvoidingView,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import Header from '@/components/Header';
import LocationTreeEditor from '@/components/LocationTreeEditor';
import { Chantier, ChantierBuilding } from '@/constants/types';

const STATUS_LABELS: Record<string, { label: string; color: string; icon: string }> = {
  active: { label: 'En cours', color: C.closed, icon: 'play-circle-outline' },
  completed: { label: 'Terminé', color: C.primary, icon: 'checkmark-circle-outline' },
  paused: { label: 'En pause', color: C.medium, icon: 'pause-circle-outline' },
};

export default function ManageChantiersScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { chantiers, sitePlans, reserves, activeChantierId, setActiveChantier, deleteChantier, updateChantier, companies } = useApp();
  const { permissions } = useAuth();

  const [structureModal, setStructureModal] = useState<{ chantier: Chantier; buildings: ChantierBuilding[] } | null>(null);

  function handleSetActive(id: string) {
    if (id === activeChantierId) return;
    setActiveChantier(id);
  }

  function handleDelete(id: string, name: string) {
    const planCount = sitePlans.filter(p => p.chantierId === id).length;
    const reserveCount = reserves.filter(r => r.chantierId === id).length;
    Alert.alert(
      'Supprimer le chantier ?',
      `"${name}" sera supprimé ainsi que ses ${planCount} plan(s). Les ${reserveCount} réserves associées seront conservées.`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Supprimer', style: 'destructive', onPress: () => deleteChantier(id) },
      ]
    );
  }

  function openStructureModal(chantier: Chantier) {
    setStructureModal({ chantier, buildings: chantier.buildings ? [...chantier.buildings] : [] });
  }

  function saveStructure() {
    if (!structureModal) return;
    updateChantier({ ...structureModal.chantier, buildings: structureModal.buildings.length > 0 ? structureModal.buildings : undefined });
    setStructureModal(null);
  }

  return (
    <View style={styles.container}>
      <Header title="Chantiers" showBack />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>

        {chantiers.length === 0 ? (
          <View style={styles.emptyState}>
            <Ionicons name="business-outline" size={52} color={C.textMuted} />
            <Text style={styles.emptyTitle}>Aucun chantier</Text>
            <Text style={styles.emptySubtitle}>Créez votre premier chantier pour démarrer.</Text>
            {permissions.canCreate && (
              <TouchableOpacity
                style={styles.emptyBtn}
                onPress={() => router.push('/chantier/new' as any)}
              >
                <Ionicons name="add-circle-outline" size={16} color="#fff" />
                <Text style={styles.emptyBtnText}>Nouveau chantier</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <>
            {chantiers.map(chantier => {
              const isActive = chantier.id === activeChantierId;
              const planCount = sitePlans.filter(p => p.chantierId === chantier.id).length;
              const reserveCount = reserves.filter(r => r.chantierId === chantier.id).length;
              const buildingCount = chantier.buildings?.length ?? 0;
              const statusCfg = STATUS_LABELS[chantier.status] ?? STATUS_LABELS.active;

              return (
                <View key={chantier.id} style={[styles.chantierCard, isActive && styles.chantierCardActive]}>
                  {isActive && (
                    <View style={styles.activeBanner}>
                      <Ionicons name="radio-button-on" size={11} color={C.closed} />
                      <Text style={styles.activeBannerText}>Chantier actif</Text>
                    </View>
                  )}
                  <View style={styles.chantierHeader}>
                    <View style={[styles.chantierIconWrap, { backgroundColor: isActive ? C.primary + '20' : C.surface2 }]}>
                      <Ionicons name="business" size={22} color={isActive ? C.primary : C.textSub} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.chantierName}>{chantier.name}</Text>
                      {chantier.address ? (
                        <Text style={styles.chantierAddress} numberOfLines={1}>{chantier.address}</Text>
                      ) : null}
                    </View>
                    <View style={[styles.statusBadge, { backgroundColor: statusCfg.color + '20' }]}>
                      <Ionicons name={statusCfg.icon as any} size={11} color={statusCfg.color} />
                      <Text style={[styles.statusBadgeText, { color: statusCfg.color }]}>{statusCfg.label}</Text>
                    </View>
                  </View>

                  <View style={styles.chantierStats}>
                    <View style={styles.statItem}>
                      <Ionicons name="map-outline" size={13} color={C.textMuted} />
                      <Text style={styles.statText}>{planCount} plan{planCount !== 1 ? 's' : ''}</Text>
                    </View>
                    <View style={styles.statDivider} />
                    <View style={styles.statItem}>
                      <Ionicons name="warning-outline" size={13} color={C.textMuted} />
                      <Text style={styles.statText}>{reserveCount} réserve{reserveCount !== 1 ? 's' : ''}</Text>
                    </View>
                    <View style={styles.statDivider} />
                    <View style={styles.statItem}>
                      <Ionicons name="business-outline" size={13} color={buildingCount > 0 ? C.primary : C.textMuted} />
                      <Text style={[styles.statText, buildingCount > 0 && { color: C.primary }]}>
                        {buildingCount > 0 ? `${buildingCount} bât.` : 'Aucun bât.'}
                      </Text>
                    </View>
                    {chantier.startDate && (
                      <>
                        <View style={styles.statDivider} />
                        <View style={styles.statItem}>
                          <Ionicons name="calendar-outline" size={13} color={C.textMuted} />
                          <Text style={styles.statText}>{chantier.startDate}</Text>
                        </View>
                      </>
                    )}
                  </View>

                  {chantier.description ? (
                    <Text style={styles.chantierDesc} numberOfLines={2}>{chantier.description}</Text>
                  ) : null}

                  {chantier.companyIds && chantier.companyIds.length > 0 && (
                    <View style={styles.companyPillsRow}>
                      {chantier.companyIds.map(cid => {
                        const co = companies.find(c => c.id === cid);
                        if (!co) return null;
                        return (
                          <View key={cid} style={[styles.companyPill, { backgroundColor: co.color + '20', borderColor: co.color + '60' }]}>
                            <View style={[styles.companyPillDot, { backgroundColor: co.color }]} />
                            <Text style={[styles.companyPillText, { color: co.color }]}>{co.shortName}</Text>
                          </View>
                        );
                      })}
                    </View>
                  )}

                  <View style={styles.chantierActions}>
                    {!isActive && (
                      <TouchableOpacity
                        style={styles.actionBtn}
                        onPress={() => handleSetActive(chantier.id)}
                      >
                        <Ionicons name="radio-button-off-outline" size={14} color={C.primary} />
                        <Text style={styles.actionBtnText}>Activer</Text>
                      </TouchableOpacity>
                    )}
                    {permissions.canCreate && (
                      <TouchableOpacity
                        style={[styles.actionBtn, { borderColor: C.primary + '50' }]}
                        onPress={() => openStructureModal(chantier)}
                      >
                        <Ionicons name="git-network-outline" size={14} color={C.primary} />
                        <Text style={[styles.actionBtnText, { color: C.primary }]}>Structure</Text>
                      </TouchableOpacity>
                    )}
                    {permissions.canDelete && (
                      <TouchableOpacity
                        style={[styles.actionBtn, { borderColor: C.open + '50' }]}
                        onPress={() => handleDelete(chantier.id, chantier.name)}
                      >
                        <Ionicons name="trash-outline" size={14} color={C.open} />
                        <Text style={[styles.actionBtnText, { color: C.open }]}>Supprimer</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })}

            {permissions.canCreate && (
              <TouchableOpacity
                style={styles.addBtn}
                onPress={() => router.push('/chantier/new' as any)}
              >
                <Ionicons name="add-circle-outline" size={18} color={C.primary} />
                <Text style={styles.addBtnText}>Ajouter un chantier</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </ScrollView>

      {/* MODAL STRUCTURE */}
      <Modal
        visible={structureModal !== null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setStructureModal(null)}
      >
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setStructureModal(null)} style={styles.modalCloseBtn}>
                <Ionicons name="close" size={22} color={C.text} />
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Structure du bâtiment</Text>
                {structureModal && (
                  <Text style={styles.modalSubtitle} numberOfLines={1}>{structureModal.chantier.name}</Text>
                )}
              </View>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={saveStructure}>
                <Ionicons name="checkmark" size={16} color="#fff" />
                <Text style={styles.modalSaveBtnText}>Enregistrer</Text>
              </TouchableOpacity>
            </View>

            <ScrollView
              contentContainerStyle={styles.modalContent}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.modalHintBox}>
                <Ionicons name="information-circle-outline" size={14} color={C.primary} />
                <Text style={styles.modalHintText}>
                  Définissez ou modifiez la hiérarchie de localisation. Ces bâtiments et niveaux seront disponibles dans tous les formulaires liés à ce chantier.
                </Text>
              </View>

              {structureModal && (
                <LocationTreeEditor
                  buildings={structureModal.buildings}
                  onChange={buildings => setStructureModal(prev => prev ? { ...prev, buildings } : null)}
                />
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 48 },
  emptyState: { alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', color: C.text },
  emptySubtitle: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center' },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.primary, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12, marginTop: 8 },
  emptyBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  chantierCard: { backgroundColor: C.surface, borderRadius: 16, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: C.border },
  chantierCardActive: { borderColor: C.primary + '60', backgroundColor: C.primaryBg + '40' },
  activeBanner: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 10 },
  activeBannerText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.closed, textTransform: 'uppercase', letterSpacing: 0.5 },
  chantierHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  chantierIconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  chantierName: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.text },
  chantierAddress: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  statusBadgeText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  chantierStats: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 10 },
  statItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textMuted },
  statDivider: { width: 1, height: 12, backgroundColor: C.border },
  chantierDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, lineHeight: 17, marginBottom: 8 },
  companyPillsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 12 },
  companyPill: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 12, borderWidth: 1 },
  companyPillDot: { width: 6, height: 6, borderRadius: 3 },
  companyPillText: { fontSize: 11, fontFamily: 'Inter_600SemiBold' },
  chantierActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  actionBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: C.border },
  actionBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },
  addBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16, borderRadius: 14, backgroundColor: C.primaryBg, borderWidth: 1.5, borderColor: C.primary + '40', borderStyle: 'dashed' },
  addBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.primary },
  modalContainer: { flex: 1, backgroundColor: C.bg },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.surface },
  modalCloseBtn: { padding: 4 },
  modalTitle: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.text },
  modalSubtitle: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1 },
  modalSaveBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.primary, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  modalSaveBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  modalContent: { padding: 16, paddingBottom: 48 },
  modalHintBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: C.primaryBg, borderRadius: 10, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: C.primary + '30' },
  modalHintText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, lineHeight: 17 },
});
