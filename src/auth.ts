import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import readline from "node:readline";
import { google } from "googleapis";

const root = process.env.ORION_FLOW_HOME ?? process.cwd();
const credentialsPath = process.env.ORION_CREDENTIALS_PATH ?? path.join(root, "credentials.json");
const tokenPath = process.env.ORION_TOKEN_PATH ?? path.join(root, "token.json");

const scopes = [
  "https://www.googleapis.com/auth/tasks",
  "https://www.googleapis.com/auth/calendar",
];

const TIMEOUT_MS = 5 * 60 * 1000;

interface ClientCredentials {
  client_id?: string;
  client_secret?: string;
}

interface Authorization {
  code: string;
  redirectUri: string;
}

async function readClientCredentials(): Promise<ClientCredentials> {
  let raw: string;
  try {
    raw = await fs.readFile(credentialsPath, "utf8");
  } catch {
    throw new Error(`Falta ${credentialsPath}. Descarga credenciales OAuth de tipo Desktop app y guárdalas con ese nombre.`);
  }

  const parsed = JSON.parse(raw) as Record<string, ClientCredentials>;
  const details = parsed.installed ?? parsed.web;
  if (!details?.client_id) {
    throw new Error("credentials.json no contiene una configuración OAuth instalada o web.");
  }
  return details;
}

/** Acepta una URL de redirección completa o un código suelto. */
function parsePastedValue(value: string, fallbackRedirectUri: string): Authorization | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const code = url.searchParams.get("code") ?? new URLSearchParams(url.hash.replace(/^#/, "")).get("code");
      if (!code) return null;
      return { code, redirectUri: url.origin };
    } catch {
      return null;
    }
  }

  if (/^[0-9A-Za-z\-._~/:]+$/.test(trimmed)) {
    return { code: trimmed, redirectUri: fallbackRedirectUri };
  }

  return null;
}

async function main(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // El usuario puede pegar la URL antes de que termine la preparación: en ese
  // caso la línea queda encolada hasta que el flujo esté listo para leerla.
  const queuedLines: string[] = [];
  let handleLine: ((line: string) => void) | null = null;
  rl.on("line", (line) => {
    if (handleLine) handleLine(line);
    else queuedLines.push(line);
  });

  try {
    const details = await readClientCredentials();
    const server = http.createServer();

    const port = await new Promise<number>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (address === null || typeof address === "string") {
          reject(new Error("No se pudo determinar el puerto local para la autorización."));
          return;
        }
        resolve(address.port);
      });
    });

    const redirectUri = `http://localhost:${port}`;
    const oauth = new google.auth.OAuth2(details.client_id, details.client_secret, redirectUri);

    const authUrl = oauth.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: scopes,
      redirect_uri: redirectUri,
    });

    console.log("1) Copia este enlace y ábrelo en tu navegador:");
    console.log("");
    console.log(authUrl);
    console.log("");
    console.log("2) Acepta los permisos de Google.");
    console.log("");
    console.log("Si el navegador está en OTRA máquina (SSH/remote), la página final fallará o");
    console.log("no volverá sola. Copia la URL completa a la que te redirigió (la que empieza");
    console.log(`con ${redirectUri} y contiene "code=") y pégala aquí en la terminal.`);
    console.log("");

    const authorization = await new Promise<Authorization>((resolve, reject) => {
      const finish = (value: Authorization | null, error?: Error): void => {
        clearTimeout(timeout);
        handleLine = null;
        server.close();
        if (error) reject(error);
        else if (value) resolve(value);
      };

      const onLine = (line: string): void => {
        const parsed = parsePastedValue(line, redirectUri);
        if (!parsed) {
          console.log("No se reconoce. Pega la URL completa de redirección o el código solo.");
          return;
        }
        finish(parsed);
      };

      const timeout = setTimeout(() => {
        rl.close();
        finish(null, new Error("Se agotó el tiempo de espera (5 minutos). Ejecuta el comando de nuevo."));
      }, TIMEOUT_MS);

      server.on("request", (req, res) => {
        const requestUrl = new URL(req.url ?? "/", redirectUri);
        if (requestUrl.pathname !== "/") {
          res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("Not found");
          return;
        }

        const code = requestUrl.searchParams.get("code");
        const error = requestUrl.searchParams.get("error");
        if (error || !code) {
          res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
          res.end("No se recibió el código de autorización. Vuelve a intentarlo.");
          finish(null, new Error(error ? `Google devolvió el error: ${error}` : "No se recibió el código de autorización."));
          return;
        }

        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Autorización completada. Ya puedes cerrar esta pestaña y volver a la terminal.");
        finish({ code, redirectUri });
      });

      handleLine = (line: string): void => onLine(line);
      for (const line of queuedLines.splice(0)) handleLine(line);
      console.log("Esperando la autorización (pega la URL aquí si no vuelve sola)...");
    });

    const { tokens } = await oauth.getToken({
      code: authorization.code,
      redirect_uri: authorization.redirectUri,
    });
    await fs.writeFile(tokenPath, JSON.stringify(tokens, null, 2), { mode: 0o600 });
    console.log(`Autorización completada. Token guardado en ${tokenPath}`);
  } catch (error) {
    console.error("No se pudo completar la autorización de Google.");
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    rl.close();
  }
}

await main();
