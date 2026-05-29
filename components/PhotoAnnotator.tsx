import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, Image,
  Platform, TextInput, ScrollView, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { C } from '@/constants/colors';
import { PhotoAnnotation } from '@/constants/types';
import { genId } from '@/lib/utils';

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

const TOOLS: { key: AnnotationTool; icon: string }[] = [
  { key: 'point', icon: 'ellipse' },
  { key: 'text', icon: 'text' },
  { key: 'arrow', icon: 'arrow-forward' },
  { key: 'rect', icon: 'square-outline' },
  { key: 'measure', icon: 'resize-outline' },
  { key: 'pen', icon: 'pencil' },
];

const STROKE_WIDTHS = [3, 6, 10];

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
  const [selectedStrokeWidth, setSelectedStrokeWidth] = useState(6);
  const [currentStroke, setCurrentStroke] = useState<PhotoAnnotation | null>(null);
  const currentStrokeRef = useRef<PhotoAnnotation | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [pendingText, setPendingText] = useState('');
  const [pendingTextPos, setPendingTextPos] = useState<{ x: number; y: number } | null>(null);
  const containerRef = useRef<View>(null);
  const [containerSize, setContainerSize] = useState({ w: 300, h: 220 });

  function eventToPoint(evt: any): AnnotationPoint {
    const { locationX, locationY } = evt.nativeEvent;
    const xPct = (locationX / Math.max(1, containerSize.w)) * 100;
    const yPct = (locationY / Math.max(1, containerSize.h)) * 100;
    return {
      x: Math.max(1, Math.min(99, xPct)),
      y: Math.max(1, Math.min(99, yPct)),
    };
  }

  function shouldAppendPoint(points: AnnotationPoint[], point: AnnotationPoint) {
    const last = points[points.length - 1];
    if (!last) return true;
    return Math.hypot(point.x - last.x, point.y - last.y) >= 0.35;
  }

  function handlePenStart(evt: any) {
    if (!editable || activeTool !== 'pen') return;
    const point = eventToPoint(evt);
    const stroke: PhotoAnnotation = {
      id: genId(),
      x: point.x,
      y: point.y,
      color: selectedColor,
      label: t('photoAnnotator.tools.pen'),
      tool: 'pen',
      points: [point],
      strokeWidth: selectedStrokeWidth,
    };
    currentStrokeRef.current = stroke;
    setCurrentStroke(stroke);
  }

  function handlePenMove(evt: any) {
    if (!editable || activeTool !== 'pen') return;
    const point = eventToPoint(evt);
    setCurrentStroke(prev => {
      if (!prev) return prev;
      const points = prev.points ?? [];
      if (!shouldAppendPoint(points, point)) return prev;
      const next = { ...prev, points: [...points, point] };
      currentStrokeRef.current = next;
      return next;
    });
  }

  function handlePenEnd() {
    const stroke = currentStrokeRef.current;
    if (!stroke) return;
    if ((stroke.points?.length ?? 0) > 1) {
      setMarkers(prev => [...prev, stroke]);
    }
    currentStrokeRef.current = null;
    setCurrentStroke(null);
  }

  function handleImageTap(evt: any) {
    if (!editable) return;
    if (activeTool === 'pen') return;
    const point = eventToPoint(evt);
    const xPct = point.x;
    const yPct = point.y;
    const x = Math.max(2, Math.min(98, xPct));
    const y = Math.max(2, Math.min(98, yPct));

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

    const newMarker: PhotoAnnotation = {
      id: genId(),
      x,
      y,
      color: selectedColor,
      label: activeTool === 'measure'
        ? t('photoAnnotator.measureLabel', { count: markers.filter(m => m.tool === 'measure').length + 1 })
        : String(markers.length + 1),
      tool: toolToType[activeTool],
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
    };
    setMarkers(prev => [...prev, newMarker]);
    setPendingTextPos(null);
    setPendingText('');
  }

  function handleRemoveMarker(id: string) {
    Alert.alert(t('photoAnnotator.removeAnnotationTitle'), '', [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => {
        setMarkers(prev => prev.filter(m => m.id !== id).map((m, i) => ({ ...m, label: m.tool === 'text' || m.tool === 'measure' ? m.label : String(i + 1) })));
      }},
    ]);
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

  function getMarkerIcon(tool?: PhotoAnnotation['tool']): string {
    switch (tool) {
      case 'arrow': return '↗';
      case 'rect': return '□';
      case 'measure': return '↔';
      case 'text': return 'T';
      default: return '';
    }
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

  const penResponderProps: any = editable && activeTool === 'pen'
    ? {
        onStartShouldSetResponder: () => true,
        onMoveShouldSetResponder: () => true,
        onResponderGrant: handlePenStart,
        onResponderMove: handlePenMove,
        onResponderRelease: handlePenEnd,
        onResponderTerminate: handlePenEnd,
      }
    : {};

  function renderPenStroke(m: PhotoAnnotation, thumbnail = false) {
    const points = m.points?.length ? m.points : [{ x: m.x, y: m.y }];
    const dotSize = Math.max(thumbnail ? 2 : 3, Math.min(thumbnail ? 6 : 14, (m.strokeWidth ?? 6) * (thumbnail ? 0.45 : 1)));
    return (
      <View key={m.id} style={StyleSheet.absoluteFill} pointerEvents="none">
        {points.map((point, index) => (
          <View
            key={`${m.id}-${index}`}
            style={[
              styles.penPoint,
              thumbnail && styles.thumbPenPoint,
              {
                left: `${point.x}%` as any,
                top: `${point.y}%` as any,
                width: dotSize,
                height: dotSize,
                borderRadius: dotSize / 2,
                backgroundColor: m.color,
                marginLeft: -dotSize / 2,
                marginTop: -dotSize / 2,
              },
            ]}
          />
        ))}
      </View>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={[styles.container, { paddingBottom: insets.bottom }]}>
        <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
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
                <TouchableOpacity onPress={() => {
                  Alert.alert(t('photoAnnotator.clearAllTitle'), '', [
                    { text: t('common.cancel'), style: 'cancel' },
                    { text: t('photoAnnotator.clear'), style: 'destructive', onPress: () => { setMarkers([]); currentStrokeRef.current = null; setCurrentStroke(null); } },
                  ]);
                }} style={styles.clearBtn}>
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
          <TouchableOpacity
            activeOpacity={editable ? 0.95 : 1}
            onPress={editable ? handleImageTap : undefined}
            style={styles.imageTouchable}
            onLayout={e => setContainerSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
            {...penResponderProps}
          >
            <Image
              source={{ uri: photoUri }}
              style={styles.image}
              resizeMode="contain"
            />
            {[...markers, ...(currentStroke ? [currentStroke] : [])]
              .filter(m => m.tool === 'pen')
              .map(m => renderPenStroke(m))}
            {markers.filter(m => m.tool !== 'pen').map(m => (
              <TouchableOpacity
                key={m.id}
                style={[
                  styles.markerWrap,
                  {
                    left: `${m.x}%` as any,
                    top: `${m.y}%` as any,
                  },
                ]}
                onPress={editable ? (e => { e.stopPropagation(); handleMarkerPress(m); }) : undefined}
                onLongPress={editable ? () => handleRemoveMarker(m.id) : undefined}
              >
                {getMarkerShape(m)}
              </TouchableOpacity>
            ))}
          </TouchableOpacity>
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
}: {
  uri: string;
  annotations: PhotoAnnotation[];
  style?: any;
  onPress?: () => void;
}) {
  function renderThumbnailPenStroke(m: PhotoAnnotation) {
    const points = m.points?.length ? m.points : [{ x: m.x, y: m.y }];
    const dotSize = Math.max(2, Math.min(6, (m.strokeWidth ?? 6) * 0.45));
    return (
      <View key={m.id} style={StyleSheet.absoluteFill} pointerEvents="none">
        {points.map((point, index) => (
          <View
            key={`${m.id}-${index}`}
            style={[
              styles.penPoint,
              styles.thumbPenPoint,
              {
                left: `${point.x}%` as any,
                top: `${point.y}%` as any,
                width: dotSize,
                height: dotSize,
                borderRadius: dotSize / 2,
                backgroundColor: m.color,
                marginLeft: -dotSize / 2,
                marginTop: -dotSize / 2,
              },
            ]}
          />
        ))}
      </View>
    );
  }

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={onPress ? 0.85 : 1}
      style={[{ position: 'relative', overflow: 'hidden' }, style]}
    >
      <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      {annotations.filter(m => m.tool === 'pen').map(renderThumbnailPenStroke)}
      {annotations.filter(m => m.tool !== 'pen').map(m => (
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
      {annotations.length > 0 && (
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
});
