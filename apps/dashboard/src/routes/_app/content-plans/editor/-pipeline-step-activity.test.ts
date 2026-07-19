import { expect, test } from "vite-plus/test";
import { TaskEffect, TaskStatus } from "@trendpublish/contracts";
import type { RuntimeEvent, TaskRecord } from "#platform/api/types.ts";
import {
  eventBelongsToStep,
  sortStepsByStart,
  stepDefaultsOpen,
  stepLabel,
  stepModelMetrics,
  stepModelText,
  stepSummary,
} from "./-pipeline-step-activity.ts";

test("stepLabel maps known step kinds to Chinese labels", () => {
  expect(stepLabel("research/internal/plan-queries")).toBe("规划检索词");
  expect(stepLabel("research")).toBe("研究汇总");
  expect(stepLabel("compose")).toBe("撰写正文");
  expect(stepLabel("quality/revise/1")).toBe("定向修订 · 第1项");
  expect(stepLabel("quality/evaluate/1")).toBe("质量评估 · 第1项");
  expect(stepLabel("build/compiler")).toBe("文档编译");
});

test("stepLabel strips connection-id suffix from fetch and search steps", () => {
  // Only the kind matters; the `:connection-<uuid>` is suppressed.
  expect(stepLabel("research/internal/fetch/1-source-fetch:connection-abc")).toBe(
    "网页抓取 · 第1项",
  );
  expect(stepLabel("research/internal/search/2-source-search:connection-xyz")).toBe(
    "联网搜索 · 第2项",
  );
  expect(stepLabel("research/internal/fetch/2-3-1-source-fetch:connection-abc")).toBe(
    "网页抓取 · 第2项",
  );
});

test("sortStepsByStart places the stage container at the bottom", () => {
  const wrapper = taskRecord({ taskId: "research", startedAt: "2026-07-18T12:00:00.000Z" });
  const child1 = taskRecord({
    taskId: "research/internal/plan-queries",
    startedAt: "2026-07-18T12:00:01.000Z",
  });
  const child2 = taskRecord({
    taskId: "research/internal/fetch/1-x",
    startedAt: "2026-07-18T12:00:03.000Z",
  });

  expect(sortStepsByStart([wrapper, child2, child1]).map((t) => t.taskId)).toEqual([
    "research/internal/plan-queries",
    "research/internal/fetch/1-x",
    "research",
  ]);
});

test("sortStepsByStart still orders children chronologically among themselves", () => {
  const late = taskRecord({ taskId: "research/internal/b", startedAt: "2026-07-18T12:00:05.000Z" });
  const early = taskRecord({
    taskId: "research/internal/a",
    startedAt: "2026-07-18T12:00:01.000Z",
  });

  expect(sortStepsByStart([late, early]).map((t) => t.taskId)).toEqual([
    "research/internal/a",
    "research/internal/b",
  ]);
});

test("stepSummary shows joined queries for plan-queries output", () => {
  const task = taskRecord({
    taskId: "research/internal/plan-queries",
    output: ["AI agent 2024", "enterprise automation ROI"],
  });
  expect(stepSummary(task)).toBe("AI agent 2024、enterprise automation ROI");
});

test("stepSummary shows result count and first title for search output", () => {
  const task = taskRecord({
    taskId: "research/internal/search/2-source-search:connection-abc",
    output: [
      { id: "r1", title: "What is an AI Agent?", url: "https://example.com", snippet: "" },
      { id: "r2", title: "Agent Types", url: "https://other.com", snippet: "" },
    ],
  });
  expect(stepSummary(task)).toBe("2 条结果：What is an AI Agent?");
});

test("stepSummary shows the fetched page title for fetch output", () => {
  const task = taskRecord({
    taskId: "research/internal/fetch/1-source-fetch:connection-abc",
    output: [{ id: "m1", title: "百度一下，你就知道", sourceUrl: "https://baidu.com" }],
  });
  expect(stepSummary(task)).toBe("百度一下，你就知道");
});

