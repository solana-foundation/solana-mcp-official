import express, { type Request as ExpressRequest, type Response as ExpressResponse } from "express";
import rawBody from "raw-body";
import * as dotenv from "dotenv";

import { createMcp, warmup } from "../lib";

dotenv.config();

const handler = createMcp();
const app = express();

// Fire and forget — runs in the background while express starts listening so
// the first user request after a deploy lands on a warm RAG endpoint.
void warmup();

app.get("/healthz", (_req: ExpressRequest, res: ExpressResponse) => {
  res.status(200).json({ ok: true });
});

app.all(/.*/, async (req: ExpressRequest, res: ExpressResponse) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
    const method = req.method;
    const webHeaders = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (value === undefined) continue;
      if (Array.isArray(value)) webHeaders.set(name, value.join(", "));
      else webHeaders.set(name, String(value));
    }

    let body: Uint8Array | undefined;
    if (method !== "GET" && method !== "HEAD") {
      const buf = await rawBody(req);
      if (buf.length > 0) {
        body = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      }
    }

    const webReq = new Request(url, {
      method,
      headers: webHeaders,
      body: body as BodyInit | undefined,
    });

    const webRes = await handler(webReq);

    res.status(webRes.status);
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
  } catch (err) {
    console.error("[start] handler error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    } else {
      res.end();
    }
  }
});

const port = Number(process.env.DATABRICKS_APP_PORT ?? process.env.PORT ?? 3000);
const SHUTDOWN_GRACE_MS = 10_000;

const server = app.listen(port, () => {
  console.warn(`[start] solana-mcp listening on :${port}`);
});

function shutdown(signal: NodeJS.Signals): void {
  console.warn(`[start] received ${signal}, draining in-flight requests…`);
  // Hard cap so a stuck connection cannot hold the container forever. Exit 0
  // even on timeout so Databricks Apps does not interpret a normal deploy
  // cutover as a crash and trigger a restart.
  const force = setTimeout(() => {
    console.warn(`[start] drain exceeded ${SHUTDOWN_GRACE_MS}ms, forcing exit`);
    process.exit(0);
  }, SHUTDOWN_GRACE_MS);
  force.unref();

  server.close(err => {
    if (err) {
      console.error("[start] server close error:", err);
      process.exit(1);
      return;
    }
    console.warn("[start] drained, exiting cleanly");
    process.exit(0);
  });
  // `server.close()` only stops accepting new connections; HTTP/1.1 keep-alive
  // sockets stay open and the close callback never fires until they idle out.
  // Close idle sockets immediately so the callback can run promptly while
  // in-flight requests still get to finish.
  server.closeIdleConnections();
}

process.once("SIGTERM", shutdown);
process.once("SIGINT", shutdown);
