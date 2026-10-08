import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DateTime } from "luxon";
import { z } from "zod";
import { getGoogleApis } from "./google.js";

const server = new McpServer({ name: "orion", version: "0.1.0" });

const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
});

function fail(error: unknown): ReturnType<typeof text> {
  const message = error instanceof Error ? error.message : String(error);
  return text({ error: message });
}

async function safe<T>(operation: () => Promise<T>): Promise<ReturnType<typeof text>> {
  try {
    return text(await operation());
  } catch (error) {
    return fail(error);
  }
}

const taskListId = z.string().optional().describe("ID de la lista de Google Tasks; si se omite se usa project.");
const project = z.string().min(1).optional().describe("Nombre del proyecto, que corresponde a una lista de Google Tasks.");

async function findTaskList(tasks: Awaited<ReturnType<typeof getGoogleApis>>["tasks"], name: string, create = false) {
  let pageToken: string | undefined;
  do {
    const response = await tasks.tasklists.list({ maxResults: 100, pageToken });
    const found = response.data.items?.find((item) => item.title?.toLocaleLowerCase() === name.toLocaleLowerCase());
    if (found?.id) return found;
    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);
  if (!create) throw new Error(`No existe el proyecto/lista "${name}".`);
  const created = await tasks.tasklists.insert({ requestBody: { title: name } });
  if (!created.data.id) throw new Error("Google no devolvió el ID del nuevo proyecto.");
  return created.data;
}

async function resolveTaskList(
  tasks: Awaited<ReturnType<typeof getGoogleApis>>["tasks"],
  listId: string | undefined,
  projectName: string | undefined,
  create = false,
) {
  if (listId) return { id: listId, title: projectName ?? listId };
  if (!projectName) throw new Error("Indica project o taskListId.");
  const list = await findTaskList(tasks, projectName, create);
  if (!list.id) throw new Error("La lista no tiene ID.");
  return { id: list.id, title: list.title ?? projectName };
}

function taskSummary(task: Record<string, unknown>) {
  return {
    id: task.id,
    title: task.title,
    notes: task.notes,
    status: task.status,
    due: task.due,
    completed: task.completed,
    parent: task.parent,
    updated: task.updated,
    webViewLink: task.webViewLink,
  };
}

function appendNote(notes: string | undefined, line: string): string {
  const current = notes?.trim() ?? "";
  return current ? `${current}\n${line}` : line;
}

function googleDateTime(value: string, timezone: string): string {
  const parsed = DateTime.fromISO(value, { zone: timezone });
  if (!parsed.isValid) throw new Error(`Fecha/hora inválida: ${value}`);
  return parsed.toISO({ suppressMilliseconds: false }) ?? value;
}

function taskDue(value: string | undefined, timezone: string): string | undefined {
  if (!value) return undefined;
  const parsed = DateTime.fromISO(value, { zone: timezone });
  if (!parsed.isValid) throw new Error(`Fecha límite inválida: ${value}`);
  return `${parsed.toFormat("yyyy-MM-dd")}T00:00:00.000Z`;
}

async function primaryCalendar(calendar: Awaited<ReturnType<typeof getGoogleApis>>["calendar"]) {
  const response = await calendar.calendarList.list({ minAccessRole: "writer", maxResults: 250 });
  const calendars = response.data.items ?? [];
  return calendars.find((item) => item.primary) ?? calendars[0];
}

async function defaultCalendarId(calendar: Awaited<ReturnType<typeof getGoogleApis>>["calendar"], requested?: string) {
  if (requested) return requested;
  const primary = await primaryCalendar(calendar);
  if (!primary?.id) throw new Error("No se encontró un calendario disponible.");
  return primary.id;
}

async function timezoneFor(calendar: Awaited<ReturnType<typeof getGoogleApis>>["calendar"], calendarId?: string) {
  try {
    const settings = await calendar.settings.get({ setting: "timezone" });
    if (settings.data.value) return settings.data.value;
  } catch {
    // Fall back to the process timezone when settings are not readable.
  }
  return process.env.ORION_TIMEZONE ?? DateTime.local().zoneName;
}

