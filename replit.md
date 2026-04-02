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
- **PointageContext** — Now loads from `time_entries` on startup, syncs add/update/delete to Supabase; falls back to AsyncStorage when Supabase unavailable
- **Missing tables** — 6 new tables added to schema.sql with proper RLS policies

## Important Notes
- `newArchEnabled: false` in app.json (uses legacy architecture)
- Web output uses Metro bundler (single output mode)
- The `SafeKeyboardProvider` in `_layout.tsx` skips `KeyboardProvider` on web (not supported)
- Font loading uses `@expo-google-fonts/inter` with splash screen gating
