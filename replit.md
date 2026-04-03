# BuildTrack - Gestion de chantier numérique

## Overview
BuildTrack is a professional construction management mobile application built with Expo/React Native. It serves as a "control tower" for construction sites, providing tools for site supervision, incident reporting, document management, and team communication.

## Tech Stack
- **Framework**: Expo SDK 53 with React Native
- **Language**: TypeScript
- **Navigation**: Expo Router (file-based routing)
- **Backend**: Supabase (Auth, Database, Storage)
- **Styling**: React Native StyleSheet with custom theme
- **State**: React Query + React Context + AsyncStorage

## Key Features
- Dashboard & Analytics (real-time project status)
- Reserves/Punch list management with global "+" FAB on every main tab
- Plan viewer (PDF and DXF construction plans, with WebView-based mobile PDF rendering)
- Internal communications (channels + direct messages)
- Site journals, checklists, meeting reports, OPR, site visits
- Photo annotations and equipment tracking
- Role-based access (Super Admin, Admin, Site Manager, Team Leader, Subcontractor)

## Navigation Structure (5 tabs)
- **Dashboard** — Project KPIs and overview
- **Réserves** — Punch list management (with FAB for quick creation)
- **Plans** — Interactive plan viewer with PDF support on mobile
- **Messages** — Channels, DMs, groups (with FAB for quick reserve creation)
- **Terrain** — Daily field tools: Journal, Pointage, OPR, Visites, Incidents + Documents + Admin

## UX Improvements (April 2026)
- Renamed "Modules" tab to "Terrain" with hammer icon — more intuitive for BTP workers
- "Terrain quotidien" section promoted to top of Terrain tab (Journal, Pointage, OPR, Visites, Incidents)
- Intégrations BTP demoted to Administration section (low-frequency feature)
- Persistent "+" FAB added to Messages and Terrain tabs (already existed on Dashboard, Réserves, Plans)
- PDF plans now render inline on mobile via WebView (no more "Ouvrir le plan" external redirect)
- Chantier creation no longer requires a plan — plans section is now optional

## Authentification & Onboarding (Avril 2026)
- **Écran d'inscription** (`app/register.tsx`) — deux modes :
  - **Nouveau client** : crée une organisation, abonnement trial Équipe 30j, et compte admin
  - **Invitation reçue** : crée un compte avec l'email de l'invitation ; la liaison org/rôle est automatique via `linkPendingInvitation`
- **`AuthContext.register()`** — nouvelle fonction qui gère signUp + création org + profile en Supabase
- **Lien "Créer un compte"** ajouté sur l'écran de connexion
- **Politiques RLS** ajoutées dans `lib/schema.sql` : INSERT sur organizations, subscriptions, et invitations lisibles par l'invité

## UX Fixes (Sprint 2 — April 2026)
1. **BottomSheetPicker** (`components/BottomSheetPicker.tsx`) — reusable slide-up modal replacing all horizontal chip scroll pickers
2. **Network indicator** — 8×8 dot in Header: green=online, red=offline with queued-action badge count
3. **Search icon** — Dashboard header now has a search icon button; tablet sidebar BT logo is tappable
4. **Journal CTA** — "Saisir l'entrée du jour" prominent button shown when no today entry exists yet
5. **Default arrival time** — Configurable in Settings (Attendance tab); preset chips 06:30–08:30
6. **Pointage presets** — Arrival (06:30–08:30) and departure (16:00–18:00) quick-select time chips; uses defaultArrivalTime as initial value
7. **Reserve form order** — PHOTOS card moved to appear right after TYPE (before Templates/Titre)
8. **Reserve form pickers** — LOT, PLAN, LOCALISATION (Zone/Niveau/Bâtiment), ENTREPRISE all use BottomSheetPicker

## Project Structure
```
app/           # Expo Router file-based routes
  _layout.tsx  # Root layout with all providers
  login.tsx    # Login screen (default unauthenticated route)
  (tabs)/      # Main tab navigation
components/    # Reusable UI components
context/       # Global state providers (Auth, Network, Notifications, etc.)
lib/           # Utilities, Supabase client, DXF parser, PDF helpers
constants/     # Types (types.ts) and theme colors (colors.ts)
assets/        # Fonts and images
```

## Workflows
- **Start Frontend**: `node node_modules/expo/bin/cli start --web --port 5000`
  - Runs the Expo dev server on port 5000
  - Hot Module Reloading enabled (no restart needed for most code changes)
  - Users can scan the QR code with Expo Go to test on physical devices

## Environment Variables
- Supabase credentials should be stored as environment variables/secrets
- Check `lib/supabase.ts` for the Supabase configuration

