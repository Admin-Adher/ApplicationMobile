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
PORT=5000 npx expo start --web --port 5000
```

The app is accessible on port 5000 (web preview). Users can also scan the QR code with Expo Go for mobile testing.

## Database

The Supabase schema is defined in `lib/schema.sql`. Run it in the Supabase SQL Editor to set up tables. The app includes a demo seed mechanism in `AuthContext.tsx` that creates demo users on first run.

## User Roles

- Admin
- Conducteur de travaux (Site Manager)
- Chef d'équipe (Foreman)
- Observateur (Observer)
