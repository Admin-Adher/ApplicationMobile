import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Application from 'expo-application';

export const PRIVATE_MEDIA_PROTOCOL_VERSION = 1;

export function currentBuildNumber(): number | null {
  if (Platform.OS === 'android') {
    const native = Application.nativeBuildVersion;
    if (typeof native === 'string' && /^\d+$/.test(native)) {
      const value = Number.parseInt(native, 10);
      if (value > 0) return value;
    }
  }
  const config: any = Constants.expoConfig ?? (Constants as any).manifest;
  const configured = config?.android?.versionCode;
  if (typeof configured === 'number' && configured > 0) return configured;
  if (typeof configured === 'string' && /^\d+$/.test(configured)) {
    return Number.parseInt(configured, 10);
  }
  return null;
}

export function currentApplicationVersion(): string {
  const native = Application.nativeApplicationVersion;
  if (typeof native === 'string' && native.trim()) return native.trim();
  const config: any = Constants.expoConfig ?? (Constants as any).manifest;
  return String(config?.version ?? '0.0.0');
}

export function privateMediaClientHeaders(): Record<string, string> {
  const build = currentBuildNumber();
  return {
    'X-BuildTrack-Client': Platform.OS,
    'X-BuildTrack-Client-Version': currentApplicationVersion(),
    'X-BuildTrack-Media-Protocol': String(PRIVATE_MEDIA_PROTOCOL_VERSION),
    ...(build != null ? { 'X-BuildTrack-Build': String(build) } : {}),
  };
}
