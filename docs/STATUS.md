# Estado del MVP Spark

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
