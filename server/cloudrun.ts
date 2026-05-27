import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { join } from "node:path";

import { flushAnalytics } from "../lib/analytics";
import { handleMcpRequest } from "../lib/handler";

const PORT = Number(process.env.PORT ?? 8080);
const SHUTDOWN_GRACE_MS = 10_000;
const PUBLIC_DIR = join(process.cwd(), "public");
const STATIC_ASSETS = new Map([
  ["/apple-touch-icon.png", "image/png"],
  ["/favicon.ico", "image/x-icon"],
  ["/favicon.png", "image/png"],
  ["/favicon.svg", "image/svg+xml"],
  ["/icon-192.png", "image/png"],
  ["/icon-512.png", "image/png"],
  ["/meta.png", "image/png"],
]);

const server = createServer((req, res) => {
  void route(req, res).catch(err => {
    console.error("[cloudrun] handler error:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    } else {
      res.end();
    }
  });
});

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const pathname = getPathname(req);

  if (req.method === "GET" && pathname === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === "GET" || req.method === "HEAD") {
    if (pathname === "/" || pathname === "/index.html") {
      await serveStaticFile(res, "index.html", "text/html; charset=utf-8", req.method === "HEAD");
      return;
    }

    const contentType = STATIC_ASSETS.get(pathname);
    if (contentType) {
      await serveStaticFile(res, pathname.slice(1), contentType, req.method === "HEAD");
      return;
    }
  }

  const webReq = await toWebRequest(req);
  const webRes = await handleMcpRequest(webReq);
  await streamWebResponse(webRes, res);
}

function getPathname(req: IncomingMessage): string {
  const host = req.headers.host ?? `localhost:${PORT}`;
  return new URL(req.url ?? "/", `http://${host}`).pathname;
}

async function serveStaticFile(
  res: ServerResponse,
  fileName: string,
  contentType: string,
  headOnly: boolean,
): Promise<void> {
  try {
    const body = await readFile(join(PUBLIC_DIR, fileName));
    res.writeHead(200, {
      "Cache-Control": fileName === "index.html" ? "public, max-age=60" : "public, max-age=86400",
      "Content-Length": body.byteLength,
      "Content-Type": contentType,
    });
    res.end(headOnly ? undefined : body);
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(headOnly ? undefined : "Not found");
      return;
    }
    throw err;
  }
}

async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const host = req.headers.host ?? `localhost:${PORT}`;
  // Cloud Run / GFE terminates TLS at the front door and forwards via plain
  // HTTP w/ `x-forwarded-proto: https`. Honor it so any downstream that
  // inspects request.url scheme sees the public-facing protocol.
  const fwdProto = req.headers["x-forwarded-proto"];
  const proto = (Array.isArray(fwdProto) ? fwdProto[0] : fwdProto) ?? "http";
  const url = new URL(req.url ?? "/", `${proto}://${host}`);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) headers.set(name, value.join(", "));
    else headers.set(name, String(value));
  }

  let body: Uint8Array | undefined;
  if (req.method && req.method !== "GET" && req.method !== "HEAD") {
    body = await readBody(req);
  }

  return new Request(url, {
    method: req.method,
    headers,
    body: body && body.byteLength > 0 ? (body as BodyInit) : undefined,
  });
}

function readBody(req: IncomingMessage): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", chunk => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(new Uint8Array(Buffer.concat(chunks))));
    req.on("error", reject);
  });
}

async function streamWebResponse(webRes: Response, res: ServerResponse): Promise<void> {
  res.statusCode = webRes.status;
  webRes.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });

  if (!webRes.body) {
    res.end();
    return;
  }

  const reader = webRes.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } finally {
    reader.releaseLock();
    res.end();
  }
}

server.listen(PORT, () => {
  console.warn(`[cloudrun] solana-mcp listening on :${PORT}`);
});

function shutdown(signal: NodeJS.Signals): void {
  console.warn(`[cloudrun] received ${signal}, draining…`);
  // Force-exit on timeout uses a non-zero code so Cloud Run / monitoring can
  // alert on unclean shutdowns. Cloud Run does not gate restarts on exit
  // code, so this does not introduce a deploy-time crash loop.
  const force = setTimeout(() => {
    console.warn(`[cloudrun] drain exceeded ${SHUTDOWN_GRACE_MS}ms, forcing exit`);
    process.exit(1);
  }, SHUTDOWN_GRACE_MS);
  force.unref();

  server.close(err => {
    if (err) {
      console.error("[cloudrun] server close error:", err);
      process.exit(1);
      return;
    }
    void flushAnalytics()
      .catch((flushErr: unknown) => {
        console.warn("[cloudrun] analytics flush failed during shutdown:", flushErr);
      })
      .finally(() => {
        console.warn("[cloudrun] drained, exiting cleanly");
        process.exit(0);
      });
  });
  server.closeIdleConnections();
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