// Paleta de colores de Google Calendar (colorId 1–11) con alias en español e inglés.
const EVENT_COLOR_ALIASES: Array<[string, string]> = [
  ["1", "1"], ["lavanda", "1"], ["lavender", "1"],
  ["2", "2"], ["salvia", "2"], ["sage", "2"],
  ["3", "3"], ["uva", "3"], ["grape", "3"], ["morado", "3"], ["purpura", "3"],
  ["4", "4"], ["flamenco", "4"], ["flamingo", "4"], ["rosa", "4"],
  ["5", "5"], ["platano", "5"], ["banana", "5"], ["amarillo", "5"],
  ["6", "6"], ["mandarina", "6"], ["tangerine", "6"], ["naranja", "6"],
  ["7", "7"], ["pavo real", "7"], ["pavo-real", "7"], ["peacock", "7"], ["celeste", "7"],
  ["8", "8"], ["arandano", "8"], ["blueberry", "8"], ["azul", "8"],
  ["9", "9"], ["albahaca", "9"], ["basil", "9"], ["verde", "9"],
  ["10", "10"], ["tomate", "10"], ["tomato", "10"], ["rojo", "10"],
  ["11", "11"], ["grafito", "11"], ["graphite", "11"], ["gris", "11"],
];

const normalizeColor = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

const EVENT_COLOR_MAP = new Map(EVENT_COLOR_ALIASES.map(([alias, id]) => [normalizeColor(alias), id]));

export const EVENT_COLOR_HELP = "Nombre (lavanda, salvia, uva, flamenco, plátano, mandarina, pavo real, arándano, albahaca, tomate, grafito), colorId 1–11 o color genérico (verde, azul, rojo, naranja, amarillo, gris).";

function resolveColor(color?: string | null): string | undefined {
  if (color === undefined || color === null || String(color).trim() === "") return undefined;
  const id = EVENT_COLOR_MAP.get(normalizeColor(String(color)));
  if (!id) throw new Error(`Color desconocido: "${color}". Usa uno de: lavanda, salvia, uva, flamenco, plátano, mandarina, pavo real, arándano, albahaca, tomate, grafito (o colorId 1–11).`);
  return id;
}

function eventSummary(event: Record<string, any>) {
  return {
    id: event.id,
    summary: event.summary,
    description: event.description,
    status: event.status,
    start: event.start,
    end: event.end,
    colorId: event.colorId,
    attendees: event.attendees,
    htmlLink: event.htmlLink,
    creator: event.creator,
    organizer: event.organizer,
    extendedProperties: event.extendedProperties,
  };
}

function eventBounds(event: Record<string, any>, timezone: string) {
  const start = event.start?.date
    ? DateTime.fromISO(event.start.date, { zone: timezone }).startOf("day")
    : DateTime.fromISO(event.start?.dateTime ?? "", { setZone: true }).setZone(timezone);
  const end = event.end?.date
    ? DateTime.fromISO(event.end.date, { zone: timezone }).startOf("day")
    : DateTime.fromISO(event.end?.dateTime ?? "", { setZone: true }).setZone(timezone);
  return { start, end };
}

async function findConflicts(
  calendar: Awaited<ReturnType<typeof getGoogleApis>>["calendar"],
  calendarId: string,
  timezone: string,
  start: DateTime,
  end: DateTime,
  excludeEventId?: string,
) {
  const response = await calendar.events.list({
    calendarId,
    timeMin: start.toUTC().toISO()!,
    timeMax: end.toUTC().toISO()!,
    singleEvents: true,
    orderBy: "startTime",
  });
  return (response.data.items ?? [])
    .filter((event) => event.id !== excludeEventId && event.status !== "cancelled")
    .map((event) => ({ event, bounds: eventBounds(event as Record<string, any>, timezone) }))
    .filter(({ bounds }) => bounds.start.isValid && bounds.end.isValid && bounds.start < end && bounds.end > start)
    .map(({ event }) => eventSummary(event as Record<string, any>));
}

