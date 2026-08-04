import { test } from "vite-plus/test";
import { assertEquals } from "../test/assert.ts";
import { DefaultObservabilityLogger, StdoutObservabilitySink } from "./observability.ts";

test("observability logger enriches and redacts events", async () => {
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (value: unknown) => {
    lines.push(String(value));
  };
  try {
    const logger = new DefaultObservabilityLogger({
      service: "trendpublish-test",
      environment: "test",
      sinks: [new StdoutObservabilitySink()],
    });

    await logger.event({
      level: "info",
      kind: "log",
      event: "log.info",
      runId: "run-1",
      attributes: {
        apiKey: "secret-key",
      },
    });

    const event = JSON.parse(lines[0]);
    assertEquals(event.service, "trendpublish-test");
    assertEquals(event.environment, "test");
    assertEquals(event.runId, "run-1");
    assertEquals(event.attributes.apiKey, "[REDACTED]");
  } finally {
    console.log = originalLog;
  }
});
