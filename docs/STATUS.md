# Estado del MVP Spark

## Lote en curso — pulido pre-playtest

- Las jugadas locales pendientes ya no se pierden ante una desconexión breve: se conservan mientras el turno siga vigente y se reintentan al volver la conexión.
- El modo de apuntado se cancela limpiamente si cae la conexión, evitando quedar visualmente en un estado de ataque imposible.
- El stress multijugador ahora mete tráfico de presencia de todos los jugadores, no sólo del host, mientras entran jugadas y se resuelven rondas.
- Se agregan regresiones para: `GUARDANDO…` vs `ELEGIDA`, relevo de host durante `locked`, timeout con jugador distraído, timer sin quedarse en 0, reconexión durante targeting, layout 6 jugadores a 320×568 sin scroll y combinación mechón + ataque + límite de Esconderse.
- Salir durante una partida activa ahora requiere una segunda confirmación breve; el primer toque no puede cerrar accidentalmente la partida de todos.
- Al entrar mediante un enlace de invitación, el parámetro `?s=` se limpia del navegador una vez confirmada la sala, evitando reingresos accidentales después de salir.
- La revancha se prueba desde estado contaminado y debe reiniciar Pelo, Soplos, racha de Esconderse, ítem central, resultado, `chosen` y `ready` desde cero.
- Las colas de intención ahora llevan generación propia: una escritura vieja que termine tarde después de salir/cambiar de ronda no puede bloquear ni consumir la primera jugada de la sala siguiente.
- Este lote permanece en una rama de trabajo y no se publica hasta cerrar el paquete de pulido.

## 0.35.0 — Plan Cóndor: stress multijugador y resolución robusta

- Se agrega una prueba de estrés de integración con 2, 3, 4 y 6 jugadores, cuatro rondas consecutivas por tamaño de sala y elecciones simultáneas.
- La prueba fuerza además heartbeats del host mientras entran las jugadas y carreras de varias resoluciones del mismo turno, verificando que sólo una resolución gane, que exista un único documento de ronda y que el turno siguiente arranque limpio.
- Cada ronda valida que todos los jugadores activos queden realmente marcados como elegidos, que cada intención propia corresponda al turno correcto y que Pelo/Soplos permanezcan dentro de sus límites.
- Las dos transacciones críticas de `advanceGame` pasan a admitir hasta 10 reintentos, reduciendo el riesgo de que una actualización concurrente de presencia haga fallar el cierre o la resolución del turno.
- El cliente host evita iniciar su heartbeat mientras está resolviendo una ronda, eliminando contención autogenerada entre presencia y autoridad de juego.
- Se mantienen intactas las reglas de combate, el ritmo de 8 s, el mechón y la autoridad temporal del host.
- Código, versión pública, lockfile y Service Worker quedan alineados en v0.35.0.

## 0.34.0 — Plan Cóndor: jugadas del host confiables

- Se corrige un bloqueo específico del host al guardar una jugada: `submitIntent` ya no lee el documento de sala dentro de la misma transacción. El heartbeat activo del host actualiza esa sala cada ~1,8 s y podía invalidar/reintentar la transacción repetidamente hasta que vencía el turno.
- La pertenencia vigente a la sala sigue validándose al commit mediante Firestore Rules; se mantiene el write atómico de intención + marca `chosen`.
- La transacción de intención admite hasta 10 reintentos para absorber contención real sobre el documento de partida cuando varios jugadores eligen casi al mismo tiempo.
- La UI deja de mostrar “ELEGIDA” durante el estado optimista local: mientras Firestore todavía está confirmando aparece “GUARDANDO…”. “ELEGIDA” queda reservado para una intención ya aceptada.
- Se agrega una regresión que impide volver a incorporar el documento de sala al read-set de `submitIntent` y verifica versión/caché pública 0.34.0.
- Código, versión pública, lockfile y Service Worker quedan alineados en v0.34.0.

## 0.32.0 — Plan Cóndor: código de sala + regresión de lobby

