import { expect, test } from "vite-plus/test";
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

  expect(await task.run(spec({ value: 1 }), execute)).toEqual({ value: 1 });
  expect(await task.run(spec({ value: 1 }), execute)).toEqual({ value: 1 });
  expect(calls).toBe(1);
});

test("task fingerprint rejects changed input under the same task id", async () => {
  const task = new TaskRunner(new MemoryTaskStore()).forJob("job-1");
  await task.run(spec({ value: 1 }), async () => "first");
  await expect(task.run(spec({ value: 2 }), async () => "second")).rejects.toBeInstanceOf(
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

  expect(
    await task.run(optional, async () => {
      calls += 1;
      throw new Error("image provider unavailable");
    }),
  ).toBe("fallback");
  expect(await task.run(optional, async () => "unexpected")).toBe("fallback");
  expect(calls).toBe(1);
  expect((await store.get("job-1", "example"))?.status).toBe("degraded");
});

test("unsafe unknown outcome is never replayed as a retry", async () => {
  const store = new MemoryTaskStore();
  const task = new TaskRunner(store).forJob("job-1");
  let calls = 0;

  await expect(
    task.run({ ...spec({ package: "p1" }), effect: "unsafe" }, async () => {
      calls += 1;
      throw new UnknownTaskOutcomeError("create draft timed out");
    }),
  ).rejects.toBeInstanceOf(TaskNeedsAttentionError);
  await expect(
    task.run({ ...spec({ package: "p1" }), effect: "unsafe" }, async () => "duplicate"),
  ).rejects.toBeInstanceOf(TaskNeedsAttentionError);
  expect(calls).toBe(1);
});

test("transient tasks stream lifecycle without persisting input or output", async () => {
  const store = new MemoryTaskStore();
  const activities: unknown[] = [];
  const task = new TaskRunner(store, {
    activities: {
      async onTaskActivity(activity) {
        activities.push(activity);
      },
    },
  }).forJob("job-1");
  let calls = 0;
  const transient = { ...spec({ prompt: "private" }), transient: true };

  expect(await task.run(transient, async () => `raw-${++calls}`)).toBe("raw-1");
  expect(await task.run(transient, async () => `raw-${++calls}`)).toBe("raw-2");
  expect(await store.get("job-1", "example")).toBeNull();
  expect(JSON.stringify(activities)).not.toContain("private");
  expect(JSON.stringify(activities)).not.toContain("raw-");
});

function spec(input: unknown) {
  return { id: "example", version: "1", input };
}
