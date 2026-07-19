import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vite-plus/test";
import { JobStatus } from "@trendpublish/contracts";
import type { RuntimeEvent } from "#platform/api/types.ts";
import { compactActivityPreview, describeRuntimeEvent } from "./-job-activity.ts";
import { JobActivityView } from "./-job-activity-view.tsx";

test("model activity aggregates streamed deltas for the same task", () => {
  const events = [
    runtimeEvent("1", "model.response.delta", "research/write", {
      delta: "第一段",
      accumulatedCharacters: 3,
    }),
    runtimeEvent("2", "model.response.delta", "research/write", {
      delta: "第二段",
      accumulatedCharacters: 6,
    }),
  ];
  const activity = describeRuntimeEvent(events[1]!, events);
  expect(activity.label).toBe("正在接收模型输出");
  expect(activity.preview).toBe("第一段第二段");
  expect(activity.detail).toMatch(/6 个字符/);
});

test("model activity only aggregates deltas after the latest start for the same task", () => {
  const events = [
    runtimeEvent("1", "model.response.started", "research/write"),
    runtimeEvent("2", "model.response.delta", "research/write", { delta: "旧输出" }),
    runtimeEvent("3", "model.response.completed", "research/write"),
    runtimeEvent("4", "model.response.started", "other/task"),
    runtimeEvent("5", "model.response.started", "research/write"),
    runtimeEvent("6", "model.response.delta", "research/write", {
      delta: "新输出",
      accumulatedCharacters: 3,
    }),
  ];
  const activity = describeRuntimeEvent(events[5]!, events);
  expect(activity.preview).toBe("新输出");
  expect(activity.preview).not.toMatch(/旧输出/);
});

test("recent activity previews are compacted before rendering", () => {
  expect(compactActivityPreview("详情")).toBe("详情");
  expect(compactActivityPreview("x".repeat(300))).toBe(`${"x".repeat(240)}\n…`);
  expect(compactActivityPreview(undefined)).toBeUndefined();
});

test("unknown event data remains visible after a newer event arrives", () => {
  const unknown = runtimeEvent("8", "asset.generated", "build/assets", {
    assetId: "cover-1",
  });
  const completed = runtimeEvent("9", "job.status.changed", undefined, {
    status: JobStatus.Succeeded,
  });
  const html = renderToStaticMarkup(
    createElement(JobActivityView, {
      events: [unknown, completed],
      jobStatus: JobStatus.Succeeded,
      streamState: "idle",
    }),
  );

  expect(html).toMatch(/asset\.generated/);
  expect(html).toMatch(/cover-1/);
});

test("unknown runtime events remain visible with their protocol name and data", () => {
  const event = runtimeEvent("9", "asset.generated", undefined, { assetId: "cover-1" });
  const activity = describeRuntimeEvent(event);
  expect(activity.label).toBe("asset.generated");
  expect(activity.preview).toMatch(/cover-1/);
});

test("job status events have a user-facing activity label", () => {
  const event = runtimeEvent("10", "job.status.changed", undefined, { status: "succeeded" });
  const activity = describeRuntimeEvent(event);
  expect(activity.label).toBe("任务已完成");
  expect(activity.detail).toBe("状态：已完成");
});

test("bridged child job status remains distinguishable from the outer job", () => {
  const event = runtimeEvent("11", "job.status.changed", undefined, {
    sourceJobId: "article-child",
    sourceJobType: "article.generate",
    status: "succeeded",
  });
  const activity = describeRuntimeEvent(event);
  expect(activity.label).toBe("文章子任务已完成");
  expect(activity.detail).toBe("状态：已完成");
});

test("unknown child job types use a neutral child-task label", () => {
  const event = runtimeEvent("12", "job.status.changed", undefined, {
    sourceJobId: "future-child",
    sourceJobType: "future.operation",
    status: "succeeded",
  });
  expect(describeRuntimeEvent(event).label).toBe("子任务已完成");
});

function runtimeEvent(id: string, type: string, taskId?: string, data?: unknown): RuntimeEvent {
  return {
    id,
    type,
    occurredAt: "2026-07-18T12:00:00.000Z",
    ...(taskId ? { taskId } : {}),
    ...(data === undefined ? {} : { data }),
  };
}
