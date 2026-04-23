import express, { type Request as ExpressRequest, type Response as ExpressResponse } from "express";
import rawBody from "raw-body";
import * as dotenv from "dotenv";

import { createMcp } from "../lib";

dotenv.config();

const handler = createMcp();
const app = express();

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
app.listen(port, () => {
  console.warn(`[start] solana-mcp listening on :${port}`);
});
