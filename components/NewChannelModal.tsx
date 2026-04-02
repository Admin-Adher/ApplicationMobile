import { View, Text, StyleSheet, Modal, TouchableOpacity, TextInput, ScrollView, Alert, Platform } from 'react-native';
import { useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { C } from '@/constants/colors';

const ICONS = [
  'chatbubbles', 'megaphone', 'construct', 'hammer', 'shield-checkmark',
  'star', 'flash', 'flag', 'ribbon', 'layers',
  'clipboard', 'briefcase', 'document-text', 'camera', 'people',
  'alert-circle', 'checkmark-circle', 'information-circle', 'time', 'settings',
];

const COLORS = [
  '#0A84FF', '#7C3AED', '#059669', '#D97706', '#EC4899',
  '#EA580C', '#0891B2', '#65A30D', '#DC2626', '#6366F1',
];

interface Props {
  visible: boolean;
  onClose: () => void;
  onCreate: (name: string, description: string, icon: string, color: string) => void;
}

export default function NewChannelModal({ visible, onClose, onCreate }: Props) {
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [selectedIcon, setSelectedIcon] = useState('chatbubbles');
  const [selectedColor, setSelectedColor] = useState('#0A84FF');

  function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) {
      Alert.alert('Nom requis', 'Veuillez saisir un nom pour le canal.');
      return;
    }
    onCreate(trimmed, description.trim(), selectedIcon, selectedColor);
    setName('');
    setDescription('');
    setSelectedIcon('chatbubbles');
    setSelectedColor('#0A84FF');
    onClose();
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        <View style={[styles.header, Platform.OS === 'android' && { paddingTop: insets.top + 14 }]}>
          <TouchableOpacity onPress={onClose} style={styles.cancelBtn}>
            <Text style={styles.cancelText}>Annuler</Text>
          </TouchableOpacity>
          <Text style={styles.title}>Nouveau canal</Text>
          <TouchableOpacity onPress={handleCreate} style={[styles.createBtn, { backgroundColor: selectedColor }]}>
            <Text style={styles.createText}>Créer</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={[styles.preview, { backgroundColor: selectedColor + '15', borderColor: selectedColor + '40' }]}>
            <View style={[styles.previewIcon, { backgroundColor: selectedColor + '25' }]}>
              <Ionicons name={selectedIcon as any} size={30} color={selectedColor} />
            </View>
            <Text style={[styles.previewName, { color: selectedColor }]}>{name || 'Nom du canal'}</Text>
          </View>

          <Text style={styles.label}>Nom du canal</Text>
          <TextInput
            style={styles.input}
            placeholder="ex: Réunion de chantier"
            placeholderTextColor={C.textMuted}
            value={name}
            onChangeText={setName}
            autoCapitalize="sentences"
            maxLength={40}
          />

          <Text style={styles.label}>Description (optionnel)</Text>
          <TextInput
            style={[styles.input, styles.inputMulti]}
            placeholder="À quoi sert ce canal ?"
            placeholderTextColor={C.textMuted}
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={2}
            maxLength={120}
          />

          <Text style={styles.label}>Couleur</Text>
          <View style={styles.colorRow}>
            {COLORS.map(col => (
              <TouchableOpacity
                key={col}
                style={[styles.colorDot, { backgroundColor: col }, selectedColor === col && styles.colorDotSelected]}
                onPress={() => setSelectedColor(col)}
                activeOpacity={0.8}
              >
                {selectedColor === col && <Ionicons name="checkmark" size={14} color="#fff" />}
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.label}>Icône</Text>
          <View style={styles.iconGrid}>
            {ICONS.map(icon => (
              <TouchableOpacity
                key={icon}
                style={[styles.iconBtn, selectedIcon === icon && { backgroundColor: selectedColor + '25', borderColor: selectedColor }]}
                onPress={() => setSelectedIcon(icon)}
                activeOpacity={0.75}
              >
                <Ionicons name={icon as any} size={22} color={selectedIcon === icon ? selectedColor : C.textSub} />
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: C.border,
    backgroundColor: C.surface,
  },
  cancelBtn: { paddingVertical: 6, paddingHorizontal: 4 },
  cancelText: { fontSize: 15, fontFamily: 'Inter_400Regular', color: C.textSub },
  title: { fontSize: 16, fontFamily: 'Inter_700Bold', color: C.text },
  createBtn: { paddingHorizontal: 16, paddingVertical: 7, borderRadius: 20 },
  createText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  content: { padding: 20, paddingBottom: 40 },
  preview: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    padding: 16, borderRadius: 16, borderWidth: 1,
    marginBottom: 24,
  },
  previewIcon: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  previewName: { fontSize: 18, fontFamily: 'Inter_700Bold', flex: 1 },
  label: {
    fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub,
    textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: 10, marginTop: 4,
  },
  input: {
    backgroundColor: C.surface, borderRadius: 12, borderWidth: 1, borderColor: C.border,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, fontFamily: 'Inter_400Regular',
    color: C.text, marginBottom: 20,
  },
  inputMulti: { minHeight: 72, textAlignVertical: 'top' },
  colorRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 24 },
  colorDot: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: 'transparent',
  },
  colorDotSelected: { borderColor: C.text },
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  iconBtn: {
    width: 48, height: 48, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: C.surface, borderWidth: 1, borderColor: C.border,
  },
});
