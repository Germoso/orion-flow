import fs from "node:fs/promises";
import path from "node:path";
import { google } from "googleapis";

const root = process.env.ORION_FLOW_HOME ?? process.cwd();
const credentialsPath = process.env.ORION_CREDENTIALS_PATH ?? path.join(root, "credentials.json");
const tokenPath = process.env.ORION_TOKEN_PATH ?? path.join(root, "token.json");

export const scopes = [
  "https://www.googleapis.com/auth/tasks",
  "https://www.googleapis.com/auth/calendar",
];

type OAuthFile = {
  installed?: { client_id: string; client_secret: string; redirect_uris?: string[] };
  web?: { client_id: string; client_secret: string; redirect_uris?: string[] };
};

type OAuthClient = InstanceType<typeof google.auth.OAuth2>;

let cachedAuth: OAuthClient | undefined;

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
}

async function persistTokens(auth: OAuthClient, tokens: Record<string, unknown>): Promise<void> {
  let previous: Record<string, unknown> = {};
  try {
    previous = await readJson<Record<string, unknown>>(tokenPath);
  } catch {
    // The token file may not exist on the first authorization.
  }
  await fs.writeFile(tokenPath, JSON.stringify({ ...previous, ...tokens }, null, 2), { mode: 0o600 });
  auth.setCredentials({ ...auth.credentials, ...tokens });
}

export async function getAuth(): Promise<OAuthClient> {
  if (cachedAuth) return cachedAuth;

  let oauth: OAuthFile;
  let tokens: Record<string, unknown>;
  try {
    oauth = await readJson<OAuthFile>(credentialsPath);
  } catch {
    throw new Error(`Falta ${credentialsPath}. Descarga credenciales OAuth de tipo Desktop app y guárdalas con ese nombre.`);
  }

  try {
    tokens = await readJson<Record<string, unknown>>(tokenPath);
  } catch {
    throw new Error(`Google todavía no está autorizado. Ejecuta "npm run auth" en ${root}.`);
  }

  const details = oauth.installed ?? oauth.web;
  if (!details) throw new Error("credentials.json no contiene una configuración OAuth instalada o web.");

  const auth = new google.auth.OAuth2(
    details.client_id,
    details.client_secret,
    details.redirect_uris?.[0],
  );
  auth.setCredentials(tokens);
  auth.on("tokens", (newTokens) => {
    void persistTokens(auth, newTokens as Record<string, unknown>);
  });
  cachedAuth = auth;
  return auth;
}

export async function getGoogleApis(): Promise<{
  auth: OAuthClient;
  tasks: ReturnType<typeof google.tasks>;
  calendar: ReturnType<typeof google.calendar>;
}> {
  const auth = await getAuth();
  return {
    auth,
    tasks: google.tasks({ version: "v1", auth }),
    calendar: google.calendar({ version: "v3", auth }),
  };
}
