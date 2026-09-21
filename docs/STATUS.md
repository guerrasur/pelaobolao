# Estado del MVP Spark

## 0.8.0 — Plan Cóndor: presión de ronda y game feel aislado

- Se agregó una capa de presentación independiente (`src/condor.js` + `src/condor.css`) que observa únicamente el DOM ya renderizado; no escribe en Firestore ni participa de la autoridad de la partida.
- Los últimos 3 segundos de elección tienen un tick breve y un pulso visual único por segundo; al llegar a 1 s el tablero refuerza la urgencia sin modificar el deadline.
- Al sellarse las jugadas aparece un sello central corto y un cue de audio propio. El reveal suma una ráfaga de tiza que no intercepta punteros.
- Los botones de acción reciben feedback de pulsación y el modo Soplar atenúa objetivos inválidos para reducir errores de targeting.
- Los cambios de fase visibles tienen una entrada corta y el sello de resultado gana jerarquía, manteniendo geometría estable y fullscreen.
- Todos los efectos respetan `prefers-reduced-motion`; audio y partículas son mejoras opcionales y nunca bloquean una ronda.
- Se añadieron pruebas unitarias para parseo del timer, ticks 3-2-1 y clases de transición. El script `npm test` las incluye.
- Inspiración de esta pasada: la separación entre momento destacado y resumen de Brawl Stars, y el uso de feedback visual/sonoro inmediato en juegos mobile para comunicar estado con poco espacio.
- Sin cambios en reglas de combate, protocolo multijugador, Firestore Rules ni arquitectura Firebase Spark.


## 0.7.0 — spectator mode, countdown y robustez de versión

- Las tarjetas de rivales sólo son interactuables cuando realmente están disponibles como objetivo de Soplar; fuera de targeting quedan visualmente intactas pero dejan de comportarse como botones falsos.
- El gate de actualización sólo bloquea si version.json anuncia una versión realmente más nueva. Una respuesta vieja por caché ya no puede pedir un downgrade ni dejar el juego inutilizable.
- Un jugador Pelado durante una partida activa entra en un modo espectador explícito: “PELADO · MIRANDO” + cantidad de jugadores que siguen con Pelo.
- El inicio de partida usa un overlay de tiza 3 · 2 · 1 · ¡YA! sin consumir altura del tablero.
- El reveal suma un sello corto según lo ocurrido: VOLÓ PELO, DEFENSA PERFECTA, CAOS EN EL AULA o RONDA TRANQUILA.
- Los estados de targeting atenúan rivales no válidos y resaltan únicamente tarjetas realmente seleccionables.
- Se añadieron pruebas para comparación de versiones, versión pública vieja, tarjetas targetables, espectador, countdown y sellos de ronda.
- Inspiración conceptual: Stumble Guys mantiene a eliminados como espectadores; Brawl Stars refuerza highlights de fin de batalla; Fall Guys ha corregido soft-locks y UI superpuesta alrededor de desconexiones/celebraciones.
- Sin cambios en reglas de combate ni arquitectura Firebase Spark.

## 0.6.9 — celebraciones de victoria y derrota

- El final de partida ahora es personalizado para cada jugador.
- Ganador: “¡GANASTE!”, cartel escolar dorado, confeti animado, énfasis sobre su tarjeta y cue de audio/háptica propio.
- Perdedor: “PERDISTE”, tomatazos animados que quedan estampados, cue de derrota y una placa separada con el nombre del ganador.
- Empate conserva un final neutro sin presentar falsamente un ganador o perdedor.
- La celebración es una capa visual con pointer-events desactivados: no bloquea revancha ni salida.
- Se corrigió una incompatibilidad potencial de la trayectoria CSS de los tomates para navegadores móviles.
- E2E valida el final desde ambos celulares, cuenta partículas/tomates y captura screenshots de victoria y derrota.
- La matriz de layout incluye los overlays finales para detectar overflow en mobile y landscape.
- Inspiración conceptual: Fall Guys usa celebraciones dedicadas y ha corregido específicamente interacciones que bloqueaban su pantalla de celebración; Brawl Stars separa y enriquece su pantalla de fin de batalla.
- Sin cambios en reglas de combate ni arquitectura Firebase Spark.

## 0.6.8 — HUD de combate y prompts de acción

