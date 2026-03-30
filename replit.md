# ApplicationMobile

A mobile application built with Expo and React Native, with web preview support.

## Tech Stack

- **Framework**: Expo (SDK 53) with Expo Router (file-based routing)
- **Language**: TypeScript
- **UI**: React Native + react-native-web (for web preview)
- **State**: @tanstack/react-query for server state, useState for local state
- **Navigation**: Expo Router (tab-based navigation)
- **Fonts**: Inter (via @expo-google-fonts/inter)
- **Storage**: @react-native-async-storage/async-storage

## Project Structure

```
app/
  _layout.tsx          # Root layout with all providers
  (tabs)/
    _layout.tsx        # Tab navigation layout
    index.tsx          # Home screen
    explore.tsx        # Explore screen
    profile.tsx        # Profile screen
  +not-found.tsx       # 404 screen
assets/
  images/              # App icons and images
components/            # Reusable UI components
constants/
  colors.ts            # Color theme (light/dark)
lib/
  query-client.ts      # React Query client + API utilities
```

## Running the App

- **Start Frontend**: `PORT=8080 npx expo start --port 8080`
- App runs on port 8080 (Expo Metro dev server)
- Scan the QR code with Expo Go (iOS/Android) to test on physical device
- Web preview available at port 8080

## Workflows

- `Start Frontend` — Runs the Expo dev server on port 8080

## Deployment

- Build: `npm run web` (expo export --platform web → outputs to dist/)
- Deployment type: static
- Public dir: dist/
