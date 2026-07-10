import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert, Image, Platform, ActivityIndicator, Modal, TextInput, ScrollView, Share, KeyboardAvoidingView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as Sharing from 'expo-sharing';
import * as FileSystem from 'expo-file-system';
import { C } from '@/constants/colors';
import { useApp } from '@/context/AppContext';
import { useAuth } from '@/context/AuthContext';
import Header from '@/components/Header';
import DictationTextInput from '@/components/DictationTextInput';
import { Photo, Channel } from '@/constants/types';
import { uploadPhoto } from '@/lib/storage';
import { genId, formatDateFR } from '@/lib/utils';
import BottomNavBar from '@/components/BottomNavBar';

export default function PhotosScreen() {
  const { t } = useTranslation();
  const { photos, addPhoto, deletePhoto, channels, addMessage } = useApp();
  const { user, permissions } = useAuth();
  const [loading, setLoading] = useState(false);
  const [pendingUri, setPendingUri] = useState<string | null>(null);
  const [commentInput, setCommentInput] = useState('');
  const [locationInput, setLocationInput] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [sharePhoto, setSharePhoto] = useState<Photo | null>(null);
  const [shareModalVisible, setShareModalVisible] = useState(false);
  const [shareCaption, setShareCaption] = useState('');
  const [fullScreenUri, setFullScreenUri] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [authorFilter, setAuthorFilter] = useState('');
  const [pendingGps, setPendingGps] = useState<{ lat: number; lon: number; accuracy: number } | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'loading' | 'unavailable'>('idle');

  // Capture GPS au moment de la prise : pendingGps n'était jamais alimenté
  // (bandeau « en cours » permanent, coordonnées jamais enregistrées).
  async function captureGps() {
    if (Platform.OS === 'web') { setGpsStatus('unavailable'); return; }
    setGpsStatus('loading');
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') { setGpsStatus('unavailable'); return; }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setPendingGps({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy: Math.round(pos.coords.accuracy ?? 0),
      });
      setGpsStatus('idle');
    } catch {
      setGpsStatus('unavailable');
    }
  }

  function openShareModal(photo: Photo) {
    setSharePhoto(photo);
    setShareCaption(photo.comment || '');
    setShareModalVisible(true);
  }

  function handleShareToChannel(channel: Channel) {
    if (!sharePhoto) return;
    const caption = shareCaption.trim() || sharePhoto.comment || t('photosScreen.sharedPhotoFallback');
    addMessage(
      channel.id,
      caption,
      { attachmentUri: sharePhoto.uri || undefined },
      user?.name ?? 'Moi'
    );
    const note = sharePhoto.uri
      ? t('photosScreen.shareChannelWithImage', { channel: channel.name })
      : t('photosScreen.shareChannelNoImage', { channel: channel.name });
    setShareModalVisible(false);
    Alert.alert(t('photosScreen.shareDoneTitle'), note, [{ text: 'OK' }]);
  }

  async function handleSystemShare() {
    if (!sharePhoto) return;
    const caption = shareCaption.trim() || sharePhoto.comment || t('photosScreen.systemShareFallback');
    const uri = sharePhoto.uri;

    try {
      if (Platform.OS === 'web') {
        if (uri?.startsWith('http') && typeof navigator !== 'undefined' && (navigator as any).share) {
          await (navigator as any).share({ title: caption, url: uri });
        } else if (uri?.startsWith('http')) {
          await (navigator as any).clipboard?.writeText(uri);
          Alert.alert(t('photosScreen.linkCopiedTitle'), t('photosScreen.linkCopiedText'));
        } else {
          Alert.alert(t('photosScreen.shareUnavailableTitle'), t('photosScreen.webLocalUnavailable'));
        }
        return;
      }

      if (uri?.startsWith('http')) {
        await Share.share({ message: `${caption}\n${uri}`, url: uri, title: caption });
        return;
      }

      if (uri) {
        const isAvailable = await Sharing.isAvailableAsync();
        if (isAvailable) {
          let fileUri = uri;
          if (!uri.startsWith(FileSystem.documentDirectory ?? '')) {
            const dest = FileSystem.cacheDirectory + `share_${Date.now()}.jpg`;
            await FileSystem.copyAsync({ from: uri, to: dest });
            fileUri = dest;
          }
          await Sharing.shareAsync(fileUri, { mimeType: 'image/jpeg', dialogTitle: caption });
        } else {
          Alert.alert(t('photosScreen.unavailableTitle'), t('photosScreen.fileShareUnavailable'));
        }
        return;
      }

      Alert.alert(t('photosScreen.noImageTitle'), t('photosScreen.invalidUri'));
    } catch (err: any) {
      if (err?.message?.includes('cancel') || err?.message?.includes('abort')) return;
      Alert.alert(t('common.error'), t('photosScreen.shareError', { message: err?.message ?? '' }));
    }
  }

  function handleDeletePhoto(id: string, comment: string) {
    if (!permissions.canDelete) {
      Alert.alert(t('photosScreen.deniedTitle'), t('photosScreen.deleteDenied'));
      return;
    }
    Alert.alert(t('photosScreen.deletePhotoTitle'), t('photosScreen.deletePhotoText', { comment }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => deletePhoto(id) },
    ]);
  }

  function openCommentModal(uri: string) {
    setPendingUri(uri);
    setCommentInput('');
    setLocationInput('');
    setPendingGps(null);
    setModalVisible(true);
    captureGps();
  }

  async function blobUriToDataUri(blobUri: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.onload = () => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(xhr.response);
      };
      xhr.onerror = reject;
      xhr.responseType = 'blob';
      xhr.open('GET', blobUri);
      xhr.send();
    });
  }

  async function confirmPhoto() {
    if (!pendingUri) return;
    setModalVisible(false);
    setLoading(true);
    try {
      const filename = `photo_${Date.now()}.jpg`;
      const storageUrl = await uploadPhoto(pendingUri, filename);

      let finalUri: string | undefined = storageUrl ?? pendingUri;

      if (!storageUrl && Platform.OS === 'web' && finalUri?.startsWith('blob:')) {
        try {
          finalUri = await blobUriToDataUri(finalUri);
        } catch {
          finalUri = undefined;
        }
      }

      if (finalUri?.startsWith('blob:')) {
        finalUri = undefined;
      }

      const newPhoto: Photo = {
        id: genId(),
        comment: commentInput.trim() || t('photosScreen.defaultComment'),
        location: locationInput.trim() || t('photosScreen.undefinedZone'),
        takenAt: formatDateFR(new Date()),
        takenBy: user?.name ?? t('photosScreen.teamFallback'),
        colorCode: C.closed,
        uri: finalUri,
        ...(pendingGps ? { gpsLat: pendingGps.lat, gpsLon: pendingGps.lon, gpsAccuracy: pendingGps.accuracy } : {}),
      };
      addPhoto(newPhoto);
      if (storageUrl) {
        Alert.alert(t('photosScreen.savedTitle'), t('photosScreen.uploadedText'));
      }
    } catch {
      Alert.alert(t('common.error'), t('photosScreen.processError'));
    } finally {
      setLoading(false);
      setPendingUri(null);
    }
  }

  const uniqueAuthors = useMemo(() => Array.from(new Set(photos.map(p => p.takenBy))), [photos]);

  const filteredPhotos = useMemo(() => {
    let list = photos;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(p =>
        p.comment.toLowerCase().includes(q) ||
        p.location.toLowerCase().includes(q) ||
        p.takenBy.toLowerCase().includes(q) ||
        p.takenAt.includes(q)
      );
    }
    if (authorFilter) {
      list = list.filter(p => p.takenBy === authorFilter);
    }
    return list;
  }, [photos, searchQuery, authorFilter]);

  function cancelModal() {
    setModalVisible(false);
    setPendingUri(null);
    setPendingGps(null);
    setGpsStatus('idle');
  }

  async function handlePickPhoto() {
    if (!permissions.canCreate) {
      Alert.alert(t('photosScreen.deniedTitle'), t('photosScreen.createDenied'));
      return;
    }
    if (Platform.OS !== 'web') {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(t('photosScreen.permissionDenied'), t('photosScreen.galleryRequired'));
        return;
      }
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      openCommentModal(result.assets[0].uri);
    }
  }

  async function handleCamera() {
    if (!permissions.canCreate) {
      Alert.alert(t('photosScreen.deniedTitle'), t('photosScreen.createDenied'));
      return;
    }
    if (Platform.OS === 'web') {
      Alert.alert(t('photosScreen.infoTitle'), t('photosScreen.cameraMobileOnly'));
      return;
    }
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert(t('photosScreen.permissionDenied'), t('photosScreen.cameraRequired'));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, quality: 0.8 });
    if (!result.canceled && result.assets[0]) {
      openCommentModal(result.assets[0].uri);
    }
  }

  return (
    <View style={styles.container}>
      <Header
        title={t('photosScreen.title')}
        subtitle={t('photosScreen.subtitle', { count: photos.length })}
        showBack
        rightIcon={permissions.canCreate ? 'camera-outline' : undefined}
        onRightPress={permissions.canCreate ? handleCamera : undefined}
      />

      <FlatList
        data={filteredPhotos}
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
                <Text style={styles.statLabel}>{t('photosScreen.totalPhotos')}</Text>
              </View>
              <View style={styles.statItem}>
                <Text style={styles.statVal}>{uniqueAuthors.length}</Text>
                <Text style={styles.statLabel}>{t('photosScreen.photographers')}</Text>
              </View>
            </View>

            <View style={styles.searchWrap}>
              <Ionicons name="search-outline" size={16} color={C.textMuted} />
              <TextInput
                style={styles.searchInput}
                placeholder={t('photosScreen.searchPlaceholder')}
                placeholderTextColor={C.textMuted}
                value={searchQuery}
                onChangeText={setSearchQuery}
                returnKeyType="search"
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={8}>
                  <Ionicons name="close-circle" size={16} color={C.textMuted} />
                </TouchableOpacity>
              )}
            </View>

            {uniqueAuthors.length > 1 && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    style={[styles.filterChip, !authorFilter && styles.filterChipActive]}
                    onPress={() => setAuthorFilter('')}
                  >
                    <Text style={[styles.filterChipText, !authorFilter && styles.filterChipTextActive]}>{t('photosScreen.allAuthors')}</Text>
                  </TouchableOpacity>
                  {uniqueAuthors.map(author => (
                    <TouchableOpacity
                      key={author}
                      style={[styles.filterChip, authorFilter === author && styles.filterChipActive]}
                      onPress={() => setAuthorFilter(authorFilter === author ? '' : author)}
                    >
                      <Text style={[styles.filterChipText, authorFilter === author && styles.filterChipTextActive]}>{author}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>
            )}

            {(searchQuery || authorFilter) && (
              <Text style={styles.filterResult}>{t('photosScreen.resultsCount', { count: filteredPhotos.length })}</Text>
            )}

            {permissions.canCreate && (
              <View style={styles.actionRow}>
                <TouchableOpacity style={[styles.actionBtn, { flex: 1 }]} onPress={handleCamera} disabled={loading}>
                  <Ionicons name="camera" size={18} color={C.primary} />
                  <Text style={styles.actionBtnText}>{t('photosScreen.takePhoto')}</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[styles.actionBtn, { flex: 1 }]} onPress={handlePickPhoto} disabled={loading}>
                  <Ionicons name="images-outline" size={18} color={C.inProgress} />
                  <Text style={[styles.actionBtnText, { color: C.inProgress }]}>{t('photosScreen.fromGallery')}</Text>
                </TouchableOpacity>
              </View>
            )}
            {loading && (
              <View style={styles.loadingRow}>
                <ActivityIndicator color={C.primary} size="small" />
                <Text style={styles.loadingText}>{t('photosScreen.uploading')}</Text>
              </View>
            )}
          </>
        )}
        renderItem={({ item }) => (
          <View style={styles.photoCard}>
            <TouchableOpacity
              onPress={() => item.uri ? setFullScreenUri(item.uri) : null}
              activeOpacity={0.9}
            >
              {item.uri ? (
                <View>
                  <Image source={{ uri: item.uri }} style={styles.photoThumbImg} resizeMode="cover" />
                  <View style={styles.expandHint}>
                    <Ionicons name="expand-outline" size={10} color="#fff" />
                  </View>
                </View>
              ) : (
                <View style={[styles.photoThumb, styles.photoThumbPlaceholder]}>
                  <Ionicons name="image-outline" size={28} color={C.textMuted} />
                  <Text style={styles.placeholderLabel} numberOfLines={1}>{item.location}</Text>
                </View>
              )}
            </TouchableOpacity>
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
                  {item.uri?.startsWith('http') ? t('photosScreen.cloud') : t('photosScreen.local')} — {item.takenAt}
                </Text>
              </View>
              <View style={styles.photoActions}>
                <TouchableOpacity style={styles.shareBtn} onPress={() => openShareModal(item)} activeOpacity={0.75}>
                  <Ionicons name="share-social-outline" size={12} color={C.primary} />
                  <Text style={styles.shareBtnText}>{t('photosScreen.share')}</Text>
                </TouchableOpacity>
                {permissions.canDelete && (
                  <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDeletePhoto(item.id, item.comment)} activeOpacity={0.75}>
                    <Ionicons name="trash-outline" size={12} color={C.open} />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          </View>
        )}
        ListEmptyComponent={() => (
          <View style={styles.empty}>
            <Ionicons name="camera-outline" size={48} color={C.textMuted} />
            <Text style={styles.emptyText}>{t('photosScreen.emptyTitle')}</Text>
            <Text style={styles.emptyHint}>{t('photosScreen.emptyHint')}</Text>
          </View>
        )}
      />

      {/* Vue plein écran */}
      <Modal visible={!!fullScreenUri} transparent animationType="fade" onRequestClose={() => setFullScreenUri(null)}>
        <View style={styles.fullScreenOverlay}>
          <TouchableOpacity style={styles.fullScreenClose} onPress={() => setFullScreenUri(null)}>
            <Ionicons name="close" size={26} color="#fff" />
          </TouchableOpacity>
          {fullScreenUri && (
            <Image source={{ uri: fullScreenUri }} style={styles.fullScreenImage} resizeMode="contain" />
          )}
        </View>
      </Modal>

      {/* Modal partage */}
      <Modal visible={shareModalVisible} transparent animationType="slide" onRequestClose={() => setShareModalVisible(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('photosScreen.sharePhoto')}</Text>
              <TouchableOpacity onPress={() => setShareModalVisible(false)} hitSlop={8}>
                <Ionicons name="close" size={22} color={C.textSub} />
              </TouchableOpacity>
            </View>

            {sharePhoto?.uri && (
              <Image source={{ uri: sharePhoto.uri }} style={[styles.modalPreview, { height: 100 }]} resizeMode="cover" />
            )}

            <View style={styles.modalField}>
              <Text style={styles.modalLabel}>{t('photosScreen.captionOptional')}</Text>
              <DictationTextInput
                inputStyle={styles.modalInput}
                placeholder={t('photosScreen.captionPlaceholder')}
                placeholderTextColor={C.textMuted}
                value={shareCaption}
                onChangeText={setShareCaption}
                textAssistEnabled
                textAssistContext="comment"
              />
            </View>

            {/* Avertissement si la photo n'a pas d'image */}
            {!sharePhoto?.uri && (
              <View style={styles.noUriWarning}>
                <Ionicons name="information-circle-outline" size={16} color={C.waiting} />
                <Text style={styles.noUriWarningText}>{t('photosScreen.noImageWarning')}</Text>
              </View>
            )}

            {/* Partage externe — WhatsApp, SMS, email, etc. */}
            <TouchableOpacity style={styles.sysShareBtn} onPress={handleSystemShare} activeOpacity={0.8}>
              <View style={styles.sysShareIcon}>
                <Ionicons name="share-outline" size={20} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.sysShareTitle}>{t('photosScreen.systemShareTitle')}</Text>
                <Text style={styles.sysShareSub}>{t('photosScreen.systemShareSubtitle')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#fff" />
            </TouchableOpacity>

            {/* Séparateur */}
            <View style={styles.shareSeparator}>
              <View style={styles.separatorLine} />
              <Text style={styles.separatorLabel}>{t('photosScreen.shareInChannel')}</Text>
              <View style={styles.separatorLine} />
            </View>

            <ScrollView style={{ maxHeight: 200 }} showsVerticalScrollIndicator={false}>
              {channels.map(ch => (
                <TouchableOpacity
                  key={ch.id}
                  style={styles.channelPickItem}
                  onPress={() => handleShareToChannel(ch)}
                  activeOpacity={0.75}
                >
                  <View style={[styles.channelPickIcon, { backgroundColor: ch.color + '20' }]}>
                    <Ionicons name={ch.icon as any} size={18} color={ch.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.channelPickName}>{ch.name}</Text>
                    <Text style={styles.channelPickDesc} numberOfLines={1}>{ch.description}</Text>
                  </View>
                  <Ionicons name="chevron-forward" size={14} color={C.textMuted} />
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal annotation */}
      <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={cancelModal}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('photosScreen.annotatePhoto')}</Text>
              <TouchableOpacity onPress={cancelModal} hitSlop={8}>
                <Ionicons name="close" size={22} color={C.textSub} />
              </TouchableOpacity>
            </View>

            {pendingUri && (
              <Image source={{ uri: pendingUri }} style={styles.modalPreview} resizeMode="cover" />
            )}

            <View style={styles.modalField}>
              <Text style={styles.modalLabel}>{t('photosScreen.comment')}</Text>
              <DictationTextInput
                inputStyle={styles.modalInput}
                placeholder={t('photosScreen.commentPlaceholder')}
                placeholderTextColor={C.textMuted}
                value={commentInput}
                onChangeText={setCommentInput}
                multiline
                numberOfLines={3}
                textAssistEnabled
                textAssistContext="comment"
              />
            </View>

            <View style={styles.modalField}>
              <Text style={styles.modalLabel}>{t('photosScreen.location')}</Text>
              <TextInput
                style={styles.modalInput}
                placeholder={t('photosScreen.locationPlaceholder')}
                placeholderTextColor={C.textMuted}
                value={locationInput}
                onChangeText={setLocationInput}
              />
            </View>

            {pendingGps ? (
              <View style={styles.gpsIndicator}>
                <Ionicons name="locate" size={12} color="#10B981" />
                <Text style={styles.gpsIndicatorText}>
                  {t('photosScreen.gpsCaptured', { lat: pendingGps.lat.toFixed(5), lon: pendingGps.lon.toFixed(5), accuracy: pendingGps.accuracy })}
                </Text>
              </View>
            ) : gpsStatus === 'loading' ? (
              <View style={[styles.gpsIndicator, { backgroundColor: C.surface2, borderColor: C.border }]}>
                <Ionicons name="locate-outline" size={12} color={C.textMuted} />
                <Text style={[styles.gpsIndicatorText, { color: C.textMuted }]}>{t('photosScreen.gpsLoading')}</Text>
              </View>
            ) : null}

            <View style={styles.modalBtns}>
              <TouchableOpacity style={styles.cancelBtn} onPress={cancelModal}>
                <Text style={styles.cancelBtnText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={confirmPhoto}>
                <Ionicons name="checkmark" size={16} color="#fff" />
                <Text style={styles.confirmBtnText}>{t('common.save')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <BottomNavBar />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },
  content: { padding: 12, paddingBottom: 32 },
  searchWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.surface, marginBottom: 12, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: C.border },
  searchInput: { flex: 1, fontSize: 13, fontFamily: 'Inter_400Regular', color: C.text },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: C.surface, borderWidth: 1, borderColor: C.border },
  filterChipActive: { backgroundColor: C.primaryBg, borderColor: C.primary },
  filterChipText: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.textSub },
  filterChipTextActive: { color: C.primary },
  filterResult: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted, marginBottom: 10, textAlign: 'center' },
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
  photoThumbPlaceholder: { backgroundColor: C.surface2, gap: 6 },
  placeholderLabel: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textMuted, paddingHorizontal: 8, textAlign: 'center' },
  photoThumbImg: { width: '100%', height: 110 },
  expandHint: { position: 'absolute', bottom: 6, right: 6, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 4, padding: 3 },
  photoInfo: { padding: 10 },
  photoComment: { fontSize: 12, fontFamily: 'Inter_500Medium', color: C.text, marginBottom: 6, lineHeight: 16 },
  photoMeta: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 2 },
  photoLocation: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textSub, flex: 1 },
  photoBy: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textSub },
  photoDate: { fontSize: 10, fontFamily: 'Inter_400Regular', color: C.textMuted },
  photoActions: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  shareBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 8, borderRadius: 8, backgroundColor: C.primaryBg },
  shareBtnText: { fontSize: 11, fontFamily: 'Inter_600SemiBold', color: C.primary },
  deleteBtn: { padding: 6, borderRadius: 8, backgroundColor: C.openBg, borderWidth: 1, borderColor: C.open + '30' },
  empty: { alignItems: 'center', paddingTop: 40, gap: 10 },
  emptyText: { fontSize: 15, fontFamily: 'Inter_400Regular', color: C.textMuted },
  emptyHint: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textMuted },
  fullScreenOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center', alignItems: 'center' },
  fullScreenClose: { position: 'absolute', top: 50, right: 20, zIndex: 10, padding: 8 },
  fullScreenImage: { width: '100%', height: '100%' },
  modalOverlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  modalCard: { backgroundColor: C.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: 36 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  modalTitle: { fontSize: 17, fontFamily: 'Inter_700Bold', color: C.text },
  modalPreview: { width: '100%', height: 150, borderRadius: 12, marginBottom: 16 },
  modalField: { marginBottom: 14 },
  modalLabel: { fontSize: 12, fontFamily: 'Inter_600SemiBold', color: C.textSub, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  modalInput: {
    backgroundColor: C.surface2, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12,
    color: C.text, fontFamily: 'Inter_400Regular', fontSize: 14,
    borderWidth: 1, borderColor: C.border, textAlignVertical: 'top',
  },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 12, borderWidth: 1.5, borderColor: C.border },
  cancelBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.textSub },
  confirmBtn: { flex: 2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, borderRadius: 12, backgroundColor: C.primary },
  confirmBtnText: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: '#fff' },
  noUriWarning: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#FFFBEB', borderRadius: 10, padding: 10, marginBottom: 12, borderWidth: 1, borderColor: '#F59E0B40' },
  noUriWarningText: { flex: 1, fontSize: 12, fontFamily: 'Inter_400Regular', color: '#92400E' },
  sysShareBtn: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#25D366', borderRadius: 14, padding: 14, marginBottom: 14 },
  sysShareIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  sysShareTitle: { fontSize: 14, fontFamily: 'Inter_700Bold', color: '#fff' },
  sysShareSub: { fontSize: 11, fontFamily: 'Inter_400Regular', color: 'rgba(255,255,255,0.85)', marginTop: 2 },
  shareSeparator: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  separatorLine: { flex: 1, height: 1, backgroundColor: C.border },
  separatorLabel: { fontSize: 11, fontFamily: 'Inter_400Regular', color: C.textMuted, textAlign: 'center' },
  channelPickItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  channelPickIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  channelPickName: { fontSize: 14, fontFamily: 'Inter_600SemiBold', color: C.text },
  channelPickDesc: { fontSize: 12, fontFamily: 'Inter_400Regular', color: C.textSub, marginTop: 1 },
  gpsBadge: { backgroundColor: '#ECFDF5', borderRadius: 6, paddingHorizontal: 5, paddingVertical: 2, marginTop: 2 },
  gpsText: { fontSize: 9, fontFamily: 'Inter_400Regular', color: '#059669', flex: 1 },
  gpsIndicator: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: '#ECFDF5', borderRadius: 8, padding: 8,
    borderWidth: 1, borderColor: '#6EE7B7', marginBottom: 12,
  },
  gpsIndicatorText: { fontSize: 11, fontFamily: 'Inter_400Regular', color: '#059669', flex: 1 },
});
