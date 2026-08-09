# Benchmark de reconnaissance des codes-barres BTP

## Résultat du 9 août 2026

Le banc comprend dix GTIN valides provenant de dix fabricants et de cinq familles BTP. Les deux catalogues ouverts utilisés par BuildTrack ont été interrogés en direct : ils ont trouvé **0/10** produit. Une recherche web du GTIN exact a retrouvé **10/10** références. Sur les extraits de recherche vérifiés, l’ancien interpréteur produisait seulement **3/10** désignations contenant tous les éléments distinctifs attendus et acceptait à tort un titre générique de catalogue.

Après correction :

- produits trouvés dans les extraits vérifiés : **10/10** ;
- variantes contenant la référence, le modèle ou les dimensions attendues : **10/10** ;
- scénarios négatifs acceptés : **0/2** ;
- faux titre « ACCESSOIRES 2026 » : rejeté.

Un essai direct complémentaire du catalogue généraliste UPCitemdb a retrouvé **6/10** GTIN BTP (Hager, GROHE, KNIPEX, Wiha, Makita et Wera). Les six identités correspondaient exactement au GTIN demandé, mais plusieurs titres ne contenaient pas tous les détails de la fiche fabricant. Ils sont donc utilisés comme préremplissage à confiance moyenne, puis enrichis par la recherche web exacte quand celle-ci est configurée. Les quatre autres références (Legrand, Bosch Professional, HellermannTyton et Rawlplug) restent dépendantes de la recherche web ou de la saisie manuelle.

Ce résultat mesure le moteur sur ce jeu représentatif, pas l’ensemble des produits commercialisés. Il ne constitue donc pas une promesse universelle de 100 %. Le test en conditions réelles dépend aussi de la présence du secret serveur `BRAVE_SEARCH_API_KEY`, de l’indexation de la page et de la qualité de son extrait.

## Jeu de références

| Fabricant | GTIN | Produit / variante contrôlée | Source fabricant |
|---|---:|---|---|
| Legrand | 3245064079709 | DX3, disjoncteur 1P courbe D 13 A, réf. 407970 | [Legrand](https://www.legrand.com/ecatalogue/en/catalog/products/mcb-dx3-6000a-1-pole-13a-curve-407970) |
| Hager | 3250614435225 | Protection moteur 3P 4,0–6,3 A, MM509N | [Hager](https://hager.com/intl-en/products/information/mm509n-motor-starter-4-0-6-3a-2-5m) |
| GROHE | 4005176465468 | Essence, mitigeur 1 sortie, réf. 24057001 | [GROHE](https://www.grohe.fr/fr_fr/essence-mitigeur-monocommande-1-sortie-24057001.html) |
| KNIPEX | 4003773033837 | Pince-clé 250 mm, réf. 86 03 250 | [KNIPEX](https://www.knipex.com/fr-fr/produits/pinces-multiprises-et-cles-serre-tubes/pinces-cles-pince-et-cle-a-la-fois/pinces-cles-pince-et-cle-a-la-fois/8603250) |
| Wiha | 4010995008802 | Tournevis VDE SoftFinish PZ3, 150 mm, réf. 00880 | [Wiha](https://wiha.com/tools/screwdrivers/vde-screwdrivers/softfinish-electric/pozidriv/screwdriver-softfinish-electric/00880) |
| Makita | 0088381367004 | Batterie BL1830, 18 V 3,0 Ah, réf. 193533-3 | [Makita](https://www.makita.fr/data/sr/productinfo/generated/193533-3_fiche_produit.pdf) |
| Bosch Professional | 4059952650234 | Foret PRO HEX-5 3 × 50 × 100 mm, réf. 2 608 706 968 | [Catalogue Bosch 2026](https://www.bosch-professional.com/ch/media/service_relaunch/downloads/kataloge/2026_t1/ac_ch_fr-web.pdf) |
| Wera | 4013288017772 | Tournevis à frapper 918 SPZ PZ1 × 80 mm, réf. 05017050001 | [Wera](https://hybris-media.wera.de/download/pdfgenerator-datasheets/en/05017050001.pdf) |
| HellermannTyton | 4031026479880 | Ruban HTAPE-FLEX15 noir, 19 mm × 20 m, réf. 710-00155 | [HellermannTyton](https://www.hellermanntyton.com/ar/productos/cintas-aislantes/htape-flex15-19x20/710-00155) |
| Rawlplug | 5906675001050 | Cheville à frapper FX-C 5 × 30 mm, boîte de 200 | [Rawlplug](https://rawlplug.com/global/en/p/fx-05c030) |

## Rejouer la mesure

Le test déterministe utilise des extraits issus des pages ci-dessus et vérifie chaque élément distinctif :

```text
npm run test:barcode-btp
npm run benchmark:barcode-btp
```

Le mode live effectue dix requêtes réelles au fournisseur web et peut donc consommer son quota :

```powershell
$env:BRAVE_SEARCH_API_KEY = '<clé serveur>'
npm run benchmark:barcode-btp -- --live
```

La clé ne doit être présente que dans l’environnement serveur ou les secrets Supabase. Elle ne doit jamais être ajoutée à l’APK, à une variable `EXPO_PUBLIC_*` ou au dépôt Git.
