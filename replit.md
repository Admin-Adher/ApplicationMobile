# BuildTrack

Digital construction site management application built with Expo (React Native) targeting web, iOS, and Android.

## Tech Stack

- **Framework:** Expo SDK 53 with Expo Router (file-based routing)
- **Language:** TypeScript
- **UI:** React Native with `react-native-web` for browser support
- **Backend/Database:** Supabase (PostgreSQL + Auth + Storage)
- **State Management:** React Context API + `useReducer`
- **Data Fetching:** React Context (TanStack Query was installed but unused; removed from dependencies)
- **Local Storage:** AsyncStorage
- **Reporting:** `expo-print` (PDF), `expo-file-system` + `expo-sharing` (CSV natif)

## Architecture — Chantier Model

The application uses a **Chantier (construction site) as the root entity**:

```
Chantier (construction site)
  └── SitePlan (floor plans — PDF/image, many per chantier)
       └── Reserve (defect/issue, positioned on a plan with planX/planY pins)
            └── Comments, History, Photos
```

Key flows:
1. Create chantier → add SitePlans (PDFs/images imported)
2. View plans tab → select plan → see numbered reserve pins
3. Tap plan → place marker → navigate to new reserve (planId + coords pre-filled)
4. Reserve stores chantierId + planId for plan association

## Project Structure

```
app/               # Expo Router routes
  (tabs)/          # Main tab navigation (Dashboard, Reserves, Plans, Teams)
  reserve/         # Dynamic routes for reserve detail/creation
  chantier/        # new.tsx (create) + manage.tsx (list/switch chantiers)
  task/            # Dynamic routes for task management
  login.tsx        # Auth entry point
components/        # Reusable UI components
context/           # AuthContext, AppContext (Supabase sync + mock fallback)
lib/               # supabase.ts, schema.sql, storage helpers
constants/         # TypeScript types and theme colors
assets/            # Images, icons, splash screen
```

## Environment Variables

- `EXPO_PUBLIC_SUPABASE_URL` — Supabase project URL
- `EXPO_PUBLIC_SUPABASE_KEY` — Supabase publishable (anon) key

## Running the App

The "Start Frontend" workflow runs:
```
npm run start
```
which executes `npx expo start --web --port 5000`

The app is accessible on port 5000 (web preview). Users can also scan the QR code with Expo Go for mobile testing.

## UX Audit Fixes Applied (March 2026)

All 13 issues from the comprehensive UX audit were addressed:

- **Data consistency**: Mock reserves/tasks now always load from MOCK_RESERVES fallback if AsyncStorage returns empty, ensuring Dashboard and Réserves counts always match
- **Back navigation**: Added `← back` buttons to Incidents, Équipes, and Administration screens (secondary tabs accessed via "Plus")
- **Incidents FAB**: Promoted "Signaler" from header text link to a prominent red FAB button
- **Réserves FAB**: Fixed FAB bottom position on web (now above the tab bar)
- **Plans filters**: Collapsed company/zone/level filter rows behind a "⋮ Options" toggle button with active filter count badge; building selector stays always visible
- **Plans legend**: Status color legend already present (open/in_progress/waiting/verification/closed)
- **Planning priority**: Added priority color badge (green/amber/red/purple dot + label) to task cards
- **Dashboard header**: Removed redundant role badge from header to reduce clutter on small screens
- **Messages**: Replaced "Supabase" technical jargon in demo banner with user-friendly text

## Database

The Supabase schema is defined in `lib/schema.sql`. The subscription/storage migration is in `lib/migration_subscription.sql` — run it once in the Supabase SQL Editor. The app includes a demo seed mechanism in `AuthContext.tsx` that creates demo users on first run (max 30s timeout).

### Tables
- Core: `profiles`, `companies`, `reserves`, `tasks`, `documents`, `photos`, `messages`, `incidents`
- Subscription (new): `plans`, `organizations`, `subscriptions`, `invitations`

### Storage Buckets
- `photos` (public) — created via SQL migration
- `documents` (public) — created via SQL migration
- Buckets must be created via Supabase SQL Editor; the anon key cannot create them programmatically.

## User Roles

