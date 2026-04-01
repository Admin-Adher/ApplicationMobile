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

## Important Notes
- `newArchEnabled: false` in app.json (uses legacy architecture)
- Web output uses Metro bundler (single output mode)
- The `SafeKeyboardProvider` in `_layout.tsx` skips `KeyboardProvider` on web (not supported)
- Font loading uses `@expo-google-fonts/inter` with splash screen gating
