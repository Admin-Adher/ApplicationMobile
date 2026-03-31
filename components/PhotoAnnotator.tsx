import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, Image,
  Platform, TextInput, ScrollView, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/constants/colors';
import { PhotoAnnotation } from '@/constants/types';
import { genId } from '@/lib/utils';

const MARKER_COLORS = [
  { value: '#EF4444', label: 'Rouge' },
  { value: '#F59E0B', label: 'Orange' },
  { value: '#3B82F6', label: 'Bleu' },
  { value: '#10B981', label: 'Vert' },
  { value: '#8B5CF6', label: 'Violet' },
  { value: '#FFFFFF', label: 'Blanc' },
  { value: '#000000', label: 'Noir' },
];

type AnnotationTool = 'point' | 'text' | 'arrow' | 'rect' | 'measure';

const TOOLS: { key: AnnotationTool; icon: string; label: string }[] = [
  { key: 'point', icon: 'ellipse', label: 'Point' },
  { key: 'text', icon: 'text', label: 'Texte' },
  { key: 'arrow', icon: 'arrow-forward', label: 'Flèche' },
  { key: 'rect', icon: 'square-outline', label: 'Zone' },
  { key: 'measure', icon: 'resize-outline', label: 'Mesure' },
];

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
  const [markers, setMarkers] = useState<PhotoAnnotation[]>(annotations);
  const [selectedColor, setSelectedColor] = useState(MARKER_COLORS[0].value);
  const [activeTool, setActiveTool] = useState<AnnotationTool>('point');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [pendingText, setPendingText] = useState('');
  const [pendingTextPos, setPendingTextPos] = useState<{ x: number; y: number } | null>(null);
  const containerRef = useRef<View>(null);
  const [containerSize, setContainerSize] = useState({ w: 300, h: 220 });

  function handleImageTap(evt: any) {
    if (!editable) return;
    const { locationX, locationY } = evt.nativeEvent;
    const xPct = (locationX / containerSize.w) * 100;
    const yPct = (locationY / containerSize.h) * 100;
    const x = Math.max(2, Math.min(98, xPct));
    const y = Math.max(2, Math.min(98, yPct));

    if (activeTool === 'text') {
      setPendingTextPos({ x, y });
      setPendingText('');
      return;
    }

    const toolToType: Record<AnnotationTool, PhotoAnnotation['tool']> = {
      point: 'point',
      arrow: 'arrow',
      rect: 'rect',
      measure: 'measure',
      text: 'text',
    };

    const newMarker: PhotoAnnotation = {
      id: genId(),
      x,
      y,
      color: selectedColor,
      label: activeTool === 'measure' ? `Mesure ${markers.filter(m => m.tool === 'measure').length + 1}` : String(markers.length + 1),
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
    Alert.alert('Supprimer l\'annotation ?', '', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => {
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

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
            <Ionicons name="close" size={22} color={C.text} />
          </TouchableOpacity>
          <Text style={styles.title}>
            {editable ? 'Annoter la photo' : 'Annotations'}
          </Text>
          {editable ? (
            <TouchableOpacity
              style={styles.saveBtn}
              onPress={() => { onSave?.(markers); onClose?.(); }}
            >
              <Text style={styles.saveBtnText}>Valider</Text>
            </TouchableOpacity>
          ) : <View style={{ width: 64 }} />}
        </View>

        {editable && (
          <>
            <View style={styles.toolbarRow}>
              <Text style={styles.toolbarLabel}>Outil :</Text>
              {TOOLS.map(t => (
                <TouchableOpacity
                  key={t.key}
                  style={[styles.toolBtn, activeTool === t.key && styles.toolBtnActive]}
                  onPress={() => setActiveTool(t.key)}
                >
                  <Ionicons name={t.icon as any} size={16} color={activeTool === t.key ? '#fff' : C.textSub} />
                  <Text style={[styles.toolBtnLabel, activeTool === t.key && styles.toolBtnLabelActive]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.colorRow}>
              <Text style={styles.toolbarLabel}>Couleur :</Text>
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
                  Alert.alert('Effacer tout ?', '', [
                    { text: 'Annuler', style: 'cancel' },
                    { text: 'Effacer', style: 'destructive', onPress: () => setMarkers([]) },
                  ]);
                }} style={styles.clearBtn}>
                  <Ionicons name="trash-outline" size={16} color={C.open} />
                </TouchableOpacity>
              )}
            </View>
          </>
        )}

        <View style={styles.imageWrap}>
          <TouchableOpacity
            activeOpacity={editable ? 0.95 : 1}
            onPress={editable ? handleImageTap : undefined}
            style={styles.imageTouchable}
            onLayout={e => setContainerSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
          >
            <Image
              source={{ uri: photoUri }}
              style={styles.image}
              resizeMode="contain"
            />
            {markers.map(m => (
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
              Appui sur la photo pour annoter · Appui court sur marqueur pour renommer · Appui long pour supprimer
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
                  {m.tool && m.tool !== 'point' && (
                    <Text style={styles.legendToolText}>
                      {m.tool === 'text' ? 'Annotation texte' : m.tool === 'arrow' ? 'Flèche' : m.tool === 'rect' ? 'Zone délimitée' : 'Mesure'}
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
                <Text style={styles.editTitle}>Modifier l'annotation</Text>
                <TextInput
                  style={styles.editInput}
                  value={editLabel}
                  onChangeText={setEditLabel}
                  autoFocus
                  placeholder="Texte de l'annotation"
                  placeholderTextColor={C.textMuted}
                  onSubmitEditing={saveLabel}
                  multiline
                />
                <View style={styles.editActions}>
                  <TouchableOpacity style={styles.editCancel} onPress={() => setEditingId(null)}>
                    <Text style={styles.editCancelText}>Annuler</Text>
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
                <Text style={styles.editTitle}>Ajouter une annotation texte</Text>
                <TextInput
                  style={styles.editInput}
                  value={pendingText}
                  onChangeText={setPendingText}
                  autoFocus
                  placeholder="Ex: Fissure horizontale, Défaut peinture..."
                  placeholderTextColor={C.textMuted}
                  multiline
                  onSubmitEditing={confirmTextInput}
                />
                <View style={styles.editActions}>
                  <TouchableOpacity style={styles.editCancel} onPress={() => setPendingTextPos(null)}>
                    <Text style={styles.editCancelText}>Annuler</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.editConfirm} onPress={confirmTextInput}>
                    <Text style={styles.editConfirmText}>Ajouter</Text>
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
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={onPress ? 0.85 : 1}
      style={[{ position: 'relative', overflow: 'hidden' }, style]}
    >
      <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
      {annotations.map(m => (
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
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: C.border,
    backgroundColor: C.surface2,
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

  imageWrap: { flex: 1, backgroundColor: '#000', margin: 12, borderRadius: 12, overflow: 'hidden' },
  imageTouchable: { flex: 1, position: 'relative' },
  image: { width: '100%', height: '100%' },

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
  editModal: { backgroundColor: C.surface, borderRadius: 16, padding: 20, width: 300, gap: 14 },
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
