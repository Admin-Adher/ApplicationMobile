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
- The Expo Metro CORS middleware is patched to allow `.replit.dev` proxy domains (via `scripts/patch-expo-cors.js`, runs automatically on `npm install`).
- If you reinstall `node_modules`, the patch is re-applied automatically via the `postinstall` script.

## iOS Configuration
- **Bundle Identifier**: `com.buildtrack.app`
- **Supports Tablet**: yes
- **Permissions configured** (infoPlist + expo plugins):
  - Camera (`NSCameraUsageDescription`)
  - Photo Library read/write (`NSPhotoLibraryUsageDescription`, `NSPhotoLibraryAddUsageDescription`)
  - Location foreground (`NSLocationWhenInUseUsageDescription`)
  - Microphone (`NSMicrophoneUsageDescription`)
- **EAS Build profiles**:
  - `preview` — internal distribution (TestFlight / ad-hoc)
  - `simulator` — iOS Simulator build for testing
  - `production` — App Store distribution

## Building for iOS (when Apple Developer Account is ready)
```bash
# Install EAS CLI
npm install -g eas-cli

# Login to your Expo account
eas login

# Build for internal testing (TestFlight)
eas build --platform ios --profile preview

# Build for App Store
eas build --platform ios --profile production

# Submit to App Store (after filling appleId/ascAppId/appleTeamId in eas.json)
eas submit --platform ios --profile production
```
Before your first build, complete the `submit.production.ios` section in `eas.json`:
- `appleId` — your Apple ID email
- `ascAppId` — App Store Connect app ID (created on appstoreconnect.apple.com)
- `appleTeamId` — your Apple Developer Team ID

## Deployment
- Development: `npm run start` (Metro bundler, web mode)
- Static build: `npm run web` (outputs to `dist/`)
- iOS native: `eas build --platform ios --profile preview` (requires Apple Developer Account)
- Android native: `eas build --platform android --profile preview`

## Replit Migration Status
- Migrated to Replit environment on 2026-04-05
- Re-confirmed working on Replit 2026-04-05 (packages reinstalled, workflow running)
- Migration completed: app runs cleanly on Replit in demo mode (no Supabase credentials required)
- Code fixes applied during migration:
  - Fixed syntax error in `context/AppContext.tsx` (addSitePlanVersion)
  - Added `DEMO_PASSWORDS` constant to `app/login.tsx`
  - Added `pendingGps` state to `app/photos.tsx`
  - Added `rightActions` prop to `components/Header.tsx`
  - Fixed `SkeletonCard` import in `app/(tabs)/incidents.tsx`
  - Fixed `genId()` to accept optional prefix in `lib/utils.ts`
  - Reduced font load timeout from 1500ms to 500ms for faster startup
- App runs in demo mode without Supabase credentials
- To connect a real Supabase backend, set `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_KEY` as Replit secrets
- CORS patch is applied automatically via `postinstall` script (`scripts/patch-expo-cors.js`)
- iOS build configuration complete — ready to build once Apple Developer Account is active

## Supabase RLS Organization ID Audit (2026-04-10)
All INSERT functions in `context/AppContext.tsx` now include `organization_id` in their Supabase payload, using the robust async org-lookup pattern (reads from profile if ref is empty). Tables fixed:
- `reserves` — `addReserve` (was already fixed)
- `tasks` — `addTask` (was already fixed)
- `visites` — `addVisite` + `fromVisite(v, orgId)` mapper updated
- `lots` — `addLot` + `fromLot(l, orgId)` mapper updated
- `oprs` — `addOpr` + `fromOpr(o, orgId)` mapper updated
- `site_plans` — `addSitePlan` + `addSitePlanVersion` updated

**Required Supabase SQL migration**: Run `supabase/migrations/20260410_master_organization_id_fix.sql` in your Supabase SQL Editor. This migration:
- Adds `organization_id` column to all 6 child tables
- Back-fills existing rows via their chantier
- Replaces RLS policies with dual-path logic (direct org_id OR chantier join)
- Is fully idempotent — safe to run multiple times

## Super Admin & Licence Architecture (2026-04-05)
- All organizations automatically receive the **Entreprise — Illimité** plan (no plan selection UI)
- `app/superadmin.tsx`: removed the obsolete "Changer la formule" plan modal and all related code (`planModal`, `allPlans`, `updateOrgPlan`, `handleChangePlan`, `PLAN_COLORS`)
- Org cards now display a fixed "Entreprise — Illimité" badge (violet) and an "Éditer" button (pencil icon)
- "Éditer" opens a new modal to rename the organization (name editable, slug read-only)
- Status change (Actif/Suspendu/Essai/Expiré) remains a quick action via the status badge on each org card
- `context/SubscriptionContext.tsx`: added `updateOrganization(orgId, name)` — updates org name in Supabase `organizations` table (or in demo state), exposed in context value
- `app/(tabs)/admin.tsx`: "Abonnement" tab renamed "Licence" with read-only Entreprise plan display

## Architecture Notes
- This is a pure React Native/Expo app. All data access is client-side.
- Supabase is the optional backend — without credentials, the app uses built-in demo data.
- No Node.js/Express backend needed — the app communicates directly with Supabase from the browser/device.
- The Supabase anon key (EXPO_PUBLIC_SUPABASE_KEY) is safe to expose client-side — Supabase RLS policies enforce data access.
