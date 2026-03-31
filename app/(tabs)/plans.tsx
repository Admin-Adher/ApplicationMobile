import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform,
  Modal, PanResponder, Animated, Image,
  ActivityIndicator, Alert, Linking,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useState, useRef, useMemo } from 'react';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { Reserve, SitePlan } from '@/constants/types';
import StatusBadge from '@/components/StatusBadge';
import { STATUS_CONFIG } from '@/components/StatusBadge';
import PriorityBadge from '@/components/PriorityBadge';
import { uploadDocument } from '@/lib/storage';
import { genId } from '@/lib/utils';
import { parseDxf, normalizeDxfPoint, DxfParseResult, DxfEntity } from '@/lib/dxfParser';

interface Room {
  id: string; label: string;
  x: number; y: number; w: number; h: number; dark?: boolean;
}

const DEMO_FLOOR_PLANS: Record<string, Room[]> = {
  'sp-A': [
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
  'sp-B': [
    { id: 'accb', label: 'Accueil B', x: 0, y: 0, w: 100, h: 18 },
    { id: 'zt', label: 'Zone Technique', x: 0, y: 18, w: 50, h: 40 },
    { id: 'atel', label: 'Atelier', x: 50, y: 18, w: 50, h: 40 },
    { id: 'stock', label: 'Stockage', x: 0, y: 58, w: 40, h: 42 },
    { id: 'lsoc', label: 'Locaux Sociaux', x: 40, y: 58, w: 60, h: 42 },
  ],
  'sp-C': [
    { id: 'ail1', label: 'Aile Nord', x: 0, y: 0, w: 30, h: 60 },
    { id: 'hc', label: 'Hall C', x: 30, y: 0, w: 40, h: 25 },
    { id: 'ail2', label: 'Aile Sud', x: 70, y: 0, w: 30, h: 60 },
    { id: 'corp', label: 'Corps Principal', x: 30, y: 25, w: 40, h: 40 },
    { id: 'ss', label: 'Sous-sol', x: 0, y: 60, w: 100, h: 40, dark: true },
  ],
};

const GENERIC_FLOOR_PLAN: Room[] = [
  { id: 'g1', label: 'Zone A', x: 0, y: 0, w: 50, h: 50 },
  { id: 'g2', label: 'Zone B', x: 50, y: 0, w: 50, h: 50 },
  { id: 'g3', label: 'Zone C', x: 0, y: 50, w: 50, h: 50 },
  { id: 'g4', label: 'Zone D', x: 50, y: 50, w: 50, h: 50 },
];

const PLAN_W = 360;
const PLAN_H = 270;

function DxfOverlay({ dxf }: { dxf: DxfParseResult }) {
  const MAX_ENTITIES = 2000;
  const elements: JSX.Element[] = [];
  let entityIdx = 0;

  function addLine(x1: number, y1: number, x2: number, y2: number, key: string) {
    const p1 = normalizeDxfPoint(x1, y1, dxf, PLAN_W, PLAN_H, 8);
    const p2 = normalizeDxfPoint(x2, y2, dxf, PLAN_W, PLAN_H, 8);
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.3) return;
    const angle = Math.atan2(dy, dx) * (180 / Math.PI);
    const cx = (p1.x + p2.x) / 2;
    const cy = (p1.y + p2.y) / 2;
    elements.push(
      <View
        key={key}
        style={{
          position: 'absolute',
          left: cx - len / 2,
          top: cy - 0.5,
          width: len,
          height: 1,
          backgroundColor: '#60A5FA',
          opacity: 0.9,
          transform: [{ rotate: `${angle}deg` }],
        }}
      />
    );
  }

  for (const e of dxf.entities) {
    if (entityIdx >= MAX_ENTITIES) break;
    if (e.type === 'LINE') {
      addLine(e.x1, e.y1, e.x2, e.y2, `l-${entityIdx}`);
      entityIdx++;
    } else if (e.type === 'LWPOLYLINE') {
      const pts = e.closed ? [...e.points, e.points[0]] : e.points;
      for (let i = 0; i < pts.length - 1 && entityIdx < MAX_ENTITIES; i++) {
        addLine(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y, `pl-${entityIdx}`);
        entityIdx++;
      }
    } else if (e.type === 'CIRCLE') {
      const pc = normalizeDxfPoint(e.cx, e.cy, dxf, PLAN_W, PLAN_H, 8);
      const scaleX = (PLAN_W - 16) / dxf.width;
      const scaleY = (PLAN_H - 16) / dxf.height;
      const rPx = e.r * Math.min(scaleX, scaleY);
      elements.push(
        <View
          key={`ci-${entityIdx}`}
          style={{
            position: 'absolute',
            left: pc.x - rPx,
            top: pc.y - rPx,
            width: rPx * 2,
            height: rPx * 2,
            borderRadius: rPx,
            borderWidth: 1,
            borderColor: '#60A5FA',
            opacity: 0.85,
          }}
        />
      );
      entityIdx++;
    } else if (e.type === 'TEXT') {
      const pt = normalizeDxfPoint(e.x, e.y, dxf, PLAN_W, PLAN_H, 8);
      elements.push(
        <Text
          key={`tx-${entityIdx}`}
          numberOfLines={1}
          style={{
            position: 'absolute',
            left: pt.x,
            top: pt.y - 5,
            fontSize: 5,
            fontFamily: 'Inter_400Regular',
            color: '#93C5FD',
            opacity: 0.85,
          }}
        >
          {e.text}
        </Text>
      );
      entityIdx++;
    }
  }

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, width: PLAN_W, height: PLAN_H, pointerEvents: 'none' as any }}>
      {elements}
    </View>
  );
}

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