function dateRange(value: Record<string, any>, timezone: string) {
  if (value.date) {
    const start = DateTime.fromISO(value.date, { zone: timezone }).startOf("day");
    const end = start.plus({ days: 1 });
    return { start, end };
  }
  const start = DateTime.fromISO(value.dateTime, { setZone: true }).setZone(timezone);
  return { start, end: start.plus({ hours: 1 }) };
}

server.registerTool(
  "list_projects",
  { description: "Lista los proyectos, representados por listas de Google Tasks.", inputSchema: {} },
  async () => safe(async () => {
    const { tasks } = await getGoogleApis();
    const items: Array<{ id: string; title: string; updated?: string }> = [];
    let pageToken: string | undefined;
    do {
      const response = await tasks.tasklists.list({ maxResults: 100, pageToken });
      for (const item of response.data.items ?? []) {
        if (item.id && item.title) items.push({ id: item.id, title: item.title, updated: item.updated ?? undefined });
      }
      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);
    return items;
  }),
);

server.registerTool(
  "create_project",
  { description: "Crea una lista/proyecto independiente en Google Tasks.", inputSchema: { name: z.string().min(1) } },
  async ({ name }) => safe(async () => {
    const { tasks } = await getGoogleApis();
    try {
      const existing = await findTaskList(tasks, name);
      return { created: false, project: { id: existing.id, title: existing.title } };
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith("No existe el proyecto/lista")) throw error;
    }
    const created = await findTaskList(tasks, name, true);
    return { created: true, project: { id: created.id, title: created.title } };
  }),
);

server.registerTool(
  "list_tasks",
  {
    description: "Lista tareas de un proyecto. Por defecto muestra tareas pendientes.",
    inputSchema: {
      project,
      taskListId,
      showCompleted: z.boolean().optional().default(false),
      dueBefore: z.string().optional().describe("Fecha ISO para filtrar tareas con vencimiento anterior."),
      maxResults: z.number().int().min(1).max(100).optional().default(100),
    },
  },
  async ({ project: projectName, taskListId: listId, showCompleted, dueBefore, maxResults }) => safe(async () => {
    const { tasks } = await getGoogleApis();
    const list = await resolveTaskList(tasks, listId, projectName);
    const response = await tasks.tasks.list({
      tasklist: list.id,
      showCompleted,
      showHidden: false,
      maxResults,
      dueMax: dueBefore,
    });
    return { project: list.title, projectId: list.id, tasks: (response.data.items ?? []).map((item) => taskSummary(item as Record<string, unknown>)) };
  }),
);

server.registerTool(
  "create_task",
  {
    description: "Crea una tarea en un proyecto. Si el proyecto no existe, lo crea.",
    inputSchema: {
      title: z.string().min(1),
      project,
      taskListId,
      notes: z.string().optional(),
      due: z.string().optional().describe("Fecha o fecha/hora ISO."),
      priority: z.enum(["low", "medium", "high", "urgent"]).optional(),
      estimatedMinutes: z.number().int().min(5).max(480).optional(),
      parentTaskId: z.string().optional(),
    },
  },
  async ({ title, project: projectName, taskListId: listId, notes, due, priority, estimatedMinutes, parentTaskId }) => safe(async () => {
    const { tasks, calendar } = await getGoogleApis();
    const list = await resolveTaskList(tasks, listId, projectName, true);
    const timezone = await timezoneFor(calendar);
    const metadata = [
      priority ? `Prioridad Orion: ${priority}` : undefined,
      estimatedMinutes ? `Duración estimada Orion: ${estimatedMinutes} minutos` : undefined,
    ].filter(Boolean).join("\n");
    const request = await tasks.tasks.insert({
      tasklist: list.id,
      parent: parentTaskId,
      requestBody: {
        title,
        notes: [notes, metadata].filter(Boolean).join("\n") || undefined,
        due: taskDue(due, timezone),
      },
    });
    return { project: list.title, projectId: list.id, task: taskSummary(request.data as Record<string, unknown>) };
  }),
);

