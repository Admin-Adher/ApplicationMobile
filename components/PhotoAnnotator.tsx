import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, Image,
  Platform, TextInput, ScrollView, Alert,
} from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { C } from '@/constants/colors';
import { PhotoAnnotation } from '@/constants/types';
import { genId } from '@/lib/utils';
import { useNetwork } from '@/context/NetworkContext';

const MARKER_COLORS = [
  { value: '#EF4444' },
  { value: '#F59E0B' },
  { value: '#3B82F6' },
  { value: '#10B981' },
  { value: '#8B5CF6' },
  { value: '#FFFFFF' },
  { value: '#000000' },
];

type AnnotationTool = 'point' | 'text' | 'arrow' | 'rect' | 'measure' | 'pen';
type AnnotationPoint = { x: number; y: number };
type Size = { w: number; h: number };
type Rect = { x: number; y: number; w: number; h: number };

const TOOLS: { key: AnnotationTool; icon: string }[] = [
  { key: 'point', icon: 'ellipse' },
  { key: 'text', icon: 'text' },
  { key: 'arrow', icon: 'arrow-forward' },
  { key: 'rect', icon: 'square-outline' },
  { key: 'measure', icon: 'resize-outline' },
  { key: 'pen', icon: 'pencil' },
];

const STROKE_WIDTHS = [2, 8, 18];

/**
 * Rectangle réellement occupé par l'image dans son conteneur selon le mode
 * d'ajustement (letterbox pour contain, débordement pour cover). Tant que la
 * taille naturelle est inconnue, on retombe sur le conteneur entier.
 */
export function fitRect(container: Size, natural: Size | null, mode: 'contain' | 'cover'): Rect {
  if (!natural || natural.w <= 0 || natural.h <= 0 || container.w <= 0 || container.h <= 0) {
    return { x: 0, y: 0, w: Math.max(1, container.w), h: Math.max(1, container.h) };
  }
  const scale = mode === 'contain'
    ? Math.min(container.w / natural.w, container.h / natural.h)
    : Math.max(container.w / natural.w, container.h / natural.h);
  const w = natural.w * scale;
  const h = natural.h * scale;
  return { x: (container.w - w) / 2, y: (container.h - h) / 2, w, h };
}

export function useNaturalSize(uri: string): Size | null {
  const [size, setSize] = useState<Size | null>(null);
  useEffect(() => {
    let alive = true;
    setSize(null);
    if (!uri) return;
    Image.getSize(
      uri,
      (w, h) => { if (alive && w > 0 && h > 0) setSize({ w, h }); },
      () => {},
    );
    return () => { alive = false; };
  }, [uri]);
  return size;
}

const isImageSpace = (m: PhotoAnnotation) => m.coordSpace === 'image';

/**
 * Traits crayon en polylignes continues (l'ancien rendu en pastilles laissait
 * des trous dès que le geste était rapide). viewBox 0-100 étiré sur le calque,
 * non-scaling-stroke pour une épaisseur uniforme en pixels écran.
 */
