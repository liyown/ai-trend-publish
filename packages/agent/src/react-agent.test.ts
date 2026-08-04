import { expect, test } from "vite-plus/test";
import type { ChatClient } from "@trendpublish/connectors";
import { MemoryTaskStore, TaskRunner } from "@trendpublish/runtime";
import { ReactAgent, ReactAgentFinalizationError } from "./react-agent.ts";

test("native ReAct keeps model turns transient while checkpointing tools and submission", async () => {
  let modelCalls = 0;
  let toolCalls = 0;
  const model: ChatClient = {
    async complete(input) {
      modelCalls += 1;
      const observed = input.messages.some((message) => message.role === "tool");
      return observed
        ? {
            content: "",
            toolCalls: [
              {
                id: "submit-1",
                name: "submit_result",
                arguments: JSON.stringify({ title: "完成" }),
              },
            ],
          }
        : {
            content: "",
            toolCalls: [
              { id: "search-1", name: "search_news", arguments: JSON.stringify({ query: "AI" }) },
            ],
          };
    },
  };
  const store = new MemoryTaskStore();
  const task = new TaskRunner(store).forJob("agent-job");
  const run = () =>
    new ReactAgent(model).run({
      system: "使用工具",
      user: "生成内容",
      tools: [
        {
          name: "search_news",
          version: "1",
          description: "搜索新闻",
          inputSchema: { type: "object" },
          async execute(value) {
            toolCalls += 1;
            return { items: [{ title: typeof value.query === "string" ? value.query : "" }] };
          },
        },
      ],
      terminal: {
        name: "submit_result",
        description: "提交结果",
        inputSchema: { type: "object" },
        parse(value) {
          if (typeof value.title !== "string") throw new Error("缺少标题");
          return { title: value.title };
        },
      },
      task,
    });

  await expect(run()).resolves.toEqual({ title: "完成" });
  await expect(run()).resolves.toEqual({ title: "完成" });
  expect(modelCalls).toBe(4);
  expect(toolCalls).toBe(1);
  expect(await store.get("agent-job", "agent/turn/1")).toBeNull();
  expect(await store.get("agent-job", "agent/submission/2/1-submit_result")).not.toBeNull();
});

test("terminal repair keeps the failed candidate and only submits changed fields", async () => {
  let modelCalls = 0;
  let receivedRepairInstruction = false;
  let fullSubmissionRemovedDuringRepair = false;
  const submittedToolNames: string[] = [];
  const model: ChatClient = {
    async complete(input) {
      modelCalls += 1;
      receivedRepairInstruction ||= input.messages.some(
        (message) =>
          message.role === "tool" &&
          message.content.includes('"candidateRetained":true') &&
          message.content.includes("repair_result"),
      );
      if (modelCalls === 2) {
        fullSubmissionRemovedDuringRepair =
          input.tools?.some((tool) => tool.name === "repair_result") === true &&
          (input.tools ?? []).every((tool) => tool.name !== "submit_result");
      }
      const call =
        modelCalls === 1
          ? {
              id: "submit-1",
              name: "submit_result",
              arguments: JSON.stringify({ title: "错误", body: "应当保留的长正文" }),
            }
          : {
              id: "repair-1",
              name: "repair_result",
              arguments: JSON.stringify({ title: "完成" }),
            };
      submittedToolNames.push(call.name);
      return { content: "", toolCalls: [call] };
    },
  };
  const store = new MemoryTaskStore();

  const result = await new ReactAgent(model).run({
    system: "生成内容",
    user: "保留有效字段",
    tools: [],
    terminal: {
      name: "submit_result",
      description: "提交完整结果",
      inputSchema: { type: "object" },
      repair: {
        name: "repair_result",
        description: "只修补失败字段",
        inputSchema: { type: "object" },
        apply(candidate, patch) {
          return { ...candidate, ...patch };
        },
      },
      parse(value) {
        if (value.title !== "完成") throw new Error("标题无效");
        return { title: value.title, body: value.body };
      },
    },
    task: new TaskRunner(store).forJob("repair-job"),
  });

  expect(result).toEqual({ title: "完成", body: "应当保留的长正文" });
  expect(modelCalls).toBe(2);
  expect(receivedRepairInstruction).toBe(true);
  expect(fullSubmissionRemovedDuringRepair).toBe(true);
  expect(submittedToolNames).toEqual(["submit_result", "repair_result"]);
  expect(await store.get("repair-job", "agent/repair/2/1-repair_result")).not.toBeNull();
});

