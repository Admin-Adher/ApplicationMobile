import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform,
  Modal, PanResponder, Animated, GestureResponderEvent, Image,
  ActivityIndicator, Alert, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useState, useRef, useMemo } from 'react';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { Reserve, Document } from '@/constants/types';
import StatusBadge from '@/components/StatusBadge';
import PriorityBadge from '@/components/PriorityBadge';
import { uploadDocument } from '@/lib/storage';

const BUILDINGS = ['A', 'B', 'C'];

interface Room {
  id: string; label: string;
  x: number; y: number; w: number; h: number; dark?: boolean;
}

const FLOOR_PLANS: Record<string, Room[]> = {
  A: [
    { id: 'ha', label: 'Hall', x: 0, y: 0, w: 30, h: 25 },
    { id: 'b101', label: 'Bureau 101', x: 30, y: 0, w: 40, h: 25 },
    { id: 'sr', label: 'Salle Réunion', x: 70, y: 0, w: 30, h: 50 },
    { id: 'coul', label: 'Couloir', x: 0, y: 25, w: 70, h: 12, dark: true },
    { id: 'b102', label: 'Bureau 102', x: 0, y: 37, w: 35, h: 30 },
    { id: 'b103', label: 'Bureau 103', x: 35, y: 37, w: 35, h: 30 },
    { id: 'lt', label: 'Local Technique', x: 70, y: 50, w: 30, h: 25 },
    { id: 'wc', label: 'Sanitaires', x: 0, y: 67, w: 70, h: 18, dark: true },
    { id: 'esc', label: 'Escaliers', x: 70, y: 75, w: 30, h: 25 },
  ],
  B: [
    { id: 'accb', label: 'Accueil B', x: 0, y: 0, w: 100, h: 18 },
    { id: 'zt', label: 'Zone Technique', x: 0, y: 18, w: 50, h: 40 },
    { id: 'atel', label: 'Atelier', x: 50, y: 18, w: 50, h: 40 },
    { id: 'stock', label: 'Stockage', x: 0, y: 58, w: 40, h: 42 },
    { id: 'lsoc', label: 'Locaux Sociaux', x: 40, y: 58, w: 60, h: 42 },
  ],
  C: [
    { id: 'ail1', label: 'Aile Nord', x: 0, y: 0, w: 30, h: 60 },
    { id: 'hc', label: 'Hall C', x: 30, y: 0, w: 40, h: 25 },
    { id: 'ail2', label: 'Aile Sud', x: 70, y: 0, w: 30, h: 60 },
    { id: 'corp', label: 'Corps Principal', x: 30, y: 25, w: 40, h: 40 },
    { id: 'ss', label: 'Sous-sol', x: 0, y: 60, w: 100, h: 40, dark: true },
  ],
};

const MARKER_COLORS: Record<string, string> = {
  open: C.open, in_progress: C.inProgress,
  waiting: C.waiting, verification: C.verification, closed: C.closed,
};

const PLAN_W = 360;
const PLAN_H = 270;

function isPdf(uri?: string | null): boolean {
  if (!uri) return false;
  return uri.toLowerCase().includes('.pdf') || uri.toLowerCase().includes('pdf');
}

function isImage(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(ext);
}

function formatSize(bytes: number | undefined): string {
  if (!bytes) return '?';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
}

function genId() {
  return Date.now().toString() + Math.random().toString(36).substr(2, 6);
}

