# BuildTrack — Design system public

Les règles propres à une page dans `pages/` priment sur ce socle. Ce document couvre l'identité publique BuildTrack ; les écrans métier existants conservent leurs contraintes produit.

## Principes

- Une interface opérationnelle, précise et calme, inspirée du plan d'exécution.
- L'information produit est le visuel principal : aucune preuve client, métrique ou intégration inventée.
- La continuité entre mobile et web doit rester visible dans la composition.
- Les fonctions avancées sont montrées par leurs parcours reliés, jamais comme une simple grille de promesses.
- Le logo officiel est exclusivement `assets/images/icon.png`.

## Palette

| Jeton | Valeur | Usage |
|---|---:|---|
| `--ink` | `#071B3A` | Titres, surfaces sombres |
| `--blue` | `#003082` | Navigation, liens, états actifs |
| `--orange` | `#FF861F` | Conversion, progression, repères |
| `--yellow` | `#FFCB00` | Signal secondaire ponctuel |
| `--paper` | `#F7F9FC` | Fond principal |
| `--surface` | `#FFFFFF` | Interfaces et formulaires |
| `--muted` | `#5D7088` | Texte secondaire |
| `--border` | `#D9E2EC` | Séparateurs et contrôles |
| `--success` | `#1B8A66` | Validation, synchronisation |
| `--danger` | `#C93B32` | Alerte, criticité |

Les aplats et la grille technique portent la profondeur. Aucun gradient décoratif n'est utilisé.

## Typographie

- Titres : `Bricolage Grotesque`, graisse 650 à 800, interlignage 0,95 à 1,08.
- Texte et interface : `Manrope`, graisse 400 à 750, corps 16 px par défaut.
- Les paragraphes commerciaux restent sous 65 caractères par ligne.
- Français, anglais et espagnol doivent conserver la même hiérarchie sans taille figée.

## Géométrie

- Rayons de 6 à 14 px pour les contrôles et cadres produit ; pas de cartes systématiquement arrondies.
- Cibles interactives de 44 px minimum.
- Bordures fines et séparateurs structurants avant les ombres.
- Ombres réservées aux niveaux réellement superposés : navigation, téléphone, formulaire, menu.

## Composants

- CTA principal orange, texte encre, hauteur minimale 48 px.
- CTA secondaire sobre, sans faux contour en capsule.
- États `hover`, `focus-visible`, `disabled`, succès et erreur obligatoires.
- Icônes SVG cohérentes, sans emoji ni mélange de familles.
- Les maquettes produit utilisent des données fictives explicitement neutres (`Projet Horizon`).

## Mouvement

- Micro-interactions de 180 à 240 ms.
- Révélations de contenu de 500 à 700 ms au maximum.
- Une animation doit expliquer un état réel : scan, synchronisation ou progression.
- Aucun scroll-jacking, parallaxe forcée ou animation décorative continue.
- `prefers-reduced-motion: reduce` neutralise toute animation non essentielle.

## Accessibilité et qualité

- Contraste WCAG AA minimum et focus clavier toujours visible.
- Les contrôles ont un nom accessible dans chacune des trois langues.
- Aucun contenu ne dépend de la couleur ou de l'animation seule.
- Validation obligatoire à 375, 768, 1024 et 1440 px, sans défilement horizontal.
- La langue du navigateur sélectionne FR, EN ou ES ; toute autre langue utilise l'anglais.