test("reserves the last turn for a forced terminal submission", async () => {
  let modelCalls = 0;
  let lastTools: string[] = [];
  let lastToolChoice: unknown;
  const model: ChatClient = {
    async complete(input) {
      modelCalls += 1;
      if (modelCalls === 1) {
        return {
          content: "继续收集",
          toolCalls: [
            { id: "search-1", name: "search_news", arguments: JSON.stringify({ query: "AI" }) },
          ],
        };
      }
      lastTools = (input.tools ?? []).map((tool) => tool.name);
      lastToolChoice = input.toolChoice;
      expect(input.messages.at(-1)?.content).toContain("最后一个允许轮次");
      return {
        content: "",
        toolCalls: [
          {
            id: "submit-1",
            name: "submit_result",
            arguments: JSON.stringify({ title: "当前最佳结果" }),
          },
        ],
      };
    },
  };

  const result = await new ReactAgent(model).run({
    system: "使用工具",
    user: "生成内容",
    tools: [
      {
        name: "search_news",
        version: "1",
        description: "搜索新闻",
        inputSchema: { type: "object" },
        async execute() {
          return { items: [] };
        },
      },
    ],
    terminal: {
      name: "submit_result",
      description: "提交结果",
      inputSchema: { type: "object" },
      parse(value) {
        if (typeof value.title !== "string") throw new Error("缺少标题");
        return { title: value.title };
      },
    },
    task: new TaskRunner(new MemoryTaskStore()).forJob("forced-final-job"),
    budget: { maxTurns: 2 },
  });

  expect(result).toEqual({ title: "当前最佳结果" });
  expect(lastTools).toEqual(["submit_result"]);
  expect(lastToolChoice).toEqual({ name: "submit_result" });
});

test("does not impose a separate tool-call budget", async () => {
  let modelCalls = 0;
  let executedCalls = 0;
  const model: ChatClient = {
    async complete() {
      modelCalls += 1;
      if (modelCalls === 1) {
        return {
          content: "",
          toolCalls: Array.from({ length: 20 }, (_, index) => ({
            id: `search-${index}`,
            name: "search_news",
            arguments: JSON.stringify({ query: String(index) }),
          })),
        };
      }
      return {
        content: "",
        toolCalls: [
          {
            id: "submit-1",
            name: "submit_result",
            arguments: JSON.stringify({ count: executedCalls }),
          },
        ],
      };
    },
  };

  const result = await new ReactAgent(model).run({
    system: "使用工具",
    user: "生成内容",
    tools: [
      {
        name: "search_news",
        version: "1",
        description: "搜索新闻",
        inputSchema: { type: "object" },
        async execute() {
          executedCalls += 1;
          return { ok: true };
        },
      },
    ],
    terminal: {
      name: "submit_result",
      description: "提交结果",
      inputSchema: { type: "object" },
      parse(value) {
        return { count: Number(value.count) };
      },
    },
    task: new TaskRunner(new MemoryTaskStore()).forJob("unlimited-tools-job"),
    budget: { maxTurns: 2 },
  });

  expect(result).toEqual({ count: 20 });
  expect(executedCalls).toBe(20);
});

test("reports a finalization failure instead of a budget error after the final turn", async () => {
  const model: ChatClient = {
    async complete() {
      return { content: "没有按协议提交", toolCalls: [] };
    },
  };

  const promise = new ReactAgent(model).run({
    system: "提交结果",
    user: "生成内容",
    tools: [],
    terminal: {
      name: "submit_result",
      description: "提交结果",
      inputSchema: { type: "object" },
      parse(value) {
        return value;
      },
    },
    task: new TaskRunner(new MemoryTaskStore()).forJob("finalization-failure-job"),
    budget: { maxTurns: 1 },
  });

  await expect(promise).rejects.toBeInstanceOf(ReactAgentFinalizationError);
  await expect(promise).rejects.not.toThrow(/预算/);
});
