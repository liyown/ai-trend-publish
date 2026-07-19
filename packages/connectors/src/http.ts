import {
  ConnectorError,
  ConnectorOutcome,
  connectorErrorFromStatus,
  describeConnectorError,
} from "./errors.ts";
import type {
  CallContext,
  ConnectorOperation,
  JsonObject,
  JsonValue,
  RequestOverrides,
} from "./types.ts";

export interface HttpRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: BodyInit | null;
}

export class HttpResponse {
  constructor(
    readonly status: number,
    readonly headers: Headers,
    private readonly bytes: Uint8Array,
    readonly statusText = "",
  ) {}

  get ok(): boolean {
    return this.status >= 200 && this.status < 300;
  }

  text(): string {
    return new TextDecoder().decode(this.bytes);
  }

  json<T = JsonValue>(): T {
    const text = this.text();
    if (!text.trim()) return undefined as T;
    try {
      return JSON.parse(text) as T;
    } catch (cause) {
      throw new ConnectorError({
        kind: "invalid_response",
        message: "外部服务返回了无效 JSON",
        cause,
      });
    }
  }

  arrayBuffer(): ArrayBuffer {
    return this.bytes.slice().buffer as ArrayBuffer;
  }
}

export interface TransportContext {
  signal?: AbortSignal;
  traceId?: string;
}

export interface HttpTransport {
  send(request: HttpRequest, context: TransportContext): Promise<HttpResponse>;
  stream?(request: HttpRequest, context: TransportContext): Promise<HttpStreamResponse>;
}

export class HttpStreamResponse {
  constructor(
    readonly status: number,
    readonly headers: Headers,
    readonly body: ReadableStream<Uint8Array>,
    readonly statusText = "",
    private readonly semanticOutcome?: HttpStreamSemanticOutcome,
  ) {}

  /**
   * Confirms that the consumer parsed and validated the whole response successfully.
   * Transport EOF alone is not enough to complete a streamed connector operation.
   */
  finalize(): void {
    this.semanticOutcome?.finalize();
  }

  /**
   * Rejects a stream after protocol or provider validation and returns the contextual error
   * that the consumer must throw.
   */
  fail(error: unknown): ConnectorError {
    return this.semanticOutcome?.fail(error) ?? normalizeStreamReadError(error);
  }
}

interface HttpStreamSemanticOutcome {
  finalize(): void;
  fail(error: unknown): ConnectorError;
}

export class FetchHttpTransport implements HttpTransport {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async send(request: HttpRequest, context: TransportContext): Promise<HttpResponse> {
    const response = await this.fetch(request, context);

    const result = new HttpResponse(
      response.status,
      response.headers,
      new Uint8Array(await response.arrayBuffer()),
      response.statusText,
    );
    if (!result.ok) {
      const detail = redactHttpDetail(result.text().trim()).slice(0, 4_000);
      const requestId = responseRequestId(result.headers);
      const statusLabel = [result.status, result.statusText].filter(Boolean).join(" ");
      const error = connectorErrorFromStatus(
        result.status,
        [
          `外部服务返回 HTTP ${statusLabel}`,
          `请求：${(request.method ?? "GET").toUpperCase()} ${safeRequestUrl(request.url)}`,
          ...(requestId ? [`请求 ID：${requestId}`] : []),
          ...(detail ? [`响应：${detail}`] : []),
        ].join("\n"),
      );
      throw error.withContext({ requestId });
    }
    return result;
  }

  async stream(request: HttpRequest, context: TransportContext): Promise<HttpStreamResponse> {
    const response = await this.fetch(request, context);
    if (!response.ok) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      throw httpStatusError(
        request,
        new HttpResponse(response.status, response.headers, bytes, response.statusText),
      );
    }
    if (!response.body) {
      throw new ConnectorError({
        kind: "invalid_response",
        message: "外部服务没有返回可读取的响应流",
      });
    }
    return new HttpStreamResponse(
      response.status,
      response.headers,
      response.body,
      response.statusText,
    );
  }

  private async fetch(request: HttpRequest, context: TransportContext): Promise<Response> {
    try {
      return await this.fetcher(request.url, {
        method: request.method ?? "GET",
        headers: request.headers,
        body: request.body,
        signal: context.signal,
      });
    } catch (cause) {
      const timedOut =
        context.signal?.aborted &&
        (context.signal.reason instanceof DOMException
          ? context.signal.reason.name === "TimeoutError"
          : false);
      throw new ConnectorError({
        kind: timedOut ? "timeout" : "network",
        message: timedOut ? "外部服务请求超时" : "无法连接外部服务",
        retryable: true,
        outcome: ConnectorOutcome.Unknown,
        cause,
      });
    }
  }
}

