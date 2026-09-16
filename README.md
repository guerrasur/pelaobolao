# Pelao Bolao · MVP

Juego web para **2 a 6 celulares**. Sin login: elegís un nombre, creás una sala o entrás con un código de seis caracteres. Primero comprobar el juego real; el diseño es deliberadamente mínimo.

## Stack y estructura

JavaScript ESM, HTML y CSS sin framework de interfaz. Vite solo empaqueta. Firebase Authentication anónima, Firestore, Cloud Functions de 2.ª generación (Node 22) y Cloud Tasks. Hosting sirve el frontend. El repositorio inicial estaba vacío.

| Ruta | Responsabilidad |
| --- | --- |
| `src/` | Interfaz móvil, arrastre/tap, identidad y suscripciones |
| `functions/src/game.js` | Reglas versionadas y resolución simultánea pura, solo servidor |
| `functions/src/service.js` | Validación y transacciones autoritativas |
| `functions/src/index.js` | Callables autenticadas y programación durable de turnos |
| `firestore.rules` | Lecturas según UID/membresía; escrituras directas denegadas |
| `tests/` | Reglas de juego, Firestore real emulado y dos navegadores independientes |
| `.github/workflows/` | Pruebas y despliegue automático de `main` |

## Identidad y datos

Firebase conserva la sesión anónima en el mismo navegador. El UID identifica al jugador; el nombre se guarda en `profiles/{uid}` con `schemaVersion: 1`. Recargar restaura el perfil y la sala. Borrar los datos del navegador, usar incógnito u otro navegador crea otra identidad. Más adelante, `linkWithCredential` permite vincular una cuenta real al UID anónimo sin mover su progreso. La fusión con una cuenta previamente existente requerirá una política aparte.

| Firestore | Contenido y acceso |
| --- | --- |
| `profiles/{uid}` | Nombre, versión y fechas. Solo su dueño puede leerlo |
| `progress/{uid}` | Espacio reservado para progreso futuro; el MVP no lo escribe |
| `sessions/{uid}` | Sala actual; separado del perfil |
| `roomCodes/{code}` | Índice privado para entrar mediante función |
| `rooms/{roomId}` | Host, miembros, presencia aproximada y partida actual |
| `games/{gameId}` | Estado público, jugadores, recursos, turno, plazo y copia de reglas |
| `games/{gameId}/intents/{uid}` | Última intención privada, turno, revisión y requestId; solo su dueño la lee |
| `games/{gameId}/rounds/{turn}` | Resultado inmutable visible para los miembros |
| `jobs/{gameId-turn-phase}` | Tareas internas, sin acceso de clientes |

El cliente no escribe directamente documentos: envía comandos autenticados. Las funciones validan estructura exacta, UID, pertenencia, rol, turno, objetivos y recursos. Admin SDK usa la identidad del servidor en Google; jamás se incluye en el frontend. La configuración Web App es pública y no concede privilegios de servidor.

Para evolucionar: agregar migraciones explícitas de `schemaVersion` sin recrear perfiles; mantener progreso aparte; cambiar `RULES.version` y reglas solo para partidas nuevas. Cada partida conserva una copia de sus reglas.

## Turnos y autoridad

Cada turno dura **8 segundos completos**; se puede cambiar la elección hasta el plazo del servidor. Este MVP no adelanta el cierre cuando todos eligieron. El cliente no predice daño ni consume Soplos. Las revisiones evitan que un envío viejo sobrescriba otro; `requestId` permite repetir el último envío sin aplicarlo otra vez. No se encolan decisiones offline para turnos posteriores.

Una Cloud Function lee la partida y todas las intenciones en una **transacción de Firestore**. Calcula desde el estado anterior, publica las acciones simultáneamente, crea un resultado único y cambia la fase en el mismo commit. Las entregas repetidas de tareas y llamadas concurrentes encuentran el turno ya resuelto y no vuelven a dañarlo. La lectura transaccional de intenciones también serializa envíos que compiten con el cierre.

