import { deepStrictEqual, equal, rejects, throws } from "../test-assert.ts";
import { test } from "vite-plus/test";
import {
  HttpResponse,
  HttpStreamResponse,
  type HttpRequest,
  type HttpTransport,
  type OperationEndEvent,
} from "../http.ts";
import { createStandaloneConnectorClients } from "../runtime.ts";
import {
  builtInConnectors,
  createBuiltInConnectorRegistry,
  dingTalkConnector,
  miniMaxConnector,
  openAICompatibleConnector,
  sourceConnectors,
  weixinOfficialAccountConnector,
  weixinRelayConnector,
} from "./index.ts";

test("built-in connector registry exposes supported service definitions", () => {
  equal(builtInConnectors.length, 22);
  deepStrictEqual(
    createBuiltInConnectorRegistry()
      .list()
      .map((definition) => definition.id),
    [
      "openai-compatible",
      "dashscope",
      "minimax",
      "bark",
      "dingtalk",
      "feishu",
      "weixin-official-account",
      "weixin-relay",
      "auto",
      "firecrawl",
      "jina",
      "jina-search",
      "brave-search",
      "tavily-search",
      "exa-search",
      "serper-search",
      "newsapi",
      "twitter",
      "rss",
      "gdelt",
      "hackernews",
      "arxiv",
    ],
  );
});

test("OpenAI-compatible chat maps domain input and sends exactly one request", async () => {
  const transport = new RecordingTransport({
    choices: [{ message: { content: "ok" } }],
    model: "answer-model",
  });
  const clients = createStandaloneConnectorClients(openAICompatibleConnector, {
    id: "ai",
    settings: { baseUrl: "https://models.example/v1", model: "default-model" },
    credentials: { apiKey: "secret" },
    overrides: {
      headers: { "X-Tenant": "editorial" },
      body: { metadata: { source: "dashboard" } },
    },
    transport,
  });

  const output = await clients.chat!.complete({
    messages: [{ role: "user", content: "hello" }],
    temperature: 0.3,
  });

  equal(output.content, "ok");
  equal(transport.requests.length, 1);
  equal(transport.requests[0].headers?.Authorization, "Bearer secret");
  equal(transport.requests[0].headers?.["X-Tenant"], "editorial");
  equal(typeof transport.requests[0].body, "string");
  deepStrictEqual(JSON.parse(transport.requests[0].body as string), {
    model: "default-model",
    messages: [{ role: "user", content: "hello" }],
    temperature: 0.3,
    metadata: { source: "dashboard" },
  });
});

test("OpenAI-compatible chat maps native tool definitions and tool calls", async () => {
  const transport = new RecordingTransport({
    choices: [
      {
        message: {
          content: null,
          tool_calls: [
            {
              id: "call-1",
              type: "function",
              function: { name: "search_news", arguments: '{"query":"AI"}' },
            },
          ],
        },
      },
    ],
  });
  const clients = createStandaloneConnectorClients(openAICompatibleConnector, {
    id: "ai-tools",
    settings: { baseUrl: "https://models.example/v1", model: "default-model" },
    credentials: { apiKey: "secret" },
    transport,
  });

  const output = await clients.chat!.complete({
    messages: [{ role: "user", content: "research" }],
    tools: [
      {
        name: "search_news",
        description: "搜索新闻",
        inputSchema: { type: "object", properties: { query: { type: "string" } } },
      },
    ],
    toolChoice: "auto",
  });

  deepStrictEqual(output.toolCalls, [
    { id: "call-1", name: "search_news", arguments: '{"query":"AI"}' },
  ]);
  const body = JSON.parse(transport.requests[0].body as string);
  equal(body.tools[0].function.name, "search_news");
  equal(body.tool_choice, "auto");
});

