# BuildTrack — Gestion de chantier numérique

## Overview
BuildTrack is a construction site management app built with **Expo (React Native)** targeting both mobile and web. It uses **Supabase** as its backend (authentication, PostgreSQL database, Realtime).

## Architecture
- **Framework:** Expo SDK 53 + React Native 0.79 with Expo Router (file-based navigation)
- **Backend:** Supabase (auth, database, realtime, storage) — connected directly from the client
- **State Management:** React Context API with useReducer
- **Language:** TypeScript 5.8
- **Local persistence:** AsyncStorage (offline cache fallback)

## Key Configuration
- **Start command:** `npm start` → runs `expo start --web --localhost --port 5000`
- **Port:** 5000
- **Environment Variables (shared):**
  - `EXPO_PUBLIC_SUPABASE_URL` — Supabase project URL (`https://jzeojdpgglbxjdasjgta.supabase.co`)
  - `EXPO_PUBLIC_SUPABASE_KEY` — Supabase anon/public key

## Project Structure
```
app/                  # Expo Router screens & navigation
  (tabs)/             # Bottom tab navigation (Dashboard, Plans, Reserves, Messages, Terrain)
  [feature]/[id].tsx  # Dynamic feature screens
components/           # Reusable UI components
context/              # Global state providers (AppContext, AuthContext, etc.)
lib/                  # Supabase client, utilities, schema
supabase/migrations/  # SQL migration files for Supabase
scripts/              # Build scripts (patch-expo-cors.js for Replit compatibility)
assets/               # Fonts, images
```

## Replit Compatibility
- `scripts/patch-expo-cors.js` — patches Expo's CORS middleware to allow Replit proxy domains (`.replit.dev`, `.repl.co`). Runs automatically via `postinstall`.
- The app has a Demo Mode (falls back to mock data if Supabase credentials are missing).
- Workflow: "Start Frontend" runs `npm start` on port 5000 (webview output).

## Database
The Supabase database schema is in `lib/schema.sql`. Migration files are in `supabase/migrations/`. Key tables: `organizations`, `profiles`, `chantiers`, `reserves`, `tasks`, `companies`, `channels`, `messages`, `visites`, `lots`, `oprs`, `site_plans`, `photos`, `documents`, `incidents`, `time_entries`.

## Security
- Row Level Security (RLS) enabled on all tables
- Multi-tenant isolation via `organization_id` on all tables
- Roles: `super_admin`, `admin`, `conducteur`, `chef_equipe`, `sous_traitant`
- Helper functions: `auth_user_org()`, `auth_user_name()` (SECURITY DEFINER)

