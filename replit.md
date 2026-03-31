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

## Project Structure

```
app/               # Expo Router routes
  (tabs)/          # Main tab navigation (Dashboard, Reserves, Plans, Teams)
  reserve/         # Dynamic routes for reserve detail/creation
  task/            # Dynamic routes for task management
  login.tsx        # Auth entry point
components/        # Reusable UI components
context/           # AuthContext, AppContext (Supabase sync)
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

## Database

The Supabase schema is defined in `lib/schema.sql`. Run it in the Supabase SQL Editor to set up tables. The app includes a demo seed mechanism in `AuthContext.tsx` that creates demo users on first run.

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

## Feature Completion (100%)

All 11 planned modules are implemented:
1. **Réserves** — full CRUD, 5 statuses, comments, history, photo attachment on creation
2. **Plans interactifs** — import PDF/image, pinning, zoom/pan, filter by company + filter by zone
3. **Documents** — upload, categories, versioning, search
4. **Équipes** — company tracking, actual/planned workers, hours, zones
5. **Planning** — list/calendar/Gantt views, task creation/deletion
6. **Dashboard** — KPIs including delayed tasks counter, status bars, critical + delayed task alerts
7. **Communication** — internal messaging, reserve comments
8. **Photos** — camera/gallery, comment+location modal before saving, Supabase upload
9. **Rapports** — daily/weekly PDF, CSV export
10. **Utilisateurs** — 4 roles, Supabase auth
11. **Administration** — dedicated admin tab (visible to `admin` role only): user role management, company CRUD