server.registerTool(
  "update_task",
  {
    description: "Actualiza el título, notas, fecha o estado de una tarea.",
    inputSchema: {
      taskId: z.string().min(1),
      project,
      taskListId,
      title: z.string().min(1).optional(),
      notes: z.string().optional(),
      due: z.string().optional().nullable(),
      status: z.enum(["needsAction", "completed"]).optional(),
    },
  },
  async ({ taskId, project: projectName, taskListId: listId, title, notes, due, status }) => safe(async () => {
    const { tasks, calendar } = await getGoogleApis();
    const list = await resolveTaskList(tasks, listId, projectName);
    const timezone = await timezoneFor(calendar);
    const patch: Record<string, unknown> = {};
    if (title !== undefined) patch.title = title;
    if (notes !== undefined) patch.notes = notes;
    if (due !== undefined) patch.due = due === null ? null : taskDue(due, timezone);
    if (status !== undefined) patch.status = status;
    const response = await tasks.tasks.patch({ tasklist: list.id, task: taskId, requestBody: patch });
    return { project: list.title, task: taskSummary(response.data as Record<string, unknown>) };
  }),
);

server.registerTool(
  "complete_task",
  { description: "Marca una tarea como completada o pendiente.", inputSchema: { taskId: z.string(), project, taskListId, completed: z.boolean().optional().default(true) } },
  async ({ taskId, project: projectName, taskListId: listId, completed }) => safe(async () => {
    const { tasks } = await getGoogleApis();
    const list = await resolveTaskList(tasks, listId, projectName);
    const response = await tasks.tasks.patch({ tasklist: list.id, task: taskId, requestBody: { status: completed ? "completed" : "needsAction" } });
    return { project: list.title, task: taskSummary(response.data as Record<string, unknown>) };
  }),
);

server.registerTool(
  "delete_task",
  { description: "Elimina permanentemente una tarea. Usar solo tras confirmación.", inputSchema: { taskId: z.string(), project, taskListId } },
  async ({ taskId, project: projectName, taskListId: listId }) => safe(async () => {
    const { tasks } = await getGoogleApis();
    const list = await resolveTaskList(tasks, listId, projectName);
    await tasks.tasks.delete({ tasklist: list.id, task: taskId });
    return { deleted: true, project: list.title, taskId };
  }),
);

server.registerTool(
  "list_calendars",
  { description: "Lista calendarios disponibles y detecta el calendario principal.", inputSchema: {} },
  async () => safe(async () => {
    const { calendar } = await getGoogleApis();
    const response = await calendar.calendarList.list({ minAccessRole: "reader", maxResults: 250 });
    return (response.data.items ?? []).map((item) => ({ id: item.id, summary: item.summary, description: item.description, primary: item.primary, accessRole: item.accessRole, timeZone: item.timeZone }));
  }),
);

server.registerTool(
  "list_calendar_events",
  {
    description: "Lista eventos de Calendar en un intervalo ISO. Usa el calendario principal si no se indica otro.",
    inputSchema: { start: z.string().optional(), end: z.string().optional(), calendarId: z.string().optional(), query: z.string().optional() },
  },
  async ({ start, end, calendarId, query }) => safe(async () => {
    const { calendar } = await getGoogleApis();
    const id = await defaultCalendarId(calendar, calendarId);
    const timezone = await timezoneFor(calendar, id);
    const startValue = start ?? DateTime.now().setZone(timezone).toISO()!;
    const endValue = end ?? DateTime.now().setZone(timezone).plus({ days: 1 }).toISO()!;
    const response = await calendar.events.list({ calendarId: id, timeMin: googleDateTime(startValue, timezone), timeMax: googleDateTime(endValue, timezone), singleEvents: true, orderBy: "startTime", q: query });
    return { calendarId: id, timezone, events: (response.data.items ?? []).map((item) => eventSummary(item as Record<string, any>)) };
  }),
);

