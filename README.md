# Orion Flow

**Orion Flow** es un servidor MCP local + un agente de productividad (**Orion**) para [OpenCode](https://opencode.ai) que gestiona tu agenda y tus pendientes sobre **Google Tasks** y **Google Calendar**.

> Orion convierte tus objetivos en acciones concretas, protege tu tiempo y mantiene una agenda realista: Google Calendar es la fuente de verdad de los compromisos con hora; Google Tasks es la fuente de verdad del inventario de trabajo pendiente.

## Características

- 🗂️ **Metodología INBOX → PROY**: bandeja de entrada para lo indefinido, listas `PROY: <nombre>` por proyecto definido, `Supermercado` para compras y `Mis tareas` para lo suelto.
- 📅 **Agenda estricta**: solo agenda el día siguiente; todo lo demás se *señala* con fecha/hora en la tarea, sin evento. Cada línea de un itinerario aprobado **existe verificablemente** en las herramientas.
- ⏰ **Fechas de vencimiento obligatorias** en toda tarea (sin `due` no hay notificación), con la hora objetivo documentada en las notas.
- 🔔 **Recordatorios con hora** vía eventos de Calendar (`notifications.calendar_reminder_minutes_before`, 30 min por defecto).
- 🟦 **Colores por categoría** en Calendar (trabajo, trámites, traslados, hogar, compras, metas, revisión de INBOX).
- ⚡ **Productividad máxima**: el tiempo libre nunca supera `productivity.max_free_block_hours` (2 h); Orion propone rellenar los huecos con el inventario por prioridad (vencidas → más próximas → metas PROY).
- 📝 **Memoria en notas**: cada decisión, corrección o feedback sobre una tarea se acumula en sus notas con fecha.
- 🔧 **Extensible**: si Orion no puede hacer algo con sus herramientas, lo desarrolla (MCP, scripts, config) y sube los cambios a GitHub.

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

1. Entra en [Google Cloud Console](https://console.cloud.google/).
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
npm run typecheck   # validación de tipos sin generar salida
npm run build       # compila a dist/
```

> El servidor MCP ejecuta `node dist/server.js`: después de tocar `src/`, reconstruye con `npm run build` y **reinicia la sesión de OpenCode** para recargar las herramientas.

## Usar con OpenCode

Inicia OpenCode desde esta carpeta:

```bash
cd /home/germoso/code/orion-flow
opencode
```

El proyecto incluye `opencode.jsonc`, que selecciona el agente **`orion`** por defecto e inicia el servidor MCP localmente. El prompt y las reglas del agente viven en [`.opencode/agents/orion.md`](.opencode/agents/orion.md).

## Herramientas MCP (`orion_*`)

### Google Tasks
| Herramienta | Función |
|---|---|
| `list_projects` / `create_project` | Listas/proyectos de Google Tasks |
| `list_tasks` / `create_task` / `update_task` | Inventario de pendientes (siempre con `due`) |
| `complete_task` / `delete_task` | Completar o eliminar tareas |

### Google Calendar
| Herramienta | Función |
|---|---|
| `list_calendars` / `list_calendar_events` | Consulta de calendarios y eventos |
| `find_available_slots` | Huecos libres en horario laboral con márgenes |
| `create_event` / `reschedule_event` / `cancel_event` | Alta, movimiento y baja de eventos |
| `schedule_task` | Agenda una tarea como evento con referencia cruzada |
| `set_event_color` | Colorea un evento existente |
| `today_briefing` | Resumen del día: eventos, vencidas y próximos huecos |

Los eventos aceptan el parámetro `color` (nombre en español, `colorId` 1–11 o genérico: verde, azul, rojo…).

## Configuración: `orion.config.jsonc`

**Todo lo variable vive en la raíz del proyecto** en [`orion.config.jsonc`](orion.config.jsonc) (formato JSONC, con un comentario `//` por valor explicando su función). El agente lee este archivo en lugar de duplicar valores en su prompt; puedes editarlo a mano o pedirle a Orion que cambie un valor.

| Sección | Qué controla |
|---|---|
| `timezone` | Zona horaria de toda la agenda |
| `workday` | Horario laboral y margen entre compromisos |
| `productivity` | Máximo de tiempo libre (2 h), sesiones (120 min), pausas |
| `notifications` | Minutos de aviso previo de los recordatorios |
| `lists` | Nombres exactos: `INBOX`, prefijo `PROY: `, `Supermercado`, `Mis tareas` |
| `inbox_review` | Día/hora de la revisión semanal del INBOX |
| `agenda` | `only_schedule_next_day`: solo se agenda mañana |
| `colors` | Paleta categoría → color de Calendar |
| `git` | `auto_push_after_change`: subir cada cambio a GitHub |

### Variables de entorno (opcionales)

También puedes personalizar el horario con variables de entorno para el MCP:

```bash
export ORION_WORKDAY_START=09:00
export ORION_WORKDAY_END=18:00
export ORION_WORKDAYS=1,2,3,4,5
export ORION_BUFFER_MINUTES=10
export ORION_TIMEZONE=America/Santo_Domingo   # si no se detecta de Calendar
export ORION_CREDENTIALS_PATH=/ruta/a/credentials.json
export ORION_TOKEN_PATH=/ruta/a/token.json
```

## Scripts auxiliares

```bash
npm run auth              # autorización OAuth con Google
npm run color:manana      # colorea los eventos de mañana con la paleta por categoría
npx tsx scripts/verify-colors.ts   # muestra los colores actuales de los eventos de mañana
```

## Seguridad

- `credentials.json`, `token.json`, `.env`, `dist/` y `node_modules/` están excluidos del repositorio por `.gitignore`.
- El token OAuth nunca se sube a GitHub; las credenciales no salen de tu equipo.

## Repositorio

https://github.com/Germoso/orion-flow
