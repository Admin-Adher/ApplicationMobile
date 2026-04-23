# BuildTrack — Vercel App

Mini-app Next.js déployée sur Vercel pour :
- **API email** : `/api/send-email` (utilise Resend)
- **Deep links** : `/invite?token=xxx` (ouvre l'app ou redirige vers le store)
- **Universal Links iOS** : `/.well-known/apple-app-site-association`
- **App Links Android** : `/.well-known/assetlinks.json`

## Déploiement sur Vercel

### 1. Variables d'environnement à configurer dans Vercel

| Variable | Description |
|---|---|
| `RESEND_API_KEY` | Clé API Resend (re_...) |
| `IOS_TEAM_ID` | Ton Apple Team ID (10 caractères, ex: ABC123DEF4) |
| `NEXT_PUBLIC_SUPABASE_URL` | URL Supabase : `https://jzeojdpgglbxjdasjgta.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Clé anon Supabase (même que `EXPO_PUBLIC_SUPABASE_KEY`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Clé `service_role` Supabase (utilisée par le cron + la page publique `/reserve/[id]`) |
| `RESERVE_TOKEN_SECRET` | Secret aléatoire ≥ 32 caractères (signe les liens `?t=…` envoyés par email pour la page publique de consultation des réserves). À générer une seule fois : `openssl rand -hex 32` |
| `CRON_SECRET` | Secret optionnel pour authentifier l'appel cron `/api/cron/overdue-reserves` |

### 2. Déployer

```bash
# Dans le dossier vercel-app/
npm install
vercel deploy
```

Ou connecte ton repo GitHub à Vercel et définis `vercel-app` comme **Root Directory** dans les paramètres du projet.

### 3. Android App Links

Édite `public/.well-known/assetlinks.json` et remplace `VOTRE_SHA256_FINGERPRINT_ICI` par le SHA-256 de ton keystore Android :

```bash
keytool -list -v -keystore your-key.jks -alias your-alias
```

### 4. iOS Universal Links

Récupère ton **Apple Team ID** dans developer.apple.com → Account → Membership.  
Configure-le comme variable d'environnement `IOS_TEAM_ID` dans Vercel.

## Architecture

```
vercel-app/
├── app/
│   ├── api/
│   │   └── send-email/route.ts   ← API Resend
│   ├── invite/page.tsx            ← Page deep link invitation
│   ├── .well-known/
│   │   └── apple-app-site-association/route.ts  ← Universal Links iOS
│   └── layout.tsx
├── public/
│   └── .well-known/
│       └── assetlinks.json       ← App Links Android
└── lib/
    └── templates.ts              ← Templates HTML des emails
```
