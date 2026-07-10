import React from 'react';
import { StyleProp, View, ViewStyle } from 'react-native';

/**
 * Conteneur de page responsive : sur grand écran (web desktop, tablette),
 * limite la largeur du contenu et le centre au lieu de l'étirer sur toute
 * la fenêtre (lignes interminables, champs démesurés). Sans effet visible
 * sur téléphone, où la largeur de fenêtre reste inférieure à maxWidth.
 *
 * Usage : envelopper le contenu de l'écran (après le Header pleine largeur) —
 * maxWidth ~720-800 pour un écran de formulaire, ~1000-1100 pour une liste
 * ou un tableau de bord.
 */
export default function PageContainer({
  children,
  maxWidth = 1080,
  style,
}: {
  children: React.ReactNode;
  maxWidth?: number;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[{ flex: 1, width: '100%', maxWidth, alignSelf: 'center' }, style]}>
      {children}
    </View>
  );
}
