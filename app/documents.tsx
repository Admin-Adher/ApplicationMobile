import { View, Text, StyleSheet, SectionList, TouchableOpacity, TextInput, Alert, Platform, ActivityIndicator, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useState, useMemo } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { DocumentType, Document } from '@/constants/types';
import Header from '@/components/Header';
import { uploadDocument } from '@/lib/storage';
import { genId, formatSize, formatDateFR } from '@/lib/utils';
import BottomNavBar from '@/components/BottomNavBar';

const DOC_ICONS: Record<DocumentType, string> = {
  plan: 'map-outline',
  report: 'document-text-outline',
  technical: 'construct-outline',
  photo: 'camera-outline',
  other: 'attach-outline',
};

const DOC_COLORS: Record<DocumentType, string> = {
  plan: C.inProgress,
  report: C.closed,
  technical: C.medium,
  photo: C.verification,
  other: C.low,
};

function getDocType(mimeType: string | undefined, name: string): DocumentType {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['pdf'].includes(ext) && name.toLowerCase().includes('plan')) return 'plan';
  if (['pdf', 'doc', 'docx'].includes(ext)) return 'report';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'technical';
  if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) return 'photo';
  return 'other';
}

export default function DocumentsScreen() {
  const { documents, addDocument, deleteDocument } = useApp();
  const { permissions } = useAuth();
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

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

  async function handlePickDocument() {
    if (!permissions.canCreate) {
      Alert.alert('Accès refusé', "Votre rôle ne permet pas d'importer des documents.");
      return;
    }
    setLoading(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        const docType = getDocType(asset.mimeType, asset.name);

        if (docType === 'plan') {
          setLoading(false);
          Alert.alert(
            'Bâtiment du plan',
            'Dans quel bâtiment ce plan se situe-t-il ?',
            ['A', 'B', 'C'].map(building => ({
              text: `Bâtiment ${building}`,
              onPress: async () => {
                setLoading(true);
                try {
                  const storageUrl = await uploadDocument(asset.uri, asset.name, asset.mimeType ?? undefined);
                  const finalUri = storageUrl ?? asset.uri;
                  const existingVersions = documents.filter(d => d.name === asset.name).map(d => d.version);
                  const newDoc: Document = {
                    id: genId(),
                    name: asset.name,
                    type: 'plan',
                    category: `Plan-${building}`,
                    uploadedAt: formatDateFR(new Date()),
                    size: formatSize(asset.size),
                    version: existingVersions.length > 0 ? Math.max(...existingVersions) + 1 : 1,
                    uri: finalUri,
                  };
                  addDocument(newDoc);
                  Alert.alert(
                    'Plan importé',
                    storageUrl
                      ? `"${asset.name}" uploadé sur Supabase Storage.`
                      : `"${asset.name}" importé (stockage local).`
                  );
                } catch {
                  Alert.alert('Erreur', 'Impossible de charger le document.');
                } finally {
                  setLoading(false);
                }
              },
            }))
          );
          return;
        }

        const storageUrl = await uploadDocument(asset.uri, asset.name, asset.mimeType ?? undefined);
        const finalUri = storageUrl ?? asset.uri;

        const existingNonPlanVersions = documents.filter(d => d.name === asset.name).map(d => d.version);
        const newDoc: Document = {
          id: genId(),
          name: asset.name,
          type: docType,
          category: docType === 'report' ? 'Rapports' : docType === 'technical' ? 'Fiches techniques' : docType === 'photo' ? 'Photos' : 'Documents',
          uploadedAt: formatDateFR(new Date()),
          size: formatSize(asset.size),
          version: existingNonPlanVersions.length > 0 ? Math.max(...existingNonPlanVersions) + 1 : 1,
          uri: finalUri,
        };
        addDocument(newDoc);
        Alert.alert(
          'Document importé',
          storageUrl
            ? `"${asset.name}" uploadé sur Supabase Storage.`
            : `"${asset.name}" importé (stockage local).`
        );
      }
    } catch (e) {
      Alert.alert('Erreur', 'Impossible de charger le document.');
    } finally {
      setLoading(false);
    }
  }

  function handleDownload(doc: Document) {
    if (!doc.uri) {
      Alert.alert('Info', 'Aucun fichier disponible pour ce document.');
      return;
    }
    if (doc.uri.startsWith('http')) {
      Linking.openURL(doc.uri).catch(() =>
        Alert.alert('Erreur', "Impossible d'ouvrir le lien.")
      );
    } else {
      Alert.alert('Fichier local', `Fichier disponible localement :\n${doc.uri.slice(0, 80)}...`);
    }
  }

  function handleDelete(doc: Document) {
    if (!permissions.canDelete) {
      Alert.alert('Accès refusé', "Votre rôle ne permet pas de supprimer des documents.");
      return;
    }
    Alert.alert('Supprimer', `Supprimer "${doc.name}" ?`, [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => deleteDocument(doc.id) },
    ]);
  }

  return (
    <View style={styles.container}>
      <Header
        title="Documents"
        subtitle={`${documents.length} fichiers`}
        showBack
        rightIcon={permissions.canCreate ? (loading ? 'hourglass-outline' : 'add-outline') : undefined}
        onRightPress={permissions.canCreate ? handlePickDocument : undefined}
      />

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

      {permissions.canCreate && (
        <TouchableOpacity style={styles.uploadBar} onPress={handlePickDocument} disabled={loading}>
          {loading ? (
            <>
              <ActivityIndicator size="small" color={C.primary} />
              <Text style={styles.uploadText}>Upload en cours...</Text>
            </>
          ) : (
            <>
              <Ionicons name="cloud-upload-outline" size={18} color={C.primary} />
              <Text style={styles.uploadText}>Importer un document (PDF, Word, Excel, Image…)</Text>
            </>
          )}
        </TouchableOpacity>
      )}

      <SectionList
        sections={grouped}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        renderSectionHeader={({ section }) => (
          <Text style={styles.sectionHeader}>{section.title}</Text>
        )}
        renderItem={({ item }) => (
          <View style={styles.docCard}>
            <View style={[styles.iconWrap, { backgroundColor: DOC_COLORS[item.type] + '20' }]}>
              <Ionicons name={DOC_ICONS[item.type] as any} size={22} color={DOC_COLORS[item.type]} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.docName} numberOfLines={2}>{item.name}</Text>
              <Text style={styles.docMeta}>{item.size} — v{item.version} — {item.uploadedAt}</Text>
              {item.uri && (
                <View style={styles.uriBadge}>
                  <Ionicons
                    name={item.uri.startsWith('http') ? 'cloud-done-outline' : 'phone-portrait-outline'}
                    size={10}
                    color={item.uri.startsWith('http') ? C.closed : C.textMuted}
                  />
                  <Text style={[styles.uriBadgeText, { color: item.uri.startsWith('http') ? C.closed : C.textMuted }]}>
                    {item.uri.startsWith('http') ? 'Cloud Supabase' : 'Fichier local'}
                  </Text>
                </View>
              )}
            </View>
            <View style={styles.docActions}>
              <TouchableOpacity onPress={() => handleDownload(item)} hitSlop={8} style={styles.docActionBtn}>
                <Ionicons
                  name={item.uri?.startsWith('http') ? 'open-outline' : 'download-outline'}
                  size={18}
                  color={C.textMuted}
                />
              </TouchableOpacity>
              {permissions.canDelete && (
                <TouchableOpacity onPress={() => handleDelete(item)} hitSlop={8} style={[styles.docActionBtn, styles.docDeleteBtn]}>
                  <Ionicons name="trash-outline" size={17} color={C.open} />
                </TouchableOpacity>
              )}
            </View>
          </View>
        )}
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <Ionicons name="folder-open-outline" size={48} color={C.textMuted} />
            <Text style={styles.emptyText}>Aucun document trouvé</Text>
            {permissions.canCreate && <Text style={styles.emptyHint}>Appuyez sur + pour importer</Text>}
          </View>
        )}
      />
      <BottomNavBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.surface, margin: 16, marginBottom: 8, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: C.border },
  searchInput: { flex: 1, fontSize: 14, fontFamily: 'Inter_400Regular', color: C.text },
  uploadBar: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.primaryBg, marginHorizontal: 16, marginBottom: 8, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: C.primary + '50', borderStyle: 'dashed' },
  uploadText: { flex: 1, fontSize: 13, fontFamily: 'Inter_500Medium', color: C.primary },
  content: { paddingHorizontal: 16, paddingBottom: 32 },
  sectionHeader: { fontSize: 12, fontFamily: 'Inter_700Bold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8, marginTop: 12 },
  docCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: C.surface, borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: C.border },
  iconWrap: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  docName: { fontSize: 14, fontFamily: 'Inter_500Medium', color: C.text, lineHeight: 20 },
  docMeta: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, marginTop: 3 },
  docActions: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  docActionBtn: { padding: 6, borderRadius: 8, backgroundColor: C.surface2, borderWidth: 1, borderColor: C.border },
  docDeleteBtn: { backgroundColor: C.openBg, borderColor: C.open + '40' },
  uriBadge: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4 },
  uriBadgeText: { fontSize: 10, fontFamily: 'Inter_400Regular' },
  empty: { alignItems: 'center', paddingTop: 60, gap: 8 },
  emptyText: { fontSize: 15, fontFamily: 'Inter_400Regular', color: C.textMuted },
  emptyHint: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted },
});