## Plans Tab UX Audit Fixes (Sprint 3 — April 2026)
1. **Pin sizes** — Minimum 44px touch targets on mobile (`pinSize = 44`, `clusterSize = 52`), larger on tablet (48/60)
2. **Status filter moved to FiltersSheet** — Removed status chip row from header, now lives inside the Filtres bottom sheet with counts and colored dots
3. **activeFilters count** — Corrected computation: no double-counting of statusFilter
4. **Empty state CTA** — When no plan file is imported and no DXF data: prominent icon + description + "Importer un plan" button with navy background
5. **ImportHintBanner** — Now only shows when DXF is loaded but no image/PDF overlaid (avoids duplication with the new empty state)
6. **Accessibility** — Added `accessibilityLabel`/`accessibilityRole` to: empty-state import button, version history button
7. **FiltersSheet** — Accepts `statusFilter` + `onStatusFilterChange` props; onReset clears status filter

## Supabase Sync Audit — April 2026
Complete audit of all tabs for multi-user Supabase synchronization:

### Tables added to lib/schema.sql (must run in Supabase SQL Editor)
- `incidents` — Safety incidents (IncidentsContext was already syncing but table was missing)
- `visites` — Site visits / OPR preparation (AppContext syncs on add/update/delete)
- `lots` — Construction lots with CCTP refs
- `oprs` — OPR sessions with items, signatures, invited emails
- `channels` — Custom & group channels (previously AsyncStorage-only, now shared between users)
- `time_entries` — Attendance entries (PointageContext now fully syncs to Supabase)

### What was already working
- Reserves — Supabase sync + real-time subscription ✓
- Tasks — Supabase sync + real-time subscription ✓
- Messages — Supabase sync + real-time subscription ✓
- Documents / Photos — Supabase sync ✓
- Companies — Supabase sync ✓
- Chantiers / Site Plans — Supabase sync + AsyncStorage fallback cache ✓

### New fixes (this sprint)
- **Channels** — `addCustomChannel`, `removeCustomChannel`, `addGroupChannel`, `removeGroupChannel`, `_updateAndPersistChannel` all write to Supabase `channels` table; real-time subscription syncs channel creation/updates/deletions across all connected users instantly
- **PointageContext** — Now loads from `time_entries` on startup, syncs add/update/delete to Supabase; real-time subscription (`realtime-time-entries-v1`) propagates INSERT/UPDATE/DELETE to all connected users instantly
- **IncidentsContext** — Real-time subscription (`realtime-incidents-v1`) added; INSERT/UPDATE/DELETE on `incidents` propagate to all connected users
- **Tasks** — Extended from UPDATE-only to full CRUD real-time: INSERT and DELETE now also trigger real-time dispatch
- **Chantiers** — Real-time subscription (`realtime-chantiers-v1`) added: full CRUD sync across users
- **SitePlans** — Real-time subscription (`realtime-site-plans-v1`) added: full CRUD sync across users
- **Visites** — Real-time subscription (`realtime-visites-v1`) added: full CRUD sync across users
- **OPRs** — Real-time subscription (`realtime-oprs-v1`) added: full CRUD sync across users
- **Lots** — Real-time subscription (`realtime-lots-v1`) added: full CRUD sync across users
- **Missing tables** — All required tables added to schema.sql with proper RLS policies

### Real-time Coverage (post-audit)
Every table that supports multi-user collaboration now has full CRUD real-time subscriptions:
| Entity | Write to Supabase | Real-time Sync |
|--------|-------------------|----------------|
| Reserves | ✅ | ✅ INSERT/UPDATE/DELETE |
| Tasks | ✅ | ✅ INSERT/UPDATE/DELETE |
| Messages | ✅ | ✅ INSERT/UPDATE/DELETE |
| Channels | ✅ | ✅ INSERT/UPDATE/DELETE |
| Time Entries | ✅ | ✅ INSERT/UPDATE/DELETE |
| Incidents | ✅ | ✅ INSERT/UPDATE/DELETE |
| Chantiers | ✅ | ✅ INSERT/UPDATE/DELETE |
| Site Plans | ✅ | ✅ INSERT/UPDATE/DELETE |
| Visites | ✅ | ✅ INSERT/UPDATE/DELETE |
| OPRs | ✅ | ✅ INSERT/UPDATE/DELETE |
| Lots | ✅ | ✅ INSERT/UPDATE/DELETE |
| Documents / Photos | ✅ | Initial load only (user-scoped uploads) |
| Companies | ✅ | Initial load only |

