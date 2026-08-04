import { z } from "zod";
import { ConnectorError } from "../errors.ts";
import { defineConnector, type ConnectorCreateContext } from "../definition.ts";
import type {
  ChatClient,
  ChatInput,
  ChatOutput,
  ChatToolCall,
  CallContext,
  EmbeddingClient,
  EmbeddingInput,
  EmbeddingOutput,
  JsonObject,
} from "../types.ts";

const settingsSchema = z.object({
  baseUrl: z.string().url(),
  model: z.string().min(1),
});

const credentialsSchema = z.object({
  apiKey: z.string().min(1),
});

type Settings = z.infer<typeof settingsSchema>;
type Credentials = z.infer<typeof credentialsSchema>;

const chatOperation = {
  name: "chat.complete",
  capability: "chat",
} as const;
const embeddingOperation = {
  name: "embedding.embed",
  capability: "embedding",
} as const;
const checkOperation = {
  name: "connection.check",
  capability: "chat",
} as const;

export const openAICompatibleConnector = defineConnector({
  id: "openai-compatible",
  version: 1,
  displayName: "OpenAI Compatible",
  description: "兼容 OpenAI Chat Completions 和 Embeddings 协议的模型服务。",
  capabilities: ["chat", "tool-calling", "embedding"],
  settingsSchema,
  credentialsSchema,
  fields: [
    {
      key: "baseUrl",
      location: "settings",
      label: "API 地址",
      input: "url",
      required: true,
      placeholder: "https://api.example.com/v1",
      order: 10,
    },
    {
      key: "model",
      location: "settings",
      label: "默认模型",
      input: "text",
      required: true,
      order: 20,
    },
    {
      key: "apiKey",
      location: "credentials",
      label: "API Key",
      input: "password",
      required: true,
      order: 30,
    },
  ],
  requestOverrides: true,
  create(context) {
    return {
      chat: new OpenAICompatibleChatClient(context),
      embedding: new OpenAICompatibleEmbeddingClient(context),
    };
  },
  async check(context, signal) {
    await context.execute(
      checkOperation,
      { url: joinUrl(context.settings.baseUrl, "models"), method: "GET" },
      { signal },
      authorization(context.credentials.apiKey),
    );
    return "连接成功，模型服务可访问";
  },
});

class OpenAICompatibleChatClient implements ChatClient {
  constructor(private readonly context: ConnectorCreateContext<Settings, Credentials>) {}

