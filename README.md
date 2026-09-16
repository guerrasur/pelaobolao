# Pelao Bolao · MVP Spark

Juego web para 2 a 6 celulares con Authentication anónima, Firestore y Hosting. Funciona en Spark: no contiene Functions, Tasks, Compute Engine ni cuentas de servicio.

El host es la autoridad temporal. Cada jugador escribe su intención privada; al terminar los 8 segundos, el host resuelve simultáneamente Soplos, defensas, daño, eliminación y empate en una transacción. `resolvedTurn` y `games/{gameId}/rounds/{turn}` evitan daño duplicado. La autoridad pasa a otro miembro cuando el host abandona o deja de enviar presencia. Si todos se desconectan, el turno espera hasta que vuelva un jugador. Esta versión prioriza simplicidad sobre antifraude.

Se conservan las reglas e interacción existentes: 2–6 jugadores, Pelo 3/4, Soplos 0/2, aire, esconderse, Soplar con drag/tap, decisiones cambiables y resultados simultáneos.

Publicación: habilitá Auth anónima, Firestore y una Web App; completá `.env.production` con la configuración pública; ejecutá `npm ci`, `npm run build` y `npx firebase deploy --only firestore:rules,firestore:indexes,hosting --project TU_ID`. El workflow de GitHub es opcional y usa `FIREBASE_TOKEN` revocable, junto a `FIREBASE_PROJECT_ID`, `FIREBASE_WEB_CONFIG` y `DEPLOY_ENABLED=true`; no habilita APIs de Cloud.

Para probar: abrí el dominio en dos celulares, creá sala, compartí el código, uní el segundo e iniciá.
