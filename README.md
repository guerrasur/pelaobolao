# Pelao Bolao · MVP Spark

Juego web para 2 a 6 celulares con Authentication anónima, Firestore y Hosting. Funciona en Spark: no contiene Functions, Tasks, Compute Engine ni cuentas de servicio.

El host es la autoridad temporal. Cada jugador escribe su intención privada; después de la cuenta regresiva inicial, cada turno dura 8 segundos y el host resuelve simultáneamente Soplos, defensas, daño, eliminación y empate en una transacción. `resolvedTurn` y `games/{gameId}/rounds/{turn}` evitan daño duplicado. La posición visual se fija al comenzar la partida y el jugador local permanece abajo.

Se conservan las reglas e interacción existentes: 2–6 jugadores, Pelo 3/4, Soplos 0/2, aire, esconderse, Soplar con drag/tap, decisiones cambiables y resultados simultáneos. El lobby usa estados Listo/No listo, códigos de sala de 4 caracteres y enlaces compartibles (`schemaVersion` de rooms y games: 3). Al abrir la web se vuelve a confirmar el nombre, precargado con el último usado; la identidad anónima y la sala se conservan en el navegador.

La versión visible se toma de `package.json`. `public/version.json` permite detectar despliegues nuevos: una versión desactualizada bloquea el juego y ofrece una actualización limpia, sin perder la sesión guardada. Ambos números deben incrementarse juntos.

Publicación: habilitá Auth anónima, Firestore y una Web App; configurá las variables públicas `VITE_FIREBASE_*`; ejecutá `npm ci`, `npm run build` y `npx firebase deploy --only firestore:rules,firestore:indexes,hosting --project TU_ID`. El workflow de GitHub despliega Hosting, reglas e índices usando el secret `FIREBASE_SERVICE_ACCOUNT_PELAOBOLAO`; no usa Functions, Tasks ni servicios pagos.

Para probar: abrí el dominio en dos celulares, creá sala, compartí el código, uní el segundo e iniciá.
