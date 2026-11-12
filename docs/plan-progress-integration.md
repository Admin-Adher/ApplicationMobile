# Avancement des ouvrages sur plans PDF

Depuis **Plans → sélectionner un PDF → Avancement**, le web et Android ouvrent le même éditeur 2D. Les plans et entreprises viennent du chantier connecté. L'import du PDF doit être synchronisé avant de préparer son avancement : les références temporaires de fichiers locaux ne sont pas utilisées pour des écritures serveur. Ensuite, les ouvrages du PDF téléchargé sont modifiables hors connexion. Aucun PDF ni repère de démonstration n'est livré avec l'application.

Le parcours reprend l'ajout d'équipements, les longueurs droites ou avec coudes à 90°, les contours et rectangles, le bouton explicite de fin de surface, la modification des fiches et tracés, les dimensions, les états et l'export Excel. Les boutons tactiles mesurent au moins 44 px. La calibration s'applique à une page ; changer de PDF ou de page ne reprend pas l'échelle d'une autre page.

Les dimensions sont enregistrées en mètres, avec saisie en mm, cm ou m. Le calcul du prix est explicite : unité, longueur, surface, emprise, surface verticale ou volume. Les volumes sont des volumes géométriques pleins. Les prix démarrent à zéro ; ajouter une dimension ne choisit pas automatiquement une autre unité de facturation.

À faire = 0 %, En cours = 50 %, Terminé et Contrôlé = 100 %. Seul Contrôlé alimente le montant validé. Le total d'avancement est pondéré par la valeur HT des ouvrages chiffrés ; l'écran indique combien sont chiffrés et ne présente pas un faux 0 % quand aucun prix n'est renseigné. Des unités différentes ne sont jamais additionnées.

L'Excel porte sur **toutes les pages du PDF courant**, pas tous les plans du chantier. Il contient Synthèse, Ouvrages, Historique et Mode de calcul. Le montant proposé est `MAX(0, contrôlé - déjà facturé)` par entreprise/lot/page. Le déjà facturé reste conservé même si un ouvrage est retiré. Ce fichier est un instantané ; aucune facture n'est émise et un fichier Excel déjà téléchargé n'est pas mis à jour automatiquement.

| Action | Droit existant utilisé |
| --- | --- |
| Lire le suivi | Membre actif de l'organisation ayant accès au chantier |
| Préparer, modifier, calibrer ou contrôler | `canCreate` et `canEdit` |
| Mettre à jour un état ou une note de sa propre entreprise | `canEditOwn`, ouvrage non contrôlé ; contrôle exclu |
| Retirer un ouvrage | `canDelete` |
| Consulter les prix et exporter | `canExport` |
| Modifier les prix ou le déjà facturé | Droits de préparation et `canExport` |

Le serveur vérifie ces règles à chaque appel. Les prix et le déjà facturé sont retirés de la réponse pour les comptes sans droit d'export. Les tables ne sont pas directement accessibles aux clients. Les organisations viennent des adhésions actives, jamais d'un identifiant fourni par l'éditeur.

Les nouvelles tables sont indépendantes de `site_plans.annotations`, des réserves et des autres suivis existants. Le noyau TypeScript et l'éditeur sont partagés ; les hôtes React et React Native gèrent l'authentification, le cache, le partage et leurs files existantes. L'éditeur n'obtient aucun jeton Supabase. Les messages vérifient leur canal et leur nonce ; le web vérifie aussi la fenêtre émettrice et isole l'éditeur dans une iframe.

Chaque modification possède une identité UUID persistée avec son contenu. La base conserve son reçu : un réessai après perte de réponse ne réapplique pas l'écriture. Un changement ne porte que sur les champs modifiés. Les écritures suivantes du même PDF attendent la réussite des précédentes ; un incident temporaire sur une création ne transforme pas ses modifications dépendantes en refus définitifs. Deux changements indépendants fusionnent ; un ancien contenu du même champ est refusé explicitement, sans écraser le serveur. Ce refus utilise un HTTP 400 déterministe, compatible avec les trois tentatives puis la fiche refusée du moteur Android. Après examen/abandon de la saisie refusée dans la file, rouvrir le plan récupère l'état serveur avant de refaire la modification.

Les caches sont séparés par compte, organisation, plan, référence du fichier et droits financiers. Le web mémorise les PDF ouverts dans un cache borné à 100 Mo ; Android réutilise son cache de plans par compte. Les fichiers du lecteur sont disponibles sans CDN. Il faut avoir ouvert/téléchargé le plan avant de le consulter sans réseau ; le lecteur de suivi limite les PDF à 25 Mo. Le rechargement complet du site web hors réseau reste soumis au fonctionnement du site existant : ce module n'ajoute pas de service worker global.

Android accuse réception après l'écriture stricte de la file. Un échec ambigu de stockage conserve l'intention et demande une vérification à la réouverture ; il ne supprime pas une écriture qui aurait déjà traversé une autre barrière de synchronisation. Le web attend la transaction IndexedDB. Les nouvelles données serveur sont reprises lorsque la file du plan est vide et que l'utilisateur n'a ni tracé ni formulaire en cours. Un remplacement de fichier crée un suivi distinct et ne repositionne pas les anciens tracés sur le nouveau fond ; les anciennes données restent en base.

Les sources de l'éditeur sont dans `lib/plan-progress/editor`. Après modification : `node scripts/build-plan-progress.cjs`. Ce script produit l'asset texte Expo et l'HTML web identiques, ainsi que les copies web du PDF.js déjà embarqué. La CI vérifie leur concordance avec `--check`. Aucune dépendance native ni modification du runtime 1.2.4 n'est nécessaire.

Recette du 12 novembre 2026 : parcours réel navigateur avec PostgreSQL jetable et données fictives sur un PDF réel, ajout/modification/état/contrôle, retour hors connexion et rejeu ; neuf formats tactiles 320–844 px, portrait/paysage, pincement 100→240 % sans point parasite et rotation conservant le tracé. Lecture indépendante ZIP/XML de l'Excel : 10 m de cheminement, 0,8 m³ de section, 25 m² et 5 m³ avec épaisseur ; prévu 1 925 €, validé 1 125 €, facturé 100 €, proposition 1 025 €. La suite PostgreSQL complète existante et les assertions du nouveau module passent. Les types Expo, web et tests sont contrôlés, ainsi que l'export Android et la compilation Next.js. La caméra et un appareil Android physique ne font pas partie de cette recette du module.

Ordre de publication : appliquer `20261112140000_plan_progress.sql` au projet Supabase existant ; attendre les contrôles GitHub ; fusionner la branche pour publier le web et l'OTA production ; déclencher ensuite le workflow Android avec `build_apk=true` pour produire le nouvel APK signé. Le workflow existant fixe son numéro de build et conserve le runtime compatible. Ne pas publier le client avant l'application de sa migration.