- Se recupera el resaltado amarillo del código de sala tal como estaba antes, pero el rótulo “SALA” permanece neutro y fuera del bloque resaltado.
- El código vuelve a usar placa amarilla, borde punteado oscuro y sombra corta; no se agregan textos decorativos de tiza.
- El encabezado del lobby se endurece para 320–340 px: código y botón Compartir reducen padding/espaciado sin desplazarse fuera del viewport.
- Se agrega una regresión E2E a 320×568 que comprueba color, borde, separación de “SALA” y ausencia de overflow horizontal.
- Se corrige documentación desactualizada sobre CI/deploy: `main` sí usa el workflow automático de Firebase.
- No se modifican Pelo, Soplos, daño, ítems, sincronización, Firestore Rules ni autoridad del host.
- Código, caché PWA y versión pública quedan alineados en v0.32.0.

## 0.30.0 — Plan Cóndor: menú y lobby sin ruido

- El menú principal elimina slogans, saludos, subtítulos, aclaraciones y microcopy auxiliar sin reemplazarlos por nuevas frases: quedan la identidad visual y las acciones Crear sala / Entrar.
- El lobby elimina “Sala de espera”, el encabezado redundante de jugadores y los párrafos de ayuda. Código, compartir, orden de jugadores, estado Listo/No listo, host y progreso siguen visibles.
- La presencia por jugador pasa de texto repetido a un indicador puntual; la información de bloqueo sigue estando representada por estado visual y botones deshabilitados.
- El lobby usa una superficie flexible sin scroll con filas de altura acotada, conservando el orden fijo de ingreso.
- Al abrir el teclado en mobile, el hero del inicio se repliega en vez de comprimirse junto al formulario; el perfil también reduce decoración durante la escritura.
- El observador de la capa de entrada agrupa mutaciones con `requestAnimationFrame`, reduciendo renders y reflows redundantes.
- Las animaciones de entrada evitan blur y filtros costosos, priorizando opacidad/transform para una respuesta más fluida en celulares.
- Se agrega una regresión estática para la nueva capa `condor30.css`. No se modifican reglas de juego, Firestore Rules ni autoridad del host.
- Código y metadatos quedan en v0.30.0. El deploy a Firebase Hosting no se da por realizado: `main` no contiene actualmente un workflow automático y este entorno no dispone de una conexión Firebase para ejecutar el CLI.
## 0.29.1 — Plan Cóndor: sólo el mechón

- Se elimina el aviso textual separado del +1 Pelo. Durante la elección ya no aparece ningún bloque explicativo, título o CTA asociado al objeto.
- En el tablero queda únicamente el mechón con su halo; el hit-area continúa invisible y estable.
- La explicación de riesgo y la advertencia de última ronda permanecen en el `aria-label` para accesibilidad, sin ocupar espacio visual.
- Se mantienen intactas la aparición aleatoria, la disputa, la vulnerabilidad al agarrar, el parpadeo de tercera ronda y la desaparición posterior.
- Se añaden regresiones para impedir que el banner textual vuelva a renderizarse.

## 0.29.0 — Plan Cóndor: mechón central sin tarjeta

- El ítem +1 Pelo deja de renderizar papel, borde, cinta, badge “NUEVO”, copy “+1 PELO” y CTA “AGARRAR”: dentro del tablero sólo queda visible el mechón.
- El área táctil absoluta permanece estable e invisible para no mover las tarjetas de jugadores ni empeorar la interacción mobile.
- El mechón adopta un halo cálido y un trazo luminoso inspirado en el concepto aprobado; targeting y selección intensifican el halo sin volver a introducir una placa.
- Se elimina también el pseudo-callout “SOLTÁ ACÁ” del centro para evitar ruido visual heredado.
- La tercera ronda del objeto mantiene el parpadeo lento, ahora aplicado al mechón/halo en vez de una tarjeta completa.
- Se agregan regresiones de UI/CSS para impedir que vuelva a aparecer texto o un contenedor visual alrededor del ítem.
- Sin cambios en spawn, disputa, +1 Pelo, vulnerabilidad al agarrar, expiración, Firestore ni autoridad del host.


## 0.28.0 — Plan Cóndor: director de reveal estable

