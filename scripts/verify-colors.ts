import { DateTime } from "luxon";
import { getGoogleApis } from "../src/google.js";
async function main() {
  const { calendar } = await getGoogleApis();
  const tz = "America/Santo_Domingo";
  const start = DateTime.now().setZone(tz).plus({ days: 1 }).startOf("day");
  const list = await calendar.events.list({ calendarId: "primary", timeMin: start.toISO()!, timeMax: start.plus({ days: 1 }).toISO()!, singleEvents: true, orderBy: "startTime" });
  for (const e of list.data.items ?? []) console.log(`${e.start?.dateTime ?? e.start?.date} | colorId=${e.colorId ?? "(default)"} | ${e.summary}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
