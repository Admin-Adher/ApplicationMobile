# BuildTrack

**BuildTrack** est une application SaaS React Native / Expo SDK 54 de gestion de chantier.

## Architecture

- **Frontend mobile** : Expo (React Native) avec Expo Router pour la navigation
- **Backend** : Supabase (Auth, PostgreSQL avec RLS, Realtime et registre média)
- **Web target** : Metro bundler, tourne comme SPA sur le port 5000
- **API canonique** : Next.js/Vercel (`https://buildtrack-mobile.vercel.app`)
- **Emails transactionnels** : Resend ou SMTP, exclusivement depuis l’API canonique
- **Deep links, landing page et expérience web** : Next.js/Vercel

## Démarrer l'application

```
npm run start
```
Lance : `node node_modules/expo/bin/cli start --web --localhost --port 5000`

Le workflow "Start Frontend" est configuré sur le port 5000.

## Mises à jour OTA (expo-updates — mai 2026)

Le système de mise à jour est en deux couches :

**Couche 1 — OTA JS bundle (expo-updates)** : correctifs JS-only poussés sans nouveau APK.
- `hooks/useOtaUpdate.ts` — vérifie `expo-updates` au démarrage et à chaque retour en premier plan.
- `components/OtaUpdateBanner.tsx` — bannière violette « Mise à jour prête » avec bouton « Redémarrer ».
- `app.json` : `updates.url = https://u.expo.dev/e3c73711-...`, `runtimeVersion.policy = appVersion`.
- CI : job `publish-ota` dans `.github/workflows/build-apk.yml` — `eas update --branch production`.
- **Prérequis** : ajouter `EXPO_TOKEN` dans les secrets GitHub du dépôt (Settings → Secrets → Actions).
  Générer le token : https://expo.dev/accounts/[compte]/settings/access-tokens

**Couche 2 — APK complet (GitHub Releases)** : nouvelles dépendances natives, changements de config.
- `hooks/useAppUpdate.ts` + `components/UpdateBanner.tsx` — bannière orange, téléchargement direct APK.

**Règle d'utilisation** :
- Corrections de bugs JS → `git push main` → OTA publié automatiquement → app mise à jour sans action utilisateur.
- Nouveau module natif / upgrade Expo → nouveau APK à distribuer via GitHub Releases.

## Replit

- **Frontend uniquement** : Replit exécute Expo Metro sur le port 5000. Aucun serveur Express local ne porte de logique privilégiée.
- **CORS** : `scripts/patch-expo-cors.js` patche automatiquement Expo pour autoriser les domaines `.replit.dev` et `.repl.co` (exécuté via `postinstall`).
- **API distante** : `EXPO_PUBLIC_API_URL` pointe toujours vers l’API Next.js canonique. Cette règle vaut aussi pour Expo web afin d’éviter le retour accidentel vers des routes locales incomplètes.
- **Backend** : Supabase reste l’autorité d’identité et de données ; Replit ne contient ni service role, ni SMTP privilégié, ni implémentation serveur parallèle.
- **CI Android (GitHub Actions)** : `.github/workflows/build-apk.yml` — ajout de `yes | sdkmanager --licenses || true` après le setup Android SDK pour accepter toutes les licences (y compris TV/XR) sans interaction. Les packages SDK sont ciblés sur `platform-tools build-tools;34.0.0 platforms;android-34` pour éviter les licences exotiques.

## Variables d'environnement

Configurées dans Replit (shared) :
- `EXPO_PUBLIC_SUPABASE_URL` — URL du projet Supabase
- `EXPO_PUBLIC_SUPABASE_KEY` — Clé anon Supabase (public, intentionnellement côté client)
- `EXPO_PUBLIC_APP_URL` — URL de l'app Replit (dev domain, ex: `https://xxx.replit.dev`)
- `EXPO_PUBLIC_API_URL` — URL HTTPS de l’API Next.js canonique

Les secrets `SUPABASE_SERVICE_ROLE_KEY`, SMTP/Resend, R2 et `CRON_SECRET`
restent exclusivement dans l’environnement Vercel ; ils ne doivent pas être
ajoutés à l’environnement du frontend Replit.

## Correctif critique — Écran vide / "Vérification en cours..." après veille prolongée (mai 2026)

**Fichiers modifiés** : `lib/supabase.ts`, `lib/offlineCache.ts`, `lib/queryClient.ts`

**Symptômes** : Après que l'app n'a pas été ouverte depuis un certain temps (veille prolongée), au retour :
- Dashboard et Plans affichent un écran blanc
- Réserves restent sur le squelette "Chargement..."
- Diagnostic des paramètres bloqué sur "Vérification en cours..." à l'infini