server.registerTool(
  "find_available_slots",
  {
    description: "Busca huecos libres en horario laboral, considerando eventos y buffers.",
    inputSchema: {
      startDate: z.string().optional().describe("Fecha ISO inicial; por defecto hoy."),
      endDate: z.string().optional().describe("Fecha ISO final; por defecto dentro de 7 días."),
      durationMinutes: z.number().int().min(5).max(480),
      calendarId: z.string().optional(),
      maxSlots: z.number().int().min(1).max(20).optional().default(5),
    },
  },
  async ({ startDate, endDate, durationMinutes, calendarId, maxSlots }) => safe(async () => {
    const { calendar } = await getGoogleApis();
    const id = await defaultCalendarId(calendar, calendarId);
    const timezone = await timezoneFor(calendar, id);
    const first = DateTime.fromISO(startDate ?? DateTime.now().setZone(timezone).toISODate()!, { zone: timezone }).startOf("day");
    const last = DateTime.fromISO(endDate ?? first.plus({ days: 7 }).toISODate()!, { zone: timezone }).startOf("day");
    const startUtc = first.toUTC().toISO()!;
    const endUtc = last.plus({ days: 1 }).toUTC().toISO()!;
    const events = await calendar.events.list({ calendarId: id, timeMin: startUtc, timeMax: endUtc, singleEvents: true, orderBy: "startTime" });
    const busy = (events.data.items ?? []).map((event) => {
      if (event.start?.date || event.end?.date) {
        const startLocal = DateTime.fromISO(event.start?.date ?? "", { zone: timezone }).startOf("day");
        const endLocal = DateTime.fromISO(event.end?.date ?? "", { zone: timezone }).startOf("day");
        return { start: startLocal, end: endLocal };
      }
      return { start: DateTime.fromISO(event.start?.dateTime ?? "", { setZone: true }).setZone(timezone), end: DateTime.fromISO(event.end?.dateTime ?? "", { setZone: true }).setZone(timezone) };
    }).filter((item) => item.start.isValid && item.end.isValid);
    const [startHour, startMinute] = (process.env.ORION_WORKDAY_START ?? "09:00").split(":").map(Number);
    const [endHour, endMinute] = (process.env.ORION_WORKDAY_END ?? "18:00").split(":").map(Number);
    const workdays = new Set((process.env.ORION_WORKDAYS ?? "1,2,3,4,5").split(",").map(Number));
    const buffer = Number(process.env.ORION_BUFFER_MINUTES ?? "10");
    const slots: Array<{ start: string; end: string; durationMinutes: number; timezone: string }> = [];
    for (let day = first; day <= last && slots.length < maxSlots; day = day.plus({ days: 1 })) {
      if (!workdays.has(day.weekday)) continue;
      let cursor = day.set({ hour: startHour, minute: startMinute, second: 0, millisecond: 0 });
      const workEnd = day.set({ hour: endHour, minute: endMinute, second: 0, millisecond: 0 });
      const dayBusy = busy.filter((event) => event.end > cursor && event.start < workEnd).sort((a, b) => a.start.toMillis() - b.start.toMillis());
      for (const event of dayBusy) {
        const eventStart = event.start < cursor ? cursor : event.start;
        if (eventStart.diff(cursor, "minutes").minutes >= durationMinutes) {
          const slotEnd = cursor.plus({ minutes: durationMinutes });
          slots.push({ start: cursor.toISO()!, end: slotEnd.toISO()!, durationMinutes, timezone });
          if (slots.length >= maxSlots) break;
        }
        if (event.end.plus({ minutes: buffer }) > cursor) cursor = event.end.plus({ minutes: buffer });
      }
      if (slots.length >= maxSlots) break;
      if (workEnd.diff(cursor, "minutes").minutes >= durationMinutes) {
        const slotEnd = cursor.plus({ minutes: durationMinutes });
        slots.push({ start: cursor.toISO()!, end: slotEnd.toISO()!, durationMinutes, timezone });
      }
    }
    return { calendarId: id, timezone, workday: { start: process.env.ORION_WORKDAY_START ?? "09:00", end: process.env.ORION_WORKDAY_END ?? "18:00", bufferMinutes: buffer }, slots };
  }),
);

