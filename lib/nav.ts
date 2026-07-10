import { router } from 'expo-router';

/**
 * Retour arrière robuste, notamment sur le web.
 *
 * `router.back()` est un no-op quand la pile de navigation est vide : URL
 * ouverte directement, rafraîchissement de page ou lien partagé sur le web.
 * Les boutons « retour » paraissaient alors morts (clic sans effet). On
 * retombe ici sur une destination sûre quand il n'y a pas de page précédente.
 */
export function goBack(fallback: string = '/(tabs)/') {
  if (router.canGoBack()) router.back();
  else router.navigate(fallback as any);
}
