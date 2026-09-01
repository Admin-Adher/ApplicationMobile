import React, { useEffect, useRef, useState } from 'react';
import {
  Image as NativeImage,
  type ImageProps,
  type ImageSourcePropType,
} from 'react-native';
import {
  invalidateMediaRef,
  isManagedMediaRef,
  isRetryableMediaResolutionError,
  resolveMediaRefOrThrow,
} from '@/lib/media';
import { subscribeSessionRecovery } from '@/lib/sessionExpiry';

const TRANSPARENT_PIXEL_URI =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==';
const RETRY_DELAYS_MS = [750, 2_500, 8_000, 30_000, 60_000] as const;

function sourceUri(source: ImageSourcePropType | undefined): string | null {
  if (!source || typeof source === 'number' || Array.isArray(source)) return null;
  return typeof source.uri === 'string' ? source.uri : null;
}

function resolutionErrorEvent(message: string): Parameters<NonNullable<ImageProps['onError']>>[0] {
  return { nativeEvent: { error: message } } as Parameters<NonNullable<ImageProps['onError']>>[0];
}

export function MediaImage({
  onError,
  onLoad,
  source,
  ...props
}: ImageProps) {
  const originalUri = sourceUri(source);
  const managed = Boolean(originalUri && isManagedMediaRef(originalUri));
  const [resolvedUri, setResolvedUri] = useState<string | null>(
    originalUri && !managed ? originalUri : null,
  );
  const [resolutionCycle, setResolutionCycle] = useState(0);
  const retryCountRef = useRef(0);
  const nativeFailureCountRef = useRef(0);
  const needsRecoveryRef = useRef(false);
  const reportedErrorRef = useRef(false);
  const onErrorRef = useRef(onError);
  const onLoadRef = useRef(onLoad);

  useEffect(() => { onErrorRef.current = onError; }, [onError]);
  useEffect(() => { onLoadRef.current = onLoad; }, [onLoad]);

  useEffect(() => {
    retryCountRef.current = 0;
    nativeFailureCountRef.current = 0;
    needsRecoveryRef.current = false;
    reportedErrorRef.current = false;
  }, [originalUri]);

  useEffect(() => subscribeSessionRecovery(() => {
    if (!needsRecoveryRef.current) return;
    retryCountRef.current = 0;
    setResolutionCycle(value => value + 1);
  }), []);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    if (!originalUri) {
      setResolvedUri(null);
      return () => { cancelled = true; };
    }
    if (!isManagedMediaRef(originalUri)) {
      setResolvedUri(originalUri);
      return () => { cancelled = true; };
    }

    setResolvedUri(null);
    void resolveMediaRefOrThrow(originalUri, { cacheDisk: true }).then(uri => {
      if (cancelled) return;
      retryCountRef.current = 0;
      needsRecoveryRef.current = false;
      reportedErrorRef.current = false;
      setResolvedUri(uri);
    }).catch((error: unknown) => {
      if (cancelled) return;
      if (isRetryableMediaResolutionError(error)) {
        needsRecoveryRef.current = true;
        const retryIndex = Math.min(retryCountRef.current, RETRY_DELAYS_MS.length - 1);
        retryCountRef.current += 1;
        retryTimer = setTimeout(
          () => setResolutionCycle(value => value + 1),
          RETRY_DELAYS_MS[retryIndex],
        );
        return;
      }

      needsRecoveryRef.current = false;
      if (!reportedErrorRef.current) {
        reportedErrorRef.current = true;
        onErrorRef.current?.(resolutionErrorEvent(
          error instanceof Error ? error.message : 'Média indisponible',
        ));
      }
    });

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [originalUri, resolutionCycle]);

  const handleNativeError: NonNullable<ImageProps['onError']> = event => {
    if (!originalUri || !managed || nativeFailureCountRef.current >= 1) {
      onErrorRef.current?.(event);
      return;
    }

    // A signed URL may expire between resolution and download, or a previous
    // disk cache entry may be corrupt. Invalidate once and obtain a fresh URL
    // before exposing a permanent broken-image state to the parent.
    nativeFailureCountRef.current += 1;
    needsRecoveryRef.current = true;
    setResolvedUri(null);
    void invalidateMediaRef(originalUri).finally(() => {
      setResolutionCycle(value => value + 1);
    });
  };

  const handleNativeLoad: NonNullable<ImageProps['onLoad']> = event => {
    if (managed && !resolvedUri) return; // transparent loading pixel
    nativeFailureCountRef.current = 0;
    needsRecoveryRef.current = false;
    onLoadRef.current?.(event);
  };

  const nextSource = originalUri
    ? (
        resolvedUri
          ? { ...(source as object), uri: resolvedUri }
          : managed
            ? { uri: TRANSPARENT_PIXEL_URI }
            : source
      )
    : source;

  return (
    <NativeImage
      {...props}
      source={nextSource}
      onError={handleNativeError}
      onLoad={handleNativeLoad}
    />
  );
}