**Causes racines identifiées (3)** :

1. **Lock Supabase bloqué à l'infini** (`lib/supabase.ts:84`) — La fonction `safeLock` utilisait `Math.max(50, acquireTimeoutMs)`. Supabase-js interne passe `Infinity` comme `acquireTimeoutMs`. Résultat : `Math.max(50, Infinity) = Infinity` → le setTimeout ne se déclenche jamais. Quand l'app est gelée en veille pendant un refresh, le verrou reste tenu par une promesse fantôme. Tous les appels `getSession()` suivants bloquent à l'infini.

2. **`isSupabaseSessionValid()` sans timeout** (`lib/offlineCache.ts:20`) — Appelée dans TOUS les hooks de query (useReserves, useChantiers, useCompanies, etc.). Sans timeout, si `getSession()` bloque → toutes les queries bloquent → écrans vides à l'infini.

3. **`focusManager` React Query non câblé à `AppState`** (`lib/queryClient.ts`) — Sans ce câblage, `refetchOnWindowFocus: true` n'a aucun effet sur React Native. Aucun refetch automatique n'est déclenché au retour en premier plan.

**Correctifs appliqués** :

- `lib/supabase.ts` : Plafonnement strict du timeout d'acquisition du lock à `LOCK_MAX_MS = 5000ms` (`Math.min(Math.max(50, acquireTimeoutMs), LOCK_MAX_MS)`). Ajout de `resetAuthLock()` exportée + appelée dans le listener `AppState 'active'` AVANT `startAutoRefresh()` pour garantir que le verrou est libéré immédiatement au réveil.

- `lib/offlineCache.ts` : `isSupabaseSessionValid()` utilise désormais `Promise.race([getSession(), timeout(4s)])`. Si `getSession()` dépasse 4 secondes, retourne `false` → les queries utilisent le cache local → l'UI reste responsive.

- `lib/queryClient.ts` : `focusManager.setEventListener()` câblé à `AppState.addEventListener('change', ...)` sur React Native. Au retour en premier plan (`state === 'active'`), React Query déclenche automatiquement un refetch de toutes les queries stale.

## Correctif critique — Perte de données hors connexion (mai 2026)

**Fichier** : `hooks/queries/useReserves.ts` — fonction `addReserve`

**Problème** : Lorsque le réseau était instable (WiFi sans internet, signal faible), le ping de détection de connectivité pouvait renvoyer un faux positif (`isOnline = true`). La fonction `addReserve` tentait alors une synchronisation directe avec Supabase. Si le JWT était expiré (token non rafraîchissable hors connexion), Supabase rejetait l'insertion avec une erreur RLS (`42501`). Le gestionnaire d'erreur RLS appelait alors `rollback()`, supprimant la réserve du cache local — **perte totale de la donnée saisie** — et affichait l'alerte "Session expirée".

**Règle corrigée** : `rollback()` ne doit être appelé que si le serveur confirme explicitement que l'utilisateur n'a pas les droits (mauvais rôle, profil sans organisation). Pour toutes les erreurs de connectivité/session, l'opération est enqueued dans la file hors-ligne pour synchronisation ultérieure, sans jamais supprimer la copie locale.

**Changements** :
- Absence de session (`getSession()` renvoie null) → enqueue, pas de rollback
- Échec de lecture du profil (timeout réseau) → enqueue, pas de rollback
- Retry avec org_id corrigé qui échoue aussi → enqueue avec le nouvel org_id, pas de rollback
- JWT valide mais RLS bloque quand même (claims désynchronisés) → enqueue, pas de rollback
- Erreur non-RLS (violation contrainte, etc.) → enqueue + log, pas de rollback
- Seuls rollbacks conservés : rôle insuffisant (confirmé serveur) et profil sans organisation (confirmé serveur)

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
- `vercel-app/lib/sender.ts` — transport email serveur canonique
- `vercel-app/lib/server-auth.ts` — autorité membership et authentification serveur
- `vercel-app/lib/private-media-server.ts` — autorisation et signature des médias privés
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

L’autorité réside dans `organization_memberships` et `private.platform_admins`.
`profiles` ne contient plus que l’identité et une projection de compatibilité.
Voir `docs/ARCHITECTURE.md` pour les invariants et la matrice d’isolation.

## Rôles utilisateurs

`super_admin` (plateforme), `admin`, `conducteur`, `chef_equipe`, `magasinier`, `observateur`, `sous_traitant`

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