- Las tarjetas muestran barras compactas de Pelo y Soplos sin sumar altura al tablero.
- Un check visual indica quién ya eligió durante la ronda sin revelar qué acción eligió.
- Los prompts pasan a formato corto de acción: “¡ELEGÍ!”, “¡APUNTÁ!” y “¡TOMÁ AIRE!”.
- El resumen de ronda usa chips visuales propios para Ataque, Aire, Abajo, Distraído, Bloqueos y pérdida de Pelo; se eliminaron emojis decorativos.
- El resumen compacto ahora cuenta también a quienes quedaron Distraídos.
- El ganador recibe una animación liviana sobre el avatar sin assets externos y respetando reduced-motion.
- La matriz E2E renderiza también estados de jugador que ya eligió para detectar overflow en 2–6 jugadores.
- Referencias de diseño consultadas: Brawl Stars (lectura rápida de estado/vida), Clash Royale (foco en arena y feedback inmediato), Among Us (estado global claro/version locking) y WarioWare (prompts breves e imperativos).
- Sin cambios en reglas de combate ni arquitectura Firebase Spark.

## 0.6.7 — logo limpio y navegación más segura

- El logo sigue centrado, sobre papel rayado y pegado con cinta, pero se eliminó por completo el texto "MENOS PELO · MÁS PROBLEMAS".
- Tocar el logo durante una sala o partida ya no navega accidentalmente a la raíz; indica que hay que salir de la sala para volver al inicio.
- Guardar una jugada ya no crea un aviso global redundante que podía reducir momentáneamente el espacio disponible del tablero; el estado Elegido sigue visible en los controles.
- Se añadieron regresiones E2E para impedir que vuelva el eslogan y para asegurar que tocar el logo no abandone la vista de partida.
- Sin cambios en reglas de combate ni arquitectura Firebase Spark.

## 0.6.6 — logo con cinta y pulido de lobby/conexión

- Vuelve el logo de las primeras versiones: papel rayado centrado, inclinado y sujeto con una cinta translúcida.
- En horizontal el mismo logo se compacta para preservar el tablero fullscreen.
- El lobby usa el mismo badge VOS que las tarjetas de partida, sin repetir "(vos)" dentro del nombre.
- Conectado, comprobando conexión y sin conexión tienen indicadores visuales distintos.
- Compartir una sala captura código y enlace antes de abrir la hoja nativa, evitando errores si la sala cambia o se abandona mientras el diálogo está abierto.
- Se añadieron regresiones E2E para centrado del logo en todos los viewports y para compartir/salir simultáneamente.
- Sin cambios en reglas de combate ni arquitectura Firebase Spark.

## 0.6.5 — revancha segura y targeting más claro

- Volver al lobby después de una partida reinicia el estado Listo de todos; ninguna revancha puede arrancar sin una nueva confirmación.
- El modo Soplar muestra instrucciones contextuales según haya Soplos disponibles o esté activo el targeting.
- En targeting, sólo los rivales válidos reciben énfasis visual; el propio asiento se mantiene claramente diferenciado.
- El asiento local usa un badge compacto VOS en vez de repetir "(vos)" dentro del nombre.
- El resumen del turno se organiza en filas con color por acción y señal específica cuando hubo pérdida de Pelo.
- Elegir una acción produce feedback háptico breve en móviles compatibles.
- Se añadieron pruebas de integración, UI y E2E para revancha, targeting y asiento propio.
- Sin cambios en las reglas de combate ni en la arquitectura Firebase Spark.

## 0.6.4 — arranque limpio y feedback expresivo

- Un jugador que quedó marcado Listo pero perdió su lease ya no entra a una partida nueva.
- El host no puede iniciar mientras haya participantes visibles desconectados; la transacción vuelve a validar y elimina asientos vencidos antes de crear el game.
- Los avatares cambian expresión al Soplar, Tomar aire, Esconderse, recibir daño y quedar Pelados.
- En móviles compatibles, recibir daño o bloquear un ataque produce vibración breve; la vibración es opcional y nunca bloquea el turno.
- Ganador, Pelo crítico, Soplo bloqueado y transiciones de fase tienen feedback visual más fuerte.
- Se añadió cobertura de integración para el caso Listo + desconectado y cobertura de render para ganador/expresiones.
- Sin cambios en las reglas de combate ni en la arquitectura Firebase Spark.

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
