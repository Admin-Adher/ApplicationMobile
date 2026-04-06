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