test("stepSummary returns undefined for steps with no parseable output", () => {
  expect(stepSummary(taskRecord({ taskId: "build/compiler" }))).toBeUndefined();
  expect(stepSummary(taskRecord({ taskId: "compose" }))).toBeUndefined();
});

test("sortStepsByStart orders by start time regardless of update order", () => {
  const late = taskRecord({ taskId: "research/b", startedAt: "2026-07-18T12:00:05.000Z" });
  const early = taskRecord({ taskId: "research/a", startedAt: "2026-07-18T12:00:01.000Z" });

  expect(sortStepsByStart([late, early]).map((task) => task.taskId)).toEqual([
    "research/a",
    "research/b",
  ]);
});

test("sortStepsByStart breaks equal start times by taskId", () => {
  const second = taskRecord({ taskId: "quality/report/2" });
  const first = taskRecord({ taskId: "quality/report/1" });

  expect(sortStepsByStart([second, first]).map((task) => task.taskId)).toEqual([
    "quality/report/1",
    "quality/report/2",
  ]);
});

test("eventBelongsToStep matches a step's own taskId and its internal scope children", () => {
  const stepIds = ["compose", "quality/revise/1"];
  // The writer emits model events under `compose/internal`, not the leaf record `compose`.
  expect(eventBelongsToStep("compose/internal", "compose", stepIds)).toBe(true);
  expect(eventBelongsToStep("compose", "compose", stepIds)).toBe(true);
  expect(eventBelongsToStep("quality/revise/1/internal", "quality/revise/1", stepIds)).toBe(true);
  expect(eventBelongsToStep("compose/internal", "quality/revise/1", stepIds)).toBe(false);
  expect(eventBelongsToStep(undefined, "compose", stepIds)).toBe(false);
});

test("eventBelongsToStep attributes a nested event to the deepest step only", () => {
  const stepIds = ["research", "research/internal/plan-queries"];
  // `plan-queries` is its own step, so its events must not also inflate the parent `research`.
  expect(
    eventBelongsToStep("research/internal/plan-queries", "research/internal/plan-queries", stepIds),
  ).toBe(true);
  expect(eventBelongsToStep("research/internal/plan-queries", "research", stepIds)).toBe(false);
  // A research event with no deeper step still belongs to `research`.
  expect(eventBelongsToStep("research/internal", "research", stepIds)).toBe(true);
});

test("stepModelMetrics returns null when the step made no model call", () => {
  const events = [runtimeEvent({ type: "task.started", taskId: "build/compiler" })];
  expect(stepModelMetrics("build/compiler", events, ["build/compiler"])).toBeNull();
});

test("stepModelMetrics counts model events emitted under the step's internal scope", () => {
  const stepIds = ["compose", "quality/revise/1"];
  const events = [
    runtimeEvent({
      type: "model.response.delta",
      taskId: "compose/internal",
      occurredAt: "2026-07-18T12:00:01.000Z",
      data: { delta: "he", accumulatedCharacters: 2 },
    }),
    runtimeEvent({
      type: "model.response.delta",
      taskId: "compose/internal",
      occurredAt: "2026-07-18T12:00:02.000Z",
      data: { delta: "llo", accumulatedCharacters: 5 },
    }),
    // Another step's model events must not leak into this step's total.
    runtimeEvent({
      type: "model.response.delta",
      taskId: "quality/revise/1/internal",
      data: { delta: "x", accumulatedCharacters: 99 },
    }),
  ];

  expect(stepModelMetrics("compose", events, stepIds)).toEqual({
    characters: 5,
    outputTokens: undefined,
    occurredAt: "2026-07-18T12:00:02.000Z",
  });
});

