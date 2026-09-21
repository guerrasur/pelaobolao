# Estado del MVP Spark

## 0.6.3 — presencia, claridad de combate y robustez visual

- El lobby muestra progreso de Listos, conectividad por jugador y cuántos participantes siguen pendientes antes de iniciar.
- La mesa muestra presencia, estado crítico con 1 Pelo y eliminación con señal visual más fuerte.
- Los bloqueos distinguen mejor al defensor que atajó del atacante cuyo Soplo fue bloqueado.
- El render de asientos tolera índices heredados o incompletos sin producir colores/posiciones inválidos.
- Los resultados describen la pérdida de Pelo como daño recibido, evitando asociarla visualmente con la acción ejecutada.
- Se añadió cobertura unitaria para presencia, progreso del lobby, estados críticos y tarjetas heredadas.
- Mantiene las reglas, protocolo multijugador y arquitectura Firebase Spark de 0.6.2.

## 0.5.2 — salida local y entrada explícita

Base: `main` de GitHub, commit `9b20e68bceebbf7c7b221d69153d8b4313b93d95`.

- Abrir o recargar no se suscribe a la sala guardada. Confirmar nombre lleva al inicio; se puede reingresar con código.
- Cambiar brevemente de pestaña mantiene las suscripciones actuales.
- Salir y volver al inicio desconectan la interfaz inmediatamente; la limpieza remota es independiente.
- El botón de salir sigue disponible sin conexión y durante operaciones pendientes.
- Crear sala no reutiliza una sala vieja; una salida atrasada no borra una sesión nueva.
- Las respuestas y errores de operaciones anteriores no reabren salas ni alteran el bloqueo de nuevas operaciones.
- Acceso denegado a la partida y vencimiento por inactividad vuelven al inicio aun cuando falle la limpieza remota.

Validación: 27 pruebas de lógica/controlador y build de producción aprobados. Se actualizaron las expectativas de reingreso de las pruebas E2E y se añadió cobertura de integración para creación nueva y salida atrasada. Integración/Firestore bloqueada: el entorno tiene Java 17 y firebase-tools exige Java 21 o superior. E2E no ejecutado; no se afirma validación en dispositivos reales. No se modificaron reglas Firestore.

## 0.5.1 — sincronización de transiciones y compatibilidad

- Las transiciones de fase actualizan una marca de progreso junto con el reloj del servidor.
- Las reglas aceptan partidas heredadas que no tengan mapas opcionales completos, sin abrir permisos para falsificar acciones.
- Las confirmaciones de ronda y los tests de integración cubren teléfonos lentos, jugadores eliminados y salidas explícitas.

## 0.5.0 — partidas temporales, fases visibles y sonidos

- `roomCommand('leave')` abandona la partida completa: la partida pasa a `abandoned`, la sala se cierra y las sesiones vuelven a la pantalla inicial.
- `abandonGame` retira una partida sin actividad durante dos minutos. También retira una partida terminada que quedó guardada por más de dos minutos, sin conservarla como revancha automática.
- La identidad del jugador queda en `profiles` y la sesión sólo se usa para recuperar una sala activa; no se persiste una partida como progreso.
- Las fases tienen una banda visual propia: “ELEGÍ TU JUGADA”, “ACCIONES SELLADAS”, “REVELANDO RESULTADOS” y “PARTIDA TERMINADA”. Los controles sólo aparecen durante `choosing`.
- Sonidos breves generados con Web Audio al iniciar una ronda y al revelar sus resultados. Si el navegador bloquea audio, la partida continúa sin sonido.
- `phaseDeadline` normaliza timestamps heredados y evita mostrar milisegundos como segundos.

Validación ejecutada: 21 pruebas unitarias y build de producción. La sesión de pruebas contra el emulador de Firestore quedó bloqueada por el límite temporal de herramientas del entorno; debe ejecutarse en Codespaces con `npm run test:integration` antes de publicar. La validación visual completa en navegador depende de disponer de Chromium.

## 0.4.1 — corrección del contador gigante

Se reprodujo una ruta de fallo compatible con la captura: una lectura `clockAt` nula se convertía en cero y la calibración colocaba el reloj cerca de enero de 1970. Al restarlo de la fecha de la ronda aparecían aproximadamente 1.789 millones de segundos en lugar de 3. No se dispone de los registros del navegador afectado para confirmar qué originó esa lectura en producción.

- Solo se aceptan timestamps resueltos, confirmados por el servidor, sin caché ni escrituras pendientes.
- Las muestras nulas, ausentes, malformadas o fuera de rango se descartan antes de elegir la de menor latencia.
- La propia calibración rechaza valores inválidos y conserva la última hora válida. Si ninguna muestra sirve al iniciar, se muestra un error recuperable en lugar de abrir el juego con un reloj incorrecto.
- Sin cambios de estética, reglas de juego ni permisos Firestore respecto de 0.4.0.

Validación: prueba de regresión falló con el código anterior (`1789603203` segundos frente a `3`) y pasa con la corrección. 20 pruebas unitarias, 20 de integración/reglas y build aprobados. Se añadió calibración real contra el emulador con una hora de desfase y sincronización concurrente de la misma identidad. Sin nueva validación de navegador ni dispositivos físicos.

