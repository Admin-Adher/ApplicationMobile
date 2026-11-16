# Suivi MEP sur plans PDF

État de cette notice : développement du 16 novembre 2026. Elle décrit le code et les recettes locales avec données fictives. Elle ne constitue ni une validation en production, ni une recette sur tablette avec stylet ou sur un APK Android physique.

Le suivi MEP étend le module Ouvrages existant. Il ne crée pas une seconde file de synchronisation métier et ne modifie pas les réserves, les annotations générales des plans ou les calculs de facturation existants.

## Utiliser le suivi

1. Dans **Plans**, ouvrir un PDF du chantier puis **Avancement**. Le fichier doit avoir terminé son import. Renseigner le bâtiment du plan avant de créer un point bloquant.
2. Choisir **Ajouter un ouvrage**, puis un équipement, un cheminement ou une surface. Les cheminements acceptent les diagonales ; les tracés restent ajustables après leur création.
3. Dans la fiche, activer **Réseau technique MEP**. Choisir la discipline, le réseau et éventuellement le sous-réseau ; renseigner le local ou la zone et l'entreprise / le lot.
4. Définir la base du prévu : mesure du tracé après calibration, quantitatif renseigné ou estimation manuelle. Les prix restent distincts et facultatifs pour le suivi physique.
5. Sélectionner un tronçon et renseigner son pourcentage ou sa quantité réalisée. Pour un cheminement, **Marquer une portion réalisée** permet de toucher son début puis sa fin, de vérifier la sélection et de valider. Plusieurs portions disjointes sont conservées ; leur chevauchement ne compte pas deux fois. **Corriger une portion réalisée** retire une portion sélectionnée du réalisé.
6. Choisir **Signaler un blocage**, placer son repère sur le plan et renseigner description, photo et entreprise responsable. Une personne, une échéance et une priorité peuvent compléter l'affectation. Indiquer si le point empêche la progression ou représente une réserve à traiter.
7. Ouvrir la liste des points bloquants ou la synthèse MEP du chantier pour filtrer les actions et les réseaux. **Actualiser** lit les autres plans autorisés du même chantier. Le PDF ouvert conserve ses modifications locales.
8. Traiter les points **Ouvert → Affecté / En traitement → Résolu → Vérifié / clos**. La vérification et la clôture sont distinctes de la résolution. Les repères clos restent conservés ; ils ne sont plus comptés comme blocages actifs.
9. Exporter Excel, CSV ou le rapport PDF selon les droits du compte. Sur le web, l'action PDF ouvre l'impression du navigateur : choisir l'enregistrement PDF. Sur Android, le fichier PDF généré est proposé au partage du système.

Le marquage d'une portion suit un cheminement préparé : il ne détecte pas automatiquement les tuyaux ou câbles dans un PDF. Il ne s'agit pas d'un outil de reconnaissance de plans ni d'un pinceau libre dont la couleur suffirait à déterminer le pourcentage.

## Calcul physique et contrôle

- **Mesure du tracé** : longueur, surface ou nombre d'équipements du dessin, avec une échelle propre à chaque page pour les longueurs et surfaces.
- **Quantitatif renseigné** : quantité prévue explicitement saisie. Par exemple, 30 m réalisés sur 100 m prévus représentent 30 %.
- **Estimation manuelle** : pourcentage déclaré explicitement identifié comme estimation, sans prétendre à un métrage automatique.
- **Quantité exécutée** : prévu × pourcentage. Les portions dessinées sont ramenées à des intervalles normalisés du cheminement et leur union détermine le pourcentage.
- **Vérifié** : seul l'état **Contrôlé** de l'ouvrage alimente la quantité vérifiée. La clôture d'un point bloquant ne contrôle pas automatiquement l'ouvrage.
- **Consolidation** : les quantités homogènes sont regroupées par unité ; le pourcentage utilise exécuté / prévu. Des unités différentes ou des estimations utilisent les poids renseignés. Les mètres, unités, m² et m³ ne sont jamais additionnés comme une même quantité.