test("OpenAI-compatible chat assembles streamed native tool call arguments", async () => {
  const transport = new StreamingTransport([
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"search_news","arguments":"{\\"query\\":"}}]}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"AI\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
  ]);
  const clients = createStandaloneConnectorClients(openAICompatibleConnector, {
    id: "ai-stream-tools",
    settings: { baseUrl: "https://models.example/v1", model: "default-model" },
    credentials: { apiKey: "secret" },
    transport,
  });

  const events: Array<{ type: string; accumulatedArguments?: string }> = [];
  const output = await clients.chat!.complete(
    { messages: [{ role: "user", content: "research" }] },
    {
      onEvent(event) {
        events.push({
          type: event.type,
          accumulatedArguments:
            event.type === "response.tool_delta" ? event.accumulatedArguments : undefined,
        });
      },
    },
  );

  deepStrictEqual(output.toolCalls, [
    { id: "call-1", name: "search_news", arguments: '{"query":"AI"}' },
  ]);
  deepStrictEqual(
    events.filter((event) => event.type === "response.tool_delta"),
    [
      { type: "response.tool_delta", accumulatedArguments: '{"query":' },
      { type: "response.tool_delta", accumulatedArguments: '{"query":"AI"}' },
    ],
  );
});

test("OpenAI-compatible chat streams content deltas when events are requested", async () => {
  const transport = new StreamingTransport(
    [
      'data: {"model":"stream-model","choices":[{"delta":{"reasoning_content":"private"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"你"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"好"}}]}\n\n',
      'data: {"choices":[],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n',
      "data: [DONE]\n\n",
    ],
    undefined,
    false,
  );
  const operationEnds: OperationEndEvent[] = [];
  const clients = createStandaloneConnectorClients(openAICompatibleConnector, {
    id: "ai-stream",
    settings: { baseUrl: "https://models.example/v1", model: "default-model" },
    credentials: { apiKey: "secret" },
    transport,
    observer: { onOperationEnd: (event) => operationEnds.push(event) },
  });
  const events: Array<{ type: string; delta?: string }> = [];
  const output = await clients.chat!.complete(
    { messages: [{ role: "user", content: "hello" }] },
    {
      onEvent: (event) =>
        events.push({
          type: event.type,
          delta: event.type === "response.delta" ? event.delta : undefined,
        }),
    },
  );

  equal(output.content, "你好");
  equal(output.usage?.outputTokens, 2);
  deepStrictEqual(events, [
    { type: "response.started", delta: undefined },
    { type: "response.delta", delta: "你" },
    { type: "response.delta", delta: "好" },
    { type: "response.completed", delta: undefined },
  ]);
  equal(JSON.stringify(events).includes("private"), false);
  equal(JSON.parse(transport.requests[0]!.body as string).stream, true);
  equal(transport.cancellations, 1);
  deepStrictEqual(
    operationEnds.map(({ success, errorKind }) => ({ success, errorKind })),
    [{ success: true, errorKind: undefined }],
  );
});

test("OpenAI-compatible chat accepts CR, LF and CRLF SSE lines across chunks", async () => {
  const transport = new StreamingTransport([
    'data: {"model":"stream-model","choices":[{"delta":{"content":"A"}}]}\r',
    '\rdata: {"choices":[{"delta":{"content":"B"}}]}\r\n',
    "\r\ndata: [DONE]\n\n",
  ]);
  const clients = createStandaloneConnectorClients(openAICompatibleConnector, {
    id: "ai-line-endings",
    settings: { baseUrl: "https://models.example/v1", model: "default-model" },
    credentials: { apiKey: "secret" },
    transport,
  });

  const output = await clients.chat!.complete(
    { messages: [{ role: "user", content: "hello" }] },
    { onEvent() {} },
  );

  equal(output.content, "AB");
});

test("OpenAI-compatible chat accepts an explicit finish reason without DONE", async () => {
  const transport = new StreamingTransport(
    [
      'data: {"model":"stream-model","choices":[{"delta":{"content":"ok"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
    ],
    undefined,
    false,
  );
  const operationEnds: OperationEndEvent[] = [];
  const clients = createStandaloneConnectorClients(openAICompatibleConnector, {
    id: "ai-finish-reason",
    settings: { baseUrl: "https://models.example/v1", model: "default-model" },
    credentials: { apiKey: "secret" },
    transport,
    observer: { onOperationEnd: (event) => operationEnds.push(event) },
  });

  const output = await clients.chat!.complete(
    { messages: [{ role: "user", content: "hello" }] },
    { onEvent() {} },
  );

  equal(output.content, "ok");
  equal(transport.cancellations, 1);
  deepStrictEqual(
    operationEnds.map(({ success, errorKind }) => ({ success, errorKind })),
    [{ success: true, errorKind: undefined }],
  );
});