export interface ConnectorObserver {
  onOperationStart?(event: OperationEvent): void;
  onOperationEnd?(event: OperationEndEvent): void;
}

export interface OperationEvent {
  connectorId: string;
  connectionId: string;
  operation: ConnectorOperation;
  traceId?: string;
  taskId?: string;
  startedAt: number;
}

export interface OperationEndEvent extends OperationEvent {
  durationMs: number;
  success: boolean;
  statusCode?: number;
  errorKind?: string;
}

export class ConnectorExecutor {
  constructor(
    private readonly connectorId: string,
    private readonly connectionId: string,
    private readonly transport: HttpTransport,
    private readonly observer?: ConnectorObserver,
  ) {}

  async send(
    operation: ConnectorOperation,
    request: HttpRequest,
    context: CallContext = {},
  ): Promise<HttpResponse> {
    const startedAt = Date.now();
    const event: OperationEvent = {
      connectorId: this.connectorId,
      connectionId: this.connectionId,
      operation,
      traceId: context.traceId,
      taskId: context.taskId,
      startedAt,
    };
    this.observer?.onOperationStart?.(event);

    try {
      const response = await this.transport.send(request, {
        signal: context.signal,
        traceId: context.traceId,
      });
      this.observer?.onOperationEnd?.({
        ...event,
        durationMs: Date.now() - startedAt,
        success: true,
        statusCode: response.status,
      });
      return response;
    } catch (error) {
      const normalized = addConnectorContext(error, this.connectorId, this.connectionId, operation);
      this.observer?.onOperationEnd?.({
        ...event,
        durationMs: Date.now() - startedAt,
        success: false,
        statusCode: normalized.statusCode,
        errorKind: normalized.kind,
      });
      throw normalized;
    }
  }

  async stream(
    operation: ConnectorOperation,
    request: HttpRequest,
    context: CallContext = {},
  ): Promise<HttpStreamResponse> {
    const startedAt = Date.now();
    const event: OperationEvent = {
      connectorId: this.connectorId,
      connectionId: this.connectionId,
      operation,
      traceId: context.traceId,
      taskId: context.taskId,
      startedAt,
    };
    this.observer?.onOperationStart?.(event);
    let operationEnded = false;
    let semanticFinalized = false;
    const endOperation = (result: {
      success: boolean;
      statusCode?: number;
      errorKind?: string;
    }) => {
      if (operationEnded) return;
      operationEnded = true;
      this.observer?.onOperationEnd?.({
        ...event,
        durationMs: Date.now() - startedAt,
        ...result,
      });
    };
    const failOperation = (error: unknown): ConnectorError => {
      const normalized = addConnectorContext(
        normalizeStreamReadError(error, context.signal),
        this.connectorId,
        this.connectionId,
        operation,
      );
      endOperation({
        success: false,
        statusCode: normalized.statusCode,
        errorKind: normalized.kind,
      });
      return normalized;
    };

    try {
      if (!this.transport.stream) {
        throw new ConnectorError({
          kind: "configuration",
          message: "当前 HTTP Transport 不支持流式响应",
        });
      }
      const response = await this.transport.stream(request, context);
      const source = response.body.getReader();
      const finalizeOperation = () => {
        if (semanticFinalized) return;
        semanticFinalized = true;
        endOperation({ success: true, statusCode: response.status });
      };
      const observedBody = new ReadableStream<Uint8Array>(
        {
          async pull(controller) {
            try {
              const chunk = await source.read();
              if (chunk.done) {
                controller.close();
                return;
              }
              controller.enqueue(chunk.value);
            } catch (error) {
              const normalized = failOperation(error);
              controller.error(normalized);
            }
          },
          async cancel(reason) {
            if (semanticFinalized) {
              try {
                await source.cancel(reason);
              } catch {
                // Protocol completion is authoritative. Cancellation only releases the
                // transport and must not turn a completed operation into a failure.
              }
              return;
            }
            try {
              await source.cancel(reason);
            } catch (error) {
              const normalized = failOperation(error);
              throw normalized;
            }
            failOperation(
              reason ??
                new ConnectorError({
                  kind: "network",
                  message: "外部服务响应流在读取完成前被取消",
                  retryable: true,
                  outcome: ConnectorOutcome.Unknown,
                }),
            );
          },
        },
        // Do not read ahead: a consumer must be able to reject a provider error in the last chunk
        // before the transport is reported as successfully completed.
        { highWaterMark: 0 },
      );
      return new HttpStreamResponse(
        response.status,
        response.headers,
        observedBody,
        response.statusText,
        { finalize: finalizeOperation, fail: failOperation },
      );
    } catch (error) {
      const normalized = failOperation(error);
      throw normalized;
    }
  }
}