- Admin
- Conducteur de travaux (Site Manager)
- Chef d'équipe (Foreman)
- Observateur (Observer)

## Dependencies Added

- `expo-clipboard@~7.1.5` — used in `channel/[id].tsx` for copy-to-clipboard (replaces deprecated `Clipboard` from `react-native`)

## Bug Fixes Applied

**Session 1 (earlier):**
- **`app/_layout.tsx`** — Removed `SupabaseNotConfiguredScreen` dead-end that blocked mock mode; app now boots into full mock mode when Supabase isn't configured
- **`app/channel/[id].tsx`** — Fixed `if (!supabase)` guard (always false because `supabase` is `null as any`) to `if (!isSupabaseConfigured)`; fixed send button disabled logic
- **`app/rapports.tsx`** — Moved module-level `today`/`weekNum` constants inside the component to prevent stale values
- **`context/AuthContext.tsx`** — Added mock-mode `login()` support validating against `DEMO_USERS` so logout + re-login works without Supabase
- **`app/(tabs)/more.tsx`** — Équipes module added to the "Plus" menu (was inaccessible)
- **`app/channel/[id].tsx`** — Replaced deprecated `Clipboard` from `react-native` with `expo-clipboard`; fixed deprecated `ImagePicker.MediaTypeOptions.Images` → `['images']`; fixed hardcoded `paddingTop: 52` → `insets.top + 8`

**Session 2 (current):**
- **`lib/mockData.ts`** — Added 3 missing companies (EIFFAGE Gros Œuvre, VINCI Électricité, GECINA Finitions) to `MOCK_COMPANIES`; previously only BOUYGUES existed while 4 reserve companies were referenced — causing the company filter and "Contacter" button to fail for 3 of 4 companies
- **`lib/mockData.ts`** — Distributed `MOCK_TASKS` across all 4 companies (previously all 6 tasks used `company: 'co1'` BOUYGUES only); updated `assignee` names to match
- **`context/AppContext.tsx`** — Collapsed 3 identical reducer cases (`UPDATE_RESERVE`, `UPDATE_RESERVE_STATUS`, `UPDATE_RESERVE_FIELDS`) into a single fallthrough — they had identical implementations
- **`package.json`** — Moved `eas-cli` from `dependencies` to `devDependencies` (it's a build tool, not a runtime dep); removed unused `@tanstack/react-query`

**Session 4 (actuelle) :**
- **`context/AppContext.tsx`** — Correction critique du mode démo : `supabase` est `null` quand non configuré, provoquant un crash sur tous les appels `.from()`. Solution : (1) ajout de données mock réalistes (8 réserves, 4 entreprises, 5 tâches, 3 documents, 3 photos, 5 messages, 4 profils) en constantes ; (2) ajout de `loadMockData()` ; (3) protection du useEffect d'auth avec `if (!isSupabaseConfigured)` ; (4) protection de `loadAll()` en tête de fonction ; (5) ajout de guards `if (isSupabaseConfigured)` sur les 21 appels supabase dans toutes les fonctions d'action (addReserve, updateReserve, addTask, etc.)
- **`app/reserve/new.tsx`** — Suppression des coordonnées aléatoires (`Math.random()`) sur le plan : les réserves sans placement explicite sont maintenant placées au centre (50, 50). Ajout d'un état `isSubmitting` pour prévenir la double soumission via appui rapide sur "Créer".
- **`app/rapports.tsx`** — Export PDF corrigé sur web : génération d'un fichier HTML téléchargeable via l'API Blob du navigateur (comme le CSV), au lieu d'afficher un chemin de fichier inutilisable.

**Session 3 (précédente) :**
- **`lib/supabase.ts`** — Corrigé le message de warning qui mentionnait encore "offline/mock mode" (inexistant depuis la suppression de mockData). Nouveau message : "L'application ne fonctionnera pas sans Supabase configuré."
- **`app/photos.tsx`** — Remplacé `KeyboardAvoidingView` importé depuis `react-native` par la version de `react-native-keyboard-controller`, cohérent avec tous les autres écrans (equipes.tsx, etc.)
- **`app/rapports.tsx`** — Refactorisé l'export CSV : suppression du workaround `Print.printToFileAsync` (créait un PDF d'une balise `<pre>` HTML) → utilisation de `expo-file-system` pour écrire un vrai fichier `.csv` puis partage via `expo-sharing`. Sur web : téléchargement direct via l'API Blob du navigateur.
- **`package.json`** — Ajout de `expo-file-system@~18.1.11` (compatible Expo SDK 53)

