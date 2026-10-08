// Archiva un proyecto: limpia fechas de vencimiento de sus tareas pendientes,
// deja nota de archivo y renombra la lista con el prefijo de archivado.
// Uso: npx tsx scripts/archive-project.ts "PROY: RAG personal" "📦 ARCH: RAG personal" "motivo"
import { DateTime } from "luxon";
import { getGoogleApis } from "../src/google.js";

const [listName, newName, reason] = process.argv.slice(2);
if (!listName || !newName) {
  console.error('Uso: npx tsx scripts/archive-project.ts "<lista>" "<nuevo nombre>" "<motivo opcional>"');
  process.exit(1);
}

async function main() {
  const { tasks } = await getGoogleApis();

  // 1. Localizar la lista
  let listId: string | undefined;
  let pageToken: string | undefined;
  do {
    const response = await tasks.tasklists.list({ maxResults: 100, pageToken });
    listId = response.data.items?.find((item) => item.title === listName)?.id;
    pageToken = response.data.nextPageToken ?? undefined;
  } while (!listId && pageToken);
  if (!listId) throw new Error(`No existe la lista "${listName}".`);
  const timezone = "America/Santo_Domingo";
  const stamp = DateTime.now().setZone(timezone).toFormat("dd/LL/yyyy HH:mm");

  // 2. Quitar fechas + nota en tareas pendientes
  let archived = 0;
  pageToken = undefined;
  do {
    const response = await tasks.tasks.list({ tasklist: listId, maxResults: 100, showCompleted: false, pageToken });
    for (const task of response.data.items ?? []) {
      if (!task.id) continue;
      const note = `${task.notes ? task.notes + "\n" : ""}${stamp} — ARCHIVADO: ${reason ?? "proyecto en pausa"}. Se quitó la fecha de vencimiento (no debe notificar). Para reactivar: quitar el prefijo ARCH de la lista y reprogramar.`;
      await tasks.tasks.patch({ tasklist: listId, task: task.id, requestBody: { due: null, notes: note } });
      archived += 1;
      console.log(`  · tarea sin fecha: "${task.title}"`);
    }
    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  // 3. Renombrar la lista
  await tasks.tasklists.patch({ tasklist: listId, requestBody: { title: newName } });
  console.log(`✔ Archivado: "${listName}" → "${newName}" (${archived} tareas sin fecha)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
