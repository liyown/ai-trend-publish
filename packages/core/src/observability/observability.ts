import type {
  ObservabilityEvent,
  ObservabilityLogger,
  ObservabilitySink,
} from "../ports/observability.ts";
import { redactSensitiveText } from "../utils/security/redact.ts";

export interface ObservabilityLoggerOptions {
  service: string;
  environment: string;
  sinks: ObservabilitySink[];
}

export class DefaultObservabilityLogger implements ObservabilityLogger {
  constructor(private readonly options: ObservabilityLoggerOptions) {}

  async event(
    event: Omit<ObservabilityEvent, "timestamp" | "service" | "environment">,
  ): Promise<void> {
    if (this.options.sinks.length === 0) return;
    const payload: ObservabilityEvent = {
      ...event,
      timestamp: new Date().toISOString(),
      service: this.options.service,
      environment: this.options.environment,
    };
    await Promise.allSettled(this.options.sinks.map((sink) => sink.emit(payload)));
  }

  async flush(): Promise<void> {
    await Promise.allSettled(this.options.sinks.map((sink) => sink.flush?.() ?? Promise.resolve()));
  }
}

export class StdoutObservabilitySink implements ObservabilitySink {
  constructor(private readonly pretty = false) {}

  async emit(event: ObservabilityEvent): Promise<void> {
    const payload = sanitizeEvent(event);
    if (this.pretty) {
      console.log(
        `[obs] ${payload.level} ${payload.event} ${
          payload.runId ? `run=${payload.runId}` : ""
        } ${payload.step ? `step=${payload.step}` : ""}`,
      );
      return;
    }
    console.log(JSON.stringify(payload));
  }
}

export interface HttpObservabilitySinkOptions {
  endpoint: string;
  headers?: Record<string, string>;
  bearerToken?: string;
  format?: "object" | "array" | "ndjson";
  timeoutMs?: number;
}

export class HttpObservabilitySink implements ObservabilitySink {
  constructor(private readonly options: HttpObservabilitySinkOptions) {}

  async emit(event: ObservabilityEvent): Promise<void> {
    if (!this.options.endpoint) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 5000);
    try {
      await fetch(this.options.endpoint, {
        method: "POST",
        headers: {
          "Content-Type":
            this.options.format === "ndjson" ? "application/x-ndjson" : "application/json",
          ...this.options.headers,
          ...(this.options.bearerToken
            ? { Authorization: `Bearer ${this.options.bearerToken}` }
            : {}),
        },
        body: formatPayload(sanitizeEvent(event), this.options.format),
        signal: controller.signal,
      });
    } catch (error) {
      console.warn("[observability] failed to emit HTTP event:", redactSensitiveText(error));
    } finally {
      clearTimeout(timeout);
    }
  }
}

function sanitizeEvent(event: ObservabilityEvent): ObservabilityEvent {
  return JSON.parse(redactSensitiveText(event)) as ObservabilityEvent;
}

function formatPayload(
  event: ObservabilityEvent,
  format: HttpObservabilitySinkOptions["format"] = "object",
): string {
  if (format === "array") return JSON.stringify([event]);
  if (format === "ndjson") return `${JSON.stringify(event)}\n`;
  return JSON.stringify(event);
}
