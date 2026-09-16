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

Para GitHub Actions configurá las variables públicas `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_MESSAGING_SENDER_ID` y el secret `FIREBASE_SERVICE_ACCOUNT_PELAOBOLAO`.
