# BuildTrack — Replit Project Documentation

## Overview
BuildTrack is a construction site management application built with **Expo / React Native** targeting web (via Metro bundler) and mobile (iOS/Android via EAS). It is written in TypeScript and uses **Supabase** as its backend (auth, database, realtime, storage).

## Architecture

- **Framework:** Expo SDK 53, React Native 0.79, Expo Router v5 (file-based routing)
- **Language:** TypeScript 5.8
- **Backend:** Supabase (PostgreSQL with RLS, Auth, Realtime, Storage)
- **Navigation:** Expo Router — file-based, similar to Next.js pages
- **State:** React Context providers (Auth, App, Settings, Incidents, Pointage, Network, Notifications, Subscription)
- **Offline:** AsyncStorage caching for working on sites with poor connectivity

## Key Directories

| Path | Purpose |
|------|---------|
| `app/` | All screens and routing (Expo Router) |
| `app/(tabs)/` | Main tab navigation (Dashboard, Team, Reserves, Plans, Messages, etc.) |
| `components/` | Reusable UI components |
| `context/` | React Context providers (global state) |
| `lib/` | Utilities: Supabase client, storage helpers, PDF tools |
| `assets/` | Fonts, images |
| `supabase/migrations/` | SQL migration files for Supabase (apply in Supabase SQL Editor) |
| `scripts/` | Build/patch scripts |

## Environment Variables

| Variable | Description | Where Set |
|----------|-------------|-----------|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL | Replit shared env vars |
| `EXPO_PUBLIC_SUPABASE_KEY` | Supabase anonymous key | Replit shared env vars |

## Running the App

The app runs via the **Start Frontend** workflow which executes:
```
npm start
```
This starts the Expo Metro bundler on port 5000 in web mode. The Replit preview pane shows the web version.

A CORS patch (`scripts/patch-expo-cors.js`) is applied automatically via `postinstall` to allow Replit's proxy domains (`.replit.dev`, `.repl.co`) to communicate with the Metro dev server.

## User Roles

- `super_admin` — Full access to all organizations
- `admin` — Full access within their organization
- `conducteur` — Can create/edit, no delete
- `chef_equipe` — Create/edit own items, attendance tracking
- `observateur` — Read-only + export
- `sous_traitant` — Can only see/update reserves assigned to their company

## Database Migrations

SQL migration files in `supabase/migrations/` must be applied in Supabase SQL Editor (not auto-applied). They handle:
- Row Level Security (RLS) policies by organization
- Schema alterations (new columns, indexes)
- Helper functions (`auth_user_org()`, `auth_user_name()`)
- RPCs (`mark_messages_read_by`, `toggle_message_reaction`)

## Deployment

- **Web (Replit):** Served by Metro bundler via `npm start` on port 5000
- **Static export:** `npm run web` (exports to `dist/`) — used for Replit Deployments
- **Mobile:** EAS builds (`npm run android`, `npm run ios`)
