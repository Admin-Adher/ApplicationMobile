# BuildTrack — Landing commerciale

Ce fichier remplace les choix generiques du fichier `MASTER.md` pour la page publique.

## Direction

- **Voie visuelle :** precision d'un plan d'execution, clarte d'un logiciel d'operations moderne.
- **Idee directrice :** une ligne orange, le « track », relie terrain, bureau et decision.
- **Promesse :** « Rien ne se perd entre le terrain et le bureau. »
- **Voix :** concrete, directe, fiable. Aucun jargon marketing, faux logo client, faux temoignage ou chiffre invente.
- **Composition :** asymetrique, lumineuse et technique. Les interfaces produit sont les visuels principaux.

## Typographie

- Titres : `Bricolage Grotesque`, compacte, technique, expressive.
- Texte et interface : `Manrope`, lisible et moins generique qu'Inter.
- Identite : reutiliser exclusivement le logo officiel `assets/images/icon.png` ; aucune reinterpretation du pictogramme.
- Taille de base : 16 px minimum.
- Titres courts, interlignage serre; paragraphes limites a environ 62 caracteres.

## Palette

| Role | Couleur |
|---|---|
| Encre | `#071B3A` |
| Bleu BuildTrack | `#003082` |
| Orange de progression | `#FF861F` |
| Jaune de signal | `#FFCB00` |
| Fond principal | `#F7F9FC` |
| Fond bleu pale | `#EAF1FA` |
| Surface | `#FFFFFF` |
| Texte | `#13243F` |
| Texte secondaire | `#5D7088` |
| Bordure | `#D9E2EC` |
| Succes | `#1B8A66` |
| Danger | `#C93B32` |

## Structure de conversion

1. Navigation simple avec demonstration et connexion.
2. Hero : promesse, preuves factuelles et scene produit web + mobile.
3. Bande de preuves : mobile et web, hors ligne, temps reel, roles sur mesure.
4. Parcours relie : constater, assigner, suivre, valider, rapporter.
5. Trois mondes produit : plans/reserves, terrain/coordination, stock/logistique.
6. Flux avances relies : plans, reserves, messagerie, visites, OPR, journal, pointage, documents, rapports et securite.
7. Interface adaptee au role.
8. Fiabilite operationnelle et securite.
9. Inventaire lisible des capacites.
10. FAQ.
11. Formulaire de demande de demonstration.

## Langues

- Traduction complete en anglais, francais et espagnol, y compris maquettes, formulaires et libelles accessibles.
- Detection de la langue principale du navigateur au premier affichage.
- Anglais par defaut si la langue principale n'est pas supportee.
- Selecteur manuel persistant par cookie et stockage local.

## Mouvement

- Une entree orchestree au chargement du hero.
- Une ligne orange se dessine une seule fois dans le parcours.
- Revelations de sections discretes par `IntersectionObserver`.
- Un faisceau de scan dans la maquette mobile.
- Durations de 180 a 700 ms; aucun scroll-jacking ou parallaxe.
- Toute animation est neutralisee avec `prefers-reduced-motion: reduce`.

## Regles d'interface

- Cibles tactiles de 44 px minimum.
- Focus clavier visible sur chaque controle.
- Contraste WCAG AA minimum.
- Aucun emoji utilise comme icone.
- Icones SVG coherentes, traits arrondis de 1,8 px.
- Pas de grille de cartes generiques repetitives, de gradients decoratifs ou de pills omnipresentes.
- Aucun contenu ne depend de l'animation pour etre compris.
- Responsive sans debordement a 375, 768, 1024 et 1440 px.
