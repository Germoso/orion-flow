// One-off: colorea los eventos del día siguiente según la paleta de Orion.
import { DateTime } from "luxon";
import { getGoogleApis } from "../src/google.js";

const PALETTE: Array<[RegExp, string, string]> = [
  [/^Limpiar la casa/i, "9", "verde · hogar"],
  [/^🚗 Salir de casa/i, "6", "mandarina · traslado"],
  [/^Pagar el agua/i, "10", "rojo · trámite urgente"],
  [/^(Trabajo \(Codika\)|2nd Job)/i, "7", "celeste · trabajo"],
];

async function main() {
  const { calendar } = await getGoogleApis();
  const calendarList = await calendar.calendarList.list({ minAccessRole: "writer" });
  const primary = calendarList.data.items?.find((c) => c.primary) ?? calendarList.data.items?.[0];
  if (!primary?.id) throw new Error("No hay calendario principal.");
  const timezone = primary.timeZone ?? "America/Santo_Domingo";

  const start = DateTime.now().setZone(timezone).plus({ days: 1 }).startOf("day");
  const end = start.plus({ days: 1 });

  const list = await calendar.events.list({
    calendarId: primary.id,
    timeMin: start.toISO()!,
    timeMax: end.toISO()!,
    singleEvents: true,
    orderBy: "startTime",
  });

  for (const event of list.data.items ?? []) {
    if (event.status === "cancelled") continue;
    const match = PALETTE.find(([pattern]) => pattern.test(event.summary ?? ""));
    if (!match) {
      console.log(`- "${event.summary}" → sin regla, no se toca`);
      continue;
    }
    const [, colorId, label] = match;
    await calendar.events.patch({
      calendarId: primary.id,
      eventId: event.id!,
      sendUpdates: "none",
      requestBody: { colorId },
    });
    console.log(`- "${event.summary}" → colorId ${colorId} (${label})`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