test("OpenAI-compatible chat rejects a truncated stream without a termination marker", async () => {
  const transport = new StreamingTransport([
    'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
  ]);
  const operationEnds: OperationEndEvent[] = [];
  const clients = createStandaloneConnectorClients(openAICompatibleConnector, {
    id: "ai-truncated",
    settings: { baseUrl: "https://models.example/v1", model: "default-model" },
    credentials: { apiKey: "secret" },
    transport,
    observer: { onOperationEnd: (event) => operationEnds.push(event) },
  });

  await rejects(
    () =>
      clients.chat!.complete({ messages: [{ role: "user", content: "hello" }] }, { onEvent() {} }),
    (error: unknown) => {
      equal(error instanceof Error, true);
      equal((error as Error).message.includes("完成标记前已结束"), true);
      equal((error as { kind?: string }).kind, "invalid_response");
      equal((error as { connectorId?: string }).connectorId, "openai-compatible");
      equal((error as { connectionId?: string }).connectionId, "ai-truncated");
      equal((error as { operation?: string }).operation, "chat.complete");
      return true;
    },
  );
  deepStrictEqual(
    operationEnds.map(({ success, errorKind }) => ({ success, errorKind })),
    [{ success: false, errorKind: "invalid_response" }],
  );
});

test("OpenAI-compatible chat contextualizes malformed SSE parser errors", async () => {
  const transport = new StreamingTransport(["data: not-json\r\r"]);
  const operationEnds: OperationEndEvent[] = [];
  const clients = createStandaloneConnectorClients(openAICompatibleConnector, {
    id: "ai-malformed-sse",
    settings: { baseUrl: "https://models.example/v1", model: "default-model" },
    credentials: { apiKey: "secret" },
    transport,
    observer: { onOperationEnd: (event) => operationEnds.push(event) },
  });

  await rejects(
    () =>
      clients.chat!.complete({ messages: [{ role: "user", content: "hello" }] }, { onEvent() {} }),
    (error: unknown) => {
      equal((error as { kind?: string }).kind, "invalid_response");
      equal((error as { connectorId?: string }).connectorId, "openai-compatible");
      equal((error as { connectionId?: string }).connectionId, "ai-malformed-sse");
      equal((error as { operation?: string }).operation, "chat.complete");
      return true;
    },
  );
  deepStrictEqual(
    operationEnds.map(({ success, errorKind }) => ({ success, errorKind })),
    [{ success: false, errorKind: "invalid_response" }],
  );
});

test("OpenAI-compatible chat rejects provider errors inside the SSE stream", async () => {
  const transport = new StreamingTransport([
    'data: {"choices":[{"delta":{"content":"partial"}}]}\n\n',
    'event: error\ndata: {"error":{"message":"quota exhausted","code":"quota_limit"}}\n\n',
  ]);
  const operationEnds: OperationEndEvent[] = [];
  const clients = createStandaloneConnectorClients(openAICompatibleConnector, {
    id: "ai-provider-error",
    settings: { baseUrl: "https://models.example/v1", model: "default-model" },
    credentials: { apiKey: "secret" },
    transport,
    observer: { onOperationEnd: (event) => operationEnds.push(event) },
  });

  await rejects(
    () =>
      clients.chat!.complete({ messages: [{ role: "user", content: "hello" }] }, { onEvent() {} }),
    (error: unknown) => {
      equal((error as { kind?: string }).kind, "provider");
      equal((error as { providerCode?: string }).providerCode, "quota_limit");
      equal((error as Error).message.includes("quota exhausted"), true);
      equal((error as { connectorId?: string }).connectorId, "openai-compatible");
      equal((error as { connectionId?: string }).connectionId, "ai-provider-error");
      equal((error as { operation?: string }).operation, "chat.complete");
      return true;
    },
  );
  deepStrictEqual(
    operationEnds.map(({ success, errorKind }) => ({ success, errorKind })),
    [{ success: false, errorKind: "provider" }],
  );
});

