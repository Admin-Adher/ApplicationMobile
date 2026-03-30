import { View, Text, StyleSheet, SectionList, TouchableOpacity, TextInput } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useState, useMemo } from 'react';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { DocumentType } from '@/constants/types';
import Header from '@/components/Header';

const DOC_ICONS: Record<DocumentType, string> = {
  plan: 'map-outline',
  report: 'document-text-outline',
  technical: 'construct-outline',
  photo: 'camera-outline',
  other: 'attach-outline',
};

const DOC_COLORS: Record<DocumentType, string> = {
  plan: '#3B82F6',
  report: '#10B981',
  technical: '#F59E0B',
  photo: '#8B5CF6',
  other: C.low,
};

export default function DocumentsScreen() {
  const { documents } = useApp();
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    return documents.filter(d =>
      search === '' || d.name.toLowerCase().includes(search.toLowerCase()) || d.category.toLowerCase().includes(search.toLowerCase())
    );
  }, [documents, search]);

  const grouped = useMemo(() => {
    const cats: Record<string, typeof filtered> = {};
    filtered.forEach(d => {
      if (!cats[d.category]) cats[d.category] = [];
      cats[d.category].push(d);
    });
    return Object.entries(cats).map(([title, data]) => ({ title, data }));
  }, [filtered]);

  return (
    <View style={styles.container}>
      <Header title="Documents" subtitle={`${documents.length} fichiers`} showBack />

      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={16} color={C.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Rechercher..."
          placeholderTextColor={C.textMuted}
          value={search}
          onChangeText={setSearch}
        />
      </View>

      <SectionList
        sections={grouped}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionHeader}>{section.title}</Text>
        )}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.docCard}>
            <View style={[styles.iconWrap, { backgroundColor: DOC_COLORS[item.type] + '20' }]}>
              <Ionicons name={DOC_ICONS[item.type] as any} size={22} color={DOC_COLORS[item.type]} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.docName} numberOfLines={2}>{item.name}</Text>
              <Text style={styles.docMeta}>{item.size} — v{item.version} — {item.uploadedAt}</Text>
            </View>
            <Ionicons name="download-outline" size={18} color={C.textMuted} />
          </TouchableOpacity>
        )}
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <Ionicons name="folder-open-outline" size={48} color={C.textMuted} />
            <Text style={styles.emptyText}>Aucun document trouvé</Text>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.surface, margin: 16, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    borderWidth: 1, borderColor: C.border,
  },
  searchInput: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text },
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  sectionHeader: { fontSize: 12, fontFamily: 'Inter_700Bold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8, marginTop: 12 },
  docCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.surface, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: C.border },
  iconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  docName: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.text, lineHeight: 20 },
  docMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 3 },
  empty: { alignItems: 'center', paddingTop: 60, gap: 12 },
  emptyText: { fontSize: 15, fontFamily: 'Inter_400Regular', color: C.textMuted },
});
