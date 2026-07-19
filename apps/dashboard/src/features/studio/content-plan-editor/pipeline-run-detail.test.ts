import { expect, test } from "vite-plus/test";
import { TaskEffect, TaskStatus } from "@trendpublish/contracts";
import type { TaskRecord } from "#platform/api/types.ts";
import { pipelineStageForTask, stageDuration, stageStatus } from "./pipeline-run-detail.tsx";

test("quality tasks are grouped under the review and revision stage", () => {
  expect(pipelineStageForTask("quality/evaluate/1")).toBe("quality");
  expect(pipelineStageForTask("quality/supplement/1")).toBe("quality");
});

test("stageStatus follows the governing task, not a tolerated sub-step failure", () => {
  // The research wrapper succeeded, but one fetch connection failed and was tolerated. The stage
  // must read as 完成, mirroring the actual pipeline outcome.
  const tasks = [
    taskRecord({ taskId: "research", status: TaskStatus.Succeeded }),
    taskRecord({
      taskId: "research/internal/fetch/4-3-1-source-fetch:connection-abc",
      status: TaskStatus.Failed,
    }),
    taskRecord({
      taskId: "research/internal/plan-queries",
      status: TaskStatus.Succeeded,
    }),
  ];

  expect(stageStatus(tasks)).toBe(TaskStatus.Succeeded);
});

test("stageStatus surfaces a real failure of the governing wrapper task", () => {
  const tasks = [
    taskRecord({ taskId: "research", status: TaskStatus.Failed }),
    taskRecord({
      taskId: "research/internal/plan-queries",
      status: TaskStatus.Succeeded,
    }),
  ];

  expect(stageStatus(tasks)).toBe(TaskStatus.Failed);
});

test("stageStatus rolls up the worst status among equally shallow governing tasks", () => {
  // The build stage has no bare `build` wrapper; its governing tasks (compiler, package) are depth-2
  // while an asset provider sits deeper at depth-3.
  const tasks = [
    taskRecord({ taskId: "build/compiler", status: TaskStatus.Succeeded }),
    taskRecord({ taskId: "build/package", status: TaskStatus.Running }),
    taskRecord({ taskId: "build/asset/1-cover", status: TaskStatus.Failed }),
  ];

  expect(stageStatus(tasks)).toBe(TaskStatus.Running);
});

test("running stage duration advances to the current polling time", () => {
  const task = taskRecord({
    status: TaskStatus.Running,
    startedAt: "2026-07-18T12:00:00.000Z",
    updatedAt: "2026-07-18T12:00:02.000Z",
  });

  expect(stageDuration([task], new Date("2026-07-18T12:00:05.000Z").getTime())).toBe("5.0 s");
});

test("completed stage duration remains fixed at its recorded finish time", () => {
  const task = taskRecord({
    status: TaskStatus.Succeeded,
    startedAt: "2026-07-18T12:00:00.000Z",
    updatedAt: "2026-07-18T12:00:03.000Z",
    finishedAt: "2026-07-18T12:00:03.000Z",
  });

  expect(stageDuration([task], new Date("2026-07-18T12:00:09.000Z").getTime())).toBe("3.0 s");
});

function taskRecord(overrides: Partial<TaskRecord>): TaskRecord {
  return {
    jobId: "job-1",
    taskId: "research/query",
    fingerprint: "fingerprint",
    version: "1",
    status: TaskStatus.Running,
    effect: TaskEffect.Pure,
    attempt: 1,
    startedAt: "2026-07-18T12:00:00.000Z",
    updatedAt: "2026-07-18T12:00:00.000Z",
    ...overrides,
  };
}
