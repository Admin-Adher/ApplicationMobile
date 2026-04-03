import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity,
  Alert, Platform, Image, ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useState, useMemo, useEffect } from 'react';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { ReserveKind, ReservePriority, ReserveStatus, ReservePhoto } from '@/constants/types';
import Header from '@/components/Header';
import DateInput from '@/components/DateInput';
import BottomSheetPicker from '@/components/BottomSheetPicker';
import { uploadPhoto } from '@/lib/storage';
import { genId } from '@/lib/utils';
import {
  RESERVE_BUILDINGS, RESERVE_ZONES, RESERVE_LEVELS, RESERVE_PRIORITIES, RESERVE_TEMPLATES,
  genReserveId, validateDeadline,
} from '@/lib/reserveUtils';

function SelectRow<T extends string>({
  label, options, value, onChange, colorFn,
}: {
  label: string;
  options: T[];
  value: T;
  onChange: (v: T) => void;
  colorFn?: (v: T) => string;
}) {
  return (
    <View style={styles.fieldGroup}>
      <Text style={styles.label}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={styles.chipRow}>
          {options.map(opt => (
            <TouchableOpacity
              key={opt}
              style={[styles.chip, value === opt && styles.chipActive, colorFn ? { borderColor: colorFn(opt) } : {}]}
              onPress={() => onChange(opt)}
            >
              <Text style={[styles.chipText, value === opt && styles.chipTextActive, colorFn ? { color: colorFn(opt) } : {}]}>
                {opt}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

export default function NewReserveScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { companies, addReserve, reserves, addPhoto, activeChantierId, sitePlans, lots, linkReserveToVisite, visites } = useApp();
  const { user, permissions } = useAuth();
  const params = useLocalSearchParams<{
    building?: string; planX?: string; planY?: string;
    prefill_description?: string; prefill_source?: string;
    chantierId?: string; planId?: string; visiteId?: string;
    quickPhotoUri?: string;
  }>();

  const effectiveChantierId = params.chantierId ?? activeChantierId ?? undefined;
  const chantierPlans = sitePlans.filter(p => p.chantierId === effectiveChantierId);

  const chantierBuildings = useMemo(() => {
    const existing = reserves
      .filter(r => effectiveChantierId ? r.chantierId === effectiveChantierId : true)
      .map(r => r.building).filter(Boolean);
    return Array.from(new Set([...RESERVE_BUILDINGS, ...existing])).sort();
  }, [reserves, effectiveChantierId]);

  const chantierZones = useMemo(() => {
    const existing = reserves
      .filter(r => effectiveChantierId ? r.chantierId === effectiveChantierId : true)
      .map(r => r.zone).filter(Boolean);
    return Array.from(new Set([...RESERVE_ZONES, ...existing])).sort();
  }, [reserves, effectiveChantierId]);

  const chantierLevels = useMemo(() => {
    const existing = reserves
      .filter(r => effectiveChantierId ? r.chantierId === effectiveChantierId : true)
      .map(r => r.level).filter(Boolean);
    return Array.from(new Set([...RESERVE_LEVELS, ...existing])).sort();
  }, [reserves, effectiveChantierId]);

  const visiteId = params.visiteId;
  const sourceVisite = visiteId ? visites.find(v => v.id === visiteId) : null;

  const [kind, setKind] = useState<ReserveKind>('reserve');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState(params.prefill_description ?? '');
  const [building, setBuilding] = useState(params.building ?? RESERVE_BUILDINGS[0]);
  const [zone, setZone] = useState(RESERVE_ZONES[0]);
  const [level, setLevel] = useState('RDC');
  const [selectedCompanies, setSelectedCompanies] = useState<string[]>(companies[0] ? [companies[0].name] : []);
  const [responsableNom, setResponsableNom] = useState('');
  const [priority, setPriority] = useState<ReservePriority>('medium');
  const [deadline, setDeadline] = useState('');
  const [deadlineSuggested, setDeadlineSuggested] = useState(false);
  const [lotId, setLotId] = useState<string>('');
  const [selectedPlanId, setSelectedPlanId] = useState<string>(params.planId ?? chantierPlans[0]?.id ?? '');
  const [photos, setPhotos] = useState<ReservePhoto[]>([]);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [expandedTemplateCat, setExpandedTemplateCat] = useState<string | null>(null);

  const isDirty = title.trim().length > 0 || description.trim().length > 0 || photos.length > 0 || deadline.length > 0;

  useEffect(() => {
    if (params.quickPhotoUri && photos.length === 0) {
      savePhoto(params.quickPhotoUri);
    }
  }, []);

  function handleBack() {
    if (!isDirty) { router.back(); return; }
    Alert.alert(
      'Abandonner le formulaire ?',
      'Vos saisies seront perdues si vous quittez maintenant.',
      [
        { text: 'Continuer la saisie', style: 'cancel' },
        { text: 'Abandonner', style: 'destructive', onPress: () => router.back() },
      ]
    );
  }

  const presetX = params.planX ? parseInt(params.planX) : null;
  const presetY = params.planY ? parseInt(params.planY) : null;

  const selectedLot = useMemo(() => lots.find(l => l.id === lotId) ?? null, [lots, lotId]);
  const previewId = useMemo(() => genReserveId(reserves, selectedLot), [reserves, selectedLot]);

  if (!permissions.canCreate) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg, padding: 32 }}>
        <Ionicons name="lock-closed-outline" size={48} color={C.textMuted} />
        <Text style={{ fontSize: 17, fontFamily: 'Inter_600SemiBold', color: C.text, marginTop: 16, textAlign: 'center' }}>
          Accès refusé
        </Text>
        <Text style={{ fontSize: 14, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 8, textAlign: 'center' }}>
          Votre rôle ne permet pas de créer des réserves.
        </Text>
        <TouchableOpacity
          onPress={() => router.back()}
          style={{ marginTop: 24, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: C.primary, borderRadius: 10 }}
        >
          <Text style={{ color: '#fff', fontFamily: 'Inter_600SemiBold', fontSize: 14 }}>Retour</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function getSuggestedDeadlineDays(p: ReservePriority): number | null {
    if (p === 'critical') return 2;
    if (p === 'high') return 7;
    if (p === 'medium') return 30;
    return null;
  }

  function handlePriorityChange(p: ReservePriority) {
    setPriority(p);
    const days = getSuggestedDeadlineDays(p);
    if (days !== null && !deadline) {
      const d = new Date();
      d.setDate(d.getDate() + days);
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = d.getFullYear();
      setDeadline(`${dd}/${mm}/${yyyy}`);
      setDeadlineSuggested(true);
    } else {
      setDeadlineSuggested(false);
    }
  }

  function applyTemplate(item: { title: string; description: string }) {
    setTitle(item.title);
    setDescription(item.description);
    setShowTemplates(false);
    setExpandedTemplateCat(null);
  }

  function handleLotChange(id: string) {
    setLotId(id);
    if (id) {
      const lot = lots.find(l => l.id === id);
      if (lot?.companyId) {
        const co = companies.find(c => c.id === lot.companyId);
        if (co) setSelectedCompanies([co.name]);
      }
    }
  }

  function toggleCompany(name: string) {
    setSelectedCompanies(prev =>
      prev.includes(name) ? prev.filter(n => n !== name) : [...prev, name]
    );
  }

  async function handlePickPhoto() {
    if (photos.length >= 6) { Alert.alert('Limite atteinte', 'Maximum 6 photos par réserve.'); return; }
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') { Alert.alert('Permission refusée', "L'accès à la galerie est nécessaire."); return; }
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsEditing: true, quality: 0.8 });
    if (!result.canceled && result.assets[0]) await savePhoto(result.assets[0].uri);
  }

  async function handleCamera() {
    if (photos.length >= 6) { Alert.alert('Limite atteinte', 'Maximum 6 photos par réserve.'); return; }
    if (Platform.OS === 'web') { Alert.alert('Info', 'La prise de photo directe est disponible sur appareil mobile.'); return; }
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') { Alert.alert('Permission refusée', "L'accès à l'appareil photo est nécessaire."); return; }
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.8 });
    if (!result.canceled && result.assets[0]) await savePhoto(result.assets[0].uri);
  }

  async function savePhoto(uri: string) {
    setPhotoUploading(true);
    try {
      const filename = `reserve_photo_${Date.now()}.jpg`;
      const author = user?.name ?? 'Conducteur de travaux';
      const today = new Date().toISOString().split('T')[0];

      let storageUrl: string | null = null;
      let uploadFailed = false;
      try {
        storageUrl = await uploadPhoto(uri, filename);
      } catch (uploadErr: any) {
        uploadFailed = true;
        Alert.alert(
          'Upload échoué',
          `La photo n'a pas pu être envoyée au serveur (${uploadErr?.message ?? 'erreur réseau'}). Elle est sauvegardée localement uniquement.`
        );
      }
      const finalUri = storageUrl ?? uri;

      let gpsLat: number | undefined;
      let gpsLon: number | undefined;
      if (Platform.OS !== 'web') {
        try {
          const { status } = await Location.requestForegroundPermissionsAsync();
          if (status === 'granted') {
            const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
            gpsLat = loc.coords.latitude;
            gpsLon = loc.coords.longitude;
          }
        } catch {}
      }

      const newPhoto: ReservePhoto = {
        id: genId(),
        uri: finalUri,
        kind: 'defect',
        takenAt: today,
        takenBy: author,
        gpsLat,
        gpsLon,
      };
      setPhotos(prev => [...prev, newPhoto]);
    } catch (e: any) {
      Alert.alert('Erreur photo', `Impossible de traiter cette photo. ${e?.message ?? ''}`);
    } finally {
      setPhotoUploading(false);
    }
  }

  function removePhoto(id: string) {
    setPhotos(prev => prev.filter(p => p.id !== id));
  }

  function togglePhotoKind(id: string) {
    setPhotos(prev => prev.map(p => p.id === id ? { ...p, kind: p.kind === 'defect' ? 'resolution' : 'defect' } : p));
  }

  function handleSubmit() {
    if (isSubmitting) return;
    if (!title.trim()) { Alert.alert('Champ obligatoire', 'Le titre est requis.'); return; }
    if (selectedCompanies.length === 0) { Alert.alert('Champ obligatoire', "Sélectionnez au moins une entreprise responsable."); return; }
    if (!effectiveChantierId && (!building || !building.trim())) { Alert.alert('Champ obligatoire', 'Le bâtiment est requis.'); return; }
    if (!level || !level.trim()) { Alert.alert('Champ obligatoire', 'Le niveau est requis.'); return; }
    if (deadline && !validateDeadline(deadline)) {
      Alert.alert('Date invalide', "Vérifiez que le jour, le mois et l'année sont corrects (ex : 30/04/2026).");
      return;
    }
    setIsSubmitting(true);
    try {
      const author = user?.name ?? 'Conducteur de travaux';
      const id = genReserveId(reserves, selectedLot);
      const isoToday = new Date().toISOString().split('T')[0];
      addReserve({
        id,
        kind,
        title: title.trim(),
        description: description.trim() || 'Aucune description fournie.',
        building,
        zone,
        level,
        companies: selectedCompanies,
        company: selectedCompanies[0] ?? '',
        responsableNom: responsableNom.trim() || undefined,
        priority,
        status: 'open' as ReserveStatus,
        createdAt: isoToday,
        deadline: deadline || '—',
        comments: [],
        history: [{ id: 'h0', action: kind === 'observation' ? 'Observation créée' : 'Réserve créée', author, createdAt: isoToday }],
        planX: presetX ?? undefined,
        planY: presetY ?? undefined,
        photoUri: photos[0]?.uri ?? undefined,
        photos: photos.length > 0 ? photos : undefined,
        chantierId: effectiveChantierId,
        planId: selectedPlanId || undefined,
        lotId: lotId || undefined,
        visiteId: visiteId || undefined,
      });
      if (visiteId) linkReserveToVisite(id, visiteId);
      photos.forEach(p => {
        addPhoto({
          id: genId(),
          comment: `Photo ${kind === 'observation' ? 'observation' : 'réserve'} ${id} — ${title.trim()}`,
          location: `Bât. ${building} - ${level}`,
          takenAt: isoToday,
          takenBy: author,
          colorCode: kind === 'observation' ? '#0EA5E9' : '#EF4444',
          uri: p.uri,
          reserveId: id,
        });
      });
      Alert.alert(
        kind === 'observation' ? 'Observation créée' : 'Réserve créée',
        `${id} ajoutée avec succès.`,
        [{ text: 'OK', onPress: () => { setIsSubmitting(false); router.back(); } }],
        { cancelable: false }
      );
    } catch (err) {
      setIsSubmitting(false);
      Alert.alert('Erreur', "Une erreur est survenue lors de la création. Veuillez réessayer.");
    }
  }

  return (
    <View style={styles.container}>
      <Header title={kind === 'observation' ? 'Nouvelle observation' : 'Nouvelle réserve'} showBack onBack={handleBack} rightLabel="Créer" onRightPress={handleSubmit} />

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 32 }]} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {sourceVisite ? (
          <View style={styles.visiteCard}>
            <Ionicons name="eye-outline" size={14} color="#6366F1" />
            <View style={{ flex: 1 }}>
              <Text style={styles.visiteCardLabel}>Créé depuis la visite</Text>
              <Text style={styles.visiteCardTitle}>{sourceVisite.title} — {sourceVisite.date}</Text>
            </View>
          </View>
        ) : null}

        {params.prefill_source && !sourceVisite ? (
          <View style={styles.sourceCard}>
            <Ionicons name="chatbubble-outline" size={14} color={C.inProgress} />
            <Text style={styles.sourceText}>Créé depuis : {params.prefill_source}</Text>
          </View>
        ) : null}

        {/* TYPE */}
        <View style={styles.card}>
          <Text style={styles.label}>TYPE</Text>
          <View style={styles.kindRow}>
            <TouchableOpacity style={[styles.kindChip, kind === 'reserve' && styles.kindChipReserve]} onPress={() => setKind('reserve')}>
              <Ionicons name="warning-outline" size={14} color={kind === 'reserve' ? '#EF4444' : C.textSub} />
              <Text style={[styles.kindChipText, kind === 'reserve' && { color: '#EF4444', fontFamily: 'Inter_700Bold' }]}>Réserve</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.kindChip, kind === 'observation' && styles.kindChipObservation]} onPress={() => setKind('observation')}>
              <Ionicons name="eye-outline" size={14} color={kind === 'observation' ? '#0EA5E9' : C.textSub} />
              <Text style={[styles.kindChipText, kind === 'observation' && { color: '#0EA5E9', fontFamily: 'Inter_700Bold' }]}>Observation</Text>
            </TouchableOpacity>
          </View>
          {kind === 'observation' && (
            <View style={styles.kindHintBox}>
              <Ionicons name="information-circle-outline" size={13} color="#0EA5E9" />
              <Text style={styles.kindHintText}>Une observation est un constat sans impact bloquant sur la réception.</Text>
            </View>
          )}
        </View>

        {/* PHOTOS — en premier pour capturer d'abord */}
        <View style={styles.card}>
          <View style={[styles.fieldGroup, { marginBottom: 0 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text style={styles.label}>Photos ({photos.length}/6)</Text>
              {photos.length > 0 && <Text style={styles.photoKindHint}>Appuyer sur une photo pour basculer Constat ↔ Levée</Text>}
            </View>

            {photos.length > 0 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  {photos.map(p => (
                    <View key={p.id} style={styles.photoThumb}>
                      <TouchableOpacity onPress={() => togglePhotoKind(p.id)} activeOpacity={0.85}>
                        <Image source={{ uri: p.uri }} style={styles.photoThumbImg} resizeMode="cover" />
                        <View style={[styles.photoKindBadge, { backgroundColor: p.kind === 'defect' ? '#EF444488' : '#22C55E88' }]}>
                          <Text style={styles.photoKindBadgeText}>{p.kind === 'defect' ? 'Constat' : 'Levée'}</Text>
                        </View>
                        {p.gpsLat !== undefined && (
                          <View style={styles.gpsIndicator}>
                            <Ionicons name="location" size={9} color="#fff" />
                          </View>
                        )}
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.photoRemoveBtn} onPress={() => removePhoto(p.id)}>
                        <Ionicons name="close" size={11} color="#fff" />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              </ScrollView>
            )}

            {photos.length < 6 && (
              <View style={styles.photoRow}>
                <TouchableOpacity style={[styles.photoBtn, { flex: 1 }]} onPress={handleCamera} disabled={photoUploading}>
                  <Ionicons name="camera" size={18} color={C.primary} />
                  <Text style={styles.photoBtnText}>Prendre une photo</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.photoBtn, { flex: 1 }]} onPress={handlePickPhoto} disabled={photoUploading}>
                  <Ionicons name="images-outline" size={18} color={C.inProgress} />
                  <Text style={[styles.photoBtnText, { color: C.inProgress }]}>Galerie</Text>
                </TouchableOpacity>
              </View>
            )}

            {photoUploading && (
              <View style={styles.uploadRow}>
                <ActivityIndicator size="small" color={C.primary} />
                <Text style={styles.uploadText}>Upload en cours...</Text>
              </View>
            )}
          </View>
        </View>

        {/* TEMPLATES */}
        {kind === 'reserve' && (
          <View style={styles.card}>
            <TouchableOpacity style={styles.templateHeader} onPress={() => setShowTemplates(!showTemplates)} activeOpacity={0.7}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Ionicons name="bookmark-outline" size={15} color={C.primary} />
                <Text style={styles.templateHeaderText}>Templates rapides</Text>
                <View style={styles.templateBadge}>
                  <Text style={styles.templateBadgeText}>{RESERVE_TEMPLATES.reduce((s, c) => s + c.items.length, 0)}</Text>
                </View>
              </View>
              <Ionicons name={showTemplates ? 'chevron-up' : 'chevron-down'} size={16} color={C.textSub} />
            </TouchableOpacity>
            {showTemplates && (
              <View style={{ marginTop: 12 }}>
                {RESERVE_TEMPLATES.map(cat => (
                  <View key={cat.category} style={{ marginBottom: 4 }}>
                    <TouchableOpacity
                      style={styles.templateCatRow}
                      onPress={() => setExpandedTemplateCat(expandedTemplateCat === cat.category ? null : cat.category)}
                      activeOpacity={0.7}
                    >
                      <Ionicons name={cat.icon as any} size={14} color={C.textSub} />
                      <Text style={styles.templateCatText}>{cat.category}</Text>
                      <Ionicons name={expandedTemplateCat === cat.category ? 'chevron-up' : 'chevron-down'} size={13} color={C.textMuted} />
                    </TouchableOpacity>
                    {expandedTemplateCat === cat.category && cat.items.map(item => (
                      <TouchableOpacity key={item.title} style={styles.templateItem} onPress={() => applyTemplate(item)} activeOpacity={0.7}>
                        <Ionicons name="arrow-forward-outline" size={12} color={C.primary} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.templateItemTitle}>{item.title}</Text>
                          <Text style={styles.templateItemDesc} numberOfLines={1}>{item.description}</Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                ))}
              </View>
            )}
            {!showTemplates && (
              <Text style={styles.templateHint}>Choisissez un modèle pour pré-remplir titre et description</Text>
            )}
          </View>
        )}

        {/* TITRE / DESCRIPTION */}
        <View style={styles.card}>
          <View style={styles.fieldGroup}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <Text style={styles.label}>Titre *</Text>
              <View style={styles.idPreviewBadge}>
                <Ionicons name="pricetag-outline" size={10} color={C.textMuted} />
                <Text style={styles.idPreviewText}>Réf : {previewId}</Text>
              </View>
            </View>
            <TextInput
              style={styles.input}
              placeholder="Ex : Fissure mur porteur..."
              placeholderTextColor={C.textMuted}
              value={title}
              onChangeText={setTitle}
            />
          </View>
          <View style={[styles.fieldGroup, { marginBottom: 0 }]}>
            <Text style={styles.label}>Description</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Décrivez le problème en détail..."
              placeholderTextColor={C.textMuted}
              value={description}
              onChangeText={setDescription}
              multiline
              numberOfLines={4}
            />
          </View>
        </View>

        {/* CORPS D'ÉTAT (LOT) */}
        {lots.length > 0 && (
          <View style={styles.card}>
            <BottomSheetPicker
              label="Corps d'état (lot)"
              options={lots.map(lot => ({
                label: `${lot.number ? `${lot.number}. ` : ''}${lot.name}`,
                value: lot.id,
                color: lot.color,
              }))}
              value={lotId}
              onChange={handleLotChange}
              allowNone
              noneLabel="Aucun lot"
            />
            {selectedLot && (
              <View style={styles.lotAutoFillHint}>
                <Ionicons name="information-circle-outline" size={12} color={C.primary} />
                <Text style={styles.lotAutoFillText}>
                  Référence automatique : <Text style={{ fontFamily: 'Inter_700Bold' }}>{previewId}</Text>
                  {selectedLot.companyId && companies.find(c => c.id === selectedLot.companyId)
                    ? ` · Entreprise auto-remplie : ${companies.find(c => c.id === selectedLot.companyId)!.shortName}`
                    : ''}
                </Text>
              </View>
            )}
          </View>
        )}

        {/* PLAN */}
        {chantierPlans.length > 0 && (
          <View style={styles.card}>
            <BottomSheetPicker
              label="Plan associé"
              options={chantierPlans.map(p => ({ label: p.name, value: p.id }))}
              value={selectedPlanId}
              onChange={setSelectedPlanId}
              allowNone
              noneLabel="Aucun plan"
            />
          </View>
        )}

        {/* LOCALISATION */}
        <View style={styles.card}>
          {(!effectiveChantierId && chantierPlans.length === 0) && (
            <BottomSheetPicker
              label="Bâtiment"
              options={chantierBuildings.map(b => ({ label: b, value: b }))}
              value={building}
              onChange={setBuilding}
            />
          )}
          <BottomSheetPicker
            label="Zone"
            options={chantierZones.map(z => ({ label: z, value: z }))}
            value={zone}
            onChange={setZone}
          />
          <BottomSheetPicker
            label="Niveau"
            options={chantierLevels.map(l => ({ label: l, value: l }))}
            value={level}
            onChange={setLevel}
          />
        </View>

        {/* ENTREPRISES */}
        <View style={styles.card}>
          <Text style={styles.label}>Entreprises responsables *</Text>
          {companies.length === 0 ? (
            <View style={styles.warningRow}>
              <Ionicons name="alert-circle-outline" size={14} color={C.medium} />
              <Text style={styles.warningText}>
                Aucune entreprise configurée. Ajoutez d'abord une entreprise dans l'onglet Équipes.
              </Text>
            </View>
          ) : (
            <>
              {companies.map(co => {
                const selected = selectedCompanies.includes(co.name);
                return (
                  <TouchableOpacity
                    key={co.id}
                    style={[styles.companyRow, selected && { backgroundColor: co.color + '15', borderColor: co.color }]}
                    onPress={() => toggleCompany(co.name)}
                    activeOpacity={0.7}
                  >
                    <View style={[styles.companyColorDot, { backgroundColor: co.color }]} />
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.companyRowName, selected && { color: co.color, fontFamily: 'Inter_600SemiBold' }]}>{co.name}</Text>
                      {co.shortName && co.shortName !== co.name && (
                        <Text style={styles.companyRowShort}>{co.shortName}</Text>
                      )}
                    </View>
                    <View style={[styles.companyCheckbox, selected && { backgroundColor: co.color, borderColor: co.color }]}>
                      {selected && <Ionicons name="checkmark" size={12} color="#fff" />}
                    </View>
                  </TouchableOpacity>
                );
              })}
              {selectedCompanies.length > 1 && (
                <View style={styles.multiCompanyHint}>
                  <Ionicons name="information-circle-outline" size={12} color={C.primary} />
                  <Text style={styles.multiCompanyHintText}>
                    {selectedCompanies.length} entreprises sélectionnées — toutes seront notifiées.
                  </Text>
                </View>
              )}
            </>
          )}
        </View>

        {/* RESPONSABLE NOM */}
        <View style={styles.card}>
          <View style={[styles.fieldGroup, { marginBottom: 0 }]}>
            <Text style={styles.label}>Responsable (contact)</Text>
            <TextInput
              style={styles.input}
              placeholder="Nom du responsable chez l'entreprise..."
              placeholderTextColor={C.textMuted}
              value={responsableNom}
              onChangeText={setResponsableNom}
            />
          </View>
        </View>

        {/* PRIORITÉ */}
        <View style={styles.card}>
          <View style={[styles.fieldGroup, { marginBottom: 0 }]}>
            <Text style={styles.label}>Priorité</Text>
            <View style={styles.chipRow}>
              {RESERVE_PRIORITIES.map(p => (
                <TouchableOpacity
                  key={p.value}
                  style={[styles.chip, priority === p.value && { backgroundColor: p.color + '20', borderColor: p.color }]}
                  onPress={() => handlePriorityChange(p.value)}
                >
                  <Text style={[styles.chipText, priority === p.value && { color: p.color }]}>{p.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        {/* DATE LIMITE */}
        <View style={styles.card}>
          <View style={styles.fieldGroup}>
            <DateInput label="Date limite" value={deadline} onChange={v => { setDeadline(v); setDeadlineSuggested(false); }} optional />
          </View>
          {deadlineSuggested && deadline ? (
            <View style={styles.lotAutoFillHint}>
              <Ionicons name="bulb-outline" size={12} color={C.primary} />
              <Text style={styles.lotAutoFillText}>
                Délai suggéré automatiquement selon la priorité ({getSuggestedDeadlineDays(priority)}j). Vous pouvez modifier la date.
              </Text>
            </View>
          ) : null}
        </View>

        <TouchableOpacity
          style={[styles.submitBtn, isSubmitting && { opacity: 0.6 }, kind === 'observation' && styles.submitBtnObservation]}
          onPress={handleSubmit}
          disabled={isSubmitting}
        >
          <Ionicons name="add-circle" size={20} color="#fff" />
          <Text style={styles.submitBtnText}>
            {isSubmitting ? 'Création...' : kind === 'observation' ? "Créer l'observation" : 'Créer la réserve'}
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 16, paddingBottom: 48 },
  card: { backgroundColor: C.surface, borderRadius: 14, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: C.border },
  fieldGroup: { marginBottom: 14 },
  label: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 },
  hint: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 6 },
  input: {
    backgroundColor: C.surface2, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    color: C.text, fontFamily: 'Inter_400Regular', fontSize: 14,
    borderWidth: 1, borderColor: C.border,
  },
  textArea: { minHeight: 90, textAlignVertical: 'top' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface2, flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipActive: { backgroundColor: C.primaryBg, borderColor: C.primary },
  chipText: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.textSub },
  chipTextActive: { color: C.primary },
  coDot: { width: 8, height: 8, borderRadius: 4 },
  lotDot: { width: 7, height: 7, borderRadius: 3.5 },

  photoRow: { flexDirection: 'row', gap: 10 },
  photoBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.surface2, borderRadius: 10, paddingVertical: 14, borderWidth: 1.5, borderColor: C.border },
  photoBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.primary },
  photoKindHint: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textMuted },
  photoThumb: { position: 'relative', width: 80, height: 80, borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: C.border },
  photoThumbImg: { width: '100%', height: '100%' },
  photoKindBadge: { position: 'absolute', bottom: 0, left: 0, right: 0, paddingVertical: 3, alignItems: 'center' },
  photoKindBadgeText: { fontSize: 9, fontFamily: 'Inter_700Bold', color: '#fff' },
  photoRemoveBtn: { position: 'absolute', top: 3, right: 3, width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(0,0,0,0.65)', alignItems: 'center', justifyContent: 'center' },
  gpsIndicator: { position: 'absolute', top: 3, left: 3, width: 16, height: 16, borderRadius: 8, backgroundColor: '#059669CC', alignItems: 'center', justifyContent: 'center' },
  uploadRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  uploadText: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub },

  templateHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  templateHeaderText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  templateBadge: { backgroundColor: C.primaryBg, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  templateBadgeText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: C.primary },
  templateHint: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 6 },
  templateCatRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border },
  templateCatText: { flex: 1, fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.text },
  templateItem: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: 9, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: C.border + '60' },
  templateItemTitle: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text },
  templateItemDesc: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1 },

  idPreviewBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: C.surface2, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: C.border },
  idPreviewText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textSub },

  lotAutoFillHint: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 8, backgroundColor: C.primaryBg, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: C.primary + '30' },
  lotAutoFillText: { flex: 1, fontSize: 11, fontFamily: 'Inter_400Regular', color: C.primary, lineHeight: 16 },

  companyRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 10, borderWidth: 1, borderColor: C.border, marginBottom: 6, backgroundColor: C.surface2 },
  companyColorDot: { width: 10, height: 10, borderRadius: 5, flexShrink: 0 },
  companyRowName: { fontSize: 13, fontFamily: 'Inter_500Medium', color: C.text },
  companyRowShort: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 1 },
  companyCheckbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  multiCompanyHint: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, paddingHorizontal: 2 },
  multiCompanyHintText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.primary, flex: 1 },
  warningRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: C.medium + '10', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: C.medium + '30' },
  warningText: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.medium, lineHeight: 18 },

  submitBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: C.primary, borderRadius: 14, paddingVertical: 16, gap: 8 },
  submitBtnObservation: { backgroundColor: '#0EA5E9' },
  submitBtnText: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  sourceCard: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.inProgress + '15', borderRadius: 10, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: C.inProgress + '30' },
  sourceText: { flex: 1, fontSize: 12, fontFamily: 'Inter_500Medium', color: C.inProgress, lineHeight: 16 },
  visiteCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#6366F115', borderRadius: 12, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#6366F130' },
  visiteCardLabel: { fontSize: 10, fontFamily: 'Inter_600SemiBold', color: '#6366F1', textTransform: 'uppercase', letterSpacing: 0.4 },
  visiteCardTitle: { fontSize: 13, fontFamily: 'Inter_500Medium', color: '#6366F1', marginTop: 2 },

  kindRow: { flexDirection: 'row', gap: 10 },
  kindChip: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 11, borderRadius: 12, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.surface2 },
  kindChipReserve: { backgroundColor: '#EF444415', borderColor: '#EF4444' },
  kindChipObservation: { backgroundColor: '#0EA5E915', borderColor: '#0EA5E9' },
  kindChipText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  kindHintBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, backgroundColor: '#0EA5E910', borderRadius: 8, padding: 10, marginTop: 10, borderWidth: 1, borderColor: '#0EA5E930' },
  kindHintText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: '#0EA5E9', lineHeight: 17 },
});
