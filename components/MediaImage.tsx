import React, { useEffect, useState } from 'react';
import { Image as NativeImage, type ImageProps, type ImageSourcePropType } from 'react-native';
import { isManagedMediaRef, resolveMediaRef } from '@/lib/media';

function sourceUri(source: ImageSourcePropType | undefined): string | null {
  if (!source || typeof source === 'number' || Array.isArray(source)) return null;
  return typeof source.uri === 'string' ? source.uri : null;
}

export function MediaImage({ source, ...props }: ImageProps) {
  const originalUri = sourceUri(source);
  const [resolvedUri, setResolvedUri] = useState<string | null>(
    originalUri && !isManagedMediaRef(originalUri) ? originalUri : null,
  );

  useEffect(() => {
    let cancelled = false;
    if (!originalUri) {
      setResolvedUri(null);
      return () => { cancelled = true; };
    }
    if (!isManagedMediaRef(originalUri)) {
      setResolvedUri(originalUri);
      return () => { cancelled = true; };
    }
    setResolvedUri(null);
    void resolveMediaRef(originalUri, { cacheDisk: true }).then(uri => {
      if (!cancelled) setResolvedUri(uri);
    });
    return () => { cancelled = true; };
  }, [originalUri]);

  const nextSource = originalUri
    ? (resolvedUri ? { ...(source as object), uri: resolvedUri } : undefined)
    : source;
  return <NativeImage {...props} source={nextSource} />;
}
