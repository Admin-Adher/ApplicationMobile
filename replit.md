# BuildTrack

**BuildTrack** est une application React Native / Expo SDK 53 de gestion de chantier numérique pour Bouygues Construction.

## Architecture

- **Frontend mobile** : Expo (React Native) avec Expo Router pour la navigation
- **Backend** : Supabase (service hébergé — auth, PostgreSQL avec RLS, realtime, storage)
- **Web target** : Metro bundler, tourne comme SPA sur le port 5000
- **Emails transactionnels** : Gmail SMTP via nodemailer (depuis l'API Vercel et la route dev locale)
- **Deep links & landing pages** : Vercel (`https://buildtrack-mobile.vercel.app`)

## Démarrer l'application

```
npm run start
```
Lance : `node node_modules/expo/bin/cli start --web --localhost --port 5000`

Le workflow "Start Frontend" est configuré sur le port 5000.

## Replit — Notes de migration (complétée)

- **Migration réussie** : L'application tourne correctement sur Replit sans modifications du code source.
- **CORS** : `scripts/patch-expo-cors.js` patche automatiquement Expo pour autoriser les domaines `.replit.dev` et `.repl.co` (exécuté via `postinstall` dans `package.json`).
- **Port** : L'app tourne sur le port 5000 (mapé sur le port externe 80).
- **Base de données** : L'app utilise Supabase hébergé (externe). Un PostgreSQL Replit/Neon est aussi provisionné (variables `DATABASE_URL`, `PGHOST`, etc.) — disponible pour usage futur si besoin.
- **Architecture conservée** : Le code Supabase existant n'a pas été modifié — l'app se connecte au projet Supabase externe via les variables `EXPO_PUBLIC_SUPABASE_URL` et `EXPO_PUBLIC_SUPABASE_KEY` déjà configurées.

## Variables d'environnement

Configurées dans Replit (shared) :
- `EXPO_PUBLIC_SUPABASE_URL` — URL du projet Supabase
- `EXPO_PUBLIC_SUPABASE_KEY` — Clé anon Supabase (public, intentionnellement côté client)
- `EXPO_PUBLIC_APP_URL` — URL Vercel : `https://buildtrack-mobile.vercel.app`
- `GMAIL_USER` — Adresse Gmail expéditrice (`buildtrack.admin@gmail.com`)
- `GMAIL_APP_PASSWORD` — Mot de passe d'application Google (16 caractères, secret Replit)
- `EMAIL_FROM` — Expéditeur affiché : `BuildTrack <buildtrack.admin@gmail.com>`

## Fichiers clés

- `lib/supabase.ts` — Client Supabase
- `lib/email/client.ts` — Client email (appelle l'API Vercel)
- `lib/email/templates.ts` — Templates HTML (pour référence — les vrais sont dans vercel-app/)
- `lib/email/sender.ts` — Wrapper nodemailer/Gmail SMTP (utilisé par la route API locale en dev)
- `vercel-app/lib/sender.ts` — Même wrapper côté app Vercel
- `app/api/send-email+api.ts` — Route API Expo (dev uniquement)
- `context/AuthContext.tsx` — Auth + envoi email de bienvenue à l'inscription
- `context/SubscriptionContext.tsx` — Invitations + envoi email d'invitation
- `scripts/patch-expo-cors.js` — Patch CORS Expo pour Replit
- `app/` — Routing Expo Router
- `supabase/migrations/` — Migrations SQL (30+ fichiers)

## Projet Vercel (`vercel-app/`)

Mini-app Next.js déployée sur Vercel qui gère :
- `POST /api/send-email` — Envoi via Resend (invitation, bienvenue, invitation-acceptée, accès-révoqué)
- `POST /api/request-password-reset` — Génère le lien Supabase via Admin API + envoie l'email brandé via Resend (nécessite `SUPABASE_SERVICE_ROLE_KEY` dans les env vars Vercel)
- `/invite?token=xxx` — Page deep link (ouvre l'app ou redirige vers le store)
- `/.well-known/apple-app-site-association` — Universal Links iOS
- `/.well-known/assetlinks.json` — App Links Android

**Pour déployer** : voir `vercel-app/README.md`

**Variable d'environnement à ajouter sur Vercel** :
- `SUPABASE_SERVICE_ROLE_KEY` — Clé service_role Supabase (Dashboard Supabase → Project Settings → API → service_role). Ne jamais mettre dans vercel.json (secret).

## Système d'emails

5 types d'emails envoyés automatiquement :
1. **Invitation** — quand un admin invite un utilisateur (depuis SubscriptionContext)
2. **Bienvenue** — à l'inscription d'un nouvel utilisateur, avec nom de l'organisation si disponible (depuis AuthContext)
3. **Réinitialisation mdp** — email brandé BuildTrack via route dédiée Vercel `/api/request-password-reset` (depuis `requestPasswordReset()` dans `lib/email/client.ts`)
4. **Invitation acceptée** — quand un invité crée son compte (depuis AuthContext `linkPendingInvitation`)
5. **Accès révoqué** — quand un admin retire un utilisateur (depuis SubscriptionContext)

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

## Limites de sièges

Toutes les organisations ont **un nombre illimité de sièges** (`seatMax = -1`). La logique de quota est désactivée côté client dans `context/SubscriptionContext.tsx` :
- `seatMax` est forcé à `-1` (illimité) pour toutes les orgs
- `canInvite` ne dépend plus que de l'état de l'abonnement (`active` ou `trial`)
- Aucun changement de schéma DB requis — les colonnes `plans.max_users` sont ignorées par le client

## URL Scheme (Deep Links)

Scheme Expo : `buildtrack://`
- `buildtrack://invite?token=xxx` — Accepter une invitation

## Diagnostic du compte (Paramètres → Compte)

Panneau pliable dans Paramètres → Compte qui :
- Compare le profil local (`user.role`, `user.organizationId`) au profil serveur Supabase (refetch live)
- Vérifie l'état de la session JWT (active / expirée)
- Liste les incohérences détectées : org_id désync, rôle désync, profil sans organisation, session expirée, rôle non autorisé pour la création
- Donne un message d'action clair pour chaque problème

Utile pour diagnostiquer les erreurs RLS de type "row-level security policy violation" lors de la création de réserves/tâches.