  async complete(input: ChatInput, callContext: CallContext = {}): Promise<ChatOutput> {
    const body: JsonObject = {
      model: input.model ?? this.context.settings.model,
      messages: input.messages.map(openAIMessage),
    };
    if (input.temperature !== undefined) body.temperature = input.temperature;
    if (input.topP !== undefined) body.top_p = input.topP;
    if (input.maxTokens !== undefined) body.max_tokens = input.maxTokens;
    if (input.responseFormat) {
      body.response_format = { type: input.responseFormat === "json" ? "json_object" : "text" };
    }
    if (input.tools?.length) {
      body.tools = input.tools.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      }));
      body.tool_choice =
        typeof input.toolChoice === "object"
          ? { type: "function", function: { name: input.toolChoice.name } }
          : (input.toolChoice ?? "auto");
    }
    if (callContext.onEvent) return await this.completeStreaming(body, callContext);
    const response = await this.context.execute(
      chatOperation,
      {
        url: joinUrl(this.context.settings.baseUrl, "chat/completions"),
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      callContext,
      authorization(this.context.credentials.apiKey),
    );
    const data = response.json<OpenAIChatResponse>();
    const message = data.choices?.[0]?.message;
    const content = typeof message?.content === "string" ? message.content : "";
    const toolCalls = normalizeToolCalls(message?.tool_calls);
    if (!content && !toolCalls.length) {
      throw new ConnectorError({
        kind: "invalid_response",
        message: "模型服务未返回消息或工具调用",
      });
    }
    return {
      content,
      ...(toolCalls.length ? { toolCalls } : {}),
      model: data.model,
      usage: data.usage
        ? {
            inputTokens: data.usage.prompt_tokens,
            outputTokens: data.usage.completion_tokens,
            totalTokens: data.usage.total_tokens,
          }
        : undefined,
      raw: data as unknown as JsonObject,
    };
  }

  private async completeStreaming(body: JsonObject, callContext: CallContext): Promise<ChatOutput> {
    body.stream = true;
    const response = await this.context.executeStream(
      chatOperation,
      {
        url: joinUrl(this.context.settings.baseUrl, "chat/completions"),
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
        body: JSON.stringify(body),
      },
      callContext,
      authorization(this.context.credentials.apiKey),
    );
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let pending = "";
    let content = "";
    let model: string | undefined;
    let usage: ChatOutput["usage"];
    const streamedToolCalls = new Map<number, ChatToolCall>();
    let started = false;
    let terminated = false;
    let eventName = "";
    let eventData: string[] = [];

    const consumeEvent = (payload: string, currentEventName: string) => {
      if (!payload || terminated) return;
      if (payload === "[DONE]") {
        terminated = true;
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload) as unknown;
      } catch (cause) {
        throw new ConnectorError({
          kind: "invalid_response",
          message: "模型服务返回了无效的 SSE 数据",
          cause,
        });
      }
      const providerError = providerStreamError(parsed, currentEventName);
      if (providerError) throw providerError;
      if (!isRecord(parsed)) {
        throw new ConnectorError({
          kind: "invalid_response",
          message: "模型服务返回了无效的 SSE 数据",
        });
      }
      const chunk = parsed as OpenAIChatChunk;
      model = chunk.model ?? model;
      if (!started) {
        started = true;
        callContext.onEvent?.({ type: "response.started", model });
      }
      const choice = chunk.choices?.[0];
      const delta = choice?.delta?.content;
      if (typeof delta === "string" && delta) {
        content += delta;
        callContext.onEvent?.({
          type: "response.delta",
          delta,
          accumulatedCharacters: content.length,
        });
      }
      for (const toolCall of choice?.delta?.tool_calls ?? []) {
        const index = toolCall.index ?? 0;
        const current = streamedToolCalls.get(index) ?? { id: "", name: "", arguments: "" };
        const next = {
          id: toolCall.id ?? current.id,
          name: toolCall.function?.name ?? current.name,
          arguments: current.arguments + (toolCall.function?.arguments ?? ""),
        };
        streamedToolCalls.set(index, next);
        callContext.onEvent?.({
          type: "response.tool_delta",
          index,
          ...(next.id ? { id: next.id } : {}),
          ...(next.name ? { name: next.name } : {}),
          argumentsDelta: toolCall.function?.arguments ?? "",
          accumulatedArguments: next.arguments,
        });
      }
      if (
        chunk.choices?.some(
          (candidate) =>
            typeof candidate.finish_reason === "string" && candidate.finish_reason.trim(),
        )
      ) {
        terminated = true;
      }
      if (chunk.usage) {
        usage = {
          inputTokens: chunk.usage.prompt_tokens,
          outputTokens: chunk.usage.completion_tokens,
          totalTokens: chunk.usage.total_tokens,
        };
      }
    };

    const flushEvent = () => {
      const currentEventName = eventName;
      const payload = eventData.join("\n").trim();
      eventName = "";
      eventData = [];
      if (payload) consumeEvent(payload, currentEventName);
    };

    const consumeLine = (rawLine: string) => {
      const line = rawLine;
      if (!line) {
        flushEvent();
        return;
      }
      if (line.startsWith(":")) return;
      const separator = line.indexOf(":");
      const field = separator < 0 ? line : line.slice(0, separator);
      let value = separator < 0 ? "" : line.slice(separator + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (field === "event") eventName = value;
      if (field === "data") eventData.push(value);
    };

    const consumePendingLines = (final = false) => {
      let lineStart = 0;
      for (let index = 0; index < pending.length; index += 1) {
        const character = pending[index];
        if (character !== "\r" && character !== "\n") continue;
        if (character === "\r" && index === pending.length - 1 && !final) break;

        consumeLine(pending.slice(lineStart, index));
        if (character === "\r" && pending[index + 1] === "\n") index += 1;
        lineStart = index + 1;
      }
      pending = pending.slice(lineStart);
      if (final && pending) {
        consumeLine(pending);
        pending = "";
      }
    };

    try {
      while (!terminated) {
        const { value, done } = await reader.read();
        if (done) {
          pending += decoder.decode();
          consumePendingLines(true);
          flushEvent();
          break;
        }
        pending += decoder.decode(value, { stream: true });
        consumePendingLines();
      }
      if (!terminated) {
        throw new ConnectorError({
          kind: "invalid_response",
          message: "模型服务响应流在完成标记前已结束",
        });
      }
      const toolCalls = [...streamedToolCalls.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, call]) => call);
      if (!content && !toolCalls.length) {
        throw new ConnectorError({
          kind: "invalid_response",
          message: "模型服务未返回消息或工具调用",
        });
      }
      callContext.onEvent?.({
        type: "response.completed",
        model,
        usage,
        accumulatedCharacters: content.length,
      });
      response.finalize();
      await reader.cancel();
    } catch (error) {
      const streamError =
        error instanceof ConnectorError
          ? error
          : new ConnectorError({
              kind: "invalid_response",
              message: "读取模型服务响应流失败",
              cause: error,
            });
      const normalized = response.fail(streamError);
      try {
        await reader.cancel(normalized);
      } catch {
        // A stream that already failed rejects cancellation with the original error.
      }
      throw normalized;
    } finally {
      reader.releaseLock();
    }
    const toolCalls = [...streamedToolCalls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, call]) => call);
    return { content, ...(toolCalls.length ? { toolCalls } : {}), model, usage };
  }
}