- El número 3–2–1 deja de formar parte del HTML calculado por `render()`; `tick()` actualiza únicamente el nodo del contador. Un heartbeat o snapshot de presencia ya no reemplaza todo el tablero por haber cambiado el segundo visual.
- Esto evita reinicios de animaciones y pequeños saltos de layout durante la fase de suspense, especialmente en celulares con latencia o varios snapshots seguidos.
- La ráfaga de tiza se mueve del inicio de `reveal` al beat `actions`: ahora ocurre cuando las jugadas realmente aparecen, en vez de quedar tapada por el overlay oscuro.
- El callout del resultado recibe un único énfasis al entrar al beat `impact`; no se añaden sonidos duplicados porque audio/hápticos siguen bajo la autoridad de la timeline principal.
- Se elimina el sello central heredado “JUGADAS SELLADAS” de la fase `locked`, que podía aparecer apenas unas décimas y producir un flash redundante antes del 3–2–1.
- Los overlays visuales del reveal pasan a ser decorativos para accesibilidad (`aria-hidden`); el estado legible sigue en el banner y `#turn-status`, evitando anunciar 3–2–1 como alertas repetidas.
- Se agregan regresiones unitarias y E2E: una prueba fuerza un snapshot de presencia en medio del countdown y exige que el nodo del reveal sobreviva sin ser reemplazado; también valida que tiza y callout aparezcan en sus beats correctos.
- Sin cambios en daño, Pelo, Soplos, frecuencia de ítems, límites de Esconderse, Firestore Rules ni autoridad del host.

## 0.27.0 — Plan Cóndor: reveal estable + teclado iOS

- La revelación de partidas nuevas usa reglas v6 y una ventana de 4 s: 1,5 s para el 3–2–1, 1,2 s para leer las jugadas y 1,3 s para las consecuencias.
- Las partidas v5 ya iniciadas siguen entrando completas dentro de sus 3,2 s snapshotteados.
- Se elimina la segunda animación de la misma acción al llegar el daño: la etapa de impacto muestra impacto/curación/bloqueo, no vuelve a ejecutar Soplar, Esconderse o Tomar aire.
- Las flechas de Soplo se construyen una vez por render de la etapa de jugadas en vez de recrearse cada 200 ms; se elimina el parpadeo/reinicio de animación.
- La etapa de jugadas deja de heredar el oscurecimiento general del reveal y usa el sistema de FX existente, sin una segunda capa de animaciones que competía por `transform`.
- El timer de turno sólo aparece durante `choosing`; la revelación usa sus propios beats y no muestra una cuenta secundaria acelerada.
- En pantallas de entrada/perfil, `visualViewport` deja de controlar la altura del `body`. Safari puede reducir su viewport visual por el teclado sin colapsar el menú.
- `condor20.js` marca explícitamente el modo teclado y evita disparar reflows sintéticos durante la animación de apertura/cierre del teclado.
- Se agregan regresiones unitarias y e2e que reproducen un viewport visual de 360 px con el input enfocado y exigen que el menú conserve su altura normal.

## 0.26.0 — Plan Águila: revelación de ronda

- La resolución simultánea ahora se presenta en tres momentos sincronizados por `phaseStartedAt`: una cuenta 3–2–1 breve, la revelación de las jugadas y recién después las consecuencias.
- Durante la etapa de jugadas se muestran las expresiones/acciones de los personajes sin adelantar pérdida o recuperación de Pelo. El Pelo previo se reconstruye localmente hasta el impacto.
- Los ataques dibujan una flecha desde el personaje que Sopla hasta su objetivo; los Soplos bloqueados se diferencian visualmente.
- El mechón permanece visible durante la revelación de acciones y sólo desaparece al mostrar la consecuencia de haber sido agarrado, disputado o vencido.
- La ronda final usa la misma secuencia antes de habilitar `¡GANASTE!` / `PERDISTE`.
- La ventana de revelación sube de 2,5 s a 3,2 s para conservar ritmo sin comprimir las tres etapas.
- Las partidas ya iniciadas con reglas v4 o anteriores mantienen la revelación anterior; el cambio se aplica a partidas nuevas con reglas v5.
- Se agregan pruebas puras para los límites temporales, compatibilidad hacia atrás y reconstrucción visual del estado previo.

