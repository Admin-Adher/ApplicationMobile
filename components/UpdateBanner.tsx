import { View, Text, StyleSheet, TouchableOpacity, Linking, Platform, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useAppUpdate } from '@/hooks/useAppUpdate';

export default function UpdateBanner() {
  const { updateAvailable, latestVersion, downloadUrl, dismiss } = useAppUpdate();

  if (!updateAvailable) return null;

  const handleUpdate = async () => {
    try {
      const supported = await Linking.canOpenURL(downloadUrl);
      if (supported) {
        await Linking.openURL(downloadUrl);
      } else if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.open(downloadUrl, '_blank');
      } else {
        await Clipboard.setStringAsync(downloadUrl);
        Alert.alert('Lien copié', 'Le lien de téléchargement a été copié dans le presse-papier.');
      }
    } catch {
      try {
        await Clipboard.setStringAsync(downloadUrl);
        Alert.alert('Lien copié', 'Le lien de téléchargement a été copié dans le presse-papier.');
      } catch {}
    }
  };

  return (
    <View style={styles.banner}>
      <View style={styles.iconWrap}>
        <Ionicons name="rocket" size={20} color="#FFFFFF" />
      </View>
      <View style={styles.textWrap}>
        <Text style={styles.title} numberOfLines={1}>
          Nouvelle version disponible{latestVersion ? ` · ${latestVersion}` : ''}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          Mettez à jour pour les dernières améliorations
        </Text>
      </View>
      <TouchableOpacity style={styles.updateBtn} onPress={handleUpdate} activeOpacity={0.85}>
        <Text style={styles.updateBtnText}>Mettre à jour</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.closeBtn} onPress={dismiss} hitSlop={8}>
        <Ionicons name="close" size={18} color="#FFFFFFCC" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#E0512B',
    borderRadius: 14,
    paddingVertical: 12,
    paddingLeft: 12,
    paddingRight: 8,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#FFFFFF22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
  subtitle: {
    color: '#FFFFFFCC',
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    marginTop: 2,
  },
  updateBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  updateBtnText: {
    color: '#E0512B',
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  closeBtn: {
    padding: 4,
  },
});