test("OpenAI-compatible chat normalizes response stream read failures", async () => {
  const transport = new StreamingTransport(
    ['data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'],
    new Error("socket reset"),
  );
  const operationEnds: OperationEndEvent[] = [];
  const clients = createStandaloneConnectorClients(openAICompatibleConnector, {
    id: "ai-read-error",
    settings: { baseUrl: "https://models.example/v1", model: "default-model" },
    credentials: { apiKey: "secret" },
    transport,
    observer: { onOperationEnd: (event) => operationEnds.push(event) },
  });

  await rejects(
    () =>
      clients.chat!.complete({ messages: [{ role: "user", content: "hello" }] }, { onEvent() {} }),
    (error: unknown) => {
      equal((error as { kind?: string }).kind, "network");
      equal((error as Error).message.includes("读取外部服务响应流失败"), true);
      equal((error as Error).message.includes("Connector：openai-compatible"), true);
      equal((error as { connectorId?: string }).connectorId, "openai-compatible");
      equal((error as { connectionId?: string }).connectionId, "ai-read-error");
      equal((error as { operation?: string }).operation, "chat.complete");
      return true;
    },
  );
  deepStrictEqual(
    operationEnds.map(({ success, errorKind }) => ({ success, errorKind })),
    [{ success: false, errorKind: "network" }],
  );
});

test("MiniMax image connector maps provider output", async () => {
  equal(
    miniMaxConnector.fields.some((field) => field.key === "apiHost"),
    false,
  );
  const modelField = miniMaxConnector.fields.find((field) => field.key === "model");
  equal(modelField?.input, "select");
  deepStrictEqual(modelField?.options, [
    { value: "image-01", label: "Image 01" },
    { value: "image-01-live", label: "Image 01 Live" },
  ]);
  const transport = new RecordingTransport({
    id: "image-task-1",
    data: { image_urls: ["https://img.example/a.jpg"] },
    base_resp: { status_code: 0, status_msg: "success" },
  });
  const clients = createStandaloneConnectorClients(miniMaxConnector, {
    id: "image",
    settings: {},
    credentials: { apiKey: "secret" },
    transport,
  });

  const output = await clients.image!.generate({
    prompt: "editorial illustration",
    aspect_ratio: "16:9",
  });

  equal(output.images[0].url, "https://img.example/a.jpg");
  equal(output.taskId, "image-task-1");
  equal(transport.requests.length, 1);
  equal(transport.requests[0].url, "https://api.minimaxi.com/v1/image_generation");
  equal(typeof transport.requests[0].body, "string");
  deepStrictEqual(JSON.parse(transport.requests[0].body as string), {
    model: "image-01",
    prompt: "editorial illustration",
    response_format: "url",
    n: 1,
    prompt_optimizer: false,
    aigc_watermark: false,
    aspect_ratio: "16:9",
  });
});

test("MiniMax image connector rejects invalid official parameters without a request", async () => {
  const transport = new RecordingTransport({});
  const clients = createStandaloneConnectorClients(miniMaxConnector, {
    id: "image-invalid",
    settings: {},
    credentials: { apiKey: "secret" },
    transport,
  });

  await rejects(
    () => clients.image!.generate({ prompt: "cover", aspect_ratio: "5:4" }),
    /参数必须是以下值之一/,
  );
  await rejects(
    () => clients.image!.generate({ prompt: "cover", width: 1024 }),
    /width 和 height 必须同时设置/,
  );
  await rejects(
    () => clients.image!.generate({ prompt: "cover", prompt_optimizer: "true" }),
    /prompt_optimizer 必须是布尔值/,
  );
  equal(transport.requests.length, 0);
});