test("stepModelMetrics keeps a nested step's events off its parent", () => {
  const stepIds = ["research", "research/internal/plan-queries"];
  const events = [
    runtimeEvent({
      type: "model.response.delta",
      taskId: "research/internal/plan-queries",
      data: { delta: "q", accumulatedCharacters: 12 },
    }),
  ];

  expect(stepModelMetrics("research", events, stepIds)).toBeNull();
  expect(stepModelMetrics("research/internal/plan-queries", events, stepIds)).toEqual({
    characters: 12,
    outputTokens: undefined,
    occurredAt: "2026-07-18T12:00:00.000Z",
  });
});

test("stepModelMetrics prefers output tokens once the completion event arrives", () => {
  const events = [
    runtimeEvent({
      type: "model.response.delta",
      taskId: "compose/internal",
      data: { delta: "hello", accumulatedCharacters: 5 },
    }),
    runtimeEvent({
      type: "model.response.completed",
      taskId: "compose/internal",
      occurredAt: "2026-07-18T12:00:03.000Z",
      data: { accumulatedCharacters: 5, usage: { outputTokens: 42 } },
    }),
  ];

  expect(stepModelMetrics("compose", events, ["compose"])).toEqual({
    characters: 5,
    outputTokens: 42,
    occurredAt: "2026-07-18T12:00:03.000Z",
  });
});

test("stepModelText concatenates deltas from the step's internal scope in order", () => {
  const events = [
    runtimeEvent({ type: "model.response.started", taskId: "compose/internal" }),
    runtimeEvent({
      type: "model.response.delta",
      taskId: "compose/internal",
      data: { delta: "他" },
    }),
    runtimeEvent({
      type: "model.response.delta",
      taskId: "compose/internal",
      data: { delta: "山" },
    }),
    // A different step's delta must not bleed into this one.
    runtimeEvent({
      type: "model.response.delta",
      taskId: "quality/revise/1/internal",
      data: { delta: "X" },
    }),
  ];

  expect(stepModelText("compose", events, ["compose", "quality/revise/1"])).toBe("他山");
});

test("stepModelText resets on a new response so only the latest attempt shows", () => {
  const events = [
    runtimeEvent({
      type: "model.response.delta",
      taskId: "compose/internal",
      data: { delta: "old" },
    }),
    runtimeEvent({ type: "model.response.started", taskId: "compose/internal" }),
    runtimeEvent({
      type: "model.response.delta",
      taskId: "compose/internal",
      data: { delta: "new" },
    }),
  ];

  expect(stepModelText("compose", events, ["compose"])).toBe("new");
});

test("stepModelText keeps only the streaming tail when very long", () => {
  const events = [
    runtimeEvent({
      type: "model.response.delta",
      taskId: "compose/internal",
      data: { delta: "a".repeat(5000) },
    }),
  ];

  const text = stepModelText("compose", events, ["compose"]);
  expect(text.startsWith("…")).toBe(true);
  expect(text.length).toBe(4001);
});

test("stepDefaultsOpen expands running and failed steps only", () => {
  expect(stepDefaultsOpen(TaskStatus.Running)).toBe(true);
  expect(stepDefaultsOpen(TaskStatus.Failed)).toBe(true);
  expect(stepDefaultsOpen(TaskStatus.Unknown)).toBe(true);
  expect(stepDefaultsOpen(TaskStatus.Succeeded)).toBe(false);
  expect(stepDefaultsOpen(TaskStatus.Degraded)).toBe(false);
});

function taskRecord(overrides: Partial<TaskRecord>): TaskRecord {
  return {
    jobId: "job-1",
    taskId: "research/query",
    fingerprint: "fingerprint",
    version: "1",
    status: TaskStatus.Succeeded,
    effect: TaskEffect.Pure,
    attempt: 1,
    startedAt: "2026-07-18T12:00:00.000Z",
    updatedAt: "2026-07-18T12:00:00.000Z",
    ...overrides,
  };
}

function runtimeEvent(overrides: Partial<RuntimeEvent>): RuntimeEvent {
  return {
    id: "1",
    type: "task.started",
    occurredAt: "2026-07-18T12:00:00.000Z",
    ...overrides,
  };
}
