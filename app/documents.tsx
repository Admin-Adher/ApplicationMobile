import { View, Text, StyleSheet, SectionList, TouchableOpacity, TextInput, Platform, ActivityIndicator, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import * as DocumentPicker from 'expo-document-picker';
import { C } from '@/constants/colors';
import { resolveMediaRef } from '@/lib/media';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import { DocumentType, Document } from '@/constants/types';
import Header from '@/components/Header';
import { uploadDocument } from '@/lib/storage';
import { genId, formatSize, formatDateFR } from '@/lib/utils';
import BottomNavBar from '@/components/BottomNavBar';
import { showAlert } from '@/lib/appAlert';
import PageContainer from '@/components/PageContainer';

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
  const { t } = useTranslation();
  const { documents, addDocument, deleteDocument, activeChantierId } = useApp();
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
      showAlert(t('documentsScreen.accessDenied'), t('documentsScreen.importDenied'));
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
          showAlert(
            t('documentsScreen.planBuildingTitle'),
            t('documentsScreen.planBuildingMessage'),
            ['A', 'B', 'C'].map(building => ({
              text: t('documentsScreen.building', { building }),
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
                    chantierId: activeChantierId ?? undefined,
                  };
                  addDocument(newDoc);
                  showAlert(
                    t('documentsScreen.planImported'),
                    storageUrl
                      ? t('documentsScreen.uploadedStorage', { name: asset.name })
                      : t('documentsScreen.importedLocal', { name: asset.name })
                  );
                } catch {
                  showAlert(t('common.error'), t('documentsScreen.loadError'));
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
          category: docType === 'report'
            ? t('documentsScreen.categoryReports')
            : docType === 'technical'
              ? t('documentsScreen.categoryTechnical')
              : docType === 'photo'
                ? t('documentsScreen.categoryPhotos')
                : t('documentsScreen.categoryDocuments'),
          uploadedAt: formatDateFR(new Date()),
          size: formatSize(asset.size),
          version: existingNonPlanVersions.length > 0 ? Math.max(...existingNonPlanVersions) + 1 : 1,
          uri: finalUri,
          chantierId: activeChantierId ?? undefined,
        };
        addDocument(newDoc);
        showAlert(
          t('documentsScreen.documentImported'),
          storageUrl
            ? t('documentsScreen.uploadedStorage', { name: asset.name })
            : t('documentsScreen.importedLocal', { name: asset.name })
        );
      }
    } catch (e) {
      showAlert(t('common.error'), t('documentsScreen.loadError'));
    } finally {
      setLoading(false);
    }
  }

  async function handleDownload(doc: Document) {
    if (!doc.uri) {
      showAlert(t('documentsScreen.noFileTitle'), t('documentsScreen.noFileMessage'));
      return;
    }
    const resolvedUri = await resolveMediaRef(doc.uri, { cacheDisk: false });
    if (!resolvedUri) {
      showAlert(t('common.error'), t('documentsScreen.openLinkError'));
      return;
    }
    if (resolvedUri.startsWith('http')) {
      Linking.openURL(resolvedUri).catch(() =>
        showAlert(t('common.error'), t('documentsScreen.openLinkError'))
      );
      return;
    }
    // Web : les URI blob:/data: (upload cloud absent ou échoué) restent ouvrables
    // dans le navigateur — nouvel onglet, sinon téléchargement via une ancre.
    if (Platform.OS === 'web' && (resolvedUri.startsWith('blob:') || resolvedUri.startsWith('data:'))) {
      try {
        // Les navigateurs bloquent la navigation d'onglet vers les data: URI :
        // dans ce cas on passe directement par le téléchargement.
        const win = resolvedUri.startsWith('blob:') ? window.open(resolvedUri, '_blank') : null;
        if (!win) {
          const a = document.createElement('a');
          a.href = resolvedUri;
          a.download = doc.name || 'document';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        }
        return;
      } catch {
        // On retombe sur le message d'information ci-dessous.
      }
    }
    showAlert(t('documentsScreen.localFileTitle'), t('documentsScreen.localFileMessage', { uri: doc.uri.slice(0, 80) }));
  }

  function handleDelete(doc: Document) {
    if (!permissions.canDelete) {
      showAlert(t('documentsScreen.accessDenied'), t('documentsScreen.deleteDenied'));
      return;
    }
    showAlert(t('documentsScreen.deleteTitle'), t('documentsScreen.deleteMessage', { name: doc.name }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => deleteDocument(doc.id) },
    ]);
  }

  return (
    <View style={styles.container}>
      <Header
        title={t('documentsScreen.title')}
        subtitle={t('documentsScreen.files', { count: documents.length })}
        showBack
        rightIcon={permissions.canCreate ? (loading ? 'hourglass-outline' : 'add-outline') : undefined}
        onRightPress={permissions.canCreate ? handlePickDocument : undefined}
      />

      <PageContainer maxWidth={1000}>
      <View style={styles.searchWrap}>
        <Ionicons name="search-outline" size={16} color={C.textMuted} />
        <TextInput
          style={styles.searchInput}
          placeholder={t('documentsScreen.searchPlaceholder')}
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
              <Text style={styles.uploadText}>{t('documentsScreen.uploading')}</Text>
            </>
          ) : (
            <>
              <Ionicons name="cloud-upload-outline" size={18} color={C.primary} />
              <Text style={styles.uploadText}>{t('documentsScreen.importDocument')}</Text>
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
                    {item.uri.startsWith('http') ? t('documentsScreen.cloudSupabase') : t('documentsScreen.localFile')}
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
            <Text style={styles.emptyText}>{t('documentsScreen.empty')}</Text>
            {permissions.canCreate && <Text style={styles.emptyHint}>{t('documentsScreen.emptyHint')}</Text>}
          </View>
        )}
      />
      </PageContainer>
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
