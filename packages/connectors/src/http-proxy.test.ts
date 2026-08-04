/// <reference types="node" />

import { createServer, type Server } from "node:http";
import { connect } from "node:net";
import type { Duplex } from "node:stream";
import { test } from "vite-plus/test";
import { deepStrictEqual, equal } from "./test-assert.ts";
import { HttpProxyTransport } from "./http.ts";

test("HTTP proxy transport tunnels requests with proxy authentication", async () => {
  const target = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ proxied: true }));
  });
  const proxy = createServer();
  const sockets = new Set<Duplex>();
  const tunnels: Array<{ authority: string; authorization?: string }> = [];
  proxy.on("connect", (request, clientSocket, head) => {
    const authority = request.url ?? "";
    tunnels.push({
      authority,
      authorization: request.headers["proxy-authorization"],
    });
    const separator = authority.lastIndexOf(":");
    const host = authority.slice(0, separator);
    const port = Number(authority.slice(separator + 1));
    const upstream = connect(port, host, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      upstream.pipe(clientSocket);
      clientSocket.pipe(upstream);
    });
    sockets.add(clientSocket);
    sockets.add(upstream);
    clientSocket.on("close", () => sockets.delete(clientSocket));
    upstream.on("close", () => sockets.delete(upstream));
  });
  const [targetPort, proxyPort] = await Promise.all([listen(target), listen(proxy)]);
  const transport = new HttpProxyTransport(`http://proxy-user:proxy-secret@127.0.0.1:${proxyPort}`);

  try {
    const response = await transport.send(
      { url: `http://127.0.0.1:${targetPort}/weixin-token` },
      {},
    );
    deepStrictEqual(response.json(), { proxied: true });
    equal(tunnels[0]?.authority, `127.0.0.1:${targetPort}`);
    equal(
      tunnels[0]?.authorization,
      `Basic ${Buffer.from("proxy-user:proxy-secret").toString("base64")}`,
    );
  } finally {
    await transport.close();
    for (const socket of sockets) socket.destroy();
    await Promise.all([close(target), close(proxy)]);
  }
});

function listen(server: Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("test server did not bind a TCP port"));
        return;
      }
      resolve(address.port);
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