server.registerTool(
  "create_event",
  {
    description: "Crea un evento de Calendar. Para eventos con invitados o cambios sensibles, pedir confirmación antes.",
    inputSchema: {
      summary: z.string().min(1),
      start: z.string().optional(),
      end: z.string().optional(),
      durationMinutes: z.number().int().min(5).max(480).optional(),
      calendarId: z.string().optional(),
      description: z.string().optional(),
      location: z.string().optional(),
      attendees: z.array(z.string().email()).optional(),
      allDay: z.boolean().optional().default(false),
      color: z.string().optional().describe(`Color del evento. ${EVENT_COLOR_HELP}`),
      allowConflict: z.boolean().optional().default(false).describe("Solo true después de confirmar explícitamente el conflicto."),
    },
  },
  async ({ summary, start, end, durationMinutes, calendarId, description, location, attendees, allDay, color, allowConflict }) => safe(async () => {
    if (!start) throw new Error("start es obligatorio.");
    const { calendar } = await getGoogleApis();
    const id = await defaultCalendarId(calendar, calendarId);
    const timezone = await timezoneFor(calendar, id);
    const startValue = DateTime.fromISO(start, { zone: timezone });
    if (!startValue.isValid) throw new Error(`start inválido: ${start}`);
    const endValue = end ? DateTime.fromISO(end, { zone: timezone }) : allDay ? startValue.plus({ days: 1 }) : startValue.plus({ minutes: durationMinutes ?? 30 });
    if (!endValue.isValid || endValue <= startValue) throw new Error("end debe ser posterior a start.");
    const colorId = resolveColor(color);
    const conflicts = await findConflicts(calendar, id, timezone, startValue, endValue);
    if (conflicts.length && !allowConflict) return { created: false, conflict: true, calendarId: id, timezone, conflicts, message: "No se creó el evento porque se solapa con otros eventos." };
    const requestBody = allDay
      ? { summary, description, location, colorId, start: { date: startValue.toISODate()! }, end: { date: endValue.toISODate()! }, attendees: attendees?.map((email) => ({ email })) }
      : { summary, description, location, colorId, start: { dateTime: startValue.toISO()!, timeZone: timezone }, end: { dateTime: endValue.toISO()!, timeZone: timezone }, attendees: attendees?.map((email) => ({ email })) };
    const response = await calendar.events.insert({ calendarId: id, sendUpdates: attendees?.length ? "all" : "none", requestBody });
    return { calendarId: id, timezone, event: eventSummary(response.data as Record<string, any>) };
  }),
);

