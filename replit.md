# BuildTrack

**BuildTrack** est une application React Native / Expo SDK 53 de gestion de chantier numérique pour Bouygues Construction.

## Architecture

- **Frontend mobile** : Expo (React Native) avec Expo Router pour la navigation
- **Backend** : Supabase (service hébergé — auth, PostgreSQL avec RLS, realtime, storage)
- **Web target** : Metro bundler, tourne comme SPA sur le port 5000
- **Emails transactionnels** : Resend (via l'API Vercel)
- **Deep links & landing pages** : Vercel (`https://buildtrack-mobile.vercel.app`)

## Démarrer l'application

```
npm run start
```
Lance : `node node_modules/expo/bin/cli start --web --localhost --port 5000`

Le workflow "Start Frontend" est configuré sur le port 5000.

## Variables d'environnement

Configurées dans Replit (shared) :
- `EXPO_PUBLIC_SUPABASE_URL` — URL du projet Supabase
- `EXPO_PUBLIC_SUPABASE_KEY` — Clé anon Supabase
- `EXPO_PUBLIC_APP_URL` — URL Vercel : `https://buildtrack-mobile.vercel.app`
- `RESEND_API_KEY` — Clé API Resend (secret)

## Fichiers clés

- `lib/supabase.ts` — Client Supabase
- `lib/email/client.ts` — Client email (appelle l'API Vercel)
- `lib/email/templates.ts` — Templates HTML (pour référence — les vrais sont dans vercel-app/)
- `lib/email/sender.ts` — Wrapper Resend (utilisé par la route API locale en dev)
- `app/api/send-email+api.ts` — Route API Expo (dev uniquement)
- `context/AuthContext.tsx` — Auth + envoi email de bienvenue à l'inscription
- `context/SubscriptionContext.tsx` — Invitations + envoi email d'invitation
- `scripts/patch-expo-cors.js` — Patch CORS Expo pour Replit
- `app/` — Routing Expo Router
- `supabase/migrations/` — Migrations SQL (30+ fichiers)

## Projet Vercel (`vercel-app/`)

Mini-app Next.js déployée sur Vercel qui gère :
- `POST /api/send-email` — Envoi via Resend (invitation, bienvenue, reset mdp)
- `/invite?token=xxx` — Page deep link (ouvre l'app ou redirige vers le store)
- `/.well-known/apple-app-site-association` — Universal Links iOS
- `/.well-known/assetlinks.json` — App Links Android

**Pour déployer** : voir `vercel-app/README.md`

## Système d'emails

3 types d'emails envoyés automatiquement :
1. **Invitation** — quand un admin invite un utilisateur (depuis SubscriptionContext)
2. **Bienvenue** — à l'inscription d'un nouvel utilisateur (depuis AuthContext)
3. **Réinitialisation mdp** — à implémenter (appeler `sendPasswordResetEmail()` de `lib/email/client.ts`)

## Base de données (Supabase)

Tables principales :
- `organizations`, `profiles`, `companies`
- `chantiers` (chantiers)
- `reserves`, `tasks`, `incidents`, `visites`
- `lots`, `oprs`, `site_plans`, `photos`
- `messages`, `channels`
- `documents`, `time_entries`
- `invitations` — gestion des invitations avec token unique

RLS via fonctions SECURITY DEFINER : `auth_user_org()`, `auth_user_role()`, `auth_user_name()`

## Rôles utilisateurs

`super_admin`, `admin`, `conducteur`, `chef_equipe`, `observateur`, `sous_traitant`

## URL Scheme (Deep Links)

Scheme Expo : `buildtrack://`
- `buildtrack://invite?token=xxx` — Accepter une invitation
