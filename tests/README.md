# Tests — BuildTrack

## Structure

```
tests/
  unit/         Tests unitaires des fonctions utilitaires
  integration/  Tests d'intégration Supabase (à exécuter hors CI sur un projet de test)
```

## Lancer les tests

```bash
npm test
```

## Couverture cible

| Module | Type | Priorité |
|---|---|---|
| `lib/utils.ts` | Unitaire | Haute |
| `lib/dateUtils.ts` | Unitaire | Haute |
| `lib/adminUtils.ts` | Unitaire | Moyenne |
| `context/AuthContext` | Intégration | Haute |
| `context/AppContext` | Intégration | Haute |

## Comptes de test

Les comptes de démonstration sont définis dans `context/AuthContext.tsx` (DEMO_USERS).
Le mot de passe est injecté via la variable d'environnement `EXPO_PUBLIC_DEMO_SEED_PASS`.
