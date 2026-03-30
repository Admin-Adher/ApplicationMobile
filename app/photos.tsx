import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, Image, Platform, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import Header from '@/components/Header';
import { Photo } from '@/constants/types';
import { uploadPhoto } from '@/lib/storage';

function genId() {
  return Date.now().toString() + Math.random().toString(36).substr(2, 6);
}

export default function PhotosScreen() {
  const { photos, addPhoto } = useApp();
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);

  async function processPhoto(uri: string, source: 'camera' | 'gallery') {
    setLoading(true);
    try {
      const filename = `photo_${Date.now()}.jpg`;
      const storageUrl = await uploadPhoto(uri, filename);
      const finalUri = storageUrl ?? uri;

      const newPhoto: Photo = {
        id: genId(),
        comment: source === 'camera' ? 'Photo prise sur le chantier' : 'Photo chantier',
        location: source === 'camera' ? 'Chantier' : 'Zone non définie',
        takenAt: new Date().toLocaleDateString('fr-FR'),
        takenBy: user?.name ?? 'Équipe',
        colorCode: source === 'camera' ? C.closed : C.primary,
        uri: finalUri,
      };
      addPhoto(newPhoto);
      if (storageUrl) {
        Alert.alert('Photo enregistrée', 'Photo uploadée sur Supabase Storage.');
      }
    } catch (e) {
      Alert.alert('Erreur', 'Impossible de traiter la photo.');
    } finally {
      setLoading(false);
    }
  }

  async function handlePickPhoto() {
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission refusée', "L'accès à la galerie est nécessaire.");
        return;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      await processPhoto(result.assets[0].uri, 'gallery');
    }
  }

  async function handleCamera() {
    if (Platform.OS === 'web') {
      Alert.alert('Info', 'La prise de photo directe est disponible sur appareil mobile via Expo Go.');
      return;
    }
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permission refusée', "L'accès à l'appareil photo est nécessaire.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.8 });
    if (!result.canceled && result.assets[0]) {
      await processPhoto(result.assets[0].uri, 'camera');
    }
  }

  return (
    <View style={styles.container}>
      <Header
        title="Photos chantier"
        subtitle={`${photos.length} photos`}
        showBack
        rightIcon="camera-outline"
        onRightPress={handleCamera}
      />

      <FlatList
        data={photos}
        numColumns={2}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.content}
        columnWrapperStyle={styles.row}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={() => (
          <>
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <Text style={styles.statVal}>{photos.length}</Text>
                <Text style={styles.statLabel}>Photos totales</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statVal}>{new Set(photos.map(p => p.takenBy)).size}</Text>
                <Text style={styles.statLabel}>Photographes</Text>
              </View>
            </View>
            <View style={styles.actionRow}>
              <TouchableOpacity style={[styles.actionBtn, { flex: 1 }]} onPress={handleCamera} disabled={loading}>
                <Ionicons name="camera" size={18} color={C.primary} />
                <Text style={styles.actionBtnText}>Prendre une photo</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, { flex: 1 }]} onPress={handlePickPhoto} disabled={loading}>
                <Ionicons name="images-outline" size={18} color={C.inProgress} />
                <Text style={[styles.actionBtnText, { color: C.inProgress }]}>Depuis la galerie</Text>
              </TouchableOpacity>
            </View>
            {loading && (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={C.primary} size="small" />
                <Text style={styles.loadingText}>Upload en cours...</Text>
              </View>
            )}
          </>
        )}
        renderItem={({ item }) => (
          <View style={styles.photoCard}>
            {item.uri ? (
              <Image source={{ uri: item.uri }} style={styles.photoThumbImg} resizeMode="cover" />
            ) : (
              <View style={[styles.photoThumb, { backgroundColor: item.colorCode + '30' }]}>
                <Ionicons name="camera" size={32} color={item.colorCode} />
              </View>
            )}
            <View style={styles.photoInfo}>
              <Text style={styles.photoComment} numberOfLines={2}>{item.comment}</Text>
              <View style={styles.photoMeta}>
                <Ionicons name="location-outline" size={10} color={C.textMuted} />
                <Text style={styles.photoLocation} numberOfLines={1}>{item.location}</Text>
              </View>
              <View style={styles.photoMeta}>
                <Ionicons name="person-outline" size={10} color={C.textMuted} />
                <Text style={styles.photoBy}>{item.takenBy}</Text>
              </View>
              <View style={styles.photoMeta}>
                {item.uri?.startsWith('http') ? (
                  <Ionicons name="cloud-done-outline" size={10} color={C.closed} />
                ) : (
                  <Ionicons name="phone-portrait-outline" size={10} color={C.textMuted} />
                )}
                <Text style={[styles.photoDate, item.uri?.startsWith('http') && { color: C.closed }]}>
                  {item.uri?.startsWith('http') ? 'Cloud' : 'Local'} — {item.takenAt}
                </Text>
              </View>
            </View>
          </View>
        )}
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <Ionicons name="camera-outline" size={48} color={C.textMuted} />
            <Text style={styles.emptyText}>Aucune photo</Text>
            <Text style={styles.emptyHint}>Appuyez sur un bouton ci-dessus pour ajouter</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 12, paddingBottom: 32 },
  row: { justifyContent: 'space-between', gap: 10 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 12, width: '100%' },
  statItem: { flex: 1, backgroundColor: C.surface, borderRadius: 12, padding: 14, alignItems: 'center', borderWidth: 1, borderColor: C.border },
  statVal: { fontSize: 24, fontFamily: 'Inter_700Bold', color: C.primary },
  statLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 2 },
  actionRow: { flexDirection: 'row', gap: 10, marginBottom: 14, width: '100%' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.surface, borderRadius: 12, paddingVertical: 14, borderWidth: 1, borderColor: C.border },
  actionBtnText: { fontSize: 13, fontFamily: 'Inter_600SemiBold', color: C.primary },
  loadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 8, marginBottom: 8 },
  loadingText: { fontSize: 13, fontFamily: 'Inter_400Regular', color: C.textSub },
  photoCard: { width: '48.5%', backgroundColor: C.surface, borderRadius: 14, overflow: 'hidden', marginBottom: 10, borderWidth: 1, borderColor: C.border },
  photoThumb: { height: 110, alignItems: 'center', justifyContent: 'center' },
  photoThumbImg: { width: '100%', height: 110 },
  photoInfo: { padding: 10 },
  photoComment: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.text, marginBottom: 6, lineHeight: 16 },
  photoMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  photoLocation: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textSub, flex: 1 },
  photoBy: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textSub },
  photoDate: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textMuted },
  empty: { alignItems: 'center', paddingTop: 40, gap: 10 },
  emptyText: { fontSize: 15, fontFamily: 'Inter_400Regular', color: C.textMuted },
  emptyHint: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted },
});