class OpenAICompatibleEmbeddingClient implements EmbeddingClient {
  constructor(private readonly context: ConnectorCreateContext<Settings, Credentials>) {}

  async embed(input: EmbeddingInput, callContext = {}): Promise<EmbeddingOutput> {
    const body: JsonObject = {
      model: input.model ?? this.context.settings.model,
      input: Array.isArray(input.input) ? input.input : input.input,
    };
    if (input.dimensions !== undefined) body.dimensions = input.dimensions;
    if (input.encodingFormat !== undefined) body.encoding_format = input.encodingFormat;
    const response = await this.context.execute(
      embeddingOperation,
      {
        url: joinUrl(this.context.settings.baseUrl, "embeddings"),
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
      callContext,
      authorization(this.context.credentials.apiKey),
    );
    const data = response.json<OpenAIEmbeddingResponse>();
    const embeddings = data.data?.map((item) => item.embedding).filter(Array.isArray) ?? [];
    if (!embeddings.length) {
      throw new ConnectorError({ kind: "invalid_response", message: "Embedding 服务未返回向量" });
    }
    return {
      embeddings,
      model: data.model,
      usage: data.usage ? { tokens: data.usage.total_tokens } : undefined,
      raw: data as unknown as JsonObject,
    };
  }
}

interface OpenAIChatResponse {
  model?: string;
  choices?: Array<{
    message?: { content?: string | null; tool_calls?: OpenAIToolCall[] };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

interface OpenAIChatChunk {
  model?: string;
  choices?: Array<{
    delta?: {
      content?: string | null;
      tool_calls?: Array<{
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: OpenAIChatResponse["usage"];
}

interface OpenAIToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string };
}

interface OpenAIEmbeddingResponse {
  model?: string;
  data?: Array<{ embedding: number[] }>;
  usage?: { total_tokens?: number };
}

function authorization(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` };
}

function openAIMessage(message: ChatInput["messages"][number]): JsonObject {
  if (message.role === "tool") {
    return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
  }
  if (message.role === "assistant") {
    return {
      role: "assistant",
      content: message.content ?? null,
      ...(message.toolCalls?.length
        ? {
            tool_calls: message.toolCalls.map((call) => ({
              id: call.id,
              type: "function",
              function: { name: call.name, arguments: call.arguments },
            })),
          }
        : {}),
    };
  }
  return { role: message.role, content: message.content };
}

function normalizeToolCalls(value: OpenAIToolCall[] | undefined): ChatToolCall[] {
  return (value ?? []).map((call, index) => {
    const id = call.id?.trim();
    const name = call.function?.name?.trim();
    if (!id || !name) {
      throw new ConnectorError({
        kind: "invalid_response",
        message: `模型服务返回了无效的工具调用 ${index + 1}`,
      });
    }
    return { id, name, arguments: call.function?.arguments ?? "{}" };
  });
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function providerStreamError(payload: unknown, eventName: string): ConnectorError | undefined {
  if (!isRecord(payload)) {
    if (eventName !== "error") return undefined;
    return new ConnectorError({
      kind: "provider",
      message: `模型服务流式响应失败：${providerErrorText(payload) ?? "未知错误"}`,
      cause: payload,
    });
  }
  const errorPayload = payload.error;
  if ((errorPayload === undefined || errorPayload === null) && eventName !== "error") {
    return undefined;
  }
  const detail = errorPayload ?? payload;
  const message =
    providerErrorText(detail) ?? providerErrorText(payload.message) ?? "模型服务返回了未知错误";
  const providerCode = providerErrorCode(detail) ?? providerErrorCode(payload);
  return new ConnectorError({
    kind: "provider",
    message: `模型服务流式响应失败：${message}`,
    providerCode,
    cause: payload,
  });
}

function providerErrorText(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim().slice(0, 2_000) || undefined;
  if (!isRecord(value)) return undefined;
  for (const key of ["message", "msg", "detail", "error"]) {
    const text = providerErrorText(value[key]);
    if (text) return text;
  }
  return undefined;
}

function providerErrorCode(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of ["code", "type"]) {
    const code = value[key];
    if (typeof code === "string" || typeof code === "number") return String(code).slice(0, 300);
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
