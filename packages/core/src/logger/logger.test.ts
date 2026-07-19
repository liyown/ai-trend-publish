import { test } from "vite-plus/test";
import { assertEquals } from "../test/assert.ts";
import { addLoggerObserver, clearLoggerObservers, Logger, LogLevel } from "./logger.ts";
import { withLoggerContext } from "./logger-context.ts";

test("Logger mirrors normal logger output to observers", async () => {
  clearLoggerObservers();
  Logger.level = LogLevel.INFO;
  const records: unknown[] = [];
  addLoggerObserver((record) => {
    records.push(record);
  });
  const logger = new Logger("test-logger");

  logger.info("hello", { runId: "run-1" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const record = records[0] as {
    levelName: string;
    category: string;
    message: string;
    context: { runId: string };
    runId: string;
  };
  assertEquals(record.levelName, "INFO");
  assertEquals(record.category, "test-logger");
  assertEquals(record.message, "hello");
  assertEquals(record.context.runId, "run-1");
  assertEquals(record.runId, "run-1");
  clearLoggerObservers();
});

test("Logger observes async run context without changing call sites", async () => {
  clearLoggerObservers();
  Logger.level = LogLevel.INFO;
  const records: unknown[] = [];
  addLoggerObserver((record) => {
    records.push(record);
  });

  await withLoggerContext({ runId: "run-ctx", step: "rank" }, async () => {
    new Logger("test-logger").warn("from workflow");
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  const record = records[0] as {
    runId: string;
    step: string;
    message: string;
  };
  assertEquals(record.runId, "run-ctx");
  assertEquals(record.step, "rank");
  assertEquals(record.message, "from workflow");
  clearLoggerObservers();
});

test("Logger respects upstream log level before observing", async () => {
  clearLoggerObservers();
  Logger.level = LogLevel.WARN;
  const records: unknown[] = [];
  addLoggerObserver((record) => {
    records.push(record);
  });

  new Logger("test-logger").info("hidden");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assertEquals(records.length, 0);
  Logger.level = LogLevel.INFO;
  clearLoggerObservers();
});
