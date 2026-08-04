import { addLoggerObserver, clearLoggerObservers, LoggerRecord } from "./logger.ts";
import {
  DefaultObservabilityLogger,
  HttpObservabilitySink,
  StdoutObservabilitySink,
} from "../observability/observability.ts";
import type { ObservabilityLevel, ObservabilitySink } from "../ports/observability.ts";
import type { ResolvedTrendPublishConfig } from "../utils/config/define-config.ts";

export function configureLoggerObservability(config: ResolvedTrendPublishConfig): void {
  clearLoggerObservers();
  if (!config.observability.enabled) return;

  const sinks: ObservabilitySink[] = [];
  if (config.observability.stdout.enabled) {
    sinks.push(new StdoutObservabilitySink(config.observability.stdout.format === "pretty"));
  }
  if (config.observability.http.enabled && config.observability.http.endpoint) {
    sinks.push(
      new HttpObservabilitySink({
        endpoint: config.observability.http.endpoint,
        bearerToken: config.observability.http.bearerToken,
        headers: config.observability.http.headers,
        format: config.observability.http.format,
        timeoutMs: config.observability.http.timeoutMs,
      }),
    );
  }
  if (
    config.observability.axiom.enabled &&
    config.observability.axiom.dataset &&
    config.observability.axiom.token
  ) {
    const apiUrl = config.observability.axiom.apiUrl.replace(/\/+$/, "");
    sinks.push(
      new HttpObservabilitySink({
        endpoint: `${apiUrl}/v1/datasets/${encodeURIComponent(
          config.observability.axiom.dataset,
        )}/ingest`,
        bearerToken: config.observability.axiom.token,
        format: "array",
        timeoutMs: config.observability.axiom.timeoutMs,
      }),
    );
  }
  if (config.observability.betterStack.enabled && config.observability.betterStack.sourceToken) {
    sinks.push(
      new HttpObservabilitySink({
        endpoint: config.observability.betterStack.ingestingHost,
        bearerToken: config.observability.betterStack.sourceToken,
        format: "object",
        timeoutMs: config.observability.betterStack.timeoutMs,
      }),
    );
  }
  if (sinks.length === 0) return;

  const observability = new DefaultObservabilityLogger({
    service: config.observability.serviceName,
    environment: config.observability.environment,
    sinks,
  });

  addLoggerObserver((record) =>
    observability.event({
      level: mapLevel(record),
      kind: "log",
      event: `log.${record.levelName.toLowerCase()}`,
      runId: record.runId,
      profileId: record.profileId,
      mode: record.mode,
      dryRun: record.dryRun,
      trigger: record.trigger,
      step: record.step,
      message: record.message,
      attributes: {
        category: record.category,
        workflowId: record.workflowId,
        context: record.context,
        formatted: record.formatted,
      },
    }),
  );
}

function mapLevel(record: LoggerRecord): ObservabilityLevel {
  switch (record.levelName) {
    case "DEBUG":
      return "debug";
    case "WARN":
      return "warn";
    case "ERROR":
    case "FATAL":
      return "error";
    case "INFO":
    default:
      return "info";
  }
}