Les quantités physiques MEP ne remplacent pas les bases financières de prix. Le suivi HT et la proposition de facturation gardent leur méthode existante. Les ouvrages sans quantité fiable sont signalés et exclus du dénominateur métrique ; un affichage de 0 % ne doit pas être interprété comme une mesure fiable en l'absence de référence.

## Droits, preuves et synchronisation

La préparation des réseaux, leur géométrie et leur contrôle réutilisent les droits existants de création / modification. Un compte ayant le droit de modifier sa propre entreprise peut renseigner son avancement non contrôlé. Le traitement d'un blocage affecté est limité à son responsable ou à l'entreprise affectée lorsqu'aucune personne n'est désignée. La clôture vérifiée reste réservée à la préparation / au contrôle.

Les preuves sont des médias privés. Une nouvelle photo est d'abord enregistrée sur l'appareil sous une référence locale, séparée par compte et organisation. La file téléverse ensuite la photo, conserve sa référence privée et prépare les deux côtés de la comparaison avant / après avant d'appeler le RPC. Une interruption ne supprime pas la saisie et ne fabrique pas une réussite.

Les identités d'opération, reçus serveur et contrôles de concurrence existants sont conservés. Deux modifications indépendantes peuvent fusionner ; un conflit sur le même champ est refusé au lieu d'écraser silencieusement l'état serveur. Les prix et le déjà facturé restent masqués aux comptes sans droit financier. Les tables MEP ne deviennent pas directement accessibles aux clients.

Les envois de photos web ont un délai de 60 secondes et nécessitent un navigateur récent prenant en charge Web Locks pour partager une référence finale entre onglets. En cas de navigateur incompatible ou d'échec d'envoi, la photo et la modification restent conservées ; la synchronisation doit être réessayée après résolution du problème.

Pour travailler hors ligne, ouvrir / télécharger le PDF et charger le suivi auparavant. Les nouvelles photos et modifications locales sont conservées pour la reprise. La synthèse d'autres plans doit avoir été chargée en ligne ; son horodatage reste la référence des données affichées. Les aperçus de preuves distantes et les PDF non téléchargés peuvent exiger une connexion. Le module ne fournit pas de service worker global permettant de garantir le premier démarrage complet du site web sans réseau.

## Plans, révisions et calques

Le format du suivi est le **PDF 2D**, avec une limite de 25 Mo par document dans ce lecteur. Les autres lecteurs de BuildTrack ne sont pas étendus par ce module ; il n'ajoute pas de modèle BIM, de 3D ni de lecture DWG.

Une superposition permet d'afficher **un autre PDF de référence à la fois**. Elle propose page, opacité, translation, taille et rotation. L'alignement est manuel ; il doit être vérifié visuellement. Ce calque est temporaire et retiré lors d'un changement de plan / page. Il ne modifie ni l'échelle, ni la géométrie des ouvrages, et ne sert pas de référence de métrage. Les réglages du calque ne constituent pas des calques CAD persistants partagés entre utilisateurs.

Chaque suivi est lié à un identifiant de plan et à sa référence de fichier exacte. Un remplacement de fichier ne repositionne pas les anciens tracés ou repères sur une autre feuille. Les données des anciens suivis restent en base ; la synthèse chantier et les comparaisons de dates portent sur les versions actuelles autorisées. Il n'y a pas de transfert automatique des coordonnées ou des quantités entre indices.

## Restitutions et limites d'export

