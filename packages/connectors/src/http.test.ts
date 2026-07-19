import { test } from "vite-plus/test";
import { deepStrictEqual, equal, rejects } from "node:assert/strict";
import {
  buildConnectorRequest,
  ConnectorExecutor,
  FetchHttpTransport,
  HttpStreamResponse,
  type OperationEndEvent,
  type HttpTransport,
} from "./http.ts";
import { ConnectorError } from "./errors.ts";

test("request overrides merge JSON and credentials are applied last", () => {
  const request = buildConnectorRequest(
    {
      url: "https://api.example.com/chat?version=1",
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "base" },
      body: JSON.stringify({ model: "base", nested: { a: 1 }, items: [1, 2] }),
    },
    {
      headers: { "X-Tenant": "editorial" },
      query: { version: "2" },
      body: { nested: { b: 2 }, items: [3] },
    },
    { Authorization: "Bearer secret" },
  );

  equal(request.url, "https://api.example.com/chat?version=2");
  equal(request.headers?.Authorization, "Bearer secret");
  equal(request.headers?.["X-Tenant"], "editorial");
  equal(typeof request.body, "string");
  deepStrictEqual(JSON.parse(request.body as string), {
    model: "base",
    nested: { a: 1, b: 2 },
    items: [3],
  });
});

test("request overrides reject protected headers", async () => {
  await rejects(
    async () =>
      buildConnectorRequest(
        { url: "https://api.example.com" },
        { headers: { Authorization: "unsafe" } },
      ),
    ConnectorError,
  );
});

test("body overrides only affect JSON object operations", () => {
  const bodyless = buildConnectorRequest(
    { url: "https://api.example.com/models", method: "GET" },
    { body: { temperature: 0.7 } },
  );
  equal(bodyless.body, undefined);

  const multipart = new FormData();
  multipart.set("file", new Blob(["image"]), "cover.jpg");
  const upload = buildConnectorRequest(
    { url: "https://api.example.com/upload", method: "POST", body: multipart },
    { body: { temperature: 0.7 } },
  );
  equal(upload.body, multipart);
});

test("executor always performs exactly one physical request", async () => {
  let calls = 0;
  const transport: HttpTransport = {
    async send() {
      calls += 1;
      throw new ConnectorError({ kind: "network", message: "offline", retryable: true });
    },
  };
  const executor = new ConnectorExecutor("test", "connection", transport);
  await rejects(
    () =>
      executor.send(
        { name: "image.generate", capability: "image" },
        { url: "https://api.example.com" },
      ),
    ConnectorError,
  );
  equal(calls, 1);
});

test("stream executor finalizes before transport EOF and ignores semantic cleanup cancellation", async () => {
  let sourceCancellations = 0;
  const operationEnds: OperationEndEvent[] = [];
  const executor = new ConnectorExecutor(
    "test",
    "connection",
    {
      send() {
        throw new Error("buffered request was not expected");
      },
      stream() {
        return Promise.resolve(
          new HttpStreamResponse(
            200,
            new Headers({ "content-type": "text/event-stream" }),
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("first"));
              },
              cancel() {
                sourceCancellations += 1;
              },
            }),
          ),
        );
      },
    },
    { onOperationEnd: (event) => operationEnds.push(event) },
  );

  const response = await executor.stream(
    { name: "chat.complete", capability: "chat" },
    { url: "https://api.example.com/chat" },
  );
  equal(operationEnds.length, 0);

  const reader = response.body.getReader();
  equal(new TextDecoder().decode((await reader.read()).value), "first");
  equal(operationEnds.length, 0);

  response.finalize();
  response.finalize();
  await reader.cancel("semantic completion");
  equal(sourceCancellations, 1);
  deepStrictEqual(
    operationEnds.map(({ success, statusCode, errorKind }) => ({
      success,
      statusCode,
      errorKind,
    })),
    [{ success: true, statusCode: 200, errorKind: undefined }],
  );
});

test("stream executor reports genuine consumer cancellation as one failure", async () => {
  let sourceCancellations = 0;
  const operationEnds: OperationEndEvent[] = [];
  const executor = new ConnectorExecutor(
    "test",
    "connection",
    {
      send() {
        throw new Error("buffered request was not expected");
      },
      stream() {
        return Promise.resolve(
          new HttpStreamResponse(
            200,
            new Headers({ "content-type": "text/event-stream" }),
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("first"));
              },
              cancel() {
                sourceCancellations += 1;
              },
            }),
          ),
        );
      },
    },
    { onOperationEnd: (event) => operationEnds.push(event) },
  );

  const response = await executor.stream(
    { name: "chat.complete", capability: "chat" },
    { url: "https://api.example.com/chat" },
  );
  const reader = response.body.getReader();
  await reader.cancel("caller stopped reading");
  response.finalize();

  equal(sourceCancellations, 1);
  deepStrictEqual(
    operationEnds.map(({ success, statusCode, errorKind }) => ({
      success,
      statusCode,
      errorKind,
    })),
    [{ success: false, statusCode: undefined, errorKind: "network" }],
  );
});