## 0.22.0 — Plan Cóndor: render crítico + HUD más liviano

- Se elimina el guard heredado `if (drag) return` al inicio de `render()`. La protección del gesto queda centralizada en `shouldHoldRenderForDrag`: snapshots inocuos conservan pointer capture, pero cambios críticos pueden renderizar y limpiar el estado transitorio.
- El HUD usa escrituras de texto idempotentes: timer, conexión, presencia, countdown, retorno al lobby y estado de resolución sólo tocan el DOM cuando el valor realmente cambia.
- El texto de feedback durante el arrastre también deja de reescribirse en cada `pointermove` si el objetivo no cambió. Esto reduce mutaciones observadas por la capa Cóndor y trabajo de layout/repaint durante el gesto.
- Se agregan regresiones para impedir que vuelva el guard global y para exigir la ruta de actualización idempotente.
- Sin cambios en daño, Pelo, Soplos, frecuencia de ítems, resolución simultánea, Firestore Rules ni autoridad del host.


## 0.21.0 — Plan Cóndor: drag estable + build alineado

- Durante un arrastre activo de Soplar, los heartbeats, presencia y snapshots que sólo piden re-render ya no reemplazan el botón capturado mientras la fase siga en `choosing`; el gesto conserva pointer capture y la guía bajo el dedo.
- El HUD dinámico sigue actualizándose mediante `tick()` durante ese breve hold, por lo que reloj y conexión no se congelan.
- Un cambio crítico de estado (fin de elección, bloqueo de versión, etc.) sí cancela el drag y limpia ghost/vector antes de reemplazar el DOM.
- Al ocultar la pestaña/app o abandonar la página se cancela explícitamente cualquier drag transitorio, evitando overlays o captura residual al volver.
- Se añade una función pura y regresión unitaria para cubrir qué renders pueden mantenerse durante un drag y cuáles deben pasar inmediatamente.
- Se corrige la deriva de metadatos: `package-lock.json` había quedado en 0.19.0 mientras la app ya estaba en 0.20.0; toda la publicación queda alineada en 0.21.0, incluida la clave de caché del Service Worker.
- Sin cambios en daño, Pelo, Soplos, objetos, resolución simultánea, Firestore Rules ni autoridad del host.

## 0.20.0 — Plan Cóndor: targeting estable en viewport móvil

- Se mantuvieron retirados los overlays redundantes de targeting eliminados en 0.19.0.
- La geometría de apuntado se vuelve a calcular ante cambios de `visualViewport`, orientación y regreso a primer plano, cubriendo Safari/Chrome móvil cuando cambia la barra del navegador.
- Sin cambios en reglas de combate o sincronización.

## 0.19.0 — Plan Águila: targeting limpio + instalación como app

- Se elimina el rectángulo amarillo “SOLTÁ ACÁ” durante el arrastre. La tarjeta rival sigue resaltándose y la trayectoria roja continúa marcando con claridad dónde va el Soplo.
- Se elimina la retícula/círculo rojo `◎` que aparecía sobre el rival después de fijar el objetivo. Se conserva el marco rojo de la tarjeta y la guía desde tu personaje al rival.
- El favicon y el ícono de pantalla de inicio parten del ícono aprobado de la pelada con un único pelo sobre fondo azul.
- Se agrega Web App Manifest con `display: standalone`, nombre, colores, scope/start URL, PNG 192px para Home Screen y un ícono SVG escalable para instalaciones de alta resolución.
- Safari/iOS recibe metadatos de Home Screen (`apple-mobile-web-app-capable`, título e ícono) y Chrome usa el manifest para abrir sin la barra del navegador cuando se inicia desde el ícono.
- Se registra un Service Worker mínimo y network-first. `version.json` queda explícitamente fuera del caché para no interferir con el bloqueo obligatorio de versiones.
- El PNG aprobado se reconstruye antes de `dev` y `build` desde una fuente base64 versionada, por lo que CI y Firebase Hosting publican siempre el mismo ícono.
- Se actualizan regresiones unitarias/E2E para confirmar que el objetivo sigue seleccionado sin el badge circular y que los metadatos instalables permanecen presentes.
- Sin cambios en daño, Pelo, Soplos, ítems, resolución simultánea, Firestore o autoridad del host.