## Known Fixes Applied
- **AppContext.tsx:** Fixed `profile` variable scoping bug — it was declared with `const` inside an `if` block but referenced outside it, causing a `ReferenceError` that triggered the "Impossible de charger les données" error dialog on every data load.
- **npm install:** On migration, needed `rm -rf node_modules/react-native-web/src` before `npm install` due to ENOTEMPTY error.
- **CORS patch:** `scripts/patch-expo-cors.js` applied automatically via `postinstall` to allow Replit proxied iframe domains.
- **Web font loading fix (app/_layout.tsx):** `timedOut` state now initializes to `true` on web (`Platform.OS === 'web'`). This prevents the app from being stuck on "Chargement…" because `useFonts` hangs indefinitely on the Replit web environment (fonts load from npm package assets but the hook never resolves). Setting `timedOut = true` on web makes `fontsReady = true` immediately and bypasses the loading screen, letting the app render the auth flow.
- **BUG 2 — deleteChantier cascade (AppContext.tsx):** Added full cascade delete in Supabase for reserves, tasks, visites, lots, oprs, site_plans before deleting the chantier itself. Previously only site_plans were deleted, leaving orphaned data.
- **BUG 3 — loadAll upsert missing organization_id (AppContext.tsx):** Added `organization_id: currentUserOrgIdRef.current` to reserves cache-upsert, and fixed visites/oprs cache-upserts to pass orgId to `fromVisite`/`fromOpr`. Prevents zombie records with `organization_id=null` that are unwritable after being pushed to Supabase.
- **BUG 5 — resolveConflict unchecked (NetworkContext.tsx):** Conflict is now only dismissed from the UI after the Supabase UPDATE succeeds. On error, `syncStatus` is set to `error` and the conflict remains queued.
- **BUG 8 — Offline queue DELETE row count (NetworkContext.tsx):** DELETE operations in the offline replay queue now use `.select()` and check that `data.length > 0`. RLS-blocked DELETEs (error=null, 0 rows affected) are re-queued as failed operations instead of being silently dropped.
- **BUG 9 — chantiers write policy (supabase/migrations/20260415):** Added `chef_equipe` to the chantiers write policy, matching the lots/oprs policy updated in 20260410. Eliminates the role inconsistency where chef_equipe could edit lots/OPRs but not the chantier itself.
- **BUG 10 — updateVisite/updateLot/updateOpr overwrite organization_id (AppContext.tsx):** `organization_id` is now excluded from UPDATE payloads for visites, lots, and oprs. Prevents accidentally setting `organization_id=null` in Supabase on every update, which would make records permanently unmodifiable.
- **BUG 11 — Orphan reserves SELECT policy (supabase/migrations/20260415):** Restricted the permissive orphan-reserves clause to `super_admin` only. Previously any authenticated user could read reserves with `chantier_id=null AND organization_id=null`, enabling cross-organization data leaks.
- **BUG 15 — sendMessage notification silent failure (AppContext.tsx):** Added `console.warn` when the notification message INSERT to Supabase fails, so RLS or permission errors are no longer swallowed silently.
- **deleteSitePlan RLS rollback (AppContext.tsx):** Added `.select()` + row count check with UI rollback on failure, consistent with all other delete functions.
- **BUG 17 — crash "Property 'canMovePins' doesn't exist" (plans.tsx + AuthContext.tsx):** The native compiled app had an older JS bundle where `ROLE_PERMISSIONS` didn't include `canMovePins`. When `plans.tsx` accesses `permissions.canMovePins` it throws a runtime error in Hermes. Fix: (1) `resolvePermissions()` now falls back to `ROLE_PERMISSIONS.observateur` for unknown roles and explicitly guards `canMovePins` from being `undefined`; (2) the prop pass in `plans.tsx` uses `permissions.canMovePins ?? true` so even a missing property gracefully defaults to allowing pin movement.
- **BUG 16 — admin panel shows "0 utilisateurs" (AuthContext.tsx + migration 20260417):** Two compounding issues: (a) the `profiles.select()` query in AuthContext explicitly lists `permissions_override` and `company_id` columns — if either column is absent from the DB (migration 20260406 not yet applied), Supabase returns `{ data: null, error }` which was silently swallowed (`.catch(() => {})`), leaving `users = []` forever; (b) the profiles SELECT policy (`auth.role() = 'authenticated'`) existed only in `schema.sql`, never in any migration — if the DB was initialized from migrations alone, no SELECT policy existed and RLS blocked all profile reads. Fix: (1) migration `20260417_fix_profiles_columns_and_select_policy.sql` adds all four missing columns with `IF NOT EXISTS` and recreates the SELECT/UPDATE/DELETE policies; (2) AuthContext now captures `error` from the Supabase response, logs it with `console.warn`, and falls back to a minimal `select('id, name, role…')` query that always works.

