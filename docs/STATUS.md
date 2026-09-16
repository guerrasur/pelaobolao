# Estado del MVP Spark

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
