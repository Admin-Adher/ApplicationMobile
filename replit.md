# BuildTrack — Application Mobile BTP

## Overview
BuildTrack is a professional construction site management app (React Native / Expo) for the French BTP industry. It manages snag lists (réserves), construction site inspections (visites/OPRs), team coordination, PDF plan annotation, and real-time messaging.

## Architecture
- **Framework**: Expo SDK 53 / React Native 0.79.7
- **Language**: TypeScript
- **Navigation**: expo-router (file-based routing)
- **Backend**: Supabase (PostgreSQL + Auth + Storage + Realtime)
- **Web bundler**: Metro (Expo web mode, single output)
- **Port**: 5000

## Running the App
```
npm run start
```
This starts the Expo Metro bundler on port 5000 (web mode).

## Environment Variables
The app runs in **demo mode** (local data only) when Supabase is not configured. To connect to a real Supabase backend, set:
- `EXPO_PUBLIC_SUPABASE_URL` — Your Supabase project URL
- `EXPO_PUBLIC_SUPABASE_KEY` — Your Supabase anon/public key

## Key Files & Directories
- `app/` — Screens and routing (expo-router file-based)
  - `(tabs)/` — Main tab navigation: Dashboard, Réserves, Plans, Messages, Terrain
  - `chantier/`, `reserve/`, `visite/`, `task/`, `channel/`, `opr*` — Feature sub-screens
- `context/` — React Context providers (Auth, App, Incidents, Notifications, Network, etc.)
- `lib/` — Utilities, Supabase client (`lib/supabase.ts`), schema (`lib/schema.sql`)
- `components/` — Reusable UI components (PdfPlanViewer, SignaturePad, PhotoAnnotator, etc.)
- `constants/` — Types, roles, and app-wide constants
- `supabase/migrations/` — SQL migration files for Supabase
- `assets/` — Fonts, images, splash screen

## Demo Mode
When `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_KEY` are not set, the app automatically falls back to offline/demo mode with:
- Local mock data (demo construction sites, snag lists, etc.)
- Demo users for all roles (admin, conducteur, chef_equipe, etc.)
- Full UI navigation without a backend connection

## Database Schema
The full Supabase PostgreSQL schema is in `lib/schema.sql`. Key tables:
- `profiles` — User accounts linked to Supabase auth
- `organizations` — Multi-tenant organizations
- `chantiers` — Construction sites
- `reserves` — Snag list items with coordinates, photos, signatures
- `visites` — Site inspection visits
- `oprs` — Procès-verbaux de réception (handover reports)
- `site_plans` — PDF/DXF floor plans with revisions
- `messages` / `channels` — Real-time messaging
- `companies`, `lots`, `tasks`, `incidents`, `time_entries`, etc.

## Replit-Specific Configuration
- The Expo Metro CORS middleware (`node_modules/@expo/cli/build/src/start/server/middleware/CorsMiddleware.js`) has been patched to allow `.replit.dev` proxy domains. This is required for the Replit preview pane to work since requests are proxied through Replit's iframe proxy.
- A backup of the original middleware is stored as `CorsMiddleware.js.bak` in the same directory.
- If you reinstall `node_modules`, you will need to re-apply this patch (or run `npm install` — Replit agent will handle it).

## Deployment
- Development: `npm run start` (Metro bundler, web mode)
- Static build: `npm run web` (outputs to `dist/`)
- Mobile: Use EAS Build for iOS/Android native builds
