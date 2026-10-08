// Crea eventos recurrentes de hábitos (uso mientras el MCP no tenga `recurrence`).
// Uso: npx tsx scripts/create-recurring.ts
import { getGoogleApis } from "../src/google.js";

type Habit = { summary: string; time: string; durationMinutes: number; rrule: string; colorId: string };

const HABITS: Habit[] = [
  { summary: "💊 Minoxidil — mañana", time: "08:00", durationMinutes: 10, rrule: "RRULE:FREQ=DAILY", colorId: "6" },
  { summary: "💊 Minoxidil — noche", time: "21:00", durationMinutes: 10, rrule: "RRULE:FREQ=DAILY", colorId: "6" },
];

async function main() {
  const { calendar } = await getGoogleApis();
  const timezone = "America/Santo_Domingo";

  // Evitar duplicados: ¿ya existen eventos de Minoxidil?
  const existing = await calendar.events.list({
    calendarId: "primary",
    q: "Minoxidil",
    timeMin: new Date().toISOString(),
    singleEvents: true,
    orderBy: "startTime",
    maxResults: 5,
  });
  if ((existing.data.items ?? []).length > 0) {
    console.log("Ya existen eventos de Minoxidil, no se crea nada:");
    for (const e of existing.data.items ?? []) console.log(`- ${e.summary} ${e.start?.dateTime ?? e.start?.date} [${e.recurrence?.join(", ") ?? "sin recurrencia"}]`);
    return;
  }

  for (const habit of HABITS) {
    const [hour, minute] = habit.time.split(":").map(Number);
    const created = await calendar.events.insert({
      calendarId: "primary",
      sendUpdates: "none",
      requestBody: {
        summary: habit.summary,
        description: "Hábito diario (2× al día) del usuario. Origen: tarea 'Ponerse Minoxidil (2× al día)' en Hábitos.\nOrion Flow · recurrente creado el 08/10/2026",
        colorId: habit.colorId,
        recurrence: [habit.rrule],
        start: { dateTime: `2026-10-08T${habit.time}:00-04:00`, timeZone: timezone },
        end: { dateTime: `2026-10-08T${String(hour).padStart(2, "0")}:${String((minute + habit.durationMinutes) % 60).padStart(2, "0")}:00-04:00`, timeZone: timezone },
      },
    });
    console.log(`✔ ${created.data.summary} → ${created.data.start?.dateTime} [${created.data.recurrence?.join(", ")}] colorId=${created.data.colorId} id=${created.data.id}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
