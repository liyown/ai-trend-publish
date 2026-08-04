import { expect, test } from "vite-plus/test";
import type { ModelStreamEvent, RunActivity } from "./types.ts";
import { mergeActivities, ModelStreamMemory } from "./use-run-monitor.ts";

test("new lifecycle sequence replaces the same activity instead of leaving it running", () => {
  const running = activity({ sequence: 1, status: "running" });
  const succeeded = activity({ sequence: 2, status: "succeeded" });

  expect(mergeActivities([running], [succeeded])).toEqual([succeeded]);
  expect(mergeActivities([succeeded], [running])).toEqual([succeeded]);
});

test("transient model events survive run switches within the current page memory", () => {
  const memory = new ModelStreamMemory(2, 2);
  const first = modelEvent("run-1", "A");
  const second = modelEvent("run-1", "B");
  memory.remember("run-1", first);
  memory.remember("run-1", second);

  memory.remember("run-2", modelEvent("run-2", "C"));

  expect(memory.read("run-1")).toEqual([first, second]);
  expect(memory.read("run-2")).toHaveLength(1);
});

function activity(patch: Pick<RunActivity, "sequence" | "status">): RunActivity {
  return {
    id: "activity-1",
    runId: "run-1",
    sessionId: "run-1:main",
    kind: "tool_call",
    label: "调用工具",
    startedAt: "2026-08-04T12:00:00.000Z",
    updatedAt: "2026-08-04T12:00:01.000Z",
    ...patch,
  };
}

function modelEvent(runId: string, delta: string): ModelStreamEvent {
  return {
    id: `${runId}-${delta}`,
    runId,
    sessionId: `${runId}:main`,
    jobId: "job-1",
    taskId: "agent/turn/1",
    type: "response.delta",
    occurredAt: "2026-08-04T12:00:00.000Z",
    data: { delta, accumulatedCharacters: delta.length },
  };
}