Actualización: mismo procedimiento de Codespaces, usando `pelaobolao-v0.4.1.zip` y el mensaje de commit `Corrige calibración del temporizador v0.4.1`. Actualizar todos los dispositivos; para verificar el arreglo se recomienda iniciar una partida nueva.

## 0.4.0 — sincronización, cierre anticipado y primera estética escolar

- Inicio de turnos y resultados anclado a `phaseStartedAt`, timestamp de Firestore, no a la hora estimada del host.
- Reloj monotónico calibrado con tres muestras; se elige la de menor latencia. Se recalibra cada minuto, al reconectar y al volver a la pestaña.
- Se ignoran snapshots locales especulativos y snapshots de caché para avanzar rondas.
- Barrera de recepción al inicio y entre rondas: cada participante confirma únicamente su propio estado. Espera adicional máxima de 15 segundos; una desconexión durante el turno no lo pausa.
- Cierre anticipado al elegir todos los activos. La fase `locked` congela las decisiones antes de permitir que el host las lea. Un host sucesor puede recuperar esa fase si el anterior sale.
- Confirmaciones públicas sin acciones/objetivos; las reglas impiden falsificar señales ajenas y exigen guardar intención y confirmación juntas.
- Primera interpretación de la referencia en CSS y SVG: cuaderno, mesa, retratos, recursos y tres botones inferiores. No es una reproducción ilustrada completa ni incluye el objeto +1 Pelo.

Validación: 17 pruebas unitarias y 18 pruebas de integración/reglas aprobadas; build aprobado. Casos de seis jugadores, concurrencia, privacidad, espera del celular lento, cierre temprano, eliminado y transferencia de host incluidos. Pruebas E2E actualizadas y un caso de dos relojes diferentes añadido, pero **no ejecutados hasta completarse**: Chromium no pudo descargarse en este entorno. Falta revisión visual en navegador y prueba en celulares reales.

Publicar Hosting **y reglas Firestore** juntos, actualizar todos los dispositivos e iniciar una partida nueva. El protocolo previo sigue admitido para partidas antiguas. Firebase Spark, sin servicios de backend nuevos.

### Cargar el ZIP en Codespaces

Primero comprobar `git status`; guardar o resolver cambios pendientes antes de copiar. Subir `pelaobolao-v0.4.0.zip` a la raíz y ejecutar:

```bash
cd /workspaces/pelaobolao
git pull --ff-only origin main
update_dir=$(mktemp -d /tmp/pelaobolao-0.4.0.XXXXXX)
unzip pelaobolao-v0.4.0.zip -d "$update_dir"
cp -a "$update_dir/pelaobolao/." .
mv pelaobolao-v0.4.0.zip "$update_dir/"
npm ci && npm test && npm run build
git diff --stat
```

Solo si las comprobaciones terminan correctamente, revisar los cambios y subir:

```bash
git add README.md docs/STATUS.md firestore.rules index.html package.json package-lock.json public/version.json src tests
git commit -m "Sincroniza rondas, cierre anticipado y estética escolar v0.4.0"
git push origin main
```

Revisar que GitHub Actions termine correctamente antes de probar. Con Java 21+ también se pueden ejecutar `npm run test:integration` y, después de instalar Chromium, `npm run test:e2e`.

## 0.3.1 — recuperación de sesión y actualización

Base: `main` de GitHub, commit `b84694e` (mismo contenido que el ZIP 0.3.0).

- Corregido el error del temporizador al volver a una partida y permanecer en la pantalla del nombre.
- Una actualización obligatoria cancela el arrastre activo y bloquea nuevas acciones, también desde manejadores anteriores.
- Si desaparece la partida o falla su lectura, se limpia el estado anterior y se muestra una salida recuperable.
- Las respuestas tardías de salas anteriores no reemplazan la sala actual. El borrado de sesión comprueba la sala esperada antes de escribir.
- Los nombres de objetivos se muestran como texto, incluyendo caracteres HTML.
- Solo el host de la sala puede leer decisiones ajenas al vencer el turno. Un usuario ajeno no obtiene acceso después del cierre.
- El host evita lanzar varias resoluciones simultáneas desde el temporizador de la misma pestaña.

Validación de esta entrega: 14 pruebas unitarias y 14 pruebas de integración/reglas aprobadas; build de producción aprobado. Las pruebas de navegador están incluidas pero no fueron ejecutadas hasta completarse: la descarga de Chromium agotó el tiempo de espera en el entorno de trabajo. No se afirma validación visual ni en celulares reales.

La prueba integrada se ejecutó con Firebase CLI 14.22.0 por disponer de Java 17 en el entorno. Para los comandos del proyecto (CLI 15), usar Java 21 o superior.

Se mantienen Firebase Spark, Authentication anónima, Firestore y Hosting. Esta entrega no se publica automáticamente desde este entorno: se distribuye como ZIP para Codespaces.


## v0.6.0 reliability pass
- El reloj de turno deriva de `phaseStartedAt` de Firestore.
- Se eliminó la barrera `syncing` entre rondas nuevas; `syncing` queda sólo para compatibilidad con partidas anteriores.
- Auto-cierre cuando todos eligen y transición directa reveal -> choosing.
- Lease del host durante partida reducido a 5 s y heartbeat a 2 s para recuperación más rápida.
- Refuerzo de fullscreen mobile y diferenciación visual entre elección y resultados.