function PlanImageLayer({ uri, isPdfFile }: { uri: string; isPdfFile: boolean }) {
  const [imgError, setImgError] = useState(false);

  if (isPdfFile) {
    if (Platform.OS === 'web') {
      return (
        <View style={planImgStyles.pdfContainer}>
          {/* @ts-ignore — web only */}
          <iframe
            src={uri}
            style={{ width: '100%', height: '100%', border: 'none', borderRadius: 8, pointerEvents: 'none' }}
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

  if (imgError) {
    return (
      <View style={planImgStyles.errorContainer}>
        <Ionicons name="image-outline" size={32} color={C.textMuted} />
        <Text style={planImgStyles.errorText}>Image inaccessible</Text>
      </View>
    );
  }

  return (
    <Image
      source={{ uri }}
      style={planImgStyles.image}
      resizeMode="contain"
      onError={() => setImgError(true)}
    />
  );
}

const planImgStyles = StyleSheet.create({
  image: { position: 'absolute', top: 0, left: 0, width: PLAN_W, height: PLAN_H, borderRadius: 8 },
  pdfContainer: { position: 'absolute', top: 0, left: 0, width: PLAN_W, height: PLAN_H },
  pdfMobile: { position: 'absolute', top: 0, left: 0, width: PLAN_W, height: PLAN_H, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.surface2 },
  pdfText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text },
  pdfBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  pdfBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  errorContainer: { position: 'absolute', top: 0, left: 0, width: PLAN_W, height: PLAN_H, alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.surface2 },
  errorText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted },
});

export default function PlansScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    reserves, companies, sitePlans, activeChantierId, activeChantier,
    addSitePlan, updateSitePlan, deleteSitePlan,
  } = useApp();
  const { permissions } = useAuth();

  const chantierPlans = useMemo(
    () => sitePlans.filter(p => p.chantierId === activeChantierId),
    [sitePlans, activeChantierId]
  );

  const [activePlanId, setActivePlanId] = useState<string | null>(null);
  const currentPlanId = activePlanId ?? chantierPlans[0]?.id ?? null;
  const currentPlan = chantierPlans.find(p => p.id === currentPlanId) ?? null;

  const [selected, setSelected] = useState<Reserve | null>(null);
  const [companyFilter, setCompanyFilter] = useState<string>('all');
  const [levelFilter, setLevelFilter] = useState<string>('all');
  const [addingMarker, setAddingMarker] = useState(false);
  const [pendingCoords, setPendingCoords] = useState<{ x: number; y: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [dxfData, setDxfData] = useState<Record<string, DxfParseResult>>({});
  const topPad = Platform.OS === 'web' ? 67 : insets.top;

  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const translateY = useRef(new Animated.Value(0)).current;
  const lastScale = useRef(1);
  const committedTX = useRef(0);
  const committedTY = useRef(0);
  const touchStartXRef = useRef(0);
  const touchStartYRef = useRef(0);
  const isDraggingRef = useRef(false);
  const suppressNextPlanTapRef = useRef(false);

  const vectorPlan = currentPlanId
    ? (DEMO_FLOOR_PLANS[currentPlanId] ?? GENERIC_FLOOR_PLAN)
    : GENERIC_FLOOR_PLAN;

  const planReserves = useMemo(() => {
    let list = reserves.filter(r => r.planId === currentPlanId);
    if (companyFilter !== 'all') list = list.filter(r => r.company === companyFilter);
    if (levelFilter !== 'all') list = list.filter(r => r.level === levelFilter);
    return list;
  }, [reserves, currentPlanId, companyFilter, levelFilter]);

  const activeFilters = [companyFilter, levelFilter].filter(f => f !== 'all').length;

  const planLevels = useMemo(() => {
    const lvls = reserves.filter(r => r.planId === currentPlanId).map(r => r.level);
    return Array.from(new Set(lvls)).sort();
  }, [reserves, currentPlanId]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) + Math.abs(gs.dy) > 4,
      onPanResponderGrant: (e) => {
        touchStartXRef.current = e.nativeEvent.pageX;
        touchStartYRef.current = e.nativeEvent.pageY;
        isDraggingRef.current = false;
      },
      onPanResponderMove: (_, gs) => {
        const moved = Math.abs(gs.dx) + Math.abs(gs.dy);
        if (moved > 6) isDraggingRef.current = true;
        translateX.setValue(committedTX.current + gs.dx);
        translateY.setValue(committedTY.current + gs.dy);
      },
      onPanResponderRelease: (_, gs) => {
        committedTX.current = committedTX.current + gs.dx;
        committedTY.current = committedTY.current + gs.dy;
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
    lastScale.current = 1;
    committedTX.current = 0;
    committedTY.current = 0;
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true }),
      Animated.spring(translateX, { toValue: 0, useNativeDriver: true }),
      Animated.spring(translateY, { toValue: 0, useNativeDriver: true }),
    ]).start();
  }

  function handlePlanTap(e: any) {
    if (!addingMarker) {
      suppressNextPlanTapRef.current = false;
      return;
    }
    if (suppressNextPlanTapRef.current) {
      suppressNextPlanTapRef.current = false;
      return;
    }
    if (isDraggingRef.current) return;
    const { locationX, locationY, pageX, pageY } = e.nativeEvent;
    const totalMove = Math.abs((pageX ?? 0) - touchStartXRef.current) + Math.abs((pageY ?? 0) - touchStartYRef.current);
    if (totalMove > 8) return;
    if (locationX === undefined || locationY === undefined) return;
    const px = Math.min(100, Math.max(0, Math.round((locationX / PLAN_W) * 100)));
    const py = Math.min(100, Math.max(0, Math.round((locationY / PLAN_H) * 100)));
    setPendingCoords({ x: px, y: py });
    setAddingMarker(false);
  }

  function handleSelectPlan(planId: string) {
    setActivePlanId(planId);
    resetView();
    setAddingMarker(false);
    setPendingCoords(null);
    setCompanyFilter('all');
    setLevelFilter('all');
  }

  async function handleImportPlan() {
    if (!currentPlanId) return;
    setImporting(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
        type: ['image/*', 'application/pdf', '*/*'],
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        const docName = asset.name;
        const docExt = docName.split('.').pop()?.toLowerCase() ?? '';
        const isImg = isImage(docName);
        const isPdfFile = docExt === 'pdf';
        const isDxf = docExt === 'dxf';

        if (!isImg && !isPdfFile && !isDxf) {
          Alert.alert('Format non supporté', 'Importez une image (JPG, PNG), un PDF ou un fichier AutoCAD (.dxf).');
          return;
        }

        if (isDxf) {
          const dxfResp = await fetch(asset.uri);
          const dxfText = await dxfResp.text();
          const parsed = parseDxf(dxfText);
          if (parsed.entities.length === 0) {
            Alert.alert('DXF vide', "Le fichier DXF ne contient aucune entité reconnue. Vérifiez qu'il s'agit d'un plan AutoCAD valide.");
            return;
          }
          setDxfData(prev => ({ ...prev, [currentPlanId]: parsed }));
          updateSitePlan({ ...currentPlan!, dxfName: docName, size: formatSize(asset.size) });
          Alert.alert(
            'Plan DXF importé ✓',
            `${parsed.entities.length} entités chargées depuis "${docName}". Le plan vectoriel AutoCAD est maintenant affiché.`
          );
          return;
        }

        const storageUrl = await uploadDocument(asset.uri, `plan_${currentPlanId}_${docName}`, asset.mimeType ?? undefined);
        const finalUri = storageUrl ?? asset.uri;

        updateSitePlan({ ...currentPlan!, uri: finalUri, size: formatSize(asset.size) });

        Alert.alert(
          'Plan importé',
          storageUrl
            ? `Plan "${currentPlan?.name}" uploadé sur Supabase Storage.`
            : `Plan "${currentPlan?.name}" importé localement.`
        );
      }
    } catch {
      Alert.alert('Erreur', "Impossible d'importer le plan.");
    } finally {
      setImporting(false);
    }
  }

  function handleRemovePlan() {
    if (!currentPlan?.uri) return;
    Alert.alert(
      'Remplacer le plan importé ?',
      `Le plan actuel sera remplacé. Vous pourrez immédiatement en importer un nouveau.`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Remplacer', style: 'destructive', onPress: handleImportPlan },
      ]
    );
  }

  function handleAddPlan() {
    if (!activeChantierId) return;
    Alert.prompt(
      'Nouveau plan',
      'Nom du plan (ex : Bâtiment D — Niveau 2)',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Créer',
          onPress: (name) => {
            if (!name?.trim()) return;
            const newPlan: SitePlan = {
              id: genId(),
              chantierId: activeChantierId,
              name: name.trim(),
              uploadedAt: new Date().toLocaleDateString('fr-FR'),
            };
            addSitePlan(newPlan);
            setActivePlanId(newPlan.id);
          },
        },
      ],
      'plain-text',
      ''
    );
  }

  if (!activeChantierId || chantierPlans.length === 0) {
    return (
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: topPad + 12 }]}>
          <Text style={styles.title}>Plans interactifs</Text>
        </View>
        <View style={styles.emptyState}>
          <Ionicons name="map-outline" size={52} color={C.textMuted} />
          <Text style={styles.emptyTitle}>
            {!activeChantierId ? 'Aucun chantier actif' : 'Aucun plan disponible'}
          </Text>
          <Text style={styles.emptySubtitle}>
            {!activeChantierId
              ? 'Créez d\'abord un chantier pour accéder aux plans.'
              : 'Ajoutez des plans à ce chantier pour visualiser les réserves.'}
          </Text>
          {!activeChantierId ? (
            <TouchableOpacity
              style={styles.emptyBtn}
              onPress={() => router.push('/chantier/new' as any)}
            >
              <Ionicons name="add-circle-outline" size={16} color="#fff" />
              <Text style={styles.emptyBtnText}>Créer un chantier</Text>
            </TouchableOpacity>
          ) : permissions.canCreate ? (
            <TouchableOpacity style={styles.emptyBtn} onPress={handleAddPlan}>
              <Ionicons name="add-circle-outline" size={16} color="#fff" />
              <Text style={styles.emptyBtnText}>Ajouter un plan</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: topPad + 12 }]}>
        <View style={styles.headerTop}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Plans interactifs</Text>
            {activeChantier && (
              <Text style={styles.chantierLabel} numberOfLines={1}>{activeChantier.name}</Text>
            )}
          </View>
          <View style={styles.zoomBtns}>
            <TouchableOpacity
              style={[styles.zoomBtn, showFilters && styles.filterToggleActive]}
              onPress={() => setShowFilters(v => !v)}
            >
              <Ionicons name="options-outline" size={14} color={showFilters ? C.primary : C.text} />
              {activeFilters > 0 && (
                <View style={styles.filterBadge}>
                  <Text style={styles.filterBadgeText}>{activeFilters}</Text>
                </View>
              )}
            </TouchableOpacity>
            <TouchableOpacity style={styles.zoomBtn} onPress={zoomOut}><Ionicons name="remove" size={16} color={C.text} /></TouchableOpacity>
            <TouchableOpacity style={styles.zoomBtn} onPress={resetView}><Ionicons name="scan-outline" size={14} color={C.text} /></TouchableOpacity>
            <TouchableOpacity style={styles.zoomBtn} onPress={zoomIn}><Ionicons name="add" size={16} color={C.text} /></TouchableOpacity>
          </View>
        </View>

        <View style={styles.buildingBarRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }}>
            <View style={styles.buildingRow}>
              {chantierPlans.map(plan => (
                <TouchableOpacity
                  key={plan.id}
                  style={[styles.buildingBtn, currentPlanId === plan.id && styles.buildingBtnActive]}
                  onPress={() => handleSelectPlan(plan.id)}
                >
                  <Text style={[styles.buildingText, currentPlanId === plan.id && styles.buildingTextActive]} numberOfLines={1}>
                    {plan.name}
                  </Text>
                  {plan.uri && <View style={styles.planDot} />}
                </TouchableOpacity>
              ))}
            </View>
          </ScrollView>
          <View style={styles.planActions}>
            {permissions.canCreate && (
              <TouchableOpacity
                style={[styles.importBtn, importing && styles.importBtnDisabled]}
                onPress={handleImportPlan}
                disabled={importing || !currentPlanId}
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
            )}
            {permissions.canCreate && Platform.OS !== 'web' && (
              <TouchableOpacity style={styles.addPlanBtn} onPress={handleAddPlan}>
                <Ionicons name="add" size={16} color={C.textSub} />
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>

      {showFilters && (
        <>
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

          {planLevels.length > 0 && (
            <View style={styles.zoneFilterWrap}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingHorizontal: 16 }}>
                <TouchableOpacity
                  style={[styles.filterChip, levelFilter === 'all' && styles.levelChipActive]}
                  onPress={() => setLevelFilter('all')}
                >
                  <Ionicons name="albums-outline" size={11} color={levelFilter === 'all' ? '#8B5CF6' : C.textMuted} />
                  <Text style={[styles.filterChipText, levelFilter === 'all' && { color: '#8B5CF6' }]}>Tous niveaux</Text>
                </TouchableOpacity>
                {planLevels.map(lvl => (
                  <TouchableOpacity
                    key={lvl}
                    style={[styles.filterChip, levelFilter === lvl && styles.levelChipActive]}
                    onPress={() => setLevelFilter(levelFilter === lvl ? 'all' : lvl)}
                  >
                    <Text style={[styles.filterChipText, levelFilter === lvl && { color: '#8B5CF6' }]}>{lvl}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          )}
        </>
      )}

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.planContainer}>
          <View style={styles.planTitleRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.planTitle}>{currentPlan?.name ?? 'Plan'}</Text>
              {currentPlan?.uri ? (
                <Text style={styles.planSubtitle}>Plan importé · {currentPlan.uploadedAt}</Text>
              ) : (
                <Text style={styles.planSubtitle}>Plan schématique · {currentPlan?.uploadedAt}</Text>
              )}
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {currentPlan?.uri && permissions.canCreate && (
                <TouchableOpacity style={styles.removePlanBtn} onPress={handleRemovePlan}>
                  <Ionicons name="swap-horizontal-outline" size={13} color={C.textSub} />
                  <Text style={styles.removePlanText}>Remplacer</Text>
                </TouchableOpacity>
              )}
              {permissions.canCreate && (
                <TouchableOpacity
                  style={[styles.addMarkerBtn, addingMarker && styles.addMarkerBtnActive]}
                  onPress={() => setAddingMarker(!addingMarker)}
                >
                  <Ionicons name={addingMarker ? 'close' : 'add-circle-outline'} size={15} color={addingMarker ? C.open : C.primary} />
                  <Text style={[styles.addMarkerText, addingMarker && { color: C.open }]}>
                    {addingMarker ? 'Annuler' : 'Placer'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {!currentPlan?.uri && permissions.canCreate && (
            <TouchableOpacity style={styles.importHintBanner} onPress={handleImportPlan} disabled={importing}>
              <Ionicons name="cloud-upload-outline" size={16} color={C.primary} />
              <Text style={styles.importHintText}>
                Importez votre vrai plan (image ou PDF) pour ce chantier
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

                {currentPlan?.uri ? (
                  <PlanImageLayer uri={currentPlan.uri} isPdfFile={isPdf(currentPlan.uri)} />
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

                {currentPlanId && dxfData[currentPlanId] && (
                  <DxfOverlay dxf={dxfData[currentPlanId]} />
                )}

                {planReserves.filter(r => r.planX != null && r.planY != null).map((r, idx) => (
                  <TouchableOpacity
                    key={r.id}
                    style={[styles.marker, {
                      left: `${r.planX}%` as any,
                      top: `${r.planY}%` as any,
                      backgroundColor: STATUS_CONFIG[r.status].color,
                    }]}
                    onPressIn={() => { suppressNextPlanTapRef.current = true; }}
                    onPress={() => setSelected(r)}
                  >
                    <Text style={styles.markerText}>{r.id.split('-')[1] ?? String(idx + 1)}</Text>
                  </TouchableOpacity>
                ))}

                {pendingCoords && (
                  <View
                    style={[styles.pendingMarker, {
                      left: `${pendingCoords.x}%` as any,
                      top: `${pendingCoords.y}%` as any,
                    }]}
                  >
                    <Ionicons name="add" size={12} color="#fff" />
                  </View>
                )}
              </View>
            </Animated.View>
          </View>

          {pendingCoords && (
            <View style={styles.pendingBanner}>
              <Ionicons name="location-outline" size={14} color={C.inProgress} />
              <Text style={styles.pendingText}>
                Position sélectionnée ({pendingCoords.x}%, {pendingCoords.y}%)
              </Text>
              <TouchableOpacity
                style={styles.pendingCreateBtn}
                onPress={() => {
                  router.push({
                    pathname: '/reserve/new',
                    params: {
                      planId: currentPlanId ?? '',
                      chantierId: activeChantierId ?? '',
                      planX: String(pendingCoords.x),
                      planY: String(pendingCoords.y),
                    },
                  } as any);
                  setPendingCoords(null);
                }}
              >
                <Text style={styles.pendingCreateText}>Créer la réserve</Text>
                <Ionicons name="arrow-forward" size={13} color={C.primary} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setPendingCoords(null)}>
                <Ionicons name="close-circle" size={18} color={C.textMuted} />
              </TouchableOpacity>
            </View>
          )}
        </View>

        {planReserves.length > 0 && (
          <View style={styles.listSection}>
            <Text style={styles.listTitle}>
              Réserves sur ce plan ({planReserves.length})
            </Text>
            {planReserves.map((r, idx) => (
              <TouchableOpacity
                key={r.id}
                style={styles.reserveRow}
                onPress={() => router.push(`/reserve/${r.id}` as any)}
              >
                <View style={[styles.pinBadge, { backgroundColor: STATUS_CONFIG[r.status].color }]}>
                  <Text style={styles.pinBadgeText}>{r.id.split('-')[1] ?? String(idx + 1)}</Text>
                </View>
                <View style={styles.reserveInfo}>
                  <Text style={styles.reserveTitle} numberOfLines={1}>{r.title}</Text>
                  <Text style={styles.reserveMeta}>{r.company} · {r.level}</Text>
                </View>
                <View style={{ gap: 4, alignItems: 'flex-end' }}>
                  <StatusBadge status={r.status} size="sm" />
                  <PriorityBadge priority={r.priority} size="sm" />
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {planReserves.length === 0 && (
          <View style={styles.noReservesCard}>
            <Ionicons name="checkmark-circle-outline" size={32} color={C.closed} />
            <Text style={styles.noReservesText}>Aucune réserve sur ce plan</Text>
            {permissions.canCreate && (
              <TouchableOpacity
                style={styles.addReserveFromPlanBtn}
                onPress={() => router.push({
                  pathname: '/reserve/new',
                  params: { planId: currentPlanId ?? '', chantierId: activeChantierId ?? '' },
                } as any)}
              >
                <Ionicons name="add" size={14} color={C.primary} />
                <Text style={styles.addReserveFromPlanText}>Ajouter une réserve</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </ScrollView>

      {permissions.canCreate && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => router.push({
            pathname: '/reserve/new',
            params: { planId: currentPlanId ?? '', chantierId: activeChantierId ?? '' },
          } as any)}
          activeOpacity={0.85}
        >
          <Ionicons name="add" size={26} color="#fff" />
        </TouchableOpacity>
      )}

      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setSelected(null)}>
          {selected && (
            <TouchableOpacity activeOpacity={1} style={styles.modalCard} onPress={() => {}}>
              <View style={styles.modalHeader}>
                <View style={[styles.modalPin, { backgroundColor: STATUS_CONFIG[selected.status].color }]}>
                  <Text style={styles.modalPinText}>{selected.id.split('-')[1] ?? '#'}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalTitle} numberOfLines={2}>{selected.title}</Text>
                  <Text style={styles.modalMeta}>{selected.company} · {selected.level}</Text>
                </View>
                <TouchableOpacity onPress={() => setSelected(null)}>
                  <Ionicons name="close" size={20} color={C.textMuted} />
                </TouchableOpacity>
              </View>
              {selected.description ? (
                <Text style={styles.modalDesc} numberOfLines={3}>{selected.description}</Text>
              ) : null}
              <View style={styles.modalBadges}>
                <StatusBadge status={selected.status} size="sm" />
                <PriorityBadge priority={selected.priority} size="sm" />
                {selected.deadline && selected.deadline !== '—' && (
                  <View style={styles.deadlineBadge}>
                    <Ionicons name="calendar-outline" size={11} color={C.textMuted} />
                    <Text style={styles.deadlineText}>{selected.deadline}</Text>
                  </View>
                )}
              </View>
              <TouchableOpacity
                style={styles.modalOpenBtn}
                onPress={() => {
                  setSelected(null);
                  router.push(`/reserve/${selected.id}` as any);
                }}
              >
                <Text style={styles.modalOpenText}>Ouvrir la réserve</Text>
                <Ionicons name="arrow-forward" size={14} color={C.primary} />
              </TouchableOpacity>
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: { backgroundColor: C.surface, borderBottomWidth: 1, borderBottomColor: C.border, paddingBottom: 0 },
  headerTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 12 },
  title: { fontSize: 22, fontFamily: 'Inter_700Bold', color: C.text },
  chantierLabel: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
  zoomBtns: { flexDirection: 'row', gap: 6 },
  zoomBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  filterToggleActive: { backgroundColor: C.primaryBg, borderColor: C.primary },
  filterBadge: { position: 'absolute', top: -4, right: -4, width: 16, height: 16, borderRadius: 8, backgroundColor: C.primary, alignItems: 'center', justifyContent: 'center' },
  filterBadgeText: { fontSize: 9, fontFamily: 'Inter_700Bold', color: '#fff' },
  buildingBarRow: { flexDirection: 'row', alignItems: 'center', paddingBottom: 10 },
  buildingRow: { flexDirection: 'row', paddingHorizontal: 16, gap: 8 },
  buildingBtn: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 20, backgroundColor: C.surface2, borderWidth: 1.5, borderColor: C.border, flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: 160 },
  buildingBtnActive: { backgroundColor: C.primaryBg, borderColor: C.primary },
  buildingText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub },
  buildingTextActive: { color: C.primary },
  planDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.closed },
  planActions: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingRight: 12 },
  importBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, backgroundColor: C.primaryBg, borderWidth: 1, borderColor: C.primary + '40' },
  importBtnDisabled: { opacity: 0.5 },
  importBtnText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },
  addPlanBtn: { width: 34, height: 34, borderRadius: 10, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
  companyFilterWrap: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  zoneFilterWrap: { paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  filterChip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border },
  filterChipActive: { backgroundColor: C.primaryBg, borderColor: C.primary },
  filterChipText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub },
  filterChipTextActive: { color: C.primary },
  filterDot: { width: 7, height: 7, borderRadius: 4 },
  levelChipActive: { backgroundColor: '#8B5CF620', borderColor: '#8B5CF6' },
  content: { padding: 16, paddingBottom: 48 },
  planContainer: { backgroundColor: C.surface, borderRadius: 16, borderWidth: 1, borderColor: C.border, marginBottom: 16, overflow: 'hidden' },
  planTitleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', padding: 14, paddingBottom: 10 },
  planTitle: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  planSubtitle: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
  removePlanBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border },
  removePlanText: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.textSub },
  addMarkerBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, backgroundColor: C.primaryBg, borderWidth: 1, borderColor: C.primary + '50' },
  addMarkerBtnActive: { backgroundColor: '#EF444420', borderColor: C.open },
  addMarkerText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.primary },
  importHintBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 14, marginBottom: 10, backgroundColor: C.primaryBg, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: C.primary + '30' },
  importHintText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: C.primary, lineHeight: 16 },
  addingHint: { flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 14, marginBottom: 8, backgroundColor: C.inProgress + '15', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 },
  addingHintText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.inProgress },
  planViewport: { overflow: 'hidden', height: PLAN_H + 20, alignItems: 'center', justifyContent: 'center', marginHorizontal: 14, marginBottom: 14, borderRadius: 10, backgroundColor: C.surface2 },
  planAnimated: { alignItems: 'center', justifyContent: 'center' },
  planView: { position: 'relative', borderRadius: 8, overflow: 'hidden', backgroundColor: '#0F1825' },
  room: { position: 'absolute', borderWidth: 1, borderColor: '#1E2D42', alignItems: 'center', justifyContent: 'center', padding: 3 },
  roomLabel: { fontSize: 8, fontFamily: 'Inter_500Medium', color: '#4A6080', textAlign: 'center' },
  marker: { position: 'absolute', width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', transform: [{ translateX: -11 }, { translateY: -11 }], borderWidth: 2, borderColor: 'rgba(255,255,255,0.35)', shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 3, elevation: 4 },
  markerText: { fontSize: 9, fontFamily: 'Inter_700Bold', color: '#fff' },
  pendingMarker: { position: 'absolute', width: 24, height: 24, borderRadius: 12, backgroundColor: C.inProgress, alignItems: 'center', justifyContent: 'center', transform: [{ translateX: -12 }, { translateY: -12 }], borderWidth: 2, borderColor: '#fff' },
  pendingBanner: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 14, marginBottom: 14, backgroundColor: C.inProgress + '15', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: C.inProgress + '30' },
  pendingText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: C.inProgress },
  pendingCreateBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pendingCreateText: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.primary },
  listSection: { marginBottom: 12 },
  listTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.textSub, marginBottom: 10, textTransform: 'uppercase', letterSpacing: 0.5 },
  reserveRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.surface, borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: C.border },
  pinBadge: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  pinBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#fff' },
  reserveInfo: { flex: 1 },
  reserveTitle: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text },
  reserveMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
  noReservesCard: { backgroundColor: C.surface, borderRadius: 14, padding: 24, alignItems: 'center', gap: 10, borderWidth: 1, borderColor: C.border },
  noReservesText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.textSub },
  addReserveFromPlanBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10, backgroundColor: C.primaryBg, borderWidth: 1, borderColor: C.primary + '40' },
  addReserveFromPlanText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.primary },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end', padding: 16 },
  modalCard: { backgroundColor: C.surface, borderRadius: 18, padding: 16, gap: 12 },
  modalHeader: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  modalPin: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  modalPinText: { fontSize: 12, fontFamily: 'Inter_700Bold', color: '#fff' },
  modalTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text },
  modalMeta: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 2 },
  modalDesc: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub, lineHeight: 18 },
  modalBadges: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  deadlineBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, backgroundColor: C.surface2, borderRadius: 6, borderWidth: 1, borderColor: C.border },
  deadlineText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted },
  modalOpenBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, backgroundColor: C.primaryBg, borderRadius: 12, borderWidth: 1, borderColor: C.primary + '40' },
  modalOpenText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.primary },
  fab: {
    position: 'absolute',
    bottom: Platform.OS === 'web' ? 100 : 24,
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: C.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...Platform.select({
      web: { boxShadow: '0px 4px 16px rgba(0,48,130,0.30)' } as any,
      default: { shadowColor: '#003082', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.30, shadowRadius: 10, elevation: 8 },
    }),
  },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, gap: 12 },
  emptyTitle: { fontSize: 18, fontFamily: 'Inter_600SemiBold', color: C.text, textAlign: 'center' },
  emptySubtitle: { fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center', lineHeight: 20 },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.primary, borderRadius: 12, paddingHorizontal: 20, paddingVertical: 12, marginTop: 8 },
  emptyBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },
});