La transición crea un documento `jobs` en esa misma transacción. Su trigger, con reintentos, encola Cloud Tasks al vencer el plazo: un fallo entre guardar el resultado y programar el siguiente turno no pierde el trabajo. Después de revelar hay 2,5 segundos de resumen. El siguiente turno recibe 8 segundos nuevos desde su inicio real. Cloud Tasks puede retrasarse y Functions puede tener arranque en frío; el plazo para aceptar acciones no se prolonga. Un cliente conectado también puede despertar al servidor como recuperación, usando la misma transacción; nunca decide el resultado. En emuladores se sustituye únicamente el transporte de tareas por un temporizador de servidor.

Soplar gasta 1 aunque sea bloqueado; múltiples ataques suman daño; los ataques de alguien eliminado **en ese mismo turno** igual se ejecutan. Si todos llegan a cero, hay empate. Los Pelados miran pero no actúan. Sin elección: Distraído, sin efectos adicionales.

Presencia: heartbeat cada 10 segundos; la interfaz marca reconexión tras 25 segundos. Un miembro activo revisa el lobby y transfiere el host tras 45 segundos sin heartbeat. Salir explícitamente transfiere el host de inmediato. Durante una partida no se elimina a nadie por un corte: conserva sus recursos y pierde únicamente las acciones no enviadas. Si todos faltan durante 2 minutos, se abandona la partida. Las salas activas se recuperan por sesión o código.

## Publicar desde el celular

**No necesitás terminal local ni Git manual.** El código está preparado; el primer deploy requiere configurar Firebase y las credenciales de GitHub una vez. Cloud Functions/Cloud Tasks requieren **Blaze con facturación habilitada**; puede haber cargos. No se habilita facturación automáticamente.

1. Seguí [la guía de configuración inicial](docs/DEPLOY.md) desde las consolas web de Firebase, Google Cloud y GitHub.
2. En GitHub, **Actions → Verificar y publicar MVP → Run workflow → main**. Ejecuta pruebas antes de publicar backend, reglas y frontend.
3. Abrí la URL de Hosting que muestra Firebase. Después, cada commit en `main` ejecuta el mismo flujo. Si falla una prueba, no publica.

Las pruebas funcionan con un proyecto `demo-pelaobolao` aislado y no necesitan secretos. `DEPLOY_ENABLED` debe estar en `true` para publicar. No hay claves privadas ni configuración inventada en el repositorio.

Para desarrollo opcional en Codespaces: `npm ci`, `npm ci --prefix functions`, `npm run emulators`; en otra terminal **de la nube**, `VITE_USE_EMULATORS=true npm run dev`. Usar el puerto 5173. Para pruebas completas, Java 21 y `npx playwright install --with-deps chromium`. GitHub Actions ya lo instala todo.

## Comprobación en dos celulares

1. A crea sala; B entra por código. A figura como host y puede iniciar con exactamente dos personas.
2. Ambos toman aire. En el siguiente turno A arrastra Soplar hacia B y B se esconde: A gasta 1, B conserva Pelo.
3. Probá tocar Soplar y después el objetivo. Cambiá de acción antes del cero; la última confirmada es la que cuenta.
4. Ambos con Soplos se atacan: ambos pierden Pelo. Con un Pelo cada uno, el resultado es empate.
5. Recargá y cortá brevemente la conexión. Recuperá nombre, sala y estado; una acción que llega tarde no entra al turno siguiente.
6. Llevá a alguien a cero: aparece Pelado, se muestra ganador y el host vuelve al lobby para revancha.
7. En el lobby, cerrá la pestaña del host: el otro dispositivo hereda el rol tras aproximadamente 45 segundos.

## Límites deliberados

No hay cartas, colección, economía, ranking, arte final, login real ni progreso avanzado. No hay presencia instantánea: el sistema usa leases. Sin límite de turnos mientras quede alguien conectado. Retención/limpieza automática de documentos, App Check, límites antiabuso por usuario, observabilidad y migraciones de futuras versiones quedan para antes de abrirlo masivamente. `expiresAt` prepara limpieza por TTL en salas, índices, partidas, resultados y tareas; TTL debe habilitarse explícitamente y no borra subcolecciones en cascada.

Referencias: [Functions y Blaze](https://firebase.google.com/docs/functions/get-started), [Cloud Tasks y permisos](https://firebase.google.com/docs/functions/task-functions), [vincular usuarios anónimos](https://firebase.google.com/docs/auth/web/anonymous-auth).
