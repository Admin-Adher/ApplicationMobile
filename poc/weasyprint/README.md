# WeasyPrint PDF POC

POC isole pour comparer WeasyPrint avec le moteur PDF actuel de BuildTrack.

Objectif :

- garder Puppeteer comme moteur de production ;
- rendre le meme type de rapport chantier avec WeasyPrint ;
- comparer pagination, tableaux, photos, entetes/pieds et poids du PDF ;
- ne rien brancher dans `vercel-app/app/api/generate-pdf/route.ts` tant que le rendu n'est pas valide.

## Lancer le service

Depuis ce dossier :

```powershell
docker compose up --build
```

Le service ecoute sur `http://127.0.0.1:8010`.

Verifier :

```powershell
Invoke-RestMethod http://127.0.0.1:8010/health
```

Pour activer le test depuis le web admin BuildTrack, configurer la route Next avec :

```powershell
$env:WEASYPRINT_POC_URL = "http://127.0.0.1:8010/render"
```

Dans l'interface web, le test apparait pour les admins dans `Parametres > Integrations BTP > Lab PDF WeasyPrint`.

## Generer le rapport de test

Dans un autre terminal, depuis ce dossier :

```powershell
node render-sample.mjs
```

Sortie attendue :

```text
poc/weasyprint/out/weasyprint-complex-reserves.pdf
```

## Generer un HTML avec le moteur BuildTrack existant

Le script suivant appelle `buildGlobalReservesHtml` depuis `vercel-app/lib/reportBuilder.ts`, avec un jeu de donnees de reserves complexe :

```powershell
node build-buildtrack-sample.mjs
node render-sample.mjs out/buildtrack-global-reserves.html out/buildtrack-global-reserves-weasyprint.pdf
```

Pour tester un HTML BuildTrack exporte :

```powershell
node render-sample.mjs samples/from-buildtrack.html out/from-buildtrack-weasyprint.pdf
```

## Images distantes

Par defaut le POC bloque les fetchs HTTP(S) depuis le HTML pour eviter les fuites de fichiers ou SSRF pendant les essais.

Pour comparer un vrai rapport avec photos Supabase publiques, lancer le service avec :

```powershell
$env:WEASYPRINT_ALLOW_REMOTE = "1"
docker compose up --build
```

Preferer quand meme les images deja inlines en `data:` pour une comparaison reproductible.

## Criteres de decision

Conserver Puppeteer si :

- la mise en page WeasyPrint demande trop de CSS specifique ;
- les photos ou plans rendent moins bien ;
- le service Docker ajoute trop de complexite pour peu de gain.

Envisager WeasyPrint si :

- les sauts de page sont plus propres ;
- les entetes/pieds de page sont plus stables ;
- les tableaux longs sont plus lisibles ;
- le rendu final est nettement plus professionnel pour les rapports chantier.
