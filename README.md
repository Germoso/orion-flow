# Orion Flow

Agente local de productividad para gestionar proyectos, Google Tasks y Google Calendar desde OpenCode.

## Requisitos

- Node.js 20 o superior.
- Una cuenta de Google.
- Un proyecto de Google Cloud con **Google Tasks API** y **Google Calendar API** habilitadas.
- Credenciales OAuth de tipo **Desktop app** descargadas como `credentials.json` en esta carpeta.

## Instalación

```bash
cd /home/germoso/code/orion-flow
npm install
```

## Configurar Google OAuth

1. Entra en [Google Cloud Console](https://console.cloud.google.com/).
2. Crea o selecciona un proyecto.
3. Habilita **Google Tasks API** y **Google Calendar API**.
4. Configura la pantalla de consentimiento OAuth y agrega tu cuenta como usuario de prueba si la aplicación está en modo testing.
5. Crea un cliente OAuth de tipo **Desktop app**.
6. Descarga el JSON y guárdalo como `credentials.json` en esta carpeta.
7. Ejecuta:

```bash
npm run auth
```

Se abrirá el navegador para autorizar acceso a tareas y calendario. El token se guardará localmente en `token.json`, que está excluido por `.gitignore`.

## Comprobar y compilar

```bash
npm run typecheck
npm run build
```

## Usar con OpenCode

Inicia OpenCode desde esta carpeta:

```bash
cd /home/germoso/code/orion-flow
opencode
```

El proyecto ya incluye `opencode.jsonc` y selecciona el agente `orion` por defecto. El servidor MCP se inicia localmente con `node dist/server.js`.

## Configuración opcional

Puedes personalizar el horario del agente con variables de entorno:

```bash
export ORION_WORKDAY_START=09:00
export ORION_WORKDAY_END=18:00
export ORION_WORKDAYS=1,2,3,4,5
export ORION_BUFFER_MINUTES=10
```

La zona horaria y el calendario principal se detectan desde Google Calendar. También puedes indicar rutas alternativas:

```bash
export ORION_CREDENTIALS_PATH=/ruta/a/credentials.json
export ORION_TOKEN_PATH=/ruta/a/token.json
```
