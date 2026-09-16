# Publicación Firebase Spark

Usa solo Auth anónima, Firestore y Hosting. No requiere Blaze.

```bash
npm ci
cp .env.example .env.production
# completar VITE_FIREBASE_*
npm run build
npx firebase login
npx firebase deploy --only firestore:rules,firestore:indexes,hosting --project TU_ID
```

Para GitHub Actions configurá las variables `FIREBASE_PROJECT_ID`, `FIREBASE_WEB_CONFIG`, `DEPLOY_ENABLED=true` y el secret `FIREBASE_TOKEN`.