## 0.18.0 — Plan Cóndor: feedback contextual para Agarrar

- Se corrigió una ambigüedad introducida por la 0.17: elegir `grab` ya no puede generar la guía roja “SOPLO → +1 PELO”. La guía de ataque sólo reconoce jugadores rivales seleccionados.
- Mientras el jugador está apuntando un Soplo, el mechón queda deshabilitado y atenuado. Así no se puede cambiar accidentalmente a `grab` tocando el centro durante el modo de ataque.
- Fuera del modo Soplar, el mechón funciona como control contextual directo: estado verde `selected-grab`, `aria-pressed`, texto “YENDO…” y un pulso/cue propio al confirmar la elección.
- El área táctil del mechón queda geométricamente fija: la sensación de flotación se mueve al dibujo interior, evitando un objetivo móvil y mejorando precisión táctil/automatización.
- El reveal incorpora expresión facial y efecto de mano para `grab`, además de la etiqueta “¡AGARRA!”, diferenciándolo visualmente de Soplar, Tomar aire y Esconderse.
- La interacción táctil sigue el principio de mostrar y enfatizar sólo el control relevante al contexto, con feedback visual/sonoro inmediato.
- Se añadió E2E dedicado: verifica que el objeto quede deshabilitado durante targeting, que `grab` no cree aim guide, que la intención conserve Soplos y que el reveal renderice el feedback específico.
- Se ampliaron regresiones de UI para `selected-grab`, accesibilidad y efecto de resultado.
- Sin cambios en daño, Pelo, Soplos, frecuencia de aparición, resolución simultánea, autoridad del host ni arquitectura Firebase Spark.

## 0.17.0 — Plan Águila: mechón flotante, pickup gratis y tablero estable

- El objeto `+1 Pelo` pasa a representarse como un mechón flotante y usa una acción propia, `grab`, en partidas nuevas.
- Agarrar el mechón no consume Soplos. La contrapartida es táctica: elegir `grab` significa no elegir `hide`, por lo que cualquier Soplo entrante impacta normalmente ese turno.
- La resolución simultánea se conserva: primero se aplica el daño y después la curación. Llegar a 0 Pelo no revive; si sobrevive, el jugador puede recuperar 1 Pelo hasta el máximo de 4.
- Si dos o más jugadores intentan agarrarlo, el objeto se pierde y nadie recibe Pelo. Si nadie lo intenta, permanece en el centro.
- Los ítems pasan a ser eventos menos frecuentes: primer turno elegible 4, cooldown normal 4 turnos, cooldown crítico 4, probabilidad base 24% y pity de 9 turnos.
- Las partidas ya iniciadas con reglas v2 conservan la interacción anterior de Soplar al objeto, evitando romper sesiones heredadas.
- El objeto queda dentro de una capa absoluta propia. Ya no cuenta como otro botón hermano del grid, por lo que su aparición no altera selectores de asiento ni mueve las tarjetas.
- El bloque superior de “ATAQUE ELEGIDO” se reemplaza por una retícula roja lateral más compacta, manteniendo el resaltado rojo de la tarjeta y la guía entre personajes.
- Firestore Rules admite `grab` sólo para reglas v3 y sólo mientras el mechón existe; no abre escrituras sobre Pelo/Soplos ni autoridad del host.
- Se actualizaron pruebas unitarias, de UI, integración y reglas para pickup gratuito, vulnerabilidad, concurrencia, compatibilidad heredada y frecuencia de aparición.
- Se mantiene Firebase Spark: Authentication anónima, Firestore y Hosting, sin servicios pagos.

## 0.11.0 — Plan Águila: salida automática y trayectoria entre personajes

