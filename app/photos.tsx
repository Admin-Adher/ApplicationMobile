import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import Header from '@/components/Header';

export default function PhotosScreen() {
  const { photos } = useApp();

  return (
    <View style={styles.container}>
      <Header title="Photos chantier" subtitle={`${photos.length} photos`} showBack rightIcon="camera-outline" onRightPress={() => Alert.alert('Appareil photo', 'Fonctionnalité disponible sur appareil physique via Expo Go.')} />

      <FlatList
        data={photos}
        numColumns={2}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.content}
        columnWrapperStyle={styles.row}
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={() => (
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
        )}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.photoCard} activeOpacity={0.8}>
            <View style={[styles.photoThumb, { backgroundColor: item.colorCode + '30' }]}>
              <Ionicons name="camera" size={32} color={item.colorCode} />
            </View>
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
              <Text style={styles.photoDate}>{item.takenAt}</Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <Ionicons name="camera-outline" size={48} color={C.textMuted} />
            <Text style={styles.emptyText}>Aucune photo</Text>
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
  photoCard: { width: '48.5%', backgroundColor: C.surface, borderRadius: 14, overflow: 'hidden', marginBottom: 10, borderWidth: 1, borderColor: C.border },
  photoThumb: { height: 110, alignItems: 'center', justifyContent: 'center' },
  photoInfo: { padding: 10 },
  photoComment: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.text, marginBottom: 6, lineHeight: 16 },
  photoMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  photoLocation: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textSub, flex: 1 },
  photoBy: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textSub },
  photoDate: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 4 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 15, fontFamily: 'Inter_400Regular', color: C.textMuted },
});