test("stream executor reports one contextual semantic failure after transport EOF", async () => {
  const operationEnds: OperationEndEvent[] = [];
  const executor = new ConnectorExecutor(
    "test",
    "connection",
    {
      send() {
        throw new Error("buffered request was not expected");
      },
      stream() {
        return Promise.resolve(
          new HttpStreamResponse(
            200,
            new Headers({ "content-type": "text/event-stream" }),
            new ReadableStream({
              start(controller) {
                controller.close();
              },
            }),
          ),
        );
      },
    },
    { onOperationEnd: (event) => operationEnds.push(event) },
  );

  const response = await executor.stream(
    { name: "chat.complete", capability: "chat" },
    { url: "https://api.example.com/chat" },
  );
  equal((await response.body.getReader().read()).done, true);
  equal(operationEnds.length, 0);

  const error = response.fail(
    new ConnectorError({
      kind: "invalid_response",
      message: "stream ended before protocol completion",
    }),
  );
  equal(error.connectorId, "test");
  equal(error.connectionId, "connection");
  equal(error.operation, "chat.complete");
  response.fail(error);
  deepStrictEqual(
    operationEnds.map(({ success, statusCode, errorKind }) => ({
      success,
      statusCode,
      errorKind,
    })),
    [{ success: false, statusCode: undefined, errorKind: "invalid_response" }],
  );
});

test("stream executor normalizes body read failures and reports one failed operation", async () => {
  let sourceController!: ReadableStreamDefaultController<Uint8Array>;
  const operationEnds: OperationEndEvent[] = [];
  const executor = new ConnectorExecutor(
    "test",
    "connection",
    {
      send() {
        throw new Error("buffered request was not expected");
      },
      stream() {
        return Promise.resolve(
          new HttpStreamResponse(
            200,
            new Headers({ "content-type": "text/event-stream" }),
            new ReadableStream({
              start(controller) {
                sourceController = controller;
                controller.enqueue(new TextEncoder().encode("first"));
              },
            }),
          ),
        );
      },
    },
    { onOperationEnd: (event) => operationEnds.push(event) },
  );

  const response = await executor.stream(
    { name: "chat.complete", capability: "chat" },
    { url: "https://api.example.com/chat" },
  );
  const reader = response.body.getReader();
  await reader.read();
  sourceController.error(new Error("socket reset"));

  await rejects(reader.read(), (error: unknown) => {
    equal(error instanceof ConnectorError, true);
    equal((error as ConnectorError).kind, "network");
    equal((error as Error).message.includes("读取外部服务响应流失败"), true);
    equal((error as Error).message.includes("Connector：test"), true);
    return true;
  });
  deepStrictEqual(
    operationEnds.map(({ success, errorKind }) => ({ success, errorKind })),
    [{ success: false, errorKind: "network" }],
  );
});

test("fetch transport performs one physical request", async () => {
  let calls = 0;
  const transport = new FetchHttpTransport(async () => {
    calls += 1;
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  const response = await transport.send({ url: "https://api.example.com" }, {});
  deepStrictEqual(response.json(), { ok: true });
  equal(calls, 1);
});

test("HTTP failures preserve safe upstream diagnostics", async () => {
  const transport = new FetchHttpTransport(async () =>
    Promise.resolve(
      new Response(JSON.stringify({ error: "site blocked", token: "provider-secret-value" }), {
        status: 403,
        statusText: "Forbidden",
        headers: { "content-type": "application/json", "x-request-id": "request-403" },
      }),
    ),
  );

  await rejects(
    () =>
      transport.send(
        {
          url: "https://api.example.com/scrape?api_key=request-secret&url=private",
          method: "POST",
        },
        {},
      ),
    (error: unknown) => {
      equal(error instanceof ConnectorError, true);
      const message = (error as Error).message;
      equal(message.includes("HTTP 403 Forbidden"), true);
      equal(
        message.includes(
          "POST https://api.example.com/scrape?api_key=%5BREDACTED%5D&url=%5BREDACTED%5D",
        ),
        true,
      );
      equal(message.includes("请求 ID：request-403"), true);
      equal(message.includes("site blocked"), true);
      equal(message.includes("provider-secret-value"), false);
      equal(message.includes("request-secret"), false);
      return true;
    },
  );
});

test("executor adds connector and operation context to root errors", async () => {
  const executor = new ConnectorExecutor("firecrawl", "connection-main", {
    async send() {
      throw new ConnectorError({
        kind: "permission",
        statusCode: 403,
        message: "外部服务返回 HTTP 403 Forbidden",
      });
    },
  });

  await rejects(
    () =>
      executor.send(
        { name: "source.fetch", capability: "source-fetch" },
        { url: "https://api.firecrawl.dev/v1/scrape" },
      ),
    (error: unknown) => {
      const message = (error as Error).message;
      equal(message.includes("Connector：firecrawl"), true);
      equal(message.includes("连接：connection-main"), true);
      equal(message.includes("操作：source.fetch（source-fetch）"), true);
      return true;
    },
  );
});