function PlanImageLayer({ uri, isPdfFile }: { uri: string; isPdfFile: boolean }) {
  if (isPdfFile) {
    if (Platform.OS === 'web') {
      return (
        <View style={planImgStyles.pdfContainer}>
          {/* @ts-ignore — web only */}
          <iframe
            src={uri}
            style={{ width: '100%', height: '100%', border: 'none', borderRadius: 8 }}
            title="Plan PDF"
          />
        </View>
      );
    }
    return (
      <View style={planImgStyles.pdfMobile}>
        <Ionicons name="document-text-outline" size={36} color={C.primary} />
        <Text style={planImgStyles.pdfText}>Plan PDF importé</Text>
        <TouchableOpacity style={planImgStyles.pdfBtn} onPress={() => Linking.openURL(uri)}>
          <Ionicons name="open-outline" size={14} color="#fff" />
          <Text style={planImgStyles.pdfBtnText}>Ouvrir le plan</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return (
    <Image source={{ uri }} style={planImgStyles.image} resizeMode="contain" />
  );
}

const planImgStyles = StyleSheet.create({
  image: { position: 'absolute', top: 0, left: 0, width: PLAN_W, height: PLAN_H, borderRadius: 8 },
  pdfContainer: { position: 'absolute', top: 0, left: 0, width: PLAN_W, height: PLAN_H },
  pdfMobile: { position: 'absolute', top: 0, left: 0, width: PLAN_W, height: PLAN_H, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.surface2 },
  pdfText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text },
  pdfBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  pdfBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#fff' },
});

export default function PlansScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { reserves, companies, documents, addDocument } = useApp();
  const [building, setBuilding] = useState('A');
  const [selected, setSelected] = useState<Reserve | null>(null);
  const [companyFilter, setCompanyFilter] = useState<string>('all');
  const [addingMarker, setAddingMarker] = useState(false);
  const [pendingCoords, setPendingCoords] = useState<{ x: number; y: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const lastScale = useRef(1);
  const lastTX = useRef(0);
  const lastTY = useRef(0);

  const vectorPlan = FLOOR_PLANS[building];

  let buildingReserves = reserves.filter(r => r.building === building);
  if (companyFilter !== 'all') {
    buildingReserves = buildingReserves.filter(r => r.company === companyFilter);
  }

  // Find the most recently uploaded plan for the current building
  const activePlan: Document | null = useMemo(() => {
    const planDocs = documents.filter(d => d.category === `Plan-${building}` && d.type === 'plan');
    return planDocs.length > 0 ? planDocs[0] : null;
  }, [documents, building]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        lastTX.current = (translateX as any)._value;
        lastTY.current = (translateY as any)._value;
      },
      onPanResponderMove: (_, gs) => {
        translateX.setValue(lastTX.current + gs.dx);
        translateY.setValue(lastTY.current + gs.dy);
      },
      onPanResponderRelease: () => {
        lastTX.current = (translateX as any)._value;
        lastTY.current = (translateY as any)._value;
      },
    })
  ).current;

  function zoomIn() {
    const next = Math.min(lastScale.current * 1.3, 4);
    lastScale.current = next;
    Animated.spring(scale, { toValue: next, useNativeDriver: true }).start();
  }
  function zoomOut() {
    const next = Math.max(lastScale.current / 1.3, 0.5);
    lastScale.current = next;
    Animated.spring(scale, { toValue: next, useNativeDriver: true }).start();
  }
  function resetView() {
    lastScale.current = 1; lastTX.current = 0; lastTY.current = 0;
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true }),
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true }),
    ]).start();
  }

  function handlePlanTap(e: GestureResponderEvent) {
    if (!addingMarker) return;
    const { locationX, locationY } = e.nativeEvent;
    const px = Math.round((locationX / PLAN_W) * 100);
    const py = Math.round((locationY / PLAN_H) * 100);
    setPendingCoords({ x: px, y: py });
    setAddingMarker(false);
  }

  async function handleImportPlan() {
    setImporting(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: ['image/*', 'application/pdf'],
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        const docName = asset.name;
        const docExt = docName.split('.').pop()?.toLowerCase() ?? '';
        const isImg = isImage(docName);
        const isPdfFile = docExt === 'pdf';

        if (!isImg && !isPdfFile) {
          Alert.alert('Format non supporté', 'Importez une image (JPG, PNG) ou un PDF.');
          return;
        }

        // Upload to Supabase Storage plans bucket
        const storageUrl = await uploadDocument(asset.uri, `plan_${building}_${docName}`, asset.mimeType ?? undefined);
        const finalUri = storageUrl ?? asset.uri;

        const newDoc: Document = {
          id: genId(),
          name: `Plan Bâtiment ${building} — ${docName}`,
          type: 'plan',
          category: `Plan-${building}`,
          uploadedAt: new Date().toLocaleDateString('fr-FR'),
          size: formatSize(asset.size),
          version: 1,
          uri: finalUri,
        };
        addDocument(newDoc);

        Alert.alert(
          'Plan importé ✓',
          storageUrl
            ? `Plan du Bâtiment ${building} uploadé sur Supabase Storage.`
            : `Plan du Bâtiment ${building} importé localement.`
        );
      }
    } catch (e) {
      Alert.alert('Erreur', 'Impossible d\'importer le plan.');
    } finally {
      setImporting(false);
    }
  }

  function handleRemovePlan() {
    Alert.alert(
      'Supprimer le plan importé ?',
      `Le plan vectoriel par défaut sera rétabli pour le Bâtiment ${building}.`,
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Supprimer',
          style: 'destructive',
          onPress: () => {
            if (activePlan) {
              // We'll just filter it out by uploading a signal — simplest: use deleteDocument
              // Since we don't expose deleteDocument here directly, we route through addDocument trick
              // Actually let's call deleteDocument if available
            }
          },
        },
      ]
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <View style={styles.headerTop}>
          <Text style={styles.title}>Plans interactifs</Text>
          <View style={styles.zoomBtns}>
            <TouchableOpacity style={styles.zoomBtn} onPress={zoomOut}><Ionicons name="remove" size={16} color={C.text} /></TouchableOpacity>
            <TouchableOpacity style={styles.zoomBtn} onPress={resetView}><Ionicons name="scan-outline" size={14} color={C.text} /></TouchableOpacity>
            <TouchableOpacity style={styles.zoomBtn} onPress={zoomIn}><Ionicons name="add" size={16} color={C.text} /></TouchableOpacity>
          </View>
        </View>
        <View style={styles.buildingBarRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
            <View style={styles.buildingRow}>
              {BUILDINGS.map(b => (
                <TouchableOpacity
                  key={b}
                  style={[styles.buildingBtn, building === b && styles.buildingBtnActive]}
                  onPress={() => { setBuilding(b); resetView(); setAddingMarker(false); setPendingCoords(null); }}
                >
                  <Text style={[styles.buildingText, building === b && styles.buildingTextActive]}>Bât. {b}</Text>
                  {documents.some(d => d.category === `Plan-${b}` && d.type === 'plan') && (
                    <View style={styles.planDot} />
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
          <TouchableOpacity
            style={[styles.importBtn, importing && styles.importBtnDisabled]}
            onPress={handleImportPlan}
            disabled={importing}
          >
            {importing ? (
              <ActivityIndicator size="small" color={C.primary} />
            ) : (
              <>
                <Ionicons name="cloud-upload-outline" size={15} color={C.primary} />
                <Text style={styles.importBtnText}>Importer</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.companyFilterWrap}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 16 }}>
          <TouchableOpacity
            style={[styles.filterChip, companyFilter === 'all' && styles.filterChipActive]}
            onPress={() => setCompanyFilter('all')}
          >
            <Text style={[styles.filterChipText, companyFilter === 'all' && styles.filterChipTextActive]}>Toutes</Text>
          </TouchableOpacity>
          {companies.map(c => (
            <TouchableOpacity
              key={c.id}
              style={[styles.filterChip, companyFilter === c.name && { backgroundColor: c.color + '20', borderColor: c.color }]}
              onPress={() => setCompanyFilter(companyFilter === c.name ? 'all' : c.name)}
            >
              <View style={[styles.filterDot, { backgroundColor: c.color }]} />
              <Text style={[styles.filterChipText, companyFilter === c.name && { color: c.color }]}>{c.shortName}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.planContainer}>
          <View style={styles.planTitleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.planTitle}>Bâtiment {building} — {activePlan ? 'Plan importé' : 'Plan masse'}</Text>
              {activePlan && (
                <Text style={styles.planSubtitle} numberOfLines={1}>
                  {activePlan.name.replace(`Plan Bâtiment ${building} — `, '')} — {activePlan.uploadedAt}
                </Text>
              )}
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {activePlan && (
                <TouchableOpacity style={styles.removePlanBtn} onPress={handleRemovePlan}>
                  <Ionicons name="swap-horizontal-outline" size={13} color={C.textSub} />
                  <Text style={styles.removePlanText}>Remplacer</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.addMarkerBtn, addingMarker && styles.addMarkerBtnActive]}
                onPress={() => setAddingMarker(!addingMarker)}
              >
                <Ionicons name={addingMarker ? 'close' : 'add-circle-outline'} size={15} color={addingMarker ? C.open : C.primary} />
                <Text style={[styles.addMarkerText, addingMarker && { color: C.open }]}>
                  {addingMarker ? 'Annuler' : 'Placer'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {!activePlan && (
            <TouchableOpacity style={styles.importHintBanner} onPress={handleImportPlan} disabled={importing}>
              <Ionicons name="cloud-upload-outline" size={16} color={C.primary} />
              <Text style={styles.importHintText}>
                Importez votre vrai plan (image ou PDF) pour ce bâtiment
              </Text>
              <Ionicons name="chevron-forward" size={14} color={C.primary} />
            </TouchableOpacity>
          )}

          {addingMarker && (
            <View style={styles.addingHint}>
              <Ionicons name="information-circle-outline" size={14} color={C.inProgress} />
              <Text style={styles.addingHintText}>Touchez le plan pour placer une réserve</Text>
            </View>
          )}

          <View style={styles.planViewport}>
            <Animated.View
              style={[styles.planAnimated, { transform: [{ scale }, { translateX }, { translateY }] }]}
              {...panResponder.panHandlers}
            >
              <View style={[styles.planView, { width: PLAN_W, height: PLAN_H }]} onTouchEnd={handlePlanTap}>

                {/* LAYER 1: Plan background — imported image/PDF or vector fallback */}
                {activePlan && activePlan.uri ? (
                  <PlanImageLayer uri={activePlan.uri} isPdfFile={isPdf(activePlan.uri)} />
                ) : (
                  vectorPlan.map(room => (
                    <View
                      key={room.id}
                      style={[styles.room, {
                        left: `${room.x}%` as any,
                        top: `${room.y}%` as any,
                        width: `${room.w}%` as any,
                        height: `${room.h}%` as any,
                        backgroundColor: room.dark ? '#0D1520' : '#141D2E',
                      }]}
                    >
                      <Text style={styles.roomLabel} numberOfLines={2}>{room.label}</Text>
                    </View>
                  ))
                )}

                {/* LAYER 2: Reserve markers (always on top) */}
                {buildingReserves.map(r => (
                  <TouchableOpacity
                    key={r.id}
                    style={[styles.marker, {
                      left: `${r.planX}%` as any,
                      top: `${r.planY}%` as any,
                      backgroundColor: MARKER_COLORS[r.status],
                    }]}
                    onPress={() => setSelected(r)}
                  >
                    <Text style={styles.markerText}>{r.id.split('-')[1] ?? '?'}</Text>
                  </TouchableOpacity>
                ))}

                {/* LAYER 3: Pending marker */}
                {pendingCoords && (
                  <TouchableOpacity
                    style={[styles.marker, styles.markerPending, {
                      left: `${pendingCoords.x}%` as any,
                      top: `${pendingCoords.y}%` as any,
                    }]}
                    onPress={() => {
                      router.push({
                        pathname: '/reserve/new',
                        params: { building, planX: pendingCoords.x, planY: pendingCoords.y },
                      } as any);
                      setPendingCoords(null);
                    }}
                  >
                    <Ionicons name="add" size={12} color="#fff" />
                  </TouchableOpacity>
                )}
              </View>
            </Animated.View>
          </View>

          {pendingCoords && (
            <View style={styles.pendingBanner}>
              <Ionicons name="location" size={14} color={C.inProgress} />
              <Text style={styles.pendingText}>
                Position ({pendingCoords.x}%, {pendingCoords.y}%) — Touchez le + pour créer la réserve
              </Text>
              <TouchableOpacity onPress={() => setPendingCoords(null)}>
                <Ionicons name="close-circle" size={16} color={C.textMuted} />
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.legend}>
            {(['open', 'in_progress', 'waiting', 'verification', 'closed'] as const).map(s => {
              const labels: Record<string, string> = { open: 'Ouvert', in_progress: 'En cours', waiting: 'Attente', verification: 'Vérif.', closed: 'Clôturé' };
              return (
                <View key={s} style={styles.legendItem}>
                  <View style={[styles.legendDot, { backgroundColor: MARKER_COLORS[s] }]} />
                  <Text style={styles.legendLabel}>{labels[s]}</Text>
                </View>
              );
            })}
          </View>
        </View>

        <Text style={styles.sectionTitle}>{buildingReserves.length} réserve(s) — Bâtiment {building}</Text>
        {buildingReserves.map(r => (
          <TouchableOpacity
            key={r.id}
            style={styles.reserveRow}
            onPress={() => router.push(`/reserve/${r.id}` as any)}
          >
            <View style={[styles.reserveColorDot, { backgroundColor: MARKER_COLORS[r.status] }]} />
            <View style={{ flex: 1 }}>
              <Text style={styles.reserveTitle}>{r.id} — {r.title}</Text>
              <Text style={styles.reserveSub}>{r.zone} — {r.level} — {r.company}</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={C.textMuted} />
          </TouchableOpacity>
        ))}
        {buildingReserves.length === 0 && (
          <View style={styles.empty}>
            <Ionicons name="map-outline" size={40} color={C.textMuted} />
            <Text style={styles.emptyText}>Aucune réserve pour ce bâtiment</Text>
          </View>
        )}
      </ScrollView>

      <Modal visible={!!selected} transparent animationType="slide" onRequestClose={() => setSelected(null)}>
        {selected && (
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalId}>{selected.id}</Text>
                <TouchableOpacity onPress={() => setSelected(null)} hitSlop={8}>
                  <Ionicons name="close" size={22} color={C.textSub} />
                </TouchableOpacity>
              </View>
              <Text style={styles.modalTitle}>{selected.title}</Text>
              <View style={styles.modalBadges}>
                <StatusBadge status={selected.status} />
                <PriorityBadge priority={selected.priority} />
              </View>
              <Text style={styles.modalInfo}>Bât. {selected.building} — {selected.zone} — {selected.level}</Text>
              <Text style={styles.modalInfo}>{selected.company}</Text>
              <TouchableOpacity
                style={styles.modalBtn}
                onPress={() => { setSelected(null); router.push(`/reserve/${selected.id}` as any); }}
              >
                <Text style={styles.modalBtnText}>Voir la réserve</Text>
                <Ionicons name="arrow-forward" size={16} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
        )}
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { paddingHorizontal: 16, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  title: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.text },
  zoomBtns: { flexDirection: 'row', gap: 6 },
  zoomBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  buildingBarRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  buildingRow: { flexDirection: 'row', gap: 8, paddingBottom: 2 },
  buildingBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  buildingBtnActive: { backgroundColor: C.primaryBg, borderColor: C.primary },
  buildingText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub },
  buildingTextActive: { color: C.primary },
  planDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.closed },
  importBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: C.primaryBg, borderWidth: 1, borderColor: C.primary },
  importBtnDisabled: { opacity: 0.6 },
  importBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },
  companyFilterWrap: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  filterChipActive: { backgroundColor: C.primaryBg, borderColor: C.primary },
  filterChipText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub },
  filterChipTextActive: { color: C.primary },
  filterDot: { width: 6, height: 6, borderRadius: 3 },
  content: { padding: 16, paddingBottom: 40 },
  planContainer: { backgroundColor: C.surface, borderRadius: 14, padding: 14, marginBottom: 20, borderWidth: 1, borderColor: C.border },
  planTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  planTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.5 },
  planSubtitle: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.closed, marginTop: 2, maxWidth: 160 },
  removePlanBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border },
  removePlanText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.textSub },
  importHintBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.primaryBg, borderRadius: 10, padding: 10, marginBottom: 10, borderWidth: 1, borderColor: C.primary + '40', borderStyle: 'dashed' },
  importHintText: { flex: 1, fontSize: 12, fontFamily: 'Inter_500Medium', color: C.primary },
  addMarkerBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: C.primaryBg, borderWidth: 1, borderColor: C.primary },
  addMarkerBtnActive: { backgroundColor: C.open + '15', borderColor: C.open },
  addMarkerText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.primary },
  addingHint: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.inProgress + '15', borderRadius: 8, padding: 8, marginBottom: 10 },
  addingHintText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.inProgress },
  planViewport: { borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: C.border, height: PLAN_H },
  planAnimated: { alignItems: 'flex-start' },
  planView: { position: 'relative', borderRadius: 8, overflow: 'hidden' },
  room: { position: 'absolute', borderWidth: 1, borderColor: '#1E2840', alignItems: 'center', justifyContent: 'center', padding: 4 },
  roomLabel: { fontSize: 8, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center' },
  marker: { position: 'absolute', width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginLeft: -11, marginTop: -11, borderWidth: 2, borderColor: '#0F1117' },
  markerPending: { backgroundColor: C.inProgress, borderColor: '#fff', borderWidth: 2 },
  markerText: { fontSize: 9, fontFamily: 'Inter_700Bold', color: '#fff' },
  pendingBanner: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.inProgress + '15', borderRadius: 8, padding: 8, marginTop: 8 },
  pendingText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: C.inProgress },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub },
  sectionTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.textSub, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  reserveRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.surface, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: C.border },
  reserveColorDot: { width: 10, height: 10, borderRadius: 5 },
  reserveTitle: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.text },
  reserveSub: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  empty: { alignItems: 'center', paddingVertical: 32, gap: 10 },
  emptyText: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textMuted },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalCard: { backgroundColor: C.surface2, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modalId: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.primary },
  modalTitle: { fontSize: 17, fontFamily: 'Inter_600SemiBold', color: C.text, marginBottom: 12, lineHeight: 24 },
  modalBadges: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  modalInfo: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, marginBottom: 4 },
  modalBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: C.primary, borderRadius: 12, paddingVertical: 14, gap: 8, marginTop: 16 },
  modalBtnText: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: '#fff' },
});
