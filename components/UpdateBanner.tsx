import { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking, Platform, Alert, AppState, AppStateStatus } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as IntentLauncher from 'expo-intent-launcher';
import { useAppUpdate } from '@/hooks/useAppUpdate';

type DownloadState = 'idle' | 'downloading' | 'opening';

export default function UpdateBanner() {
  const {
    updateAvailable,
    latestLabel,
    publishedRelative,
    downloadUrl,
    dismiss,
    justUpdated,
    justUpdatedFromBuild,
    acknowledgeJustUpdated,
    currentLabel,
  } = useAppUpdate();
  const [state, setState] = useState<DownloadState>('idle');
  const [progress, setProgress] = useState(0);
  const resumableRef = useRef<FileSystem.DownloadResumable | null>(null);
  const downloadedUriRef = useRef<string | null>(null);
  const installLaunchedRef = useRef(false);
  const stateRef = useRef<DownloadState>('idle');

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Quand l'utilisateur revient dans l'app après l'écran d'installation
  // Android (qu'il ait validé ou annulé), on remet le bouton à zéro et on
  // nettoie le fichier APK en cache pour ne pas accumuler.
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (next: AppStateStatus) => {
      if (next === 'active' && installLaunchedRef.current) {
        installLaunchedRef.current = false;
        if (stateRef.current !== 'idle') {
          setState('idle');
          setProgress(0);
        }
        const uri = downloadedUriRef.current;
        downloadedUriRef.current = null;
        if (uri) {
          try { await FileSystem.deleteAsync(uri, { idempotent: true }); } catch {}
        }
      }
    });
    return () => { sub.remove(); };
  }, []);

  // Auto-dismiss du toast de succès au bout de 8 s.
  useEffect(() => {
    if (!justUpdated) return;
    const t = setTimeout(() => { acknowledgeJustUpdated(); }, 8000);
    return () => clearTimeout(t);
  }, [justUpdated, acknowledgeJustUpdated]);

  // Bannière verte de confirmation après une mise à jour réussie
  if (justUpdated) {
    return (
      <View style={[styles.banner, styles.bannerSuccess]}>
        <View style={[styles.iconWrap, styles.iconWrapSuccess]}>
          <Ionicons name="checkmark-circle" size={20} color="#FFFFFF" />
        </View>
        <View style={styles.textWrap}>
          <Text style={styles.title} numberOfLines={1}>
            Mise à jour installée · {currentLabel}
          </Text>
          <Text style={styles.subtitle} numberOfLines={1}>
            {justUpdatedFromBuild != null
              ? `Vous étiez sur le Build ${justUpdatedFromBuild}`
              : 'Vous utilisez la dernière version'}
          </Text>
        </View>
        <TouchableOpacity style={styles.closeBtn} onPress={() => { acknowledgeJustUpdated(); }} hitSlop={8}>
          <Ionicons name="close" size={18} color="#FFFFFFCC" />
        </TouchableOpacity>
      </View>
    );
  }

  if (!updateAvailable) return null;

  const fallbackToBrowser = async () => {
    try {
      const supported = await Linking.canOpenURL(downloadUrl);
      if (supported) {
        await Linking.openURL(downloadUrl);
      } else if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.open(downloadUrl, '_blank');
      } else {
        await Clipboard.setStringAsync(downloadUrl);
        Alert.alert('Lien copié', 'Le lien a été copié dans le presse-papier.');
      }
    } catch {
      try {
        await Clipboard.setStringAsync(downloadUrl);
        Alert.alert('Lien copié', 'Le lien a été copié dans le presse-papier.');
      } catch {}
    }
  };

  const handleUpdate = async () => {
    if (state !== 'idle') return;

    // Sur le web on garde l'ouverture dans un nouvel onglet
    if (Platform.OS === 'web') {
      await fallbackToBrowser();
      return;
    }

    // Sur iOS on ne devrait jamais arriver ici (updateAvailable=false sur iOS),
    // mais par sécurité on retombe sur le navigateur.
    if (Platform.OS !== 'android') {
      await fallbackToBrowser();
      return;
    }

    try {
      setState('downloading');
      setProgress(0);

      const fileName = `buildtrack-${latestLabel ? latestLabel.replace(/\s+/g, '-').toLowerCase() : 'release'}.apk`;
      const targetUri = (FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? '') + fileName;

      // On supprime un éventuel téléchargement précédent du même nom pour
      // éviter qu'expo-file-system reprenne un fichier corrompu.
      try { await FileSystem.deleteAsync(targetUri, { idempotent: true }); } catch {}

      const resumable = FileSystem.createDownloadResumable(
        downloadUrl,
        targetUri,
        {},
        (p) => {
          if (p.totalBytesExpectedToWrite > 0) {
            setProgress(p.totalBytesWritten / p.totalBytesExpectedToWrite);
          }
        },
      );
      resumableRef.current = resumable;

      const result = await resumable.downloadAsync();
      resumableRef.current = null;

      if (!result?.uri) {
        throw new Error('Téléchargement interrompu');
      }

      downloadedUriRef.current = result.uri;
      setState('opening');

      // Étape 1 : convertir le file:// en content:// (FileProvider Expo).
      // Indispensable depuis Android 7 (FileUriExposedException sinon).
      let contentUri: string | null = null;
      try {
        contentUri = await FileSystem.getContentUriAsync(result.uri);
      } catch {
        contentUri = null;
      }

      // Étape 2 : ouvrir directement le programme d'installation de paquets
      // via ACTION_VIEW. C'est le seul intent qui déclenche l'écran natif
      // « Voulez-vous installer cette application ? ».
      let installLaunched = false;
      if (contentUri) {
        try {
          await IntentLauncher.startActivityAsync(
            'android.intent.action.VIEW',
            {
              data: contentUri,
              flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
              type: 'application/vnd.android.package-archive',
            },
          );
          installLaunched = true;
          installLaunchedRef.current = true;
        } catch {
          installLaunched = false;
        }
      }

      // Étape 3 : si l'intent VIEW a échoué (vieux Android, OEM, etc.),
      // on retombe sur le sheet de partage en dernier recours.
      if (!installLaunched) {
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          installLaunchedRef.current = true;
          await Sharing.shareAsync(result.uri, {
            mimeType: 'application/vnd.android.package-archive',
            dialogTitle: 'Installer la mise à jour BuildTrack',
            UTI: 'public.archive',
          });
        } else {
          await fallbackToBrowser();
          // Le navigateur n'a pas de retour à gérer côté AppState.
          setState('idle');
          setProgress(0);
        }
      }

      // NB : on ne reset PAS state/progress ici quand l'install est lancée.
      // Le listener AppState s'en charge au retour de l'utilisateur, ce qui
      // évite que le bouton repasse à « Mettre à jour » avant que l'écran
      // d'installation soit même affiché.
    } catch (err) {
      resumableRef.current = null;
      setState('idle');
      setProgress(0);
      Alert.alert(
        'Téléchargement impossible',
        'Le téléchargement intégré a échoué. On va l\'ouvrir dans votre navigateur.',
        [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Ouvrir', onPress: () => { fallbackToBrowser(); } },
        ],
      );
    }
  };

  const isBusy = state !== 'idle';
  const pct = Math.round(progress * 100);
  const buttonLabel =
    state === 'downloading'
      ? `Téléchargement ${pct}%`
      : state === 'opening'
        ? 'Ouverture…'
        : 'Mettre à jour';

  return (
    <View style={styles.banner}>
      <View style={styles.iconWrap}>
        <Ionicons name="rocket" size={20} color="#FFFFFF" />
      </View>
      <View style={styles.textWrap}>
        <Text style={styles.title} numberOfLines={1}>
          Nouvelle version disponible{latestLabel ? ` · ${latestLabel}` : ''}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {state === 'downloading'
            ? 'Téléchargement en cours, ne fermez pas l\'application'
            : publishedRelative
              ? `Publiée ${publishedRelative}`
              : 'Mettez à jour pour les dernières améliorations'}
        </Text>
        {state === 'downloading' && (
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.max(2, pct)}%` }]} />
          </View>
        )}
      </View>
      <TouchableOpacity
        style={[styles.updateBtn, isBusy && styles.updateBtnBusy]}
        onPress={handleUpdate}
        activeOpacity={0.85}
        disabled={isBusy}
      >
        <Text style={styles.updateBtnText} numberOfLines={1}>{buttonLabel}</Text>
      </TouchableOpacity>
      {!isBusy && (
        <TouchableOpacity style={styles.closeBtn} onPress={dismiss} hitSlop={8}>
          <Ionicons name="close" size={18} color="#FFFFFFCC" />
        </TouchableOpacity>
      )}
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
  bannerSuccess: {
    backgroundColor: '#10B981',
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#FFFFFF22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapSuccess: {
    backgroundColor: '#FFFFFF33',
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
  progressTrack: {
    marginTop: 6,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#FFFFFF33',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 2,
    backgroundColor: '#FFFFFF',
  },
  updateBtn: {
    backgroundColor: '#FFFFFF',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
    minWidth: 110,
    alignItems: 'center',
  },
  updateBtnBusy: {
    opacity: 0.85,
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
