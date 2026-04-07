# BuildTrack

**BuildTrack** is a React Native / Expo SDK 53 construction management platform (mobile + web).

## Architecture

- **Frontend**: Expo (React Native) with Expo Router for navigation
- **Backend**: Supabase (auth, PostgreSQL with RLS, realtime, storage)
- **Web target**: Metro bundler, runs as a single-page web app

## Running the App

The app starts with:
```
npm run start
```
Which runs: `node node_modules/expo/bin/cli start --web --localhost --port 5000`

The workflow "Start Frontend" is configured to run this on port 5000.

## Environment Variables

Required (set in Replit Secrets/Env Vars):
- `EXPO_PUBLIC_SUPABASE_URL` — Supabase project URL
- `EXPO_PUBLIC_SUPABASE_KEY` — Supabase anon/public key

## Key Files

- `lib/supabase.ts` — Supabase client initialization
- `context/AuthContext.tsx` — Auth state management
- `scripts/patch-expo-cors.js` — Postinstall script that patches Expo CLI's CORS middleware to allow Replit proxy domains (`.replit.dev`, `.repl.co`)
- `app/` — Expo Router file-based routing
- `supabase/migrations/` — All database schema migrations (30+ files)

## Database

The app uses **Supabase** directly (not Replit's built-in PostgreSQL). Key tables include:
- `organizations`, `profiles`, `companies`
- `chantiers` (construction sites)
- `reserves`, `tasks`, `incidents`, `visites`
- `lots`, `oprs`, `site_plans`, `photos`
- `messages`, `channels`
- `documents`, `time_entries`

All tables use Row-Level Security (RLS) policies with helper functions:
- `auth_user_org()` — gets the current user's organization
- `auth_user_role()` — gets the current user's role
- `auth_user_name()` — gets the current user's name

## User Roles

`super_admin`, `admin`, `conducteur`, `chef_equipe`, `observateur`, `sous_traitant`

## Dependencies Note

Some packages have minor version mismatches vs the Expo SDK 53 peer requirements (async-storage, react-native, safe-area-context, webview). These produce warnings but do not affect functionality.