test("Weixin direct connector routes every API operation through its account HTTP proxy", async () => {
  const directTransport = new RecordingTransport({ unexpected: true });
  const proxyTransport = new QueueRecordingTransport([
    { access_token: "token", expires_in: 7200 },
    { media_id: "cover-media" },
    { url: "https://mmbiz.qpic.cn/content.jpg" },
    { media_id: "draft-media", article_id: "article-id" },
  ]);
  const proxyUrls: string[] = [];
  const clients = createStandaloneConnectorClients(weixinOfficialAccountConnector, {
    id: "weixin-proxied",
    settings: {},
    credentials: {
      appId: "wx-app",
      appSecret: "wx-secret",
      proxyUrl: "http://proxy-user:proxy-secret@proxy.example.com:8080",
    },
    transport: directTransport,
    proxyTransportFactory(proxyUrl) {
      proxyUrls.push(proxyUrl);
      return proxyTransport;
    },
  });

  await clients.weixin!.check();
  await clients.weixin!.uploadCover({
    bytes: new TextEncoder().encode("cover"),
    mimeType: "image/jpeg",
    filename: "cover.jpg",
  });
  await clients.weixin!.uploadContentImage({
    bytes: new TextEncoder().encode("content"),
    mimeType: "image/jpeg",
    filename: "content.jpg",
  });
  await clients.weixin!.createDraft({
    title: "标题",
    digest: "摘要",
    contentHtml: "<p>正文</p>",
    coverMediaId: "cover-media",
  });

  deepStrictEqual(proxyUrls, ["http://proxy-user:proxy-secret@proxy.example.com:8080"]);
  equal(directTransport.requests.length, 0);
  equal(proxyTransport.requests.length, 4);
  equal(new URL(proxyTransport.requests[0]!.url).pathname, "/cgi-bin/token");
  equal(new URL(proxyTransport.requests[1]!.url).pathname, "/cgi-bin/material/add_material");
  equal(new URL(proxyTransport.requests[2]!.url).pathname, "/cgi-bin/media/uploadimg");
  equal(new URL(proxyTransport.requests[3]!.url).pathname, "/cgi-bin/draft/add");
});

test("Weixin direct connector remains direct when no HTTP proxy is configured", async () => {
  const transport = new RecordingTransport({ access_token: "token", expires_in: 7200 });
  const clients = createStandaloneConnectorClients(weixinOfficialAccountConnector, {
    id: "weixin-direct",
    settings: {},
    credentials: { appId: "wx-app", appSecret: "wx-secret" },
    transport,
    proxyTransportFactory() {
      throw new Error("proxy transport was not expected");
    },
  });

  await clients.weixin!.check();
  equal(transport.requests.length, 1);
});

test("Weixin Relay confirms the exact cover bytes before accepting an upload", async () => {
  const bytes = new TextEncoder().encode("generated-cover");
  const checksum = await sha256(bytes);
  const transport = new RecordingTransport({
    success: true,
    data: { mediaId: "cover-media", receivedChecksum: checksum },
  });
  const clients = createStandaloneConnectorClients(weixinRelayConnector, {
    id: "weixin-relay",
    settings: { relayUrl: "https://relay.example.com" },
    credentials: { relayToken: "relay-secret", appId: "wx-app", appSecret: "wx-secret" },
    transport,
  });

  equal(
    await clients.weixin!.uploadCover({ bytes, mimeType: "image/jpeg", filename: "cover.jpg" }),
    "cover-media",
  );
  const body = JSON.parse(transport.requests[0]!.body as string);
  equal(body.payload.checksum, checksum);
  equal(body.payload.imageBufferBase64, btoa("generated-cover"));
});

test("Weixin Relay connection check rejects a stale protocol", async () => {
  const clients = createStandaloneConnectorClients(weixinRelayConnector, {
    id: "weixin-relay-check",
    settings: { relayUrl: "https://relay.example.com" },
    credentials: { relayToken: "relay-secret", appId: "wx-app", appSecret: "wx-secret" },
    transport: new RecordingTransport({ success: true, data: { result: true } }),
  });

  await rejects(() => clients.weixin!.check(), /Relay 版本过旧/);
});

test("Weixin Relay confirms the cover media id used to create a draft", async () => {
  const transport = new RecordingTransport({
    success: true,
    data: { mediaId: "draft-media", coverMediaId: "cover-media" },
  });
  const clients = createStandaloneConnectorClients(weixinRelayConnector, {
    id: "weixin-relay-draft",
    settings: { relayUrl: "https://relay.example.com" },
    credentials: { relayToken: "relay-secret", appId: "wx-app", appSecret: "wx-secret" },
    transport,
  });

  const draft = await clients.weixin!.createDraft({
    title: "标题",
    digest: "摘要",
    contentHtml: "<p>正文</p>",
    coverMediaId: "cover-media",
  });

  equal(draft.mediaId, "draft-media");
  equal(JSON.parse(transport.requests[0]!.body as string).payload.coverMediaId, "cover-media");
});