| Export | Périmètre et contenu |
| --- | --- |
| Excel financier existant | Toutes les pages du PDF courant, avec les feuilles financières conservées et les feuilles Réseaux MEP / Points bloquants ajoutées. |
| Excel MEP | PDF courant si aucun instantané chantier n'est chargé ; sinon versions courantes du chantier, avec l'état local du PDF ouvert. Réseaux, points bloquants, synthèse physique, historique et méthode. |
| CSV MEP | Liste tabulaire des réseaux et quantités dans le même périmètre filtré. Les caractères de formule potentiellement dangereux sont neutralisés. Les détails des points bloquants restent dans l'Excel ou le PDF. |
| Rapport PDF | Synthèse physique, liste des réseaux, actions et photos. Les pages annotées proviennent du **PDF ouvert uniquement**. Les autres plans du chantier sont repris dans le rapport tabulaire ; leurs fonds PDF ne sont pas téléchargés et annotés en série. |

Les PDF reprennent les portions réellement exécutées, les portions restantes, la légende et les points numérotés. Les images sont embarquées et le document d'impression est privé de scripts et d'accès réseau. Les textes longs peuvent continuer sur une autre page ; les titres, mesures et photos sont protégés contre les coupures inutiles.

Un rapport PDF refuse explicitement un périmètre dépassant 30 pages annotées, 80 références photo ou environ 18 Mo de HTML. La résolution des preuves limite également le volume cumulé des photos ; filtrer le rapport si nécessaire. Les instantanés chantier sont bornés à 500 plans et 20 Mo de documents, l'historique à 5 000 opérations et 8 Mo de changements. Un résultat tronqué est signalé ; il ne doit pas être présenté comme un avancement exhaustif. Les exports de chantier refusent un instantané tronqué.

Les fichiers exportés sont des instantanés. Ils ne modifient pas un Excel déjà téléchargé, n'envoient pas de courriel aux entreprises et n'émettent pas de facture. Le choix de destinataires et l'envoi passent par le partage explicite de l'utilisateur.

## Dates et notifications

Le filtre de mise à jour porte sur la dernière modification synchronisée du suivi du plan, pas sur une date supposée d'exécution des travaux. La comparaison reconstitue les états synchronisés en **fin de journée UTC**, à partir des opérations des versions actuelles. Elle exige un historique complet et ordonné ; une ancienne série d'événements simultanés dont l'ordre n'est pas fiable est refusée. Les déclarations locales non synchronisées ne sont pas antidatées dans cette comparaison.

Les affectations et changements de statut produisent des notifications **internes au suivi MEP** pour le responsable désigné. Elles apparaissent lors du chargement / de l'actualisation de la synthèse et peuvent être marquées comme lues. Le module ne promet pas de courriel, SMS ou notification push système ; aucune réception physique de push n'a été validée par cette recette.

## Couverture du cahier des charges

| Référence | Couverture dans le code | Limite ou recette nécessaire |
| --- | --- | --- |
| F01 — Plans et calques | PDF, indice, référence exacte, page, zoom et PDF superposé. | Un calque de référence temporaire, alignement manuel ; pas de migration automatique entre révisions. |
| F02 — Annotation au stylet | Tracé d'ouvrages et sélection de portions, réseau / tronçon, correction et annulation. | Pointer Events partagé ; ergonomie du stylet et rejet de paume à vérifier sur appareil réel. |
| F03 — Avancement mesurable | Prévu / exécuté / pourcentage, portions, estimation explicite, contrôle distinct et blocages visibles. | Calibration ou quantitatif fiable à fournir par l'équipe. |
| F04 — Points bloquants | Repère lié au tronçon, photos, description, entreprise / responsable, échéance, priorité et cycle de traitement. | Bâtiment et zone requis ; preuve photo privée à synchroniser. |
| F05 — Rapports et diffusion | Excel, CSV réseaux, PDF annoté et rapport d'actions / photos, filtres. | Annotation des fonds limitée au PDF ouvert ; partage utilisateur, sans envoi automatique externe. |
| F06 — Tableau de bord | Consolidation des versions courantes du chantier et filtres bâtiment, niveau, zone, lot / entreprise, discipline / réseau, dates. | Instantané borné et horodaté, non une lecture temps réel de tous les appareils hors ligne. |
| F07 — Notifications et historique | Notifications internes, dates / auteurs / opérations, résolution et clôture tracées. | Pas de nouveau push système ni de SMS / courriel automatique. |
| F08 — Usage chantier | Éditeur commun web / Android, commandes tactiles, PDF et saisies locales, reprise de file et photos. | Premier chargement en ligne ; APK physique, caméra et stylet réels à valider séparément. |

