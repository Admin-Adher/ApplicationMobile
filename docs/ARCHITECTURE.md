# BuildTrack — Architecture Technique

## Vue d'ensemble

BuildTrack est une application mobile de gestion de chantier développée avec **Expo (React Native)**. Elle cible iOS, Android et Web via une seule base de code TypeScript.

---

## Stack technologique

| Couche | Technologie |
|---|---|
| Mobile / Web | Expo SDK 53 + React Native 0.79 |
| Langage | TypeScript 5.8 |
| Navigation | Expo Router (file-based, similaire Next.js) |
| Backend | Supabase (PostgreSQL + Auth + Realtime + Storage) |
| État global | React Context + useReducer |
| Stockage local | AsyncStorage (cache hors-ligne) |
| Génération PDF | expo-print + pdfjs-dist |
| Export Excel | xlsx |
| IA | OpenAI API (résumés, suggestions) |

---

## Structure du projet

```
app/                    # Écrans et routing (Expo Router)
  (tabs)/               # Onglets principaux
  chantier/             # Gestion des chantiers
  reserve/              # Gestion des réserves
  visite/               # Gestion des visites
  opr-session/          # OPR (Opérations de Réception)
  incident/             # Gestion des incidents
  channel/              # Messagerie
  task/                 # Tâches
components/             # Composants réutilisables
  PhotoAnnotator        # Annotation de photos
  PdfPlanViewer         # Visualisation plans PDF/DXF
  SignaturePad          # Signature électronique
context/                # Providers React Context
  AuthContext           # Authentification + profils
  AppContext            # Données métier (réserves, chantiers, etc.)
  SubscriptionContext   # Licence et organisation
constants/              # Types TypeScript + couleurs + rôles
lib/                    # Utilitaires
  supabase.ts           # Client Supabase
  schema.sql            # Schéma complet de la base de données
  storage.ts            # Gestion des buckets Supabase Storage
supabase/migrations/    # Migrations SQL incrémentales
assets/                 # Fonts, images, icônes
docs/                   # Documentation technique (ce dossier)
```

---

## Authentification & Rôles

L'authentification est gérée par **Supabase Auth** (email/mot de passe). Après connexion, un profil est chargé depuis la table `public.profiles`.

### Rôles disponibles

| Rôle | Description | Droits |
|---|---|---|
| `super_admin` | Administrateur plateforme | Tous les droits, accès toutes organisations |
| `admin` | Administrateur organisation | Création, édition, suppression, export |
| `conducteur` | Conducteur de travaux | Création, édition, export |
| `chef_equipe` | Chef d'équipe | Création, édition propre |
| `observateur` | Lecture seule | Lecture + export |
| `sous_traitant` | Sous-traitant | Lecture + édition propre |

---

## Modèle de données principal

### Tables Supabase

| Table | Description |
|---|---|
| `profiles` | Profils utilisateurs (rôle, organisation) |
| `organizations` | Organisations clientes |
| `plans` | Plans de licence |
| `subscriptions` | Licences actives par organisation |
| `chantiers` | Projets de construction |
| `reserves` | Réserves (non-conformités) |
| `tasks` | Tâches liées aux réserves |
| `visites` | Visites de chantier |
| `oprs` | Opérations Préalables à la Réception |
| `companies` | Entreprises / sous-traitants |
| `lots` | Lots de travaux |
| `site_plans` | Plans de chantier (PDF/DXF) |
| `messages` | Messages de la messagerie |
| `channels` | Canaux de messagerie |
| `documents` | Documents liés aux chantiers |
| `photos` | Photos des réserves |
| `invitations` | Invitations d'utilisateurs |
| `time_entries` | Pointage et présences |

---

## Sécurité

- **Row Level Security (RLS)** activé sur toutes les tables Supabase
- Les politiques d'accès sont définies par rôle (`auth.uid()` + jointure `profiles`)
- Les credentials Supabase sont injectés via variables d'environnement (`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_KEY`)
- Aucun secret n'est présent dans le code source

---

## Fonctionnement hors-ligne

L'application maintient un cache local via **AsyncStorage** pour les chantiers, réserves, visites, OPR et plans. Lors de la reconnexion, les données locales sont synchronisées avec Supabase.

---

## Génération de rapports

- **PDF** : via `expo-print` (rapports de visite, OPR, réserves)
- **Excel** : via `xlsx` (export des réserves et pointages)
- **Signature électronique** : composant `SignaturePad` (SVG)

---

## Déploiement

| Plateforme | Méthode |
|---|---|
| iOS | Expo Launch (Replit) → App Store |
| Android | EAS Build → Google Play (manuel) |
| Web | Expo export --platform web |

---

## Variables d'environnement requises

| Variable | Description |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | URL du projet Supabase |
| `EXPO_PUBLIC_SUPABASE_KEY` | Clé publique (anon key) Supabase |
| `EXPO_PUBLIC_DEMO_SEED_PASS` | Mot de passe comptes de démonstration (optionnel) |
