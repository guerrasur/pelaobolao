# Pelao Bolao · MVP Spark

Juego web para 2 a 6 celulares con Authentication anónima, Firestore y Hosting. Funciona en Spark: no contiene Functions, Tasks, Compute Engine ni cuentas de servicio.

El host es la autoridad temporal. Cada jugador escribe su intención privada; después de la cuenta regresiva inicial, cada turno dura 8 segundos y el host resuelve simultáneamente Soplos, defensas, daño, eliminación y empate en una transacción. `resolvedTurn` y `games/{gameId}/rounds/{turn}` evitan daño duplicado. La posición visual se fija al comenzar la partida y el jugador local permanece abajo.

Se conservan las reglas e interacción existentes: 2–6 jugadores, Pelo 3/4, Soplos 0/2, aire, esconderse, Soplar con drag/tap, decisiones cambiables y resultados simultáneos. El lobby usa estados Listo/No listo y códigos de sala de 4 caracteres (`schemaVersion` de rooms y games: 3).

Publicación: habilitá Auth anónima, Firestore y una Web App; configurá las variables públicas `VITE_FIREBASE_*`; ejecutá `npm ci`, `npm run build` y `npx firebase deploy --only firestore:rules,firestore:indexes,hosting --project TU_ID`. El workflow de GitHub despliega Hosting y reglas/indexes usando el secret `FIREBASE_SERVICE_ACCOUNT_PELAOBOLAO`; no usa Functions, Tasks ni servicios pagos.

Para probar: abrí el dominio en dos celulares, creá sala, compartí el código, uní el segundo e iniciá.