## Recette et publication

La recette locale combine l'éditeur réel, un PDF réel, un compte fictif et PostgreSQL isolé. Le parcours constaté comprend un tronçon de 100 m prévus, 30 m exécutés / 30 %, une photo créée hors ligne, la reprise jusqu'à la base, puis la résolution et la clôture du blocage. La lecture indépendante de `output/playwright/mep-workflow.xlsx` retrouve 100 m, 30 m et 0,3 dans Réseaux MEP et Synthèse physique MEP ; le point est conservé comme Vérifié / clos. Il reste 0 m vérifié puisque l'ouvrage lui-même est En cours : fermer son blocage ne le contrôle pas.

Les tests dédiés couvrent les calculs physiques, intervalles disjoints, contrats métier, interfaces, exports, concurrence des références média, échecs partiels, immutabilité des côtés CAS et frontière d'impression. Le rapport de recette export a aussi été rendu et examiné avec notes longues et photos. Les captures responsive incluent des formats de téléphone, tablette et ordinateur. Ces contrôles ne sont pas une mesure des performances de production ni une preuve de fonctionnement d'un stylet ou d'une caméra physique.

Les scénarios d'acceptation sont suivis ainsi :

- **T1** : isoler une discipline et un tronçon, marquer une portion sans modifier les autres ouvrages ; commande testée dans l'éditeur, stylet physique restant à valider.
- **T2** : vérifier 30 m / 100 m = 30 %, ainsi que la méthode et les quantités dans l'Excel.
- **T3** : positionner le blocage, joindre une photo, affecter l'entreprise et saisir une échéance, y compris avec capture locale avant reprise.
- **T4** : retrouver l'action, la résoudre puis la vérifier / clôturer en conservant le repère et les opérations.
- **T5** : produire le fond de plan courant avec annotations, les actions et les photos ; contrôler pagination et couleurs.
- **T6** : contrôler les filtres, les unités séparées et la pondération de la synthèse chantier ; le jeu de données fictif ne prouve pas les temps de réponse d'un grand chantier réel.
- **T7** : vérifier la séparation par référence de fichier et l'absence de report automatique des coordonnées ; une campagne de changement d'indice métier réel reste distincte de la recette fictive.

Avant publication des nouveaux clients, appliquer `supabase/migrations/20261116154432_mep_network_progress.sql` après les migrations du suivi de plans existantes. Elle étend les validations du RPC partagé, la lecture consolidée et les notifications internes ; les tables restent RPC-only. Appliquer ensuite `20261116155431_mep_blocking_completion_guard.sql` : le serveur refuse Terminé, Contrôlé ou un réalisé à 100 % tant qu’un point réellement bloquant reste actif. Les réserves non bloquantes ne bloquent pas la fin des travaux. Ne pas publier le client contre une base qui refuserait encore les nouveaux champs.

Contrôles de préparation :

```text
node scripts/build-plan-progress.cjs
node scripts/build-plan-progress.cjs --check
node node_modules/vitest/vitest.mjs run
node node_modules/typescript/bin/tsc --noEmit
node node_modules/typescript/bin/tsc --noEmit --project tsconfig.tests.json
```

Exécuter aussi les types / build web et la suite SQL complète, puis publier selon la procédure existante après leurs contrôles. Les assets de l'éditeur web et Android doivent être régénérés ensemble. Aucune nouvelle dépendance native ou nouveau runtime n'est requis par ce module ; les conditions habituelles de publication OTA et de signature APK restent applicables. Cette notice n'atteste pas qu'une migration ou une version a déjà été mise en production.
