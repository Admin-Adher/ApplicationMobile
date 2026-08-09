import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

// Android edge-to-edge can report a zero bottom inset while the three-button
// navigation bar is still drawn over the app. Android exposes no reliable API
// to distinguish three-button navigation from gesture navigation, so reserve
// the standard 48 dp navigation-bar height whenever the native inset is absent.
const ANDROID_NAVIGATION_BAR_FALLBACK = 48;

export function useBottomNavigationInset(): number {
  const insets = useSafeAreaInsets();

  if (Platform.OS === 'web') return 0;
  if (Platform.OS === 'android') {
    return Math.max(insets.bottom, ANDROID_NAVIGATION_BAR_FALLBACK);
  }

  return insets.bottom;
}
