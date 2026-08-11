import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  AppStateStatus,
  Linking,
  Platform,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';
import { useTranslation } from 'react-i18next';

export type ApkInstallState = 'idle' | 'downloading' | 'opening';

interface UseApkInstallerOptions {
  downloadUrl: string;
  releaseLabel?: string | null;
}

export interface ApkInstallerState {
  state: ApkInstallState;
  progress: number;
  progressPercent: number;
  isBusy: boolean;
  startUpdate: () => Promise<void>;
}

/**
 * Canonical BuildTrack APK installation flow.
 *
 * Both the Terrain update banner and the mandatory security gate must use this
 * hook so Android keeps the original in-app experience: download with progress,
 * FileProvider content URI, then direct launch of the native package installer.
 */
export function useApkInstaller({
  downloadUrl,
  releaseLabel,
}: UseApkInstallerOptions): ApkInstallerState {
  const { t } = useTranslation();
  const [state, setState] = useState<ApkInstallState>('idle');
  const [progress, setProgress] = useState(0);
  const resumableRef = useRef<FileSystem.DownloadResumable | null>(null);
  const downloadedUriRef = useRef<string | null>(null);
  const installLaunchedRef = useRef(false);
  const stateRef = useRef<ApkInstallState>('idle');

  const transitionTo = useCallback((next: ApkInstallState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', async (next: AppStateStatus) => {
      if (next !== 'active' || !installLaunchedRef.current) return;

      installLaunchedRef.current = false;
      transitionTo('idle');
      setProgress(0);

      const uri = downloadedUriRef.current;
      downloadedUriRef.current = null;
      if (uri) {
        try {
          await FileSystem.deleteAsync(uri, { idempotent: true });
        } catch {}
      }
    });
    return () => { sub.remove(); };
  }, [transitionTo]);

  const fallbackToBrowser = useCallback(async () => {
    try {
      const supported = await Linking.canOpenURL(downloadUrl);
      if (supported) {
        await Linking.openURL(downloadUrl);
      } else if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.open(downloadUrl, '_blank');
      } else {
        await Clipboard.setStringAsync(downloadUrl);
        Alert.alert(t('updateBanner.linkCopiedTitle'), t('updateBanner.linkCopiedText'));
      }
    } catch {
      try {
        await Clipboard.setStringAsync(downloadUrl);
        Alert.alert(t('updateBanner.linkCopiedTitle'), t('updateBanner.linkCopiedText'));
      } catch {}
    }
  }, [downloadUrl, t]);

  const startUpdate = useCallback(async () => {
    if (stateRef.current !== 'idle') return;

    if (Platform.OS === 'web' || Platform.OS !== 'android') {
      await fallbackToBrowser();
      return;
    }

    try {
      transitionTo('downloading');
      setProgress(0);

      const baseDirectory = FileSystem.cacheDirectory ?? FileSystem.documentDirectory;
      if (!baseDirectory) throw new Error('APK download directory unavailable');

      const safeLabel = releaseLabel
        ? releaseLabel.replace(/[^a-z0-9._-]+/gi, '-').toLowerCase()
        : 'release';
      const targetUri = `${baseDirectory}buildtrack-${safeLabel}.apk`;

      try {
        await FileSystem.deleteAsync(targetUri, { idempotent: true });
      } catch {}

      const resumable = FileSystem.createDownloadResumable(
        downloadUrl,
        targetUri,
        {},
        (downloadProgress) => {
          if (downloadProgress.totalBytesExpectedToWrite > 0) {
            setProgress(
              downloadProgress.totalBytesWritten
              / downloadProgress.totalBytesExpectedToWrite,
            );
          }
        },
      );
      resumableRef.current = resumable;

      const result = await resumable.downloadAsync();
      resumableRef.current = null;

      if (!result?.uri || (result.status && (result.status < 200 || result.status >= 300))) {
        throw new Error(t('updateBanner.downloadInterrupted'));
      }

      downloadedUriRef.current = result.uri;
      transitionTo('opening');

      let contentUri: string | null = null;
      try {
        contentUri = await FileSystem.getContentUriAsync(result.uri);
      } catch {
        contentUri = null;
      }

      let installLaunched = false;
      if (contentUri) {
        try {
          await IntentLauncher.startActivityAsync(
            'android.intent.action.VIEW',
            {
              data: contentUri,
              flags: 1,
              type: 'application/vnd.android.package-archive',
            },
          );
          installLaunched = true;
          installLaunchedRef.current = true;
        } catch {
          installLaunched = false;
        }
      }

      if (!installLaunched) {
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          installLaunchedRef.current = true;
          await Sharing.shareAsync(result.uri, {
            mimeType: 'application/vnd.android.package-archive',
            dialogTitle: t('updateBanner.installDialogTitle'),
            UTI: 'public.archive',
          });
        } else {
          await fallbackToBrowser();
          transitionTo('idle');
          setProgress(0);
        }
      }
    } catch {
      resumableRef.current = null;
      transitionTo('idle');
      setProgress(0);
      Alert.alert(
        t('updateBanner.downloadImpossibleTitle'),
        t('updateBanner.downloadImpossibleText'),
        [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('updateBanner.open'), onPress: () => { void fallbackToBrowser(); } },
        ],
      );
    }
  }, [downloadUrl, fallbackToBrowser, releaseLabel, t, transitionTo]);

  return {
    state,
    progress,
    progressPercent: Math.round(progress * 100),
    isBusy: state !== 'idle',
    startUpdate,
  };
}
