import { deepStrictEqual, equal } from "node:assert/strict";
import { test } from "vite-plus/test";
import { RuntimeEventHub } from "./events.ts";

test("runtime event hub filters and replays bounded job events", () => {
  const hub = new RuntimeEventHub({
    capacity: 3,
    now: () => new Date("2026-07-18T12:00:00.000Z"),
  });
  const received: string[] = [];
  const unsubscribe = hub.subscribe((event) => received.push(event.type), { jobId: "job-1" });

  hub.publish({ type: "job.started", jobId: "job-1" });
  hub.publish({ type: "job.started", jobId: "job-2" });
  hub.publish({ type: "model.response.delta", jobId: "job-1", data: { delta: "A" } });
  hub.publish({ type: "task.succeeded", jobId: "job-1" });
  unsubscribe();

  deepStrictEqual(received, ["job.started", "model.response.delta", "task.succeeded"]);
  const replay = hub.recent({ jobId: "job-1", afterId: "2" });
  deepStrictEqual(
    replay.map((event) => event.type),
    ["model.response.delta", "task.succeeded"],
  );
  equal(replay[0]?.occurredAt, "2026-07-18T12:00:00.000Z");
});

test("runtime event listeners cannot break the publisher", () => {
  const errors: unknown[] = [];
  const hub = new RuntimeEventHub({ onListenerError: (error) => errors.push(error) });
  hub.subscribe(() => {
    throw new Error("broken listener");
  });

  const event = hub.publish({ type: "task.started", jobId: "job-safe" });

  equal(event.type, "task.started");
  equal(errors.length, 1);
});
