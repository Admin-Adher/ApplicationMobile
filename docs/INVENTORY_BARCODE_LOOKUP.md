# Reconnaissance produit par code-barres

## Ordre de résolution

Après lecture du symbole par `expo-camera`, BuildTrack recherche la désignation dans cet ordre :

1. produits déjà enregistrés dans le stock du chantier actif ;
2. cache local du téléphone ;
3. [Open Products Facts](https://world.openproductsfacts.org/) ;
4. [Open Food Facts](https://world.openfoodfacts.org/) ;
5. recherche web authentifiée côté serveur ;
6. saisie manuelle ou photographie/OCR de l’étiquette.

La référence interne et le code-barres restent modifiables. Une réponse distante ne remplace jamais une désignation que l’utilisateur a déjà saisie. Une sortie reste interdite si le produit identifié n’existe pas dans le stock BuildTrack du chantier.

La désignation proposée conserve les informations distinctives disponibles : marque/famille, modèle, référence fabricant et poids, calibre, dimension ou conditionnement. Par exemple, une source qui renvoie `Nutella` et `400 g` produit la désignation `Nutella — 400 g`. Si elle ne renvoie que `Nutella`, l'interface marque la variante comme incomplète et demande au magasinier de vérifier le conditionnement. Le GTIN reste enregistré dans le champ code-barres : deux variantes portant un nom proche ne sont donc pas fusionnées.

Les GTIN-8, UPC-A, EAN-13 et GTIN-14 sont comparés dans leur représentation canonique à 14 chiffres. Cela permet de retrouver le même produit lorsqu’un lecteur renvoie un UPC-A et un autre son équivalent EAN-13.

Selon la [règle GS1 sur le contenu net déclaré](https://www.gs1.org/1/gtinrules/en/rule/266/declared-net-content), une modification de poids, volume ou quantité déclarée impose un nouveau GTIN. Le code identifie donc bien la variante commerciale ; la désignation détaillée sert à rendre cette différence immédiatement lisible pour le magasinier.

## Recherche web serveur

L'application mobile tente d'abord l'Edge Function Supabase authentifiée :

```text
POST https://<project-ref>.supabase.co/functions/v1/inventory-barcode-lookup
Authorization: Bearer <session Supabase>
apikey: <clé publique Supabase>
```

L'endpoint `/api/inventory-barcode-lookup` du serveur BuildTrack reste disponible comme repli. L'Edge Function `inventory-barcode-lookup` est déployée avec `verify_jwt = true` : un appel sans session valide est rejeté avant d'atteindre le fournisseur de recherche.

Le fournisseur actuellement supporté est Brave Search. Configurer la clé dans les secrets du projet Supabase et, si le serveur BuildTrack est utilisé, dans ses variables d'environnement :

```text
BRAVE_SEARCH_API_KEY=<clé serveur>
```

La clé ne doit jamais être préfixée par `EXPO_PUBLIC_`, incluse dans l’APK ou commitée. Sans cette variable, les catalogues ouverts et la recherche locale continuent de fonctionner ; l’interface propose un bouton qui ouvre une recherche Internet manuelle.

Le serveur limite chaque utilisateur à 20 recherches par minute, exige une session Supabase valide, n’accepte qu’un code court et ne met pas les résultats web en cache. Un résultat n’est retenu que si le code exact apparaît dans son titre, son extrait ou son URL. Les agrégateurs génériques de codes-barres sont exclus afin de réduire les faux positifs.

## Vérification rapide

- `3017620422003` : présent dans Open Food Facts. Si la fiche publique ne renvoie que « Nutella », BuildTrack doit préremplir ce nom tout en affichant l'avertissement de variante incomplète ; il ne doit pas inventer « 400 g ».
- `3245064079709` : référence Legrand absente des catalogues ouverts au moment de l’implémentation ; elle permet de valider le repli vers la recherche web lorsque la clé serveur est configurée.
- `ABC-12580` : référence interne ; elle est d’abord recherchée dans BuildTrack puis, si nécessaire, côté web.

Les tests automatisés sont exécutés avec :

```text
npm test
```
