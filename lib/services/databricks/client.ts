import * as dotenv from "dotenv";

dotenv.config();

export class DatabricksError extends Error {
  constructor(
    public readonly status: number,
    public readonly path: string,
    bodySnippet: string,
  ) {
    super(`Databricks ${status} on ${path}: ${bodySnippet}`);
    this.name = "DatabricksError";
  }
}

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [250, 1000, 4000];
const MAX_BODY_SNIPPET = 500;
const OAUTH_REFRESH_MARGIN_MS = 60_000;

type AuthMode =
  | { kind: "pat"; host: string; token: string }
  | { kind: "oauth"; host: string; clientId: string; clientSecret: string };

interface CachedOauthToken {
  token: string;
  expiresAt: number;
}

let cachedOauthToken: CachedOauthToken | null = null;

function resolveHost(): string | null {
  const raw = process.env.DATABRICKS_HOST;
  if (!raw) return null;
  const trimmed = raw.replace(/\/$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function resolveAuthMode(): AuthMode | null {
  const host = resolveHost();
  if (!host) return null;

  const token = process.env.DATABRICKS_TOKEN;
  if (token) return { kind: "pat", host, token };

  const clientId = process.env.DATABRICKS_CLIENT_ID;
  const clientSecret = process.env.DATABRICKS_CLIENT_SECRET;
  if (clientId && clientSecret) return { kind: "oauth", host, clientId, clientSecret };

  return null;
}

export function isDatabricksConfigured(): boolean {
  return resolveAuthMode() !== null;
}

async function fetchOauthToken(mode: Extract<AuthMode, { kind: "oauth" }>): Promise<string> {
  if (cachedOauthToken && cachedOauthToken.expiresAt - OAUTH_REFRESH_MARGIN_MS > Date.now()) {
    return cachedOauthToken.token;
  }

  const credentials = Buffer.from(`${mode.clientId}:${mode.clientSecret}`).toString("base64");
  const res = await fetch(`${mode.host}/oidc/v1/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials&scope=all-apis",
  });

  if (!res.ok) {
    const snippet = (await res.text()).slice(0, MAX_BODY_SNIPPET);
    throw new DatabricksError(res.status, "/oidc/v1/token", snippet);
  }

  const json = (await res.json()) as { access_token: string; expires_in: number };
  cachedOauthToken = {
    token: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  return json.access_token;
}

async function resolveBearerToken(mode: AuthMode): Promise<string> {
  return mode.kind === "pat" ? mode.token : fetchOauthToken(mode);
}

export async function dbxFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const mode = resolveAuthMode();
  if (!mode) {
    throw new Error(
      "Databricks client not configured: set DATABRICKS_HOST and either DATABRICKS_TOKEN or DATABRICKS_CLIENT_ID+DATABRICKS_CLIENT_SECRET",
    );
  }

  const bearer = await resolveBearerToken(mode);
  const url = `${mode.host}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${bearer}`);
  if (!headers.has("Content-Type") && init.body) {
    headers.set("Content-Type", "application/json");
  }

  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, { ...init, headers });
      if (res.ok) {
        return (await res.json()) as T;
      }
      const bodyText = (await res.text()).slice(0, MAX_BODY_SNIPPET);
      if ((res.status === 429 || res.status >= 500) && attempt < MAX_ATTEMPTS - 1) {
        await sleep(BACKOFF_MS[attempt]);
        continue;
      }
      throw new DatabricksError(res.status, path, bodyText);
    } catch (err) {
      if (err instanceof DatabricksError) throw err;
      lastError = err;
      if (attempt < MAX_ATTEMPTS - 1) {
        await sleep(BACKOFF_MS[attempt]);
        continue;
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Databricks request to ${path} failed after ${MAX_ATTEMPTS} attempts`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
