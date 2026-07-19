import { deepStrictEqual, equal, rejects } from "node:assert/strict";
import { test } from "vite-plus/test";
import { MemoryTaskStore } from "./memory-task-store.ts";
import { TaskRunner } from "./task-runner.ts";
import {
  TaskFingerprintConflictError,
  TaskNeedsAttentionError,
  UnknownTaskOutcomeError,
} from "./task.ts";

test("completed tasks replay without executing again", async () => {
  const store = new MemoryTaskStore();
  const task = new TaskRunner(store).forJob("job-1");
  let calls = 0;
  const execute = async () => ({ value: ++calls });

  deepStrictEqual(await task.run(spec({ value: 1 }), execute), { value: 1 });
  deepStrictEqual(await task.run(spec({ value: 1 }), execute), { value: 1 });
  equal(calls, 1);
});

test("task fingerprint rejects changed input under the same task id", async () => {
  const task = new TaskRunner(new MemoryTaskStore()).forJob("job-1");
  await task.run(spec({ value: 1 }), async () => "first");
  await rejects(
    () => task.run(spec({ value: 2 }), async () => "second"),
    TaskFingerprintConflictError,
  );
});

test("optional task failure is checkpointed as degraded", async () => {
  const store = new MemoryTaskStore();
  const task = new TaskRunner(store).forJob("job-1");
  let calls = 0;
  const optional = {
    ...spec({ value: 1 }),
    optional: true,
    fallback: () => "fallback",
  };

  equal(
    await task.run(optional, async () => {
      calls += 1;
      throw new Error("image provider unavailable");
    }),
    "fallback",
  );
  equal(await task.run(optional, async () => "unexpected"), "fallback");
  equal(calls, 1);
  equal((await store.get("job-1", "example"))?.status, "degraded");
});

test("unsafe unknown outcome is never replayed as a retry", async () => {
  const store = new MemoryTaskStore();
  const task = new TaskRunner(store).forJob("job-1");
  let calls = 0;

  await rejects(
    () =>
      task.run({ ...spec({ package: "p1" }), effect: "unsafe" }, async () => {
        calls += 1;
        throw new UnknownTaskOutcomeError("create draft timed out");
      }),
    TaskNeedsAttentionError,
  );
  await rejects(
    () => task.run({ ...spec({ package: "p1" }), effect: "unsafe" }, async () => "duplicate"),
    TaskNeedsAttentionError,
  );
  equal(calls, 1);
});

function spec(input: unknown) {
  return { id: "example", version: "1", input };
}
