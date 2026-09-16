# Configuración inicial sin terminal local

Solo se necesita una vez. Las siguientes publicaciones se hacen desde GitHub Actions. No pegues claves privadas en chats, archivos del proyecto o variables públicas.

## 1. Firebase

En tu proyecto Firebase:

- Verificá el **ID del proyecto** en Configuración del proyecto (no el número ni el nombre visible).
- Habilitá Blaze si aún no está habilitado; el backend autoritativo requiere Functions y Cloud Tasks.
- Confirmá Firestore en modo nativo, base `(default)`, Authentication → Anonymous habilitado y la Web App registrada.
- En Authentication → Settings → Authorized domains, incluí el dominio de Hosting que vas a usar.
- En Configuración del proyecto → Tus apps → Web App → Configuración, copiá el objeto público `firebaseConfig` como JSON válido. Ejemplo de forma (reemplazar valores):

```json
{
  "apiKey": "VALOR_PUBLICO",
  "authDomain": "TU_PROYECTO.firebaseapp.com",
  "projectId": "TU_PROYECTO",
  "appId": "ID_DE_LA_WEB_APP",
  "messagingSenderId": "NUMERO_DE_PROYECTO"
}
```

## 2. Cuenta para publicar desde GitHub

En Google Cloud Console, seleccioná el mismo proyecto. En **IAM y administración → Cuentas de servicio**, creá `github-deploy`. Asignale estos roles en ese proyecto:

| Rol | Uso |
| --- | --- |
| Firebase Admin (`roles/firebase.admin`) | Hosting y configuración Firebase |
| Cloud Functions Admin (`roles/cloudfunctions.admin`) | Publicar las funciones |
| Cloud Run Admin (`roles/run.admin`) | Servicios de Functions de 2.ª generación |
| Cloud Tasks Admin (`roles/cloudtasks.admin`) | Crear/configurar la cola |
| Service Usage Admin (`roles/serviceusage.serviceUsageAdmin`) | Habilitar APIs requeridas |
| Service Account User (`roles/iam.serviceAccountUser`) | Desplegar con la identidad de ejecución |
| Artifact Registry Administrator (`roles/artifactregistry.admin`) | Artefactos de las funciones |

Esta identidad de despliegue es privilegiada: limitá el acceso al repositorio y a sus Secrets. Podés migrar después a Workload Identity Federation para no usar una clave JSON.

En esa cuenta → **Claves → Agregar clave → Crear clave → JSON**. Guardá el contenido únicamente en el secret de GitHub del paso 4. No lo subas al repositorio. No uses el JSON como configuración del frontend.

## 3. Identidad que ejecuta el juego

Functions de 2.ª generación usa por defecto la **Compute Engine default service account**: `NUMERO_DE_PROYECTO-compute@developer.gserviceaccount.com`. Si todavía no existe, habilitá la API Compute Engine desde Google Cloud Console (no hace falta crear una máquina virtual).

En IAM, asignale:

| Rol | Uso |
| --- | --- |
| Cloud Datastore User (`roles/datastore.user`) | Leer/escribir Firestore desde el servidor |
| Cloud Tasks Enqueuer (`roles/cloudtasks.enqueuer`) | Encolar cada plazo de turno |
| Cloud Run Invoker (`roles/run.invoker`) | Invocar la tarea privada de 2.ª generación |
| Cloud Functions Invoker (`roles/cloudfunctions.invoker`) | Invocación de la función de tareas |
| Eventarc Event Receiver (`roles/eventarc.eventReceiver`) | Trigger del documento de tarea |
| Cloud Build Service Account (`roles/cloudbuild.builds.builder`) | Build si el proyecto usa esta identidad por defecto |

En la ficha de **esa misma cuenta de servicio → Permisos**, agregá como principal su propio email con **Service Account User**. Esto permite que la función programe tareas autenticadas usando su propia identidad (permiso `iam.serviceAccounts.actAs`). No vuelvas pública la función `turnTask`.

En proyectos antiguos, Cloud Build puede usar `NUMERO@cloudbuild.gserviceaccount.com`; conservá sus permisos de build. Los agentes de servicio que Google crea al habilitar APIs deben conservar sus roles automáticos. Si el primer deploy informa que Eventarc todavía se está inicializando, esperá unos minutos y repetí el workflow.

## 4. Variables y secreto de GitHub

En el repositorio → **Settings → Secrets and variables → Actions**:

| Tipo | Nombre exacto | Valor |
| --- | --- | --- |
| Variable | `FIREBASE_PROJECT_ID` | ID real del proyecto |
| Variable | `FIREBASE_WEB_CONFIG` | Objeto JSON público del paso 1 |
| Secret | `FIREBASE_SERVICE_ACCOUNT` | JSON privado de `github-deploy` |
| Variable | `DEPLOY_ENABLED` | `true`, una vez completados los pasos anteriores |

Desde el celular puede ser más cómodo abrir GitHub en el navegador con vista de escritorio. Este repositorio no necesita un token Firebase de usuario ni claves en archivos `.env` versionados.

## 5. Publicar y probar

En **Actions → Verificar y publicar MVP → Run workflow**, elegí `main`.

Primero corren las pruebas; después el job de publicación habilita APIs, valida que la configuración pública corresponda al proyecto, construye el frontend y ejecuta el deploy de Functions, Firestore y Hosting. El nombre de codebase `pelaobolao` mantiene agrupadas sus funciones.

Cuando todo termine en verde, abrí la URL de **Firebase → Hosting** en ambos celulares. El dominio estándar es `ID_DEL_SITIO.web.app` (también `ID_DEL_SITIO.firebaseapp.com`); usá el que muestre tu consola. No se reserva ni se adivina un dominio distinto desde el código.

Cada nuevo commit a `main` pasa por el mismo control. Si querés desactivar publicaciones, cambiá `DEPLOY_ENABLED` a `false`; las pruebas siguen funcionando. Para volver a una versión anterior, usá Revert en GitHub y dejá que el workflow publique ese commit; no reviertas solo Hosting si el cambio incluye backend o reglas.

## Diagnóstico rápido

- **Deploy omitido:** revisar `DEPLOY_ENABLED=true` y rama `main`.
- **Falta configuración / projectId distinto:** corregir variables públicas; el workflow falla antes de publicar.
- **Permiso denegado al desplegar:** revisar el rol mencionado en el log y la cuenta `github-deploy` del proyecto correcto.
- **Turno se queda en cero:** mirar Functions → Logs de `dispatchJob` / `turnTask`; revisar Cloud Tasks Enqueuer, Invoker y actAs de la cuenta de ejecución. El botón no puede forzar un resultado local.
- **Anonymous sign-in falla:** comprobar proveedor habilitado, dominio autorizado y que la configuración sea la de esta Web App.
- **Pruebas rojas:** abrir el paso fallido y descargar el artifact `resultados-mvp`, que incluye trazas del navegador cuando hay errores.

Antes de abrirlo a muchos usuarios: presupuestos/alertas de Google Cloud, App Check y límites antiabuso. Las alertas de presupuesto no son un corte automático de gasto.
