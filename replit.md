# BuildTrack

Digital construction site management application built with Expo (React Native) targeting web, iOS, and Android.

## Tech Stack

- **Framework:** Expo SDK 53 with Expo Router (file-based routing)
- **Language:** TypeScript
- **UI:** React Native with `react-native-web` for browser support
- **Backend/Database:** Supabase (PostgreSQL + Auth + Storage)
- **State Management:** React Context API + `useReducer`
- **Data Fetching:** TanStack Query (`@tanstack/react-query`)
- **Local Storage:** AsyncStorage
- **Reporting:** `expo-print` (PDF), `xlsx` (Excel/CSV)

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

- **`app/(tabs)/more.tsx`** — Équipes module added to the "Plus" menu (was inaccessible — tab hidden with `href: null` and missing from menu)
- **`app/channel/[id].tsx`** — Replaced deprecated `Clipboard` from `react-native` with `expo-clipboard`; updated `Clipboard.setString()` → `Clipboard.setStringAsync()`
- **`app/channel/[id].tsx`** — Fixed deprecated `ImagePicker.MediaTypeOptions.Images` → `['images']`
- **`app/channel/[id].tsx`** — Fixed hardcoded `paddingTop: 52` → `insets.top + 8` using `useSafeAreaInsets()` for correct notch/Dynamic Island support

## Feature Completion (100%)

All 10 planned modules are implemented:
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