server.registerTool(
  "schedule_task",
  {
    description: "Agenda una tarea existente como evento de Calendar y guarda la referencia cruzada en la tarea.",
    inputSchema: { taskId: z.string(), project, taskListId, start: z.string(), end: z.string().optional(), durationMinutes: z.number().int().min(5).max(480).optional(), calendarId: z.string().optional(), notes: z.string().optional(), color: z.string().optional().describe(`Color del evento. ${EVENT_COLOR_HELP}`), allowConflict: z.boolean().optional().default(false).describe("Solo true después de confirmar explícitamente el conflicto.") },
  },
  async ({ taskId, project: projectName, taskListId: listId, start, end, durationMinutes, calendarId, notes, color, allowConflict }) => safe(async () => {
    const { tasks, calendar } = await getGoogleApis();
    const list = await resolveTaskList(tasks, listId, projectName);
    const taskResponse = await tasks.tasks.get({ tasklist: list.id, task: taskId });
    const task = taskResponse.data;
    if (!task.id || !task.title) throw new Error("No se encontró la tarea.");
    const id = await defaultCalendarId(calendar, calendarId);
    const timezone = await timezoneFor(calendar, id);
    const startValue = DateTime.fromISO(start, { zone: timezone });
    const endValue = end ? DateTime.fromISO(end, { zone: timezone }) : startValue.plus({ minutes: durationMinutes ?? 30 });
    if (!startValue.isValid || !endValue.isValid || endValue <= startValue) throw new Error("Intervalo de agenda inválido.");
    const conflicts = await findConflicts(calendar, id, timezone, startValue, endValue);
    if (conflicts.length && !allowConflict) return { scheduled: false, conflict: true, calendarId: id, timezone, conflicts, message: "No se agendó la tarea porque el horario se solapa con otros eventos." };
    const colorId = resolveColor(color);
    const response = await calendar.events.insert({
      calendarId: id,
      sendUpdates: "none",
      requestBody: {
        summary: task.title,
        description: [task.notes, notes, `Orion Flow · proyecto: ${list.title}`].filter(Boolean).join("\n\n"),
        colorId,
        start: { dateTime: startValue.toISO()!, timeZone: timezone },
        end: { dateTime: endValue.toISO()!, timeZone: timezone },
        extendedProperties: { private: { orionTaskId: task.id, orionTaskListId: list.id, orionProject: list.title ?? "" } },
      },
    });
    const eventId = response.data.id;
    if (!eventId) throw new Error("Calendar no devolvió el ID del evento.");
    const updatedTask = await tasks.tasks.patch({ tasklist: list.id, task: task.id, requestBody: { notes: appendNote(task.notes ?? undefined, `Orion Flow eventId: ${eventId}`), due: `${startValue.toFormat("yyyy-MM-dd")}T00:00:00.000Z` } });
    return { project: list.title, task: taskSummary(updatedTask.data as Record<string, unknown>), calendarId: id, timezone, event: eventSummary(response.data as Record<string, any>) };
  }),
);

server.registerTool(
  "reschedule_event",
  {
    description: "Mueve o cambia la duración de un evento existente. Usar confirmación si modifica un compromiso.",
    inputSchema: { eventId: z.string(), start: z.string(), end: z.string().optional(), durationMinutes: z.number().int().min(5).max(480).optional(), calendarId: z.string().optional(), color: z.string().optional().describe(`Color del evento. ${EVENT_COLOR_HELP}`), allowConflict: z.boolean().optional().default(false).describe("Solo true después de confirmar explícitamente el conflicto.") },
  },
  async ({ eventId, start, end, durationMinutes, calendarId, color, allowConflict }) => safe(async () => {
    const { calendar } = await getGoogleApis();
    const id = await defaultCalendarId(calendar, calendarId);
    const timezone = await timezoneFor(calendar, id);
    const startValue = DateTime.fromISO(start, { zone: timezone });
    const endValue = end ? DateTime.fromISO(end, { zone: timezone }) : startValue.plus({ minutes: durationMinutes ?? 30 });
    if (!startValue.isValid || !endValue.isValid || endValue <= startValue) throw new Error("Intervalo de agenda inválido.");
    const conflicts = await findConflicts(calendar, id, timezone, startValue, endValue, eventId);
    const colorId = resolveColor(color);
    if (conflicts.length && !allowConflict) return { rescheduled: false, conflict: true, calendarId: id, timezone, conflicts, message: "No se movió el evento porque el nuevo horario se solapa con otros eventos." };
    const response = await calendar.events.patch({ calendarId: id, eventId, sendUpdates: "all", requestBody: { start: { dateTime: startValue.toISO()!, timeZone: timezone }, end: { dateTime: endValue.toISO()!, timeZone: timezone }, ...(colorId ? { colorId } : {}) } });
    const linkedTaskId = response.data.extendedProperties?.private?.orionTaskId;
    const linkedTaskListId = response.data.extendedProperties?.private?.orionTaskListId;
    let linkedTaskUpdated = false;
    if (linkedTaskId && linkedTaskListId) {
      try {
        const { tasks } = await getGoogleApis();
        await tasks.tasks.patch({ tasklist: linkedTaskListId, task: linkedTaskId, requestBody: { due: `${startValue.toFormat("yyyy-MM-dd")}T00:00:00.000Z` } });
        linkedTaskUpdated = true;
      } catch {
        // The calendar change succeeded; report that the linked task could not be updated.
      }
    }
    return { rescheduled: true, calendarId: id, timezone, linkedTaskUpdated, event: eventSummary(response.data as Record<string, any>) };
  }),
);

