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

## Améliorations PDF (audit sécurité — mai 2025)

- `lib/pdfBase.ts` — Ajout de `escapeHtml` exportée ; tous les helpers (`buildLetterhead`, `buildInfoGrid`, `buildKpiRow`, `buildDocFooter`, `buildPhotoGrid`, `wrapHTML`) échappent désormais toutes les chaînes utilisateur via `escapeHtml` en interne.
- `lib/utils.ts` — Ajout de `getISOWeek(date): number` (semaine ISO 8601 correcte) et `getISOWeekKey(date): string` (clé "YYYY-Www" pour groupement hebdomadaire).
- `app/rapports.tsx` — Calcul `weekNum` corrigé (ISO standard via `getISOWeek`) ; `escapeHtml` appliqué dans tous les builders HTML (`buildLotSummaryRows`, `buildDailyHTML`, `buildWeeklyHTML`, `buildIncidentHTML`, `buildCompanyReserveHTML`).
- `app/meeting-report.tsx` — `buildMeetingHTML` réécrit avec `wrapHTML`/`buildLetterhead`/`buildInfoGrid`/`buildDocFooter` + `escapeHtml` ; `handleExportPDF` utilise maintenant `exportPDFHelper` (plus d'iframe hack).
- `app/journal.tsx` — `buildJournalHTML` réécrit avec helpers pdfBase + `escapeHtml` ; `handleExportPDF` utilise `exportPDFHelper`.
- `app/analytics.tsx` — `buildAnalyticsPDF` réécrit avec helpers pdfBase + couleur de marque `#003082` corrigée + `escapeHtml` ; `handleExportPDF` utilise `exportPDFHelper` + `Alert` si pas de permission ; `weekStats` utilise `getISOWeekKey` depuis utils.
- `app/(tabs)/reserves.tsx` — `generateReportPDF` : `window.open` remplacé par `exportPDFHelper` ; `escapeHtml` appliqué à noms entreprises, titres, bâtiments ; imports Print/Sharing inutilisés supprimés.
- `app/opr.tsx` — `escapeHtml` appliqué dans les trois builders PDF (PV de réception, levée de réserves, lettre de convocation) ; signatures, noms de lots, entreprises, notes.
- `app/visite/[id].tsx` — `escapeHtml` appliqué aux réserves, participants et signature.
- `app/reserve/[id].tsx` — Catch de l'export PDF amélioré (log + message d'erreur détaillé).

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

## Configuration critique du client Supabase (lib/supabase.ts)

Deux ajustements indispensables pour éviter les blocages "spinner infini" sur React Native après un retour d'arrière-plan :

1. **`auth.lock` personnalisé (`safeLock`)** — Le verrou par défaut de supabase-js v2 (`processLock`) peut rester tenu par une promesse fantôme si l'app est gelée pendant un refresh de token. Notre implémentation applique un délai d'acquisition strict (`acquireTimeout`) et libère de force si dépassé, évitant les deadlocks définitifs.

2. **`AppState` → `auth.startAutoRefresh()` / `stopAutoRefresh()`** — Recommandation officielle Supabase pour RN. Suspend le timer d'auto-refresh quand l'app est en arrière-plan et le relance au retour. Sans ça, le SDK accumule des refresh en retard et bloque les appels suivants.

⚠️ Ne pas retirer ces deux mécanismes : le bug "Vérification en cours… infinie" et "création de réserve qui ne marche plus après mise en veille" reviendrait immédiatement.

## Protection anti-perte de données au démarrage à froid (avril 2026)

Bug critique corrigé : au cold start (relance d'app, mise à jour APK), il existait une fenêtre où la file de synchronisation hors-ligne n'était pas encore chargée mais les hooks React Query lançaient déjà un fetch Supabase. Si ce fetch revenait vide (RLS, JWT expiré, blip réseau), le `mergeWithCache` écrasait toutes les réserves/photos/tâches en cache local — donnant l'impression d'une suppression totale.

7 corrections appliquées :

1. **`context/NetworkContext.tsx`** — nouveau flag `queueLoaded` exposé via le contexte (false jusqu'à ce que la file soit hydratée depuis AsyncStorage). Chargement de la file différé jusqu'à ce que le `userId` soit connu, avec migration automatique des anciennes clés `..._anon` → `..._<uuid>`. Sync de cold-start déclenché 800 ms après hydratation. `processSyncQueue` invalide ensuite toutes les requêtes RQ.

2. **`lib/offlineCache.ts`** — `mergeWithCache(fresh, cached, pendingIds, options?)` accepte un 4ᵉ argument `{ queueLoaded }`. Quand `queueLoaded === false`, tous les items en cache absents du fetch sont préservés (ne sont pas considérés comme supprimés côté serveur). Helper `localFileExists()` ajouté.

3-5. **Hooks queries** (`useReserves`, `usePhotos`, `useTasks`, `useChantiers`, `useVisites`, `useLots`, `useOprs`, `useDocuments`, `useCompanies`, `useProfiles`) — destructurent `queueLoaded` depuis `useNetwork()`, court-circuitent le fetch tant que `!queueLoaded`, et passent `{ queueLoaded }` au `mergeWithCache`.

6. **`lib/queryPersister.ts`** — wrapper `namespacedStorage` qui isole le cache RQ persisté par utilisateur (`buildtrack_rq_cache_v1_<userId>`). API : `setPersisterUserId(userId)` (appelé depuis `AuthContext` via `useEffect` sur `user?.id`), `clearPersistedRqCache(userId)`, et clé `LAST_USER_KEY` pour l'hydratation au cold start. Empêche tout bleed de cache d'un compte vers un autre.

7. **`lib/storage.ts`** — sentinelle `MISSING_LOCAL_FILE` retournée par `uploadPhoto` quand le fichier source n'existe plus (nettoyage OS, low storage). `uploadLocalPhotosInPayload` saute proprement les entrées `photos[]` concernées et signale l'opération comme à supprimer (`{data:null, allOk:true}`). `processSyncQueue` retire alors l'op de la file au lieu de boucler indéfiniment.

`AppContext` (handler `SIGNED_OUT`) appelle `clearPersistedRqCache(justSignedOutId)` + `clearPersistedRqCache(null)` (legacy) pour purger le cache au logout intentionnel.