test("Weixin Relay rejects an upload without an exact asset receipt", async () => {
  const clients = createStandaloneConnectorClients(weixinRelayConnector, {
    id: "weixin-relay-stale",
    settings: { relayUrl: "https://relay.example.com" },
    credentials: { relayToken: "relay-secret", appId: "wx-app", appSecret: "wx-secret" },
    transport: new RecordingTransport({ success: true, data: { mediaId: "old-cover" } }),
  });

  await rejects(
    () =>
      clients.weixin!.uploadCover({
        bytes: new TextEncoder().encode("new-cover"),
        mimeType: "image/jpeg",
        filename: "cover.jpg",
      }),
    /未确认收到本次上传的图片/,
  );
});

test("source connectors expose separate search and fetch capabilities", async () => {
  const auto = sourceConnectors.find((definition) => definition.id === "auto")!;
  const jina = sourceConnectors.find((definition) => definition.id === "jina")!;
  const jinaSearch = sourceConnectors.find((definition) => definition.id === "jina-search")!;
  deepStrictEqual(auto.capabilities, ["source-fetch"]);
  deepStrictEqual(jina.capabilities, ["source-fetch"]);
  deepStrictEqual(jinaSearch.capabilities, ["source-search"]);
  deepStrictEqual(jina.credentialsSchema.parse({}), {});
  equal(jina.fields.find((field) => field.key === "apiKey")?.required, false);
  throws(() => jinaSearch.credentialsSchema.parse({}), /apiKey/);

  const clients = createStandaloneConnectorClients(auto, {
    id: "auto-source",
    settings: {},
    credentials: {},
    transport: new RecordingTransport("unused"),
  });
  equal(typeof clients["source-fetch"]!.fetch, "function");
  equal(clients["source-search"], undefined);
});

test("notification connector rejects provider-level errors", async () => {
  const transport = new RecordingTransport({ errcode: 310000, errmsg: "invalid webhook" });
  const clients = createStandaloneConnectorClients(dingTalkConnector, {
    id: "notify",
    settings: {},
    credentials: { webhook: "https://oapi.dingtalk.com/robot/send?access_token=x" },
    transport,
  });

  await rejects(
    () => clients.notification!.send({ title: "Run", content: "failed" }),
    /invalid webhook/,
  );
  equal(transport.requests.length, 1);
});

class RecordingTransport implements HttpTransport {
  readonly requests: HttpRequest[] = [];

  constructor(private readonly response: unknown) {}

  async send(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    return new HttpResponse(
      200,
      new Headers({ "content-type": "application/json" }),
      new TextEncoder().encode(JSON.stringify(this.response)),
    );
  }
}

class QueueRecordingTransport implements HttpTransport {
  readonly requests: HttpRequest[] = [];

  constructor(private readonly responses: unknown[]) {}

  async send(request: HttpRequest): Promise<HttpResponse> {
    this.requests.push(request);
    const response = this.responses.shift();
    return new HttpResponse(
      200,
      new Headers({ "content-type": "application/json" }),
      new TextEncoder().encode(JSON.stringify(response)),
    );
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
}

class StreamingTransport implements HttpTransport {
  readonly requests: HttpRequest[] = [];
  cancellations = 0;

  constructor(
    private readonly chunks: string[],
    private readonly failure?: Error,
    private readonly closeAfterChunks = true,
  ) {}

  send(): Promise<HttpResponse> {
    throw new Error("buffered request was not expected");
  }

  stream(request: HttpRequest): Promise<HttpStreamResponse> {
    this.requests.push(request);
    const chunks = this.chunks;
    const failure = this.failure;
    const closeAfterChunks = this.closeAfterChunks;
    const recordCancellation = () => {
      this.cancellations += 1;
    };
    let index = 0;
    return Promise.resolve(
      new HttpStreamResponse(
        200,
        new Headers({ "content-type": "text/event-stream" }),
        new ReadableStream({
          pull(controller) {
            const chunk = chunks[index];
            if (chunk !== undefined) {
              index += 1;
              controller.enqueue(new TextEncoder().encode(chunk));
              return;
            }
            if (failure) controller.error(failure);
            else if (closeAfterChunks) controller.close();
          },
          cancel() {
            recordCancellation();
          },
        }),
      ),
    );
  }
}
