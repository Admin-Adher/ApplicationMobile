import { useWindowDimensions } from 'react-native';

export const TABLET_SIDEBAR_W = 72;
export const TABLET_RESERVE_PANEL_W = 340;

export function useTablet() {
  const { width } = useWindowDimensions();
  const isTablet = width >= 768;
  return { isTablet, screenWidth: width };
}