- **BUG (pas de chantier actif au login) — AppContext.tsx:** Après une déconnexion (ou première connexion), `ACTIVE_CHANTIER_KEY` est vide — le code faisait `if (activeChantierId) dispatch(...)` et ne dispatchait donc rien. L'utilisateur voyait toujours un état "aucun chantier actif" même avec des chantiers disponibles. Fix : après le chargement des chantiers, on valide l'ID stocké dans la liste chargée ; si l'ID est absent ou null, on auto-sélectionne `chantiers[0]` et on le persiste dans AsyncStorage. Même logique appliquée au chemin mock.
- **BUG CRITIQUE (chargement infini à la première ouverture) — AuthContext.tsx + AppContext.tsx:** Trois bugs imbriqués causaient un chargement infini lors de la première ouverture : (A) Le processus de seeding déclenchait des `SIGNED_OUT` *avant* `INITIAL_SESSION` → AppContext effaçait les données et annulait chaque `loadAll()`. (B) Après `INITIAL_SESSION`, le seeding déclenchait des `SIGNED_IN` qui relançaient `loadAll()` en boucle. (C) Le dernier `signInWithPassword` du seeding en vol (*in-flight*) se terminait APRÈS l'abort, déclenchant un `SIGNED_IN` parasite qui annulait le `loadAll()` légitime alors que `globalSeedingRef` était déjà `false`. Fix en trois gardes : **Guard 1** — AppContext ignore tout événement avant `INITIAL_SESSION`. **Guard 2** — AppContext ignore les événements quand `globalSeedingRef.current === true` (flag module-level exporté depuis `AuthContext` et synchronisé avec `isSeedingRef`). **Guard 3** — AppContext ignore les `SIGNED_IN` si un `loadAll()` est déjà en cours (`loadAllInProgressRef`), empêchant les appels en double de s'annuler mutuellement. `INITIAL_SESSION` est désormais géré explicitement dans AppContext : avec session → `loadAll()` ; sans session → `SET_LOADING: false`.
- **BUG (SIGNED_OUT cache incomplet) — AppContext.tsx:** Lors de la déconnexion, le handler `SIGNED_OUT` ne vidait que 6 clés AsyncStorage (canaux, DM, préférences) et ne réinitialisait pas en mémoire `chantiers`, `sitePlans`, `visites`, `lots`, `oprs`, `activeChantierId`. Résultat : un second compte se connectant sur le même appareil voyait les chantiers, réserves, messages et autres données du compte précédent. Fix : ajout de 5 dispatches `SET_*` pour vider ces collections en mémoire + ajout de toutes les clés mock manquantes (`ACTIVE_CHANTIER_KEY`, `MOCK_RESERVES_KEY`, `MOCK_TASKS_KEY`, `MOCK_PHOTOS_KEY`, `MOCK_MESSAGES_KEY`, `MOCK_CHANTIERS_KEY`, `MOCK_SITE_PLANS_KEY`, `MOCK_VISITES_KEY`, `MOCK_LOTS_KEY`, `MOCK_OPRS_KEY`, `MOCK_COMPANIES_KEY`, `buildtrack_mock_documents_v2`) au `multiRemove` AsyncStorage.
- **BUG (lastMessageByChannel timestamp comparison) — app/(tabs)/messages.tsx + app/messages.tsx + AppContext.tsx:** The channel list preview was showing the wrong "last message" for each channel. Three compounding bugs: (1) `app/(tabs)/messages.tsx` compared `msg.timestamp > existing.timestamp` using French-format strings (`dd/mm/yyyy HH:mm`), which sorts incorrectly at month/year boundaries (e.g. "01/04/2026" < "31/03/2026" alphabetically). (2) `app/messages.tsx` took `chMsgs[chMsgs.length - 1]` — the last element in the channel's messages slice — but state stores preview messages newest-first (from `PREPEND_MESSAGES`), so this returned the oldest message. (3) `addMessage()` in AppContext constructed locally-sent messages without `dbCreatedAt`, so `getMsgSortTime()` returned 0 for the sender's own messages — any incoming message with a real ISO timestamp would outsort them. Fix: (a) added `getMsgSortTime(msg)` helper in both screen files (uses `dbCreatedAt` ISO timestamp with French-date fallback); (b) `lastMessageByChannel` now tracks the numeric max time; (c) `addMessage()` sets `dbCreatedAt: new Date().toISOString()` on locally-constructed messages so own messages always sort correctly.

## Per-User Permission Overrides (Feature)
- **`constants/types.ts`**: Added `UserPermissions` (with `canMovePins`), `PermissionsOverride = Partial<UserPermissions>`, added `permissionsOverride?` to `User` and `Profile`.
- **`context/AuthContext.tsx`**: Added `ROLE_PERMISSIONS` with `canMovePins` per role, `resolvePermissions(role, override)` merges overrides (super_admin is override-immune), `updateUserPermissions()` persists to Supabase `permissions_override` column and updates local state.
- **`supabase/migrations/20260406_add_permissions_override.sql`**: Adds `permissions_override jsonb DEFAULT '{}'` to profiles table.
- **`components/PdfPlanViewer.tsx`**: Pin drag gated by `canMovePins && canCreate` on both web (mouse) and mobile (touch long-press).
- **`app/admin/user/[id].tsx`**: Full-screen user edit screen with: avatar/name/email header, role radio buttons, company chip grid, 8-permission toggles with 3 states (role default / manually enabled / manually disabled), reset overrides button, save/cancel footer. Access control: admin cannot edit other admins or super_admins.
- **`app/(tabs)/admin.tsx`**: Edit button navigates to `/admin/user/[id]` screen. Old modal-based user editing code removed (dead code cleanup).