## Tablet Sidebar Layout (Sprint 4 — April 2026)
The tablet sidebar uses a **flex-row wrapper layout** in `app/(tabs)/_layout.tsx`:
- On tablet (≥768px): `<View flexDirection="row"><TabletSidebar /><View flex1><Tabs /></View></View>`
- The `TabletSidebar` is a self-contained component using `usePathname()` + `useRouter()` from Expo Router for navigation and active state — no React Navigation props needed
- Active tab detection matches both `/(tabs)/name` and `/name` URL patterns (Expo Router drops group prefixes in URLs)
- This avoids the `sceneContainerStyle` issue where `position:absolute` scene containers ignore CSS `margin`/`padding` properties
- On mobile: renders `<Tabs>` directly with the default bottom tab bar
- Sidebar features: 3px left border accent for active item, `backgroundColor: C.primaryBg` background, unread badge on Messages

## Modèle de tarification hybride (Avril 2026)
Modèle en 3 niveaux calé sur la réalité du BTP — les rôles passifs sont **toujours gratuits** :

| Plan   | Prix      | Utilisateurs actifs | Sous-traitants | Observateurs |
|--------|-----------|---------------------|----------------|--------------|
| Solo   | 79 €/mois | 3                   | Gratuits        | Gratuits     |
| Équipe | 199 €/mois| 15                  | Gratuits        | Gratuits     |
| Groupe | 499 €/mois| Illimité            | Gratuits        | Gratuits     |

**Rôles actifs facturés** : `admin`, `conducteur`, `chef_equipe`
**Rôles gratuits** (`FREE_ROLES`) : `observateur`, `sous_traitant`

### Implémentation
- `FREE_ROLES` défini dans `context/SubscriptionContext.tsx`
- `activeOrgUsers` / `freeOrgUsers` calculés et exposés via le context
- `canInvite` ignore la limite de sièges pour les rôles gratuits (`inviteUser()`)
- `seatUsed` = seulement les utilisateurs actifs (pas les gratuits)
- Écran `app/subscription.tsx` : affiche 2 sections séparées (actifs vs gratuits/icône cadeau)
- Schéma SQL : plans Solo/Équipe/Groupe avec migration depuis anciens noms Starter/Pro/Entreprise
- Nouveau compte → trial Équipe 30j

## Plans Tab — Audit & Correctifs (Avril 2026)
Audit complet des 1755 lignes de `app/(tabs)/plans.tsx`. Correctifs appliqués :

1. **DXF persisté via URI** — Les plans DXF sont désormais uploadés sur Supabase Storage à l'import (comme PDF/images). L'URI est stockée dans `currentPlan.uri` avec `fileType: 'dxf'`. Un `useEffect` recharge automatiquement le DXF au démarrage si le plan a `fileType=dxf` et que les données ne sont pas en mémoire. Plus de perte de plan DXF au redémarrage.
2. **`isPlanFile` exclut les DXF** — `isPlanFile = !!uri && fileType !== 'dxf'`. Empêche l'envoi de fichiers DXF dans `PdfPlanViewer`.
3. **`isImagePlan` préfère `fileType`** — Utilise `fileType === 'image'` en priorité, avec fallback sur l'extension URI. Plus robuste pour les URLs Supabase.
4. **Centrage cluster corrigé** — La formule `targetTX/TY` pour le zoom-sur-cluster était mathématiquement incorrecte. Corrigée : `dynW * (0.5 - cx/100) * nextScale`.
5. **Guard null `currentPlan`** — `handleImportPlan` vérifie maintenant `!currentPlanId || !currentPlan` avant de continuer.
6. **Onglets DXF** — Les miniatures des plans dans la barre d'onglets affichent correctement l'icône grille pour `fileType === 'dxf'`.
7. **Overlay chargement DXF** — Animation de chargement affichée pendant la récupération/parse du DXF.
8. **Bannière import DXF obsolète supprimée** — La bannière "Superposez un plan sur ce DXF" n'est plus pertinente depuis que les DXF ont leur propre URI.

### Patterns clés DXF
- Import DXF → upload Supabase → store `uri` + `fileType: 'dxf'` dans le plan → parse en mémoire (`dxfData[planId]`)
- Au démarrage : si `fileType=dxf` + `uri` + pas de `dxfData[planId]` → fetch + parseDxf automatique
- `hasDxf = !!(currentPlanId && dxfData[currentPlanId])` — contrôle l'affichage de `DxfCanvasOverlay`

## Important Notes
- `newArchEnabled: false` in app.json (uses legacy architecture)
- Web output uses Metro bundler (single output mode)
- The `SafeKeyboardProvider` in `_layout.tsx` skips `KeyboardProvider` on web (not supported)
- Font loading uses `@expo-google-fonts/inter` with splash screen gating
- Header `paddingLeft` changed to 24px (from 16-20px) for cleaner visual offset from sidebar edge