**Session 5 (actuelle) — Corrections d'audit :**
- **`constants/types.ts`** — Ajout de `closedAt?: string` et `closedBy?: string` sur l'interface `Reserve` (date et auteur de levée de réserve, obligatoires en BTP pour les OPR)
- **`context/AppContext.tsx`** — Suppression de la fonction `genId()` locale (dupliquée) ; import depuis `lib/utils.ts`. `updateReserveStatus` enregistre maintenant `closedAt` (date ISO) et `closedBy` (nom de l'auteur) à la clôture ; propagé sur Supabase via `closed_at`/`closed_by`. `toReserve()` mappe ces nouveaux champs depuis la base.
- **`app/(tabs)/index.tsx`** — Ajout d'une 6e KPI "Incidents non résolus" sur le tableau de bord (bouclier rouge, navigation vers `/incidents`), alimentée par `useIncidents()`
- **`app/search.tsx`** — Recherche globale étendue aux incidents (titre, description, lieu, signalé par) ; section dédiée dans les résultats avec badge de gravité ; placeholder mis à jour
- **`app/(tabs)/equipes.tsx`** — Suppression de `genId()` locale ; import depuis `lib/utils.ts`. Les cartes "Tâches en cours" sont maintenant cliquables (`onPress` → `/task/${task.id}`)
- **`app/incidents.tsx`** — Suppression de `genId()` locale ; import depuis `lib/utils.ts`
- **`app/(tabs)/admin.tsx`** — Suppression de `genId()` locale ; import depuis `lib/utils.ts`
- **`app/reserve/[id].tsx`** — Affichage de la "Date de levée" (`closedAt`) et "Clôturé par" (`closedBy`) dans le détail d'une réserve clôturée

**Session 7 (actuelle) — Audit complet : corrections et améliorations :**
- **`app/journal.tsx`** — Persistence AsyncStorage : les entrées du journal de chantier sont maintenant sauvegardées dans `buildtrack_journal_v1` et rechargées à chaque ouverture. Données non perdues entre les sessions.
- **`app/meeting-report.tsx`** — Persistence AsyncStorage : les CR de réunion sont sauvegardés dans `buildtrack_meetings_v1` et rechargés à l'ouverture. Document légal désormais persistant.
- **`app/checklist.tsx`** — Persistence AsyncStorage : les checklists sauvegardées dans `buildtrack_checklists_v1`. Correction du modèle `Checklist` (ajout des champs requis manquants : `type`, `building`, `zone`, `level`, `status`). La checklist passe automatiquement au statut `completed` quand tous les points sont cochés, avec horodatage.
- **`constants/types.ts`** — Ajout de `photoUri?: string` sur l'interface `Incident` pour la photo de preuve.
- **`app/(tabs)/incidents.tsx`** — (1) Photo de preuve : ajout d'un sélecteur caméra/galerie dans le formulaire d'incident, affichage de la photo en miniature sur la carte. (2) Clôture automatique : passage au statut `Résolu` enregistre automatiquement `closedAt` (date ISO) et `closedBy` (nom de l'utilisateur), affichés sur la carte. (3) Imports nettoyés.
- **`context/IncidentsContext.tsx`** — Mapping `photo_uri` ↔ `photoUri` dans `toIncident()` et `syncToSupabase()` pour persistance Supabase de la photo d'incident.
- **`app/(tabs)/_layout.tsx`** — L'onglet **Équipes** est maintenant visible dans la barre de navigation principale (icône `people`, libellé "Équipes"). Auparavant masqué avec `href: null`.

**Session 6 (actuelle) — Corrections audit complet :**
- **`app/task/[id].tsx`** — Corrigé deux bugs de champs incorrects : `c.text` → `c.content` (interface `Comment`) et `h.date` → `h.createdAt` (interface `HistoryEntry`). Les commentaires et l'historique des tâches s'affichent maintenant correctement (C5).
- **`constants/types.ts`** — `MeetingReport` : refonte complète de l'interface pour correspondre à l'implémentation réelle dans `meeting-report.tsx` (champs `subject`, `participants`, `redactedBy`, `decisions: string[]`, `actions: MeetingReportAction[]`, `notes`, etc.). `JournalEntry` : correction des champs `workforce/issues` → `workerCount: number / incidents: string` + ajout de `materials` et `observations`. Ajout de `MeetingReportAction` interface.
- **`app/(tabs)/more.tsx`** — Ajout de 3 nouveaux modules dans la grille : Checklists (`/checklist`), CR Réunions (`/meeting-report`), Journal de chantier (`/journal`) — ces modules existaient mais n'étaient pas accessibles depuis le menu principal.
- **`app/(tabs)/equipes.tsx`** — C4 : Les cartes de tâches affichent maintenant le nom court de l'entreprise (`shortName`) en plus du responsable, permettant d'identifier immédiatement à quelle entreprise appartient chaque tâche.

**Session 9 (actuelle) — Connexion Supabase complète + buckets storage :**
- **`lib/migration_subscription.sql`** (nouveau) — Script SQL idempotent créant les 4 tables d'abonnement (`plans`, `organizations`, `subscriptions`, `invitations`) + colonne `organization_id` dans `profiles` + buckets storage `photos`/`documents` avec politiques RLS. Corrige l'ordre de création (colonne FK avant les policies qui la référencent).
- **`context/AuthContext.tsx`** — Refactor du seeder : extraction `seedOneUser()`, timeout de 30 secondes via `Promise.race()`, gestion explicite du cas "email non confirmé" (retour sans crash). Message d'erreur de login amélioré : indique précisément comment désactiver la confirmation email dans Supabase si nécessaire.
- **`lib/storage.ts`** — Suppression des appels `createBucket()` côté client (bloqués par RLS avec la clé anon). Les buckets sont désormais créés via SQL.
- **`app/login.tsx`** — Message d'erreur du seeder mis à jour pour orienter vers la désactivation de la confirmation email Supabase.

**Session 11 (actuelle) — Audit complet warnings + corrections :**
- **`components/NotificationBanner.tsx`** — `pointerEvents="box-none"` migré du prop JSX vers `StyleSheet.create` (`styles.wrapper`). Le prop était déprécié dans React Native 19 en faveur du style. Correction de la forme intermédiaire (inline style) vers la forme définitive (StyleSheet).
- **Audit warnings terminé** — Les 2 warnings console restants (`shadow*` et `props.pointerEvents`) viennent des internals React Native (respectivement les couches de rendu web Expo et `AppContainer-dev.js` de `react-native/Libraries/ReactNative/`). Ils ne proviennent PAS du code BuildTrack et disparaîtront en production. Notre code utilise correctement `Platform.select` avec `boxShadow` pour web et `style.pointerEvents` dans StyleSheet.
- **Audit fonctionnel confirmé** — Toutes les routes vérifiées, tous les contextes chargent correctement, les données mock persistent via AsyncStorage. Les "5 tâches en retard" et "7 réserves en retard" affichées sont des données persistées de sessions précédentes — comportement correct du système.

**Session 10 (actuelle) — Audit UX : BottomNavBar + enrichissement Settings :**
- **`components/BottomNavBar.tsx`** (nouveau) — Barre de navigation persistante à 5 onglets pour toutes les pages secondaires (hors tabs principaux). Utilise `router.navigate()` pour éviter l'empilement de l'historique. Prop `activeTab` pour indiquer l'onglet actif.
- **`app/(tabs)/_layout.tsx`** — L'onglet "Plus" renommé en **"Modules"** avec l'icône `apps-outline`.
- **`app/_layout.tsx`** — Titres de pages ajoutés pour checklist, journal, meeting-report dans la Stack.
- **Toutes les pages secondaires** — BottomNavBar ajoutée : planning, rapports, search, pointage, reglementaire, checklist, journal, meeting-report, documents, photos, settings.
- **`app/rapports.tsx`** — Correction critique : BottomNavBar était placée à l'intérieur du composant auxiliaire `StatItem` au lieu du return principal. Déplacée après `</ScrollView>` dans le return principal.
- **`components/Header.tsx`** — `rightLabel` rendu en bouton pill stylisé.
- **`app/login.tsx`** — `paddingTop` du hero réduit (48→20) pour que la section "Comptes de démonstration" soit visible sans défilement.
- **`app/(tabs)/plans.tsx`** — Boutons zoom agrandis (32px→44px) pour une meilleure accessibilité tactile.
- **`app/photos.tsx`** — Placeholder amélioré : icône `image-outline` + texte de localisation.
- **`app/settings.tsx`** — Onglet **Projet** enrichi pour les admins : grille de 4 KPIs (Réserves, Entreprises, Documents, Incidents) + section "Accès rapide" avec 4 liens vers les modules clés (Équipes, Rapports, Plans, Planning).

**Session 8 (actuelle) — Points 5 et 10 de l'audit BTP :**
- **`constants/types.ts`** — Ajout de `TimeEntry` (pointage horaire : nom ouvrier, entreprise, heure arrivée/départ, notes) et `RegulatoryDoc` + `RegDocType` + `RegDocStatus` (documents réglementaires PPSPS/DICT/DOE/Plan de prévention/DPAE/autre).
- **`context/PointageContext.tsx`** (nouveau) — Contexte dédié au pointage horaire. Persistance AsyncStorage (`buildtrack_pointage_v1`). CRUD complet : `addEntry`, `updateEntry`, `deleteEntry`, `getEntriesForDate`.
- **`context/ReglementaireContext.tsx`** (nouveau) — Contexte pour les documents réglementaires. Persistance AsyncStorage (`buildtrack_reglementaire_v1`). CRUD complet : `addDoc`, `updateDoc`, `deleteDoc`.
- **`app/pointage.tsx`** (nouveau) — Module de pointage horaire : navigation jour par jour, KPIs (présents/partis/heures totales), filtres par entreprise, cartes avec heure arrivée/départ et calcul automatique des heures travaillées, bouton rapide "Départ", formulaire complet de saisie.
- **`app/reglementaire.tsx`** (nouveau) — Module PPSPS/DICT/DOE : liste par catégorie de document réglementaire, indicateurs de statut (Valide/Expire bientôt/Expiré/Manquant/En cours), bannière d'alerte si documents expirés ou manquants, changement de statut en un tap, formulaire complet avec type/titre/entreprise/référence/dates d'émission et expiration.
- **`app/_layout.tsx`** — Ajout des providers `PointageProvider` et `ReglementaireProvider`, et enregistrement des routes `pointage` et `reglementaire` dans la Stack.
- **`app/(tabs)/more.tsx`** — Ajout des deux nouveaux modules dans la grille : "Pointage horaire" et "Docs réglementaires".

## Feature Completion (100%)

All 13 planned modules are implemented:
1. **Réserves** — full CRUD, 5 statuses, comments, history, photo attachment on creation
2. **Plans interactifs** — import PDF/image, pinning, zoom/pan, filter by company + filter by zone
3. **Documents** — upload, categories, versioning, search
4. **Équipes** — company tracking, actual/planned workers, hours, zones
5. **Planning** — list/calendar/Gantt views (Gantt is now default), task creation/deletion
6. **Dashboard** — KPIs including delayed tasks counter, status bars, critical + delayed task alerts
7. **Communication** — internal messaging, reserve comments
8. **Photos** — camera/gallery, comment+location modal before saving, Supabase upload
9. **Rapports** — daily/weekly PDF, CSV export
10. **Utilisateurs** — 4 roles, Supabase auth
11. **Administration** — dedicated admin tab (visible to `admin` role only): user role management, company CRUD

## Competitive Audit Features — Archipad Gap Closure (Session 12)

**Features already implemented (confirmed in audit):**
- ✅ Feature 6 (Bulk reserve operations): Full select mode + `batchUpdateReserves` in `reserves.tsx`
- ✅ Feature 11 (Weather journal): `journal.tsx` uses open-meteo.com with GPS-based location
- ✅ Feature 12 (CCTP lot numbering): `STANDARD_LOTS` exported from `AppContext`, CCTP badges in `lots.tsx`
- ✅ Feature 14 (Meeting reports CRR): `meeting-report.tsx` with templates + PDF export
- ✅ Feature 4 (Plan versioning UI): Full version history panel + `addSitePlanVersion()` in `plans.tsx`
- ✅ Feature 9 (Collaborative OPR): Multi-signatory invite modal + signed PDF in `opr.tsx`
- ✅ Feature 10 (Rich photo annotations): Full `PhotoAnnotator.tsx` with point/text/arrow/rect/measure tools + color palette

**Features newly built in this session:**
- **Feature 1 (Individual reserve PDF)**: `reserve/[id].tsx` — Added `buildReservePDF()` function generating a professional single-reserve fiche with photos, GPS coordinates, annotations count, history table, comments, and signature block. Exportable via "Exporter fiche PDF" button. Uses `expo-print` + `expo-sharing`.
- **Feature 5 (Photo GPS capture)**: `reserve/new.tsx` — Added `expo-location` GPS capture on every photo taken (camera or gallery). Coordinates stored in `ReservePhoto.gpsLat` / `gpsLon`. GPS indicator badge shown on photo thumbnails. Coordinates included in the individual reserve PDF.
- **Feature 7 (Analytics dashboard)**: `app/analytics.tsx` (new screen) — Full analytics dashboard with: 4 KPI cards (total/closure rate/overdue/critical), status breakdown bar chart, 8-week weekly trend bar chart (reserves created vs closed), company performance table with progress bars, priority breakdown for active reserves, and building distribution. Accessible from Plus menu → "Analytique". PDF export support.
- **Feature 8 (Subcontractor portal QR)**: `sous-traitant.tsx` — Added shareable link section with QR code (via api.qrserver.com), auto-computed from current app URL + company ID, copy-to-clipboard button via `expo-clipboard`.
- **Feature 13 (Real-time sync)**: Already working — Supabase realtime subscriptions for reserves and tasks channels active in `AppContext.tsx`. `realtimeConnected` state exposed.
- **Feature 15 (BTP integrations screen)**: `app/integrations.tsx` (new screen) — Full integrations catalog with 10 BTP connectors (Procore, ArchiCAD, Revit, e-Diffusion, Géosat, Kizeo, DocuWare, Signaturit, Météo-France, URSSAF). Category filter chips, toggle switches, API key configuration modal, docs links, active/enabled state management. Accessible from Plus menu → "Intégrations BTP".

**Menu additions (more.tsx):**
- "Analytique" card added to Chantier section (bar-chart icon, sky blue)
- "Intégrations BTP" card added to Outils section (git-network icon, indigo)

## Archipad-Inspired Features (6 features)

All 6 Archipad-inspired features are implemented:
1. **Tunnel Visite→Réserve→Levée→OPR→PV signé** — `AppContext.linkReserveToVisite()` links reserves to a visite; `visite/[id].tsx` shows a 5-step tunnel progress indicator with icons, colors, and sub-labels for each stage.
2. **Observation vs Réserve distinction** — `ReserveKind = 'reserve' | 'observation'`; kind selector chips in `reserve/new.tsx`; blue observation badge in `ReserveCard.tsx`; kind filter chips in `reserves.tsx` toolbar.
3. **Corps d'état / Lot classification** — Lot picker from `lots` context in `reserve/new.tsx`; lot dot + name in `ReserveCard.tsx`; lot filter section in the advanced filter modal of `reserves.tsx`.
4. **Sous-traitant direct status update** — `sous-traitant.tsx` shows "Marquer en cours" / "Marquer traité" action buttons per reserve card, calling `updateReserveStatus`.
5. **OPR + electronic signature** — `opr.tsx` uses a proper Modal (not Alert) with TextInput for conducteur + maître d'ouvrage names, shield notice, horodatage; signature section in exported PDF.
6. **Gantt integration** — Gantt view is now the **default** view when opening the planning screen (previously was list view).