server.registerTool(
  "cancel_event",
  { description: "Cancela un evento existente. Usar siempre tras confirmación.", inputSchema: { eventId: z.string(), calendarId: z.string().optional() } },
  async ({ eventId, calendarId }) => safe(async () => {
    const { calendar } = await getGoogleApis();
    const id = await defaultCalendarId(calendar, calendarId);
    await calendar.events.delete({ calendarId: id, eventId, sendUpdates: "all" });
    return { cancelled: true, calendarId: id, eventId };
  }),
);

server.registerTool(
  "set_event_color",
  {
    description: `Cambia el color de un evento existente de Calendar. inputSchema: eventId, color, calendarId opcional. Color: ${EVENT_COLOR_HELP}`,
    inputSchema: { eventId: z.string(), color: z.string().min(1).describe(EVENT_COLOR_HELP), calendarId: z.string().optional() },
  },
  async ({ eventId, color, calendarId }) => safe(async () => {
    const { calendar } = await getGoogleApis();
    const id = await defaultCalendarId(calendar, calendarId);
    const colorId = resolveColor(color);
    const response = await calendar.events.patch({ calendarId: id, eventId, sendUpdates: "none", requestBody: { colorId } });
    return { colored: true, calendarId: id, eventId, colorId, event: eventSummary(response.data as Record<string, any>) };
  }),
);

server.registerTool(
  "today_briefing",
  { description: "Resume calendario y tareas pendientes de hoy para la revisión diaria.", inputSchema: { date: z.string().optional(), calendarId: z.string().optional() } },
  async ({ date, calendarId }) => safe(async () => {
    const { tasks, calendar } = await getGoogleApis();
    const id = await defaultCalendarId(calendar, calendarId);
    const timezone = await timezoneFor(calendar, id);
    const today = DateTime.fromISO(date ?? DateTime.now().setZone(timezone).toISODate()!, { zone: timezone });
    const start = today.startOf("day");
    const end = start.plus({ days: 1 });
    const events = await calendar.events.list({ calendarId: id, timeMin: start.toUTC().toISO()!, timeMax: end.toUTC().toISO()!, singleEvents: true, orderBy: "startTime" });
    const projects = await tasks.tasklists.list({ maxResults: 100 });
    const dueTasks: Array<Record<string, unknown>> = [];
    for (const list of projects.data.items ?? []) {
      if (!list.id) continue;
      const response = await tasks.tasks.list({ tasklist: list.id, showCompleted: false, showHidden: false, maxResults: 100, dueMax: `${today.toUTC().toFormat("yyyy-MM-dd")}T23:59:59.000Z` });
      for (const task of response.data.items ?? []) {
        if (task.due && task.due <= end.toUTC().toISO()!) dueTasks.push({ project: list.title, ...taskSummary(task as Record<string, unknown>) });
      }
    }
    return { date: today.toISODate(), timezone, calendarId: id, events: (events.data.items ?? []).map((item) => eventSummary(item as Record<string, any>)), tasksDueTodayOrOverdue: dueTasks };
  }),
);

const transport = new StdioServerTransport();
await server.connect(transport);
