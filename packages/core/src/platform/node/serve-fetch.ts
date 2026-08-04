import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export interface ServeFetchOptions {
  port: number;
  hostname?: string;
}

export function serveFetch(
  options: ServeFetchOptions,
  handler: (request: Request) => Response | Promise<Response>,
) {
  const server = createServer(async (incoming, outgoing) => {
    try {
      const request = toFetchRequest(incoming, options);
      const response = await handler(request);
      await writeFetchResponse(outgoing, response);
    } catch (error) {
      console.error("[serve-fetch] request failed", error);
      outgoing.statusCode = 500;
      outgoing.setHeader("Content-Type", "application/json");
      outgoing.end(JSON.stringify({ error: "Internal Server Error" }));
    }
  });

  server.listen(options.port, options.hostname ?? "0.0.0.0");
  return server;
}

function toFetchRequest(incoming: IncomingMessage, options: ServeFetchOptions): Request {
  const host = incoming.headers.host ?? `localhost:${options.port}`;
  const url = new URL(incoming.url ?? "/", `http://${host}`);
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (Array.isArray(value)) {
      for (const item of value) headers.append(name, item);
    } else if (value !== undefined) {
      headers.set(name, value);
    }
  }

  const method = incoming.method ?? "GET";
  const hasBody = !["GET", "HEAD"].includes(method.toUpperCase());
  return new Request(url, {
    method,
    headers,
    body: hasBody ? incoming : undefined,
    duplex: hasBody ? "half" : undefined,
  } as unknown as RequestInit & { duplex?: "half" });
}

async function writeFetchResponse(outgoing: ServerResponse, response: Response): Promise<void> {
  outgoing.statusCode = response.status;
  response.headers.forEach((value, name) => outgoing.setHeader(name, value));

  if (!response.body) {
    outgoing.end();
    return;
  }

  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      outgoing.write(value);
    }
    outgoing.end();
  } finally {
    reader.releaseLock();
  }
}