function normalizeStreamReadError(error: unknown, signal?: AbortSignal): ConnectorError {
  if (error instanceof ConnectorError) return error;
  const timedOut =
    signal?.aborted &&
    (signal.reason instanceof DOMException ? signal.reason.name === "TimeoutError" : false);
  return new ConnectorError({
    kind: timedOut ? "timeout" : "network",
    message: timedOut ? "读取外部服务响应流超时" : "读取外部服务响应流失败",
    retryable: true,
    outcome: ConnectorOutcome.Unknown,
    cause: error,
  });
}

function httpStatusError(request: HttpRequest, result: HttpResponse): ConnectorError {
  const detail = redactHttpDetail(result.text().trim()).slice(0, 4_000);
  const requestId = responseRequestId(result.headers);
  const statusLabel = [result.status, result.statusText].filter(Boolean).join(" ");
  return connectorErrorFromStatus(
    result.status,
    [
      `外部服务返回 HTTP ${statusLabel}`,
      `请求：${(request.method ?? "GET").toUpperCase()} ${safeRequestUrl(request.url)}`,
      ...(requestId ? [`请求 ID：${requestId}`] : []),
      ...(detail ? [`响应：${detail}`] : []),
    ].join("\n"),
  ).withContext({ requestId });
}

const protectedHeaders = new Set(["authorization", "host", "content-length"]);

export function buildConnectorRequest(
  request: HttpRequest,
  overrides: RequestOverrides | undefined,
  credentialHeaders: Record<string, string> = {},
): HttpRequest {
  const url = new URL(request.url);
  for (const [key, value] of Object.entries(overrides?.query ?? {})) {
    url.searchParams.set(key, value);
  }

  const headers = { ...request.headers };
  for (const [key, value] of Object.entries(overrides?.headers ?? {})) {
    if (protectedHeaders.has(key.toLowerCase())) {
      throw new ConnectorError({
        kind: "configuration",
        message: `请求覆盖不允许修改保留 Header：${key}`,
      });
    }
    headers[key] = value;
  }
  Object.assign(headers, credentialHeaders);

  let body = request.body;
  if (overrides?.body) {
    const contentType = findHeader(headers, "content-type");
    if (contentType?.includes("application/json") && typeof body === "string") {
      try {
        const parsed = JSON.parse(body) as unknown;
        if (!isJsonObject(parsed)) throw new Error("not-object");
        body = JSON.stringify(deepMerge(parsed, overrides.body));
      } catch (cause) {
        throw new ConnectorError({
          kind: "configuration",
          message: "只有 JSON 对象请求体可以应用 Body 覆盖",
          cause,
        });
      }
    }
  }

  return { ...request, url: url.toString(), headers, body };
}

function addConnectorContext(
  error: unknown,
  connectorId: string,
  connectionId: string,
  operation: ConnectorOperation,
): ConnectorError {
  const normalized =
    error instanceof ConnectorError
      ? error
      : new ConnectorError({
          kind: "provider",
          message: describeConnectorError(error),
          cause: error,
        });
  if (
    normalized.connectorId === connectorId &&
    normalized.connectionId === connectionId &&
    normalized.capability === operation.capability &&
    normalized.operation === operation.name
  ) {
    return normalized;
  }
  return normalized.withContext({
    message: [
      normalized.message,
      `Connector：${connectorId}`,
      `连接：${connectionId}`,
      `操作：${operation.name}（${operation.capability}）`,
    ].join("\n"),
    connectorId,
    connectionId,
    capability: operation.capability,
    operation: operation.name,
  });
}

function responseRequestId(headers: Headers): string | undefined {
  for (const name of ["x-request-id", "request-id", "x-trace-id", "cf-ray"]) {
    const value = headers.get(name)?.trim();
    if (value) return value.slice(0, 300);
  }
  return undefined;
}

function safeRequestUrl(value: string): string {
  try {
    const url = new URL(value);
    for (const key of url.searchParams.keys()) url.searchParams.set(key, "[REDACTED]");
    return url.toString();
  } catch {
    return "[invalid-url]";
  }
}

function redactHttpDetail(value: string): string {
  return value
    .replace(
      /((?:access_token|api_key|apikey|apiKey|secret|token|password)["'=:\s]+)[^\s"'&,}]+/gi,
      "$1[REDACTED]",
    )
    .replace(/(Authorization\s*[:=]\s*Bearer\s+)[^\s"']+/gi, "$1[REDACTED]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/g, "$1[REDACTED]");
}

function findHeader(headers: Record<string, string>, name: string): string | undefined {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry?.[1];
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge(base: JsonObject, override: JsonObject): JsonObject {
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(override)) {
    const existing = result[key];
    result[key] =
      isJsonObject(existing) && isJsonObject(value)
        ? deepMerge(existing, value)
        : structuredClone(value);
  }
  return result;
}