- Al finalizar una partida se preservan 3 segundos completos para ver la celebración de victoria/derrota. Después aparece “Regresando al lobby en 5s” y baja 4, 3, 2, 1 antes de volver automáticamente.
- El retorno usa `finishedAt` y el reloj calibrado, por lo que todos los celulares muestran la misma cuenta sin depender de timers locales iniciados al renderizar.
- El botón manual de revancha desaparece: al llegar a cero, el host devuelve la sala al lobby y todos vuelven con `ready:false`, conservando el flujo de revancha existente.
- Si el host queda suspendido o se desconecta en la pantalla final, el estado `finished` usa el lease corto de 5 s para transferir autoridad a otro participante conectado antes del retorno.
- La guía roja de Soplar ya no nace del botón: parte del avatar del jugador local y termina en el avatar del rival seleccionado.
- La trayectoria conserva punta de flecha, suma un marcador de origen y muestra el nombre del objetivo en la propia guía (“SOPLO → NOMBRE”).
- La etiqueta se corrige automáticamente si el ángulo dejaría el texto invertido; el overlay sigue sin interceptar punteros y respeta reduced motion.
- Se agregaron pruebas unitarias de la cuenta 5→0, integración del relevo de host al finalizar y E2E para origen de la flecha + regreso automático.
- Sin cambios en daño, Pelo, consumo de Soplos, resolución simultánea ni arquitectura Firebase Spark.

## 0.10.0 — Plan Cóndor: intención de ataque y lobby reactivo

- Sobre la base 0.9.0 se mantuvo intacto el orden fijo por `joinedAt` y se añadieron regresiones E2E que verifican que marcar Listo no cambia ninguna posición.
- Cuando Soplar queda dirigido a un rival, una guía roja animada conecta el botón con la tarjeta objetivo mientras la elección sigue vigente. La guía no intercepta punteros ni participa del estado del juego.
- Confirmar un objetivo produce un pulso corto alrededor de la tarjeta, rebote de la etiqueta ATAQUE ELEGIDO y un cue sonoro sutil; el feedback desaparece automáticamente al cambiar de acción o fase.
- El lobby ahora responde visualmente a ingreso, Listo y No listo mediante animaciones breves superpuestas que no alteran medidas, orden ni datos.
- Se agregaron cues separados para objetivo y Listo, manteniendo Web Audio como mejora opcional: un bloqueo de audio nunca afecta la partida.
- La geometría de la trayectoria vive en una función pura con pruebas unitarias y se recalcula al cambiar el DOM o el viewport.
- Todos los efectos nuevos respetan `prefers-reduced-motion` y mantienen `pointer-events:none` en overlays de combate.
- Referencia de interacción: la guía de Apple WWDC26 sobre controles táctiles destaca combinar mantener/arrastrar/soltar con feedback claro y continuo para apuntado mobile; esta pasada aplica ese principio sin cambiar la mecánica de Soplar.
- Sin cambios en daño, Pelo, Soplos, deadlines, host authority, Firestore Rules ni arquitectura Firebase Spark.

## 0.9.0 — Plan Águila: lobby estable y Soplar con objetivo visible

- El lobby se ordena explícitamente por `joinedAt`: cambiar Listo, recibir heartbeats o cambiar de host ya no mueve las filas.
- Las desconexiones breves conservan la posición. Si un jugador abandona o expira su lease y el lobby lo remueve, un reingreso posterior cuenta como una incorporación nueva y ocupa el último lugar.
- Cada fila muestra un número de posición estable que coincide con el orden usado para crear los asientos de la partida.
- Arrastrar Soplar ahora mueve una ficha/ráfaga visible bajo el dedo, resalta los objetivos válidos y da feedback háptico al entrar sobre uno.
- Al soltar sobre un rival, la tarjeta queda fuertemente marcada en rojo con “ATAQUE ELEGIDO” y el texto confirma el objetivo mientras la intención se guarda y después de ser aceptada.
- El drag limpia correctamente ghost, outlines y estado visual al cancelar, perder captura, cambiar de fase o quedar offline.
- Los efectos son puramente de presentación: no cambian daño, Soplos, deadlines, autoridad del host ni protocolo Firestore.
- Se añadieron regresiones de UI para el orden de ingreso y la marca de objetivo.

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
