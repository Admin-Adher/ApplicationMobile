# BuildTrack

Application de gestion de chantier numérique de type Dalux, construite avec Expo et React Native.

## Tech Stack

- **Framework**: Expo (SDK 53) avec Expo Router (routing basé sur les fichiers)
- **Language**: TypeScript
- **UI**: React Native + react-native-web (prévisualisation web)
- **State**: React Context + useReducer (AppContext, AuthContext)
- **Navigation**: Expo Router (tab-based + stack navigation)
- **Fonts**: Inter (via @expo-google-fonts/inter)
- **Storage**: @react-native-async-storage/async-storage
- **Photos**: expo-image-picker (caméra + galerie)
- **Documents**: expo-document-picker (import de fichiers)
- **Export PDF**: expo-print + expo-sharing
- **Export CSV**: génération native + expo-sharing

## Modules implémentés

| Module | Statut |
|--------|--------|
| MODULE 1 — Gestion des réserves | ✅ Complet |
| MODULE 2 — Plans interactifs | ✅ Zoom/pan + placement de marqueurs + filtre entreprise |
| MODULE 3 — Gestion documentaire | ✅ Import réel de fichiers |
| MODULE 4 — Suivi des équipes | ✅ Complet |
| MODULE 5 — Planning chantier | ✅ Création/suppression de tâches + filtres |
| MODULE 6 — Dashboard | ✅ Complet |
| MODULE 7 — Communication interne | ✅ Messages avec nom d'utilisateur |
| MODULE 8 — Photos chantier | ✅ Caméra réelle + galerie |
| MODULE 9 — Rapports automatiques | ✅ Export PDF réel + CSV |
| MODULE 10 — Gestion utilisateurs | ✅ Auth + rôles + permissions |

## Architecture

```
app/
  login.tsx              # Écran de connexion
  _layout.tsx            # Root layout + AuthGuard
  (tabs)/
    _layout.tsx          # Navigation onglets
    index.tsx            # Dashboard
    reserves.tsx         # Liste réserves
    plans.tsx            # Plans interactifs (zoom/pan)
    equipes.tsx          # Suivi équipes
    more.tsx             # Modules + profil + déconnexion
  reserve/
    [id].tsx             # Détail réserve
    new.tsx              # Création réserve
  task/
    new.tsx              # Création tâche
  documents.tsx          # Gestion documentaire
  planning.tsx           # Planning chantier
  photos.tsx             # Photos chantier
  rapports.tsx           # Rapports PDF/CSV
  messages.tsx           # Messagerie interne
context/
  AuthContext.tsx        # Auth + rôles + permissions
  AppContext.tsx         # État global de l'application
constants/
  types.ts               # Types TypeScript
  colors.ts              # Thème couleurs
lib/
  mockData.ts            # Données initiales
  storage.ts             # Persistance AsyncStorage
```

## Authentification

4 rôles disponibles :
- **Admin** — admin@buildtrack.fr / admin123
- **Conducteur** — j.dupont@buildtrack.fr / pass123
- **Chef d'équipe** — m.martin@buildtrack.fr / pass123
- **Observateur** — p.lambert@buildtrack.fr / pass123

## Workflow

- `Start Frontend` — Expo dev server sur le port 5000

## Déploiement

- Build : `npm run web` (expo export → dist/)
- Type : static
- Répertoire public : dist/
