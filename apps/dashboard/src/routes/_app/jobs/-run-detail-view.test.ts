import { expect, test } from "vite-plus/test";
import type { ModelStreamEvent } from "#platform/api/types.ts";
import {
  activityDuration,
  channelPreviewDocument,
  formatToolArguments,
  isNearScrollEnd,
  isLegacyExternalQualityActivity,
  modelOutputCharacters,
  modelOutputs,
  settleInterruptedActivities,
} from "./-run-detail-view.tsx";

test("model deltas are attached to their corresponding activity task", () => {
  const events: ModelStreamEvent[] = [
    event("response.started", "react/agent/turn/1", {
      turn: 1,
      model: "model-a",
    }),
    event("response.delta", "react/agent/turn/1", {
      turn: 1,
      delta: "正在检索",
      accumulatedCharacters: 4,
    }),
    event("response.tool_delta", "react/agent/turn/1", {
      turn: 1,
      index: 0,
      name: "search_news",
      accumulatedArguments: '{"query":"AI"}',
    }),
    event("response.started", "react/agent/turn/2", {
      turn: 2,
      model: "model-a",
    }),
    event("response.delta", "react/agent/turn/2", {
      turn: 2,
      delta: "开始写作",
      accumulatedCharacters: 4,
    }),
  ];

  const outputs = modelOutputs(events);
  expect(outputs.get("react/agent/turn/1")).toMatchObject({
    model: "model-a",
    content: "正在检索",
    characters: 4,
    toolCharacters: 14,
    tools: [{ index: 0, name: "search_news", arguments: '{"query":"AI"}' }],
  });
  expect(modelOutputCharacters(outputs.get("react/agent/turn/1"))).toBe(18);
  expect(outputs.get("react/agent/turn/2")?.content).toBe("开始写作");
});

test("tool-only model turns report their generated argument characters", () => {
  const output = modelOutputs([
    event("response.tool_delta", "react/agent/turn/1", {
      turn: 1,
      index: 0,
      name: "submit_master_content",
      accumulatedArguments: '{"topic":"AI"}',
    }),
  ]).get("react/agent/turn/1");

  expect(output).toMatchObject({ characters: 0, toolCharacters: 14 });
  expect(modelOutputCharacters(output)).toBe(14);
});

test("complete tool arguments render decoded and formatted JSON", () => {
  expect(formatToolArguments('{"topic":"\\u79d1\\u6280\\u65b0\\u95fb"}')).toBe(
    '{\n  "topic": "科技新闻"\n}',
  );
  expect(formatToolArguments('{"topic":"\\u79d1')).toBe('{"topic":"科');
  expect(formatToolArguments('{"topic":"\\u79d1\\u6280\\u65b0')).toBe('{"topic":"科技新');
});

test("reconnected model output restores total characters and marks missing text", () => {
  const output = modelOutputs([
    event("response.delta", "react/agent/turn/1", {
      delta: "继续",
      accumulatedCharacters: 120,
    }),
    event("response.completed", "react/agent/turn/1", {
      accumulatedCharacters: 128,
      usage: { totalTokens: 64 },
    }),
  ]).get("react/agent/turn/1");

  expect(output).toMatchObject({
    content: "继续",
    characters: 128,
    partial: true,
    tokens: 64,
  });
});

test("legacy external quality-loop tasks stay out of the ReAct activity timeline", () => {
  expect(isLegacyExternalQualityActivity({ taskId: "quality/report/1" } as never)).toBe(true);
  expect(isLegacyExternalQualityActivity({ taskId: "react/agent/submission/1" } as never)).toBe(
    false,
  );
});

test("running model duration advances without waiting for another stream event", () => {
  expect(
    activityDuration(
      {
        status: "running",
        startedAt: "2026-08-04T12:00:00.000Z",
      } as never,
      Date.parse("2026-08-04T12:00:02.500Z"),
    ),
  ).toBe(2_500);
  expect(
    activityDuration(
      {
        status: "succeeded",
        startedAt: "2026-08-04T12:00:00.000Z",
        finishedAt: "2026-08-04T12:00:01.250Z",
      } as never,
      Date.parse("2026-08-04T12:00:10.000Z"),
    ),
  ).toBe(1_250);
});

test("live output follows only while the viewer remains near the bottom", () => {
  expect(isNearScrollEnd({ scrollHeight: 1_000, clientHeight: 400, scrollTop: 590 })).toBe(true);
  expect(isNearScrollEnd({ scrollHeight: 1_000, clientHeight: 400, scrollTop: 300 })).toBe(false);
});

test("terminal sessions never render stale model activities as running", () => {
  const [activity] = settleInterruptedActivities(
    [
      {
        id: "activity-1",
        runId: "run-1",
        sessionId: "run-1:main",
        sequence: 1,
        kind: "model_turn",
        status: "running",
        label: "模型生成",
        startedAt: "2026-08-04T12:00:00.000Z",
        updatedAt: "2026-08-04T12:00:01.000Z",
      },
    ],
    {
      status: "needs_attention",
      error: "服务重启",
      finishedAt: "2026-08-04T12:00:02.000Z",
      updatedAt: "2026-08-04T12:00:02.000Z",
    },
  );

  expect(activity).toMatchObject({
    status: "needs_attention",
    error: "服务重启，本轮执行已中断",
    finishedAt: "2026-08-04T12:00:02.000Z",
  });
});

test("channel HTML preview is wrapped in a restricted standalone document", () => {
  const document = channelPreviewDocument('<section style="color:red">微信正文</section>');

  expect(document).toContain("Content-Security-Policy");
  expect(document).toContain("default-src 'none'");
  expect(document).toContain("form-action 'none'");
  expect(document).toContain('<section style="color:red">微信正文</section>');
});

function event(
  type: ModelStreamEvent["type"],
  taskId: string,
  data: ModelStreamEvent["data"],
): ModelStreamEvent {
  return {
    id: `${type}-${taskId}`,
    runId: "run-1",
    sessionId: "run-1:main",
    jobId: "job-1",
    taskId,
    type,
    occurredAt: "2026-08-04T12:00:00.000Z",
    data,
  };
}