function PenStrokesSvg({ strokes, widthScale = 1, minWidth = 2, maxWidth = 18 }: {
  strokes: PhotoAnnotation[];
  widthScale?: number;
  minWidth?: number;
  maxWidth?: number;
}) {
  if (strokes.length === 0) return null;
  return (
    <Svg
      style={StyleSheet.absoluteFill}
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      pointerEvents="none"
    >
      {strokes.map(s => (
        <Polyline
          key={s.id}
          points={(s.points ?? []).map(p => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={s.color}
          strokeWidth={Math.max(minWidth, Math.min(maxWidth, (s.strokeWidth ?? 8) * widthScale))}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </Svg>
  );
}

function getMarkerShape(m: PhotoAnnotation) {
  if (m.tool === 'text') {
    return (
      <View style={[styles.textMarker, { backgroundColor: m.color + 'CC', borderColor: m.color }]}>
        <Text style={[styles.textMarkerLabel, { color: m.color === '#FFFFFF' ? '#000' : '#fff' }]} numberOfLines={2}>{m.label}</Text>
      </View>
    );
  }
  if (m.tool === 'rect') {
    return (
      <View style={[styles.rectMarker, { borderColor: m.color }]}>
        <Text style={[styles.rectMarkerText, { color: m.color }]}>□</Text>
      </View>
    );
  }
  if (m.tool === 'arrow') {
    return (
      <View style={[styles.arrowMarker, { backgroundColor: m.color }]}>
        <Text style={styles.markerText}>↗</Text>
      </View>
    );
  }
  if (m.tool === 'measure') {
    return (
      <View style={[styles.measureMarker, { backgroundColor: m.color + 'DD' }]}>
        <Text style={styles.measureText}>⟷</Text>
      </View>
    );
  }
  return (
    <View style={[styles.marker, { backgroundColor: m.color }]}>
      <Text style={styles.markerText}>{m.label.length <= 2 ? m.label : m.label.slice(0, 2)}</Text>
    </View>
  );
}

interface Props {
  photoUri: string;
  annotations: PhotoAnnotation[];
  editable?: boolean;
  onSave?: (annotations: PhotoAnnotation[]) => void;
  onClose?: () => void;
  visible: boolean;
}

export function PhotoAnnotationOverlay({
  photoUri,
  annotations,
  editable = false,
  onSave,
  onClose,
  visible,
}: Props) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const [markers, setMarkers] = useState<PhotoAnnotation[]>(annotations);
  const [selectedColor, setSelectedColor] = useState(MARKER_COLORS[0].value);
  const [activeTool, setActiveTool] = useState<AnnotationTool>('point');
  const [selectedStrokeWidth, setSelectedStrokeWidth] = useState(8);
  const [currentStroke, setCurrentStroke] = useState<PhotoAnnotation | null>(null);
  const currentStrokeRef = useRef<PhotoAnnotation | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [pendingText, setPendingText] = useState('');
  const [pendingTextPos, setPendingTextPos] = useState<{ x: number; y: number } | null>(null);
  const [containerSize, setContainerSize] = useState<Size>({ w: 300, h: 220 });
  const naturalSize = useNaturalSize(photoUri);
  // Instantané de départ pour détecter un travail non enregistré à la fermeture.
  const initialSnapshotRef = useRef(JSON.stringify(annotations ?? []));
  // Suivi du geste en cours pour distinguer un tap d'un glissement.
  const gestureRef = useRef<{ startX: number; startY: number; moved: boolean } | null>(null);

  const imageRect = fitRect(containerSize, naturalSize, 'contain');

  /**
   * Convertit un événement tactile en % du rectangle réel de l'image (et non
   * du conteneur letterboxé — les bandes noires faussaient toutes les
   * coordonnées). Retourne null tant que la taille naturelle est inconnue.
   */
  function eventToImagePoint(evt: any): { x: number; y: number; inside: boolean } | null {
    if (!naturalSize) return null;
    const { locationX, locationY } = evt.nativeEvent;
    const rawX = ((locationX - imageRect.x) / Math.max(1, imageRect.w)) * 100;
    const rawY = ((locationY - imageRect.y) / Math.max(1, imageRect.h)) * 100;
    return {
      x: Math.max(0.5, Math.min(99.5, rawX)),
      y: Math.max(0.5, Math.min(99.5, rawY)),
      inside: rawX >= -0.5 && rawX <= 100.5 && rawY >= -0.5 && rawY <= 100.5,
    };
  }

  function shouldAppendPoint(points: AnnotationPoint[], point: AnnotationPoint) {
    const last = points[points.length - 1];
    if (!last) return true;
    return Math.hypot(point.x - last.x, point.y - last.y) >= 0.35;
  }

  function handleTouchStart(evt: any) {
    const { locationX, locationY } = evt.nativeEvent;
    gestureRef.current = { startX: locationX, startY: locationY, moved: false };
    if (activeTool !== 'pen') return;
    const point = eventToImagePoint(evt);
    if (!point || !point.inside) return;
    const stroke: PhotoAnnotation = {
      id: genId(),
      x: point.x,
      y: point.y,
      color: selectedColor,
      label: t('photoAnnotator.tools.pen'),
      tool: 'pen',
      points: [{ x: point.x, y: point.y }],
      strokeWidth: selectedStrokeWidth,
      coordSpace: 'image',
    };
    currentStrokeRef.current = stroke;
    setCurrentStroke(stroke);
  }

  function handleTouchMove(evt: any) {
    const g = gestureRef.current;
    if (g) {
      const { locationX, locationY } = evt.nativeEvent;
      if (Math.hypot(locationX - g.startX, locationY - g.startY) > 8) g.moved = true;
    }
    if (activeTool !== 'pen' || !currentStrokeRef.current) return;
    const point = eventToImagePoint(evt);
    if (!point) return;
    setCurrentStroke(prev => {
      if (!prev) return prev;
      const points = prev.points ?? [];
      if (!shouldAppendPoint(points, point)) return prev;
      const next = { ...prev, points: [...points, { x: point.x, y: point.y }] };
      currentStrokeRef.current = next;
      return next;
    });
  }

  function handleTouchEnd(evt: any) {
    const g = gestureRef.current;
    gestureRef.current = null;
    if (activeTool === 'pen') {
      const stroke = currentStrokeRef.current;
      currentStrokeRef.current = null;
      setCurrentStroke(null);
      // Un seul point = pastille (l'ancien code jetait le trait, un tap ne
      // dessinait jamais rien).
      if (stroke) setMarkers(prev => [...prev, stroke]);
      return;
    }
    if (g && !g.moved) handleImageTap(evt);
  }

  function handleImageTap(evt: any) {
    if (!editable) return;
    const point = eventToImagePoint(evt);
    if (!point || !point.inside) return;
    const x = Math.max(2, Math.min(98, point.x));
    const y = Math.max(2, Math.min(98, point.y));

    if (activeTool === 'text') {
      setPendingTextPos({ x, y });
      setPendingText('');
      return;
    }

    const toolToType: Record<AnnotationTool, PhotoAnnotation['tool']> = {
      point: 'dot',
      arrow: 'arrow',
      rect: 'rect',
      measure: 'measure',
      text: 'text',
      pen: 'pen',
    };

    const autoCount = markers.filter(m => m.tool !== 'text' && m.tool !== 'measure' && m.tool !== 'pen').length;
    const newMarker: PhotoAnnotation = {
      id: genId(),
      x,
      y,
      color: selectedColor,
      label: activeTool === 'measure'
        ? t('photoAnnotator.measureLabel', { count: markers.filter(m => m.tool === 'measure').length + 1 })
        : String(autoCount + 1),
      tool: toolToType[activeTool],
      coordSpace: 'image',
    };
    setMarkers(prev => [...prev, newMarker]);
  }

  function confirmTextInput() {
    if (!pendingTextPos || !pendingText.trim()) {
      setPendingTextPos(null);
      return;
    }
    const newMarker: PhotoAnnotation = {
      id: genId(),
      x: pendingTextPos.x,
      y: pendingTextPos.y,
      color: selectedColor,
      label: pendingText.trim(),
      tool: 'text',
      coordSpace: 'image',
    };
    setMarkers(prev => [...prev, newMarker]);
    setPendingTextPos(null);
    setPendingText('');
  }

  // Alert.alert n'affiche rien sur le build web : window.confirm en secours.
  function confirmDestructive(title: string, confirmLabel: string, onConfirm: () => void) {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm(title)) onConfirm();
      return;
    }
    Alert.alert(title, '', [
      { text: t('common.cancel'), style: 'cancel' },
      { text: confirmLabel, style: 'destructive', onPress: onConfirm },
    ]);
  }

  function handleRemoveMarker(id: string) {
    confirmDestructive(t('photoAnnotator.removeAnnotationTitle'), t('common.delete'), () => {
      setMarkers(prev => {
        const remaining = prev.filter(m => m.id !== id);
        // Seuls les labels auto-générés (purement numériques) sont renumérotés :
        // les renommages personnalisés et le label des traits sont préservés.
        let n = 0;
        return remaining.map(m => {
          if (m.tool === 'text' || m.tool === 'measure' || m.tool === 'pen') return m;
          n += 1;
          return /^\d+$/.test(m.label) ? { ...m, label: String(n) } : m;
        });
      });
    });
  }

  function handleClearAll() {
    confirmDestructive(t('photoAnnotator.clearAllTitle'), t('photoAnnotator.clear'), () => {
      setMarkers([]);
      currentStrokeRef.current = null;
      setCurrentStroke(null);
    });
  }

  function handleMarkerPress(m: PhotoAnnotation) {
    if (!editable) return;
    setEditingId(m.id);
    setEditLabel(m.label);
  }

  function saveLabel() {
    setMarkers(prev => prev.map(m => m.id === editingId ? { ...m, label: editLabel.trim() || m.label } : m));
    setEditingId(null);
    setEditLabel('');
  }

  function handleRequestClose() {
    if (!editable) { onClose?.(); return; }
    const dirty = JSON.stringify(markers) !== initialSnapshotRef.current;
    if (!dirty) { onClose?.(); return; }
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined') { onClose?.(); return; }
      if (window.confirm(t('photoAnnotator.unsavedMessage'))) { onSave?.(markers); onClose?.(); }
      else if (window.confirm(t('photoAnnotator.discardConfirm'))) { onClose?.(); }
      return;
    }
    Alert.alert(t('photoAnnotator.unsavedTitle'), t('photoAnnotator.unsavedMessage'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('photoAnnotator.discard'), style: 'destructive', onPress: () => onClose?.() },
      { text: t('photoAnnotator.saveAndClose'), onPress: () => { onSave?.(markers); onClose?.(); } },
    ]);
  }

  const penActive = editable && activeTool === 'pen';

  // Les props responder doivent vivre sur une View : TouchableOpacity les
  // jette (liste blanche du render RN) — c'est ce qui rendait le crayon inerte.
  const responderProps = editable
    ? {
        onStartShouldSetResponder: () => true,
        onMoveShouldSetResponder: () => penActive && !!currentStrokeRef.current,
        onResponderGrant: handleTouchStart,
        onResponderMove: handleTouchMove,
        onResponderRelease: handleTouchEnd,
        onResponderTerminate: handleTouchEnd,
        onResponderTerminationRequest: () => !penActive,
      }
    : {};

  function renderAnnotationSet(list: PhotoAnnotation[], stroke: PhotoAnnotation | null) {
    const pens = stroke ? [...list.filter(m => m.tool === 'pen'), stroke] : list.filter(m => m.tool === 'pen');
    const lines = pens.filter(p => (p.points?.length ?? 0) >= 2);
    const dots = pens.filter(p => (p.points?.length ?? 1) <= 1);
    return (
      <>
        <PenStrokesSvg strokes={lines} />
        {dots.map(m => {
          const p = m.points?.[0] ?? { x: m.x, y: m.y };
          const size = Math.max(3, Math.min(18, m.strokeWidth ?? 8));
          return (
            <View
              key={m.id}
              pointerEvents="none"
              style={[styles.penPoint, {
                left: `${p.x}%` as any,
                top: `${p.y}%` as any,
                width: size,
                height: size,
                borderRadius: size / 2,
                backgroundColor: m.color,
                marginLeft: -size / 2,
                marginTop: -size / 2,
              }]}
            />
          );
        })}
        {/* Crayon actif : les marqueurs ne doivent pas capturer le début des traits. */}
        <View style={StyleSheet.absoluteFill} pointerEvents={penActive ? 'none' : 'box-none'}>
          {list.filter(m => m.tool !== 'pen').map(m => (
            <TouchableOpacity
              key={m.id}
              style={[styles.markerWrap, { left: `${m.x}%` as any, top: `${m.y}%` as any }]}
              onPress={editable ? () => handleMarkerPress(m) : undefined}
              onLongPress={editable ? () => handleRemoveMarker(m.id) : undefined}
            >
              {getMarkerShape(m)}
            </TouchableOpacity>
          ))}
        </View>
      </>
    );
  }

  const imageMarkers = markers.filter(isImageSpace);
  const legacyMarkers = markers.filter(m => !isImageSpace(m));

  return (
    <Modal
      visible={visible}
      animationType="slide"
      // En édition, pas de pageSheet : le swipe de fermeture iOS court-circuite
      // la confirmation et perdait silencieusement le travail en cours.
      presentationStyle={editable ? 'fullScreen' : 'pageSheet'}
      onRequestClose={handleRequestClose}
    >
      <View style={[styles.container, { paddingBottom: insets.bottom }]}>
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity onPress={handleRequestClose} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.title}>
            {editable ? t('photoAnnotator.titleEdit') : t('photoAnnotator.titleView')}
          </Text>
          {editable ? (
            <TouchableOpacity
              style={styles.saveBtn}
              onPress={() => { onSave?.(markers); onClose?.(); }}
            >
              <Text style={styles.saveBtnText}>{t('photoAnnotator.validate')}</Text>
            </TouchableOpacity>
          ) : <View style={{ width: 64 }} />}
        </View>

        {editable && (
          <>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.toolbarRow}
              contentContainerStyle={styles.toolbarRowContent}
            >
              <Text style={styles.toolbarLabel}>{t('photoAnnotator.toolLabel')}</Text>
              {TOOLS.map(tool => (
                <TouchableOpacity
                  key={tool.key}
                  style={[styles.toolBtn, activeTool === tool.key && styles.toolBtnActive]}
                  onPress={() => setActiveTool(tool.key)}
                >
                  <Ionicons name={tool.icon as any} size={16} color={activeTool === tool.key ? '#fff' : C.textSub} />
                  <Text style={[styles.toolBtnLabel, activeTool === tool.key && styles.toolBtnLabelActive]}>
                    {t(`photoAnnotator.tools.${tool.key}`)}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.colorRow}>
              <Text style={styles.toolbarLabel}>{t('photoAnnotator.colorLabel')}</Text>
              {MARKER_COLORS.map(c => (
                <TouchableOpacity
                  key={c.value}
                  style={[
                    styles.colorDot,
                    { backgroundColor: c.value, borderWidth: selectedColor === c.value ? 3 : 1, borderColor: selectedColor === c.value ? C.primary : (c.value === '#FFFFFF' ? C.border : 'transparent') },
                  ]}
                  onPress={() => setSelectedColor(c.value)}
                />
              ))}
              <View style={{ flex: 1 }} />
              {markers.length > 0 && (
                <TouchableOpacity onPress={handleClearAll} style={styles.clearBtn}>
                  <Ionicons name="trash-outline" size={16} color={C.open} />
                </TouchableOpacity>
              )}
            </View>

            {activeTool === 'pen' && (
              <View style={styles.strokeRow}>
                <Text style={styles.toolbarLabel}>{t('photoAnnotator.strokeLabel')}</Text>
                {STROKE_WIDTHS.map(size => (
                  <TouchableOpacity
                    key={size}
                    style={[styles.strokeBtn, selectedStrokeWidth === size && styles.strokeBtnActive]}
                    onPress={() => setSelectedStrokeWidth(size)}
                  >
                    <View style={[styles.strokePreview, { height: size, backgroundColor: selectedColor }]} />
                    <Text style={[styles.strokeBtnText, selectedStrokeWidth === size && styles.strokeBtnTextActive]}>{size}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </>
        )}

        <View style={styles.imageWrap}>
          <View
            style={styles.imageTouchable}
            onLayout={e => setContainerSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
            {...responderProps}
          >
            <Image
              source={{ uri: photoUri }}
              // pointerEvents en style : l'image ne doit jamais être la cible
              // du toucher pour que locationX/Y restent relatifs au conteneur.
              style={[styles.image, { pointerEvents: 'none' } as any]}
              resizeMode="contain"
            />
            {/* Calque legacy : annotations historiques en % du conteneur, rendues
                telles quelles pour ne pas déplacer les données existantes. */}
            <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
              {renderAnnotationSet(legacyMarkers, null)}
            </View>
            {/* Calque image : annotations coordSpace 'image', calées sur le
                rectangle réellement affiché de la photo (hors bandes noires). */}
            <View
              style={{ position: 'absolute', left: imageRect.x, top: imageRect.y, width: imageRect.w, height: imageRect.h }}
              pointerEvents="box-none"
            >
              {renderAnnotationSet(imageMarkers, currentStroke)}
            </View>
          </View>
        </View>

        {editable && (
          <View style={styles.hint}>
            <Ionicons name="information-circle-outline" size={14} color={C.textMuted} />
            <Text style={styles.hintText}>
              {t('photoAnnotator.hint')}
            </Text>
          </View>
        )}

        {markers.length > 0 && (
          <ScrollView style={styles.legend} showsVerticalScrollIndicator={false}>
            {markers.map(m => (
              <View key={m.id} style={styles.legendRow}>
                <View style={[styles.legendDot, { backgroundColor: m.color }]}>
                  <Text style={styles.legendDotText}>
                    {m.tool === 'text' ? 'T' : m.tool === 'arrow' ? '↗' : m.tool === 'rect' ? '□' : m.tool === 'measure' ? '⟷' : m.label.length <= 2 ? m.label : m.label.slice(0, 2)}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.legendLabelText}>{m.label}</Text>
                  {m.tool && m.tool !== 'dot' && (
                    <Text style={styles.legendToolText}>
                      {m.tool === 'text'
                        ? t('photoAnnotator.textAnnotation')
                        : m.tool === 'arrow'
                          ? t('photoAnnotator.arrow')
                          : m.tool === 'rect'
                            ? t('photoAnnotator.boundedArea')
                            : m.tool === 'measure'
                              ? t('photoAnnotator.measure')
                              : t('photoAnnotator.tools.pen')}
                    </Text>
                  )}
                </View>
              </View>
            ))}
          </ScrollView>
        )}

        {editingId && (
          <Modal visible transparent animationType="fade">
            <TouchableOpacity style={styles.editOverlay} activeOpacity={1} onPress={() => setEditingId(null)}>
              <View style={styles.editModal}>
                <Text style={styles.editTitle}>{t('photoAnnotator.editAnnotation')}</Text>
                <TextInput
                  style={styles.editInput}
                  value={editLabel}
                  onChangeText={setEditLabel}
                  autoFocus
                  placeholder={t('photoAnnotator.annotationTextPlaceholder')}
                  placeholderTextColor={C.textMuted}
                  onSubmitEditing={saveLabel}
                  multiline
                />
                <View style={styles.editActions}>
                  <TouchableOpacity style={styles.editCancel} onPress={() => setEditingId(null)}>
                    <Text style={styles.editCancelText}>{t('common.cancel')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.editConfirm} onPress={saveLabel}>
                    <Text style={styles.editConfirmText}>OK</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableOpacity>
          </Modal>
        )}

        {pendingTextPos && (
          <Modal visible transparent animationType="fade">
            <TouchableOpacity style={styles.editOverlay} activeOpacity={1} onPress={() => setPendingTextPos(null)}>
              <View style={styles.editModal}>
                <Text style={styles.editTitle}>{t('photoAnnotator.addTextAnnotation')}</Text>
                <TextInput
                  style={styles.editInput}
                  value={pendingText}
                  onChangeText={setPendingText}
                  autoFocus
                  placeholder={t('photoAnnotator.addTextPlaceholder')}
                  placeholderTextColor={C.textMuted}
                  multiline
                  onSubmitEditing={confirmTextInput}
                />
                <View style={styles.editActions}>
                  <TouchableOpacity style={styles.editCancel} onPress={() => setPendingTextPos(null)}>
                    <Text style={styles.editCancelText}>{t('common.cancel')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.editConfirm} onPress={confirmTextInput}>
                    <Text style={styles.editConfirmText}>{t('locationTreeEditor.add')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </TouchableOpacity>
          </Modal>
        )}
      </View>
    </Modal>
  );
}

export function PhotoWithAnnotations({
  uri,
  annotations,
  style,
  onPress,
  resizeMode = 'cover',
  variant = 'thumb',
  showBadge = true,
}: {
  uri: string;
  annotations: PhotoAnnotation[];
  style?: any;
  onPress?: () => void;
  resizeMode?: 'cover' | 'contain';
  variant?: 'thumb' | 'viewer';
  showBadge?: boolean;
}) {
  const [containerSize, setContainerSize] = useState<Size>({ w: 0, h: 0 });
  const natural = useNaturalSize(uri);
  const imageRect = fitRect(containerSize, natural, resizeMode);
  const viewer = variant === 'viewer';
  const { isOnline } = useNetwork();

  // Échec de chargement (fichier local purgé/perdu, URL distante injoignable
  // hors connexion…) : sans état d'erreur, RN <Image> ne peint rien et la
  // vignette devient un rectangle blanc muet surmonté des badges — le bug
  // « photos toutes blanches ». On affiche un placeholder identifiable à la
  // place, et on retente le chargement quand la connexion revient.
  const [loadFailed, setLoadFailed] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  useEffect(() => { setLoadFailed(false); }, [uri]);
  useEffect(() => {
    if (isOnline && loadFailed) {
      setLoadFailed(false);
      setRetryToken(n => n + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOnline]);

  function renderSet(list: PhotoAnnotation[]) {
    const pens = list.filter(m => m.tool === 'pen');
    const lines = pens.filter(p => (p.points?.length ?? 0) >= 2);
    const dots = pens.filter(p => (p.points?.length ?? 1) <= 1);
    const widthScale = viewer ? 1 : 0.45;
    return (
      <>
        <PenStrokesSvg strokes={lines} widthScale={widthScale} minWidth={viewer ? 2 : 1.5} maxWidth={viewer ? 18 : 8} />
        {dots.map(m => {
          const p = m.points?.[0] ?? { x: m.x, y: m.y };
          const size = Math.max(viewer ? 3 : 2, Math.min(viewer ? 18 : 8, (m.strokeWidth ?? 8) * widthScale));
          return (
            <View
              key={m.id}
              style={[styles.penPoint, !viewer && styles.thumbPenPoint, {
                left: `${p.x}%` as any,
                top: `${p.y}%` as any,
                width: size,
                height: size,
                borderRadius: size / 2,
                backgroundColor: m.color,
                marginLeft: -size / 2,
                marginTop: -size / 2,
              }]}
            />
          );
        })}
        {list.filter(m => m.tool !== 'pen').map(m => viewer ? (
          <View key={m.id} style={[styles.markerWrap, { left: `${m.x}%` as any, top: `${m.y}%` as any }]}>
            {getMarkerShape(m)}
          </View>
        ) : (
          <View
            key={m.id}
            style={[
              styles.thumbMarker,
              {
                left: `${m.x}%` as any,
                top: `${m.y}%` as any,
                backgroundColor: m.tool === 'rect' ? 'transparent' : m.color,
                borderColor: m.color,
                borderWidth: m.tool === 'rect' ? 2 : 1.5,
              },
            ]}
          >
            <Text style={styles.thumbMarkerText}>
              {m.tool === 'text' ? 'T' : m.tool === 'arrow' ? '↗' : m.tool === 'rect' ? '□' : m.tool === 'measure' ? '⟷' : m.label.slice(0, 2)}
            </Text>
          </View>
        ))}
      </>
    );
  }

  const imageSpace = annotations.filter(isImageSpace);
  const legacy = annotations.filter(m => !isImageSpace(m));

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={onPress ? 0.85 : 1}
      disabled={!onPress}
      style={[{ position: 'relative', overflow: 'hidden' }, style]}
      onLayout={e => setContainerSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
    >
      <Image
        key={`${uri}#${retryToken}`}
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        resizeMode={resizeMode}
        onError={() => setLoadFailed(true)}
        onLoad={() => setLoadFailed(false)}
      />
      {loadFailed && (
        <View style={styles.imageFallback} pointerEvents="none">
          <Ionicons name="image-outline" size={viewer ? 42 : 20} color="#9CA3AF" />
          {!isOnline && (
            <Ionicons name="cloud-offline-outline" size={viewer ? 20 : 12} color="#9CA3AF" />
          )}
        </View>
      )}
      {!loadFailed && (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
          {renderSet(legacy)}
        </View>
      )}
      {!loadFailed && (
        <View
          style={{ position: 'absolute', left: imageRect.x, top: imageRect.y, width: imageRect.w, height: imageRect.h }}
          pointerEvents="none"
        >
          {renderSet(imageSpace)}
        </View>
      )}
      {showBadge && annotations.length > 0 && (
        <View style={styles.thumbBadge}>
          <Ionicons name="pencil" size={9} color="#fff" />
          <Text style={styles.thumbBadgeText}>{annotations.length}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: Platform.OS === 'ios' ? 20 : 16, paddingBottom: 12,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  closeBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontFamily: 'Inter_600SemiBold', color: C.text },
  saveBtn: { backgroundColor: C.primary, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10 },
  saveBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  toolbarRow: {
    borderBottomWidth: 1, borderBottomColor: C.border,
    backgroundColor: C.surface2,
  },
  toolbarRowContent: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  toolbarLabel: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.textMuted, marginRight: 2 },
  toolBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10,
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
  toolBtnActive: { backgroundColor: C.primary, borderColor: C.primary },
  toolBtnLabel: { fontSize: 11, fontFamily: 'Inter_500Medium', color: C.textSub },
  toolBtnLabelActive: { color: '#fff' },

  colorRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border,
  },
  colorDot: { width: 26, height: 26, borderRadius: 13 },
  clearBtn: { width: 32, height: 32, borderRadius: 8, backgroundColor: C.open + '18', alignItems: 'center', justifyContent: 'center' },
  strokeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: C.border,
    backgroundColor: C.surface,
  },
  strokeBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10,
    backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border,
  },
  strokeBtnActive: { borderColor: C.primary, backgroundColor: C.primary + '12' },
  strokePreview: { width: 30, borderRadius: 999 },
  strokeBtnText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  strokeBtnTextActive: { color: C.primary },

  imageWrap: { flex: 1, backgroundColor: '#000', margin: 12, borderRadius: 12, overflow: 'hidden' },
  imageTouchable: { flex: 1, position: 'relative' },
  image: { width: '100%', height: '100%' },
  penPoint: { position: 'absolute', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)' },
  thumbPenPoint: { borderWidth: 0 },

  markerWrap: {
    position: 'absolute',
    transform: [{ translateX: -14 }, { translateY: -14 }],
  },
  marker: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#fff',
    ...Platform.select({
      web: { boxShadow: '0 2px 8px rgba(0,0,0,0.4)' } as any,
      default: { shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
    }),
  },
  markerText: { fontSize: 11, fontFamily: 'Inter_700Bold', color: '#fff' },
  textMarker: {
    borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4,
    maxWidth: 120, borderWidth: 1.5,
    ...Platform.select({
      web: { boxShadow: '0 2px 8px rgba(0,0,0,0.4)' } as any,
      default: { shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
    }),
  },
  textMarkerLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', lineHeight: 16 },
  rectMarker: {
    width: 40, height: 30, borderRadius: 4,
    alignItems: 'center', justifyContent: 'center', borderWidth: 2.5,
  },
  rectMarkerText: { fontSize: 18, fontFamily: 'Inter_700Bold' },
  arrowMarker: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 2, borderColor: '#fff',
    ...Platform.select({
      web: { boxShadow: '0 2px 8px rgba(0,0,0,0.4)' } as any,
      default: { shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 4, elevation: 4 },
    }),
  },
  measureMarker: {
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4,
    alignItems: 'center',
    ...Platform.select({
      web: { boxShadow: '0 2px 8px rgba(0,0,0,0.3)' } as any,
      default: { shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 3, elevation: 3 },
    }),
  },
  measureText: { fontSize: 14, color: '#fff', fontFamily: 'Inter_700Bold' },

  hint: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, paddingHorizontal: 16, paddingVertical: 8 },
  hintText: { flex: 1, fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, lineHeight: 16 },

  legend: { maxHeight: 130, paddingHorizontal: 16, paddingBottom: 8 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  legendDot: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  legendDotText: { fontSize: 10, fontFamily: 'Inter_700Bold', color: '#fff' },
  legendLabelText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text },
  legendToolText: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textMuted },

  editOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  editModal: { backgroundColor: C.surface, borderRadius: 16, padding: 20, width: '88%', maxWidth: 360, gap: 14 },
  editTitle: { fontSize: 15, fontFamily: 'Inter_600SemiBold', color: C.text, textAlign: 'center' },
  editInput: {
    backgroundColor: C.surface2, borderRadius: 10, padding: 12, fontSize: 14,
    fontFamily: 'Inter_400Regular', color: C.text, borderWidth: 1, borderColor: C.border, minHeight: 60, textAlignVertical: 'top',
  },
  editActions: { flexDirection: 'row', gap: 10 },
  editCancel: { flex: 1, padding: 12, borderRadius: 10, backgroundColor: C.surface2, alignItems: 'center' },
  editCancelText: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.textSub },
  editConfirm: { flex: 1, padding: 12, borderRadius: 10, backgroundColor: C.primary, alignItems: 'center' },
  editConfirmText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },

  thumbMarker: {
    position: 'absolute', width: 18, height: 18, borderRadius: 9,
    alignItems: 'center', justifyContent: 'center', marginLeft: -9, marginTop: -9,
  },
  thumbMarkerText: { fontSize: 8, fontFamily: 'Inter_700Bold', color: '#fff' },
  thumbBadge: {
    position: 'absolute', bottom: 4, right: 4, backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 8, paddingHorizontal: 5, paddingVertical: 2,
    flexDirection: 'row', alignItems: 'center', gap: 3,
  },
  thumbBadgeText: { fontSize: 9, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  imageFallback: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: C.surface2,
    gap: 2,
  },
});
