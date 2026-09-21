# Pelao Bolao · MVP Spark

Última corrección (0.16.0): Plan Cóndor reduce la contención de Firestore espaciando heartbeats pasivos, mantiene el heartbeat rápido sólo para el host activo, corrige el cooldown del +1 Pelo cuando permaneció varios turnos y muestra la jugada local sellada antes del reveal.

Juego web para 2 a 6 celulares con Authentication anónima, Firestore y Hosting. Funciona en Spark: no contiene Functions, Tasks, Compute Engine ni cuentas de servicio.

El host es la autoridad temporal. Cada jugador escribe su intención privada. Cada turno dura como máximo 8 segundos: termina antes cuando todos los jugadores activos eligieron. Las decisiones se congelan antes de leerlas y el host resuelve simultáneamente Soplos, defensas, daño, eliminación y empate en una transacción. `resolvedTurn` y `games/{gameId}/rounds/{turn}` evitan daño duplicado. La posición visual se fija al comenzar la partida y el jugador local permanece abajo.

Desde 0.4.0, los temporizadores se calculan desde un timestamp escrito por Firestore. El reloj local usa tiempo monotónico, se calibra al entrar, al volver a la pestaña, al reconectar y cada minuto. Antes de comenzar cada ronda se espera que los celulares activos confirmen haberla recibido (hasta 15 segundos extra para no bloquear a todos por un dispositivo desconectado). Una desconexión o suspensión durante un turno ya iniciado no pausa al resto. Los eliminados no bloquean el cierre anticipado.

Estética escolar mobile-first: tablero sin scroll, pupitres y retratos vectoriales, fases muy diferenciadas, sonidos/hápticos, targeting visual desde tu personaje, celebración final, espectadores en cola para la próxima partida y objetos centrales. El primer objeto es `+1 Pelo`: aparece de forma determinista/semi-random, puede adelantarse por disparidad de HP y se disputa gastando 1 Soplo.

Las partidas nuevas snapshottean sus reglas y usan `protocolVersion: 2`; una actualización no modifica partidas ya iniciadas. `public/version.json` bloquea clientes viejos hasta que recarguen la versión publicada.

Se conservan las reglas e interacción existentes: 2–6 jugadores, Pelo 3/4, Soplos 0/2, aire, esconderse, Soplar con drag/tap, decisiones cambiables y resultados simultáneos. El lobby usa estados Listo/No listo, códigos de sala de 4 caracteres y enlaces compartibles (`schemaVersion` de rooms y games: 3). Al abrir la web se vuelve a confirmar el nombre, precargado con el último usado; la identidad anónima se conserva en el navegador. La sala solo se conserva mientras siga abierta la misma página; una recarga requiere volver a entrar con el código.

La versión visible se toma de `package.json`. `public/version.json` permite detectar despliegues nuevos: una versión desactualizada bloquea el juego y ofrece una actualización limpia, sin perder la identidad guardada; el reingreso a la sala requiere su código. Ambos números deben incrementarse juntos.

Publicación: habilitá Auth anónima, Firestore y una Web App; configurá las variables públicas `VITE_FIREBASE_*`; ejecutá `npm ci`, `npm run build` y `npx firebase deploy --only firestore:rules,firestore:indexes,hosting --project TU_ID`. El workflow de GitHub despliega Hosting, reglas e índices usando el secret `FIREBASE_SERVICE_ACCOUNT_PELAOBOLAO`; no usa Functions, Tasks ni servicios pagos.

Para probar: abrí el dominio en dos celulares, creá sala, compartí el código, uní el segundo e iniciá.


## Pruebas de recuperación (0.3.1)

`npm test` ejecuta las pruebas unitarias. `npm run test:integration` valida el cliente y las reglas contra Firestore local. Para ejecutar las pruebas de navegador: instalar Java 21 o superior y Chromium con `npx playwright install chromium`, y después ejecutar `npm run test:e2e`. Este último comando inicia Auth y Firestore emulados, y Playwright inicia Vite en el puerto 5173.

Los casos nuevos cubren la reconfirmación del nombre con un turno vencido, actualización durante un arrastre, conservación de la identidad al recargar, nombres con caracteres HTML y recuperación ante una partida desaparecida. Ver `docs/STATUS.md` para los resultados realmente ejecutados en esta entrega.
