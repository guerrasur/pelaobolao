# Estado de verificación · 16 de septiembre de 2026

Trabajo pausado a pedido del usuario. No se publicaron archivos en GitHub ni se desplegó Firebase.

- Compilación de producción: aprobada.
- Motor: 10 pruebas aprobadas en esta sesión.
- Integración Firestore y reglas: 10 pruebas aprobadas en esta sesión. Incluyen diez resoluciones concurrentes con un único resultado y consumo, partida completa de dos jugadores, ganador, revancha, acciones tardías y privacidad.
- Navegador: pendiente. Los emuladores oficiales arrancaron; Chromium completo falló antes de abrir el juego con `socket() failed: Operation not permitted`. El intento con headless shell fue interrumpido a pedido del usuario. La prueba incluye arrastre táctil, tap, recarga y reconexión, pero no se considera aprobada.
- Entorno de esta sesión: Java 21, Node 24. GitHub Actions está configurado para Node 22, como producción.
- GitHub: lectura disponible; creación real de archivo rechazada con `403 Resource not accessible by integration`, aunque ChatGPT muestra «Allow all actions» y el usuario tiene `push: true`.
- Firebase: pendiente de configuración y primer despliegue según DEPLOY.md.

## Subir la copia manualmente

1. Descomprimir el ZIP.
2. En `guerrasur/pelaobolao`, usar Add file → Upload files (o uploading an existing file si está vacío).
3. Subir el contenido descomprimido conservando carpetas y archivos ocultos, en la raíz del repositorio. No subir solamente el ZIP: GitHub no lo descomprime.
4. Comprobar que `.github/workflows/verify-deploy.yml`, `.gitignore` y `.env.example` también estén presentes. Si el selector no muestra archivos ocultos, crearlos con Add file → Create new file usando el nombre y contenido del ZIP.
5. Confirmar con Commit changes en main.
6. Revisar Actions. El workflow ejecuta las pruebas; el despliegue permanece desactivado salvo que se configure DEPLOY_ENABLED=true y las credenciales documentadas.

Si el celular no permite conservar la estructura de carpetas, usar GitHub Codespaces: cargar y extraer allí el ZIP, y confirmar desde el panel Source Control. No hace falta terminal local.

El ZIP incluye código, pruebas, configuración y documentación. Excluye claves, dependencias instaladas, logs, compilados y archivos temporales.
