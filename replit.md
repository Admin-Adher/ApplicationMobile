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
- Reserves/Punch list management
- Plan viewer (PDF and DXF construction plans)
- Internal communications (channels + direct messages)
- Site journals, checklists, meeting reports
- Photo annotations and equipment tracking
- Role-based access (Super Admin, Admin, Site Manager, Team Leader, Subcontractor)

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
