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
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const containerRef = useRef<View>(null);
  const [containerSize, setContainerSize] = useState({ w: 300, h: 220 });

  function handleImageTap(evt: any) {
    if (!editable) return;
    const { locationX, locationY } = evt.nativeEvent;
    const xPct = (locationX / containerSize.w) * 100;
    const yPct = (locationY / containerSize.h) * 100;
    const newMarker: PhotoAnnotation = {
      id: genId(),
      x: Math.max(2, Math.min(98, xPct)),
      y: Math.max(2, Math.min(98, yPct)),
      color: selectedColor,
      label: String(markers.length + 1),
    };
    setMarkers(prev => [...prev, newMarker]);
  }

  function handleRemoveMarker(id: string) {
    Alert.alert('Supprimer le marqueur ?', '', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => {
        setMarkers(prev => prev.filter(m => m.id !== id).map((m, i) => ({ ...m, label: String(i + 1) })));
      }},
    ]);
  }

  function handleMarkerLongPress(m: PhotoAnnotation) {
    if (!editable) return;
    setEditingId(m.id);
    setEditLabel(m.label);
  }

  function saveLabel() {
    setMarkers(prev => prev.map(m => m.id === editingId ? { ...m, label: editLabel.trim() || m.label } : m));
    setEditingId(null);
    setEditLabel('');
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
          <View style={styles.toolbar}>
            <Text style={styles.toolbarLabel}>Couleur :</Text>
            {MARKER_COLORS.map(c => (
              <TouchableOpacity
                key={c.value}
                style={[styles.colorDot, { backgroundColor: c.value, borderWidth: selectedColor === c.value ? 3 : 1, borderColor: selectedColor === c.value ? '#fff' : 'transparent' }]}
                onPress={() => setSelectedColor(c.value)}
              />
            ))}
            <View style={styles.toolbarSep} />
            {editable && markers.length > 0 && (
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
                  styles.marker,
                  {
                    left: `${m.x}%` as any,
                    top: `${m.y}%` as any,
                    backgroundColor: m.color,
                  },
                ]}
                onPress={editable ? (e => { e.stopPropagation(); handleMarkerLongPress(m); }) : undefined}
                onLongPress={editable ? () => handleRemoveMarker(m.id) : undefined}
              >
                <Text style={styles.markerText}>{m.label}</Text>
              </TouchableOpacity>
            ))}
          </TouchableOpacity>
        </View>

        {editable && (
          <View style={styles.hint}>
            <Ionicons name="information-circle-outline" size={14} color={C.textMuted} />
            <Text style={styles.hintText}>
              Appuyez sur la photo pour ajouter un marqueur · Appui long pour supprimer · Appui court sur le marqueur pour renommer
            </Text>
          </View>
        )}

        {markers.length > 0 && (
          <ScrollView style={styles.legend} showsVerticalScrollIndicator={false}>
            {markers.map(m => (
              <View key={m.id} style={styles.legendRow}>
                <View style={[styles.legendDot, { backgroundColor: m.color }]}>
                  <Text style={styles.legendDotText}>{m.label.length <= 2 ? m.label : m.label.slice(0, 2)}</Text>
                </View>
                <Text style={styles.legendLabelText}>{m.label}</Text>
              </View>
            ))}
          </ScrollView>
        )}

        {editingId && (
          <Modal visible transparent animationType="fade">
            <TouchableOpacity style={styles.editOverlay} activeOpacity={1} onPress={() => setEditingId(null)}>
              <View style={styles.editModal}>
                <Text style={styles.editTitle}>Renommer le marqueur</Text>
                <TextInput
                  style={styles.editInput}
                  value={editLabel}
                  onChangeText={setEditLabel}
                  autoFocus
                  placeholder="Label du marqueur"
                  placeholderTextColor={C.textMuted}
                  onSubmitEditing={saveLabel}
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
              backgroundColor: m.color,
            },
          ]}
        >
          <Text style={styles.thumbMarkerText}>{m.label.slice(0, 2)}</Text>
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
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: Platform.OS === 'ios' ? 20 : 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.surface2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    color: C.text,
  },
  saveBtn: {
    backgroundColor: C.primary,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
  },
  saveBtnText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  toolbarLabel: {
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    color: C.textSub,
    marginRight: 4,
  },
  colorDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
  },
  toolbarSep: {
    flex: 1,
  },
  clearBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: C.open + '18',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageWrap: {
    flex: 1,
    backgroundColor: '#000',
    margin: 12,
    borderRadius: 12,
    overflow: 'hidden',
  },
  imageTouchable: {
    flex: 1,
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
  },
  marker: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -14,
    marginTop: -14,
    borderWidth: 2,
    borderColor: '#fff',
    ...Platform.select({
      web: { boxShadow: '0 2px 8px rgba(0,0,0,0.4)' } as any,
      default: { shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
    }),
  },
  markerText: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
    color: '#fff',
  },
  hint: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  hintText: {
    flex: 1,
    fontSize: 11,
    fontFamily: 'Inter_400Regular',
    color: C.textMuted,
    lineHeight: 16,
  },
  legend: {
    maxHeight: 120,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 3,
  },
  legendDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  legendDotText: {
    fontSize: 10,
    fontFamily: 'Inter_700Bold',
    color: '#fff',
  },
  legendLabelText: {
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    color: C.textSub,
  },
  editOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  editModal: {
    backgroundColor: C.surface,
    borderRadius: 16,
    padding: 20,
    width: 280,
    gap: 14,
  },
  editTitle: {
    fontSize: 15,
    fontFamily: 'Inter_600SemiBold',
    color: C.text,
    textAlign: 'center',
  },
  editInput: {
    backgroundColor: C.surface2,
    borderRadius: 10,
    padding: 12,
    fontSize: 14,
    fontFamily: 'Inter_400Regular',
    color: C.text,
    borderWidth: 1,
    borderColor: C.border,
  },
  editActions: {
    flexDirection: 'row',
    gap: 10,
  },
  editCancel: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    backgroundColor: C.surface2,
    alignItems: 'center',
  },
  editCancelText: {
    fontSize: 14,
    fontFamily: 'Inter_500Medium',
    color: C.textSub,
  },
  editConfirm: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    backgroundColor: C.primary,
    alignItems: 'center',
  },
  editConfirmText: {
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
  thumbMarker: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -9,
    marginTop: -9,
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  thumbMarkerText: {
    fontSize: 8,
    fontFamily: 'Inter_700Bold',
    color: '#fff',
  },
  thumbBadge: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    backgroundColor: 'rgba(0,0,0,0.65)',
    borderRadius: 8,
    paddingHorizontal: 5,
    paddingVertical: 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  thumbBadgeText: {
    fontSize: 9,
    fontFamily: 'Inter_600SemiBold',
    color: '#fff',
  },
});
