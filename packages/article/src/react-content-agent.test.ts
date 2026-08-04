import { expect, test } from "vite-plus/test";
import type { ChatClient } from "@trendpublish/connectors";
import { MemoryTaskStore, TaskRunner } from "@trendpublish/runtime";
import { ContentReactAgent } from "./react-content-agent.ts";

test("shared ReAct researches and submits channel-neutral MasterContent", async () => {
  let terminalSchema = "";
  const model: ChatClient = {
    async complete(input) {
      terminalSchema = JSON.stringify(
        input.tools?.find((tool) => tool.name === "submit_master_content")?.inputSchema,
      );
      const observed = input.messages.some((message) => message.role === "tool");
      return observed
        ? {
            content: "",
            toolCalls: [
              {
                id: "submit",
                name: "submit_master_content",
                arguments: JSON.stringify({
                  topic: "Agent",
                  angle: "工程影响",
                  synopsis: "解释变化",
                  thesis: "工具调用提高适应性",
                  outline: ["变化", "影响"],
                  title: "Agent 工具调用意味着什么",
                  digest: "解释新的内容生产方式",
                  bodyMarkdown: "工具调用提高适应性。[来源](evidence://e-1)",
                  claims: [{ id: "claim-1", statement: "提高适应性", evidenceIds: ["e-1"] }],
                  evidence: [
                    {
                      id: "e-1",
                      statement: "工具调用提高适应性",
                      materialId: "material-1",
                      locator: { type: "text", excerpt: "工具调用提高适应性" },
                    },
                  ],
                }),
              },
            ],
          }
        : {
            content: "",
            toolCalls: [
              {
                id: "fetch",
                name: "fetch_source_1",
                arguments: JSON.stringify({ url: "https://example.com" }),
              },
            ],
          };
    },
  };
  const agent = new ContentReactAgent({
    model,
    modelConnectionId: "model-1",
    strategyId: "deep-analysis",
    strategyInstructions: "形成完整论点",
    tools: [
      {
        id: "web",
        version: "1",
        capability: "fetch",
        async fetch() {
          return [
            {
              id: "material-1",
              mediaType: "webpage",
              title: "资料",
              content: "工具调用提高适应性",
              retrievedAt: "2026-08-04T00:00:00.000Z",
              contentHash: "hash",
            },
          ];
        },
      },
    ],
  });

  const result = await agent.produce(
    {
      identity: {
        id: "identity-1",
        name: "技术作者",
        positioning: "工程解释",
        audience: "开发者",
        tone: "清晰",
        revision: 1,
      },
      requestedTopic: "Agent",
      requestedAt: "2026-08-04T00:00:00.000Z",
    },
    new TaskRunner(new MemoryTaskStore()).forJob("content-agent"),
  );

  expect(result.master.schemaVersion).toBe("master-content.v1");
  expect(result.master.agent).toEqual({
    strategyId: "deep-analysis",
    modelConnectionId: "model-1",
    maxTurns: 24,
  });
  expect(result.article.source.title).toBe("Agent 工具调用意味着什么");
  expect(result.article.assetRequests).toEqual([]);
  expect(result.brief.evidence[0]?.materialId).toBe("material-1");
  expect(terminalSchema).toContain('"required":["id","statement","materialId","locator"]');
  expect(terminalSchema).toContain('"minLength":1');
  expect(terminalSchema).toContain('"source":{"type":"string","enum":["content","transcript"]}');
  expect(terminalSchema).toContain('"start":{"type":"integer","minimum":0}');
  expect(terminalSchema).not.toContain("assetRequests");
});

test("evidence validation failure locates an exact quote and repairs only its position", async () => {
  let calls = 0;
  let receivedValidationError = false;
  let receivedLocatedQuote = false;
  let repairArguments = "";
  const submittedToolNames: string[] = [];
  const model: ChatClient = {
    async complete(input) {
      calls += 1;
      receivedValidationError ||= input.messages.some(
        (message) => message.role === "tool" && message.content.includes("文本摘录不在素材"),
      );
      receivedLocatedQuote ||= input.messages.some(
        (message) =>
          message.role === "tool" &&
          message.content.includes('"source":"content"') &&
          message.content.includes('"excerpt":"工具调用提高适应性"'),
      );
      const call =
        calls === 1
          ? {
              id: "submit-1",
              name: "submit_master_content",
              arguments: JSON.stringify(submission("模型改写后的摘录")),
            }
          : calls === 2
            ? {
                id: "locate-1",
                name: "locate_material_quotes",
                arguments: JSON.stringify({
                  requests: [
                    {
                      key: "evidence-1",
                      materialId: "material-1",
                      query: "工具调用能让 Agent 提高适应性",
                    },
                  ],
                }),
              }
            : {
                id: "repair-1",
                name: "repair_master_content",
                arguments: JSON.stringify({
                  evidence: [
                    {
                      id: "evidence-1",
                      locator: { type: "text", source: "content", start: 0, end: 9 },
                    },
                  ],
                }),
              };
      submittedToolNames.push(call.name);
      if (call.name === "repair_master_content") repairArguments = call.arguments;
      return { content: "", toolCalls: [call] };
    },
  };
  const result = await new ContentReactAgent({
    model,
    modelConnectionId: "model-1",
    strategyId: "brief",
    strategyInstructions: "准确提交",
  }).produce(
    {
      identity: {
        id: "identity-1",
        name: "技术作者",
        positioning: "工程解释",
        audience: "开发者",
        tone: "清晰",
        revision: 1,
      },
      requestedTopic: "Agent",
      requestedAt: "2026-08-04T00:00:00.000Z",
      materials: [
        {
          id: "material-1",
          mediaType: "webpage",
          title: "资料",
          content: "工具调用提高适应性",
          retrievedAt: "2026-08-04T00:00:00.000Z",
          contentHash: "hash",
        },
      ],
    },
    new TaskRunner(new MemoryTaskStore()).forJob("repair-agent"),
  );

  expect(calls).toBe(3);
  expect(receivedValidationError).toBe(true);
  expect(receivedLocatedQuote).toBe(true);
  expect(result.brief.evidence[0]?.id).toBe("evidence-1");
  expect(result.brief.evidence[0]?.locator).toEqual({
    type: "text",
    excerpt: "工具调用提高适应性",
  });
  expect(result.article.source.title).toBe("Agent 工具调用意味着什么");
  expect(submittedToolNames).toEqual([
    "submit_master_content",
    "locate_material_quotes",
    "repair_master_content",
  ]);
  expect(repairArguments).not.toContain("bodyMarkdown");
  expect(repairArguments).not.toContain('"title"');
  expect(repairArguments).not.toContain("excerpt");
});

test("missing body citation is repaired inside the same ReAct candidate", async () => {
  let calls = 0;
  let receivedCitationFailure = false;
  const submittedToolNames: string[] = [];
  const model: ChatClient = {
    async complete(input) {
      calls += 1;
      receivedCitationFailure ||= input.messages.some(
        (message) =>
          message.role === "tool" && message.content.includes("正文必须至少引用一条有效证据"),
      );
      const call =
        calls === 1
          ? {
              id: "submit-1",
              name: "submit_master_content",
              arguments: JSON.stringify({
                ...submission("工具调用提高适应性"),
                bodyMarkdown: "工具调用提高适应性。",
              }),
            }
          : {
              id: "repair-1",
              name: "repair_master_content",
              arguments: JSON.stringify({
                bodyMarkdown: "工具调用提高适应性。[来源](evidence://evidence-1)",
              }),
            };
      submittedToolNames.push(call.name);
      return { content: "", toolCalls: [call] };
    },
  };

  const result = await new ContentReactAgent({
    model,
    modelConnectionId: "model-1",
    strategyId: "brief",
    strategyInstructions: "准确提交",
  }).produce(
    {
      identity: {
        id: "identity-1",
        name: "技术作者",
        positioning: "工程解释",
        audience: "开发者",
        tone: "清晰",
        revision: 1,
      },
      requestedTopic: "Agent",
      requestedAt: "2026-08-04T00:00:00.000Z",
      materials: [
        {
          id: "material-1",
          mediaType: "webpage",
          title: "资料",
          content: "工具调用提高适应性",
          retrievedAt: "2026-08-04T00:00:00.000Z",
          contentHash: "hash",
        },
      ],
    },
    new TaskRunner(new MemoryTaskStore()).forJob("citation-repair-agent"),
  );

  expect(calls).toBe(2);
  expect(receivedCitationFailure).toBe(true);
  expect(submittedToolNames).toEqual(["submit_master_content", "repair_master_content"]);
  expect(result.article.source.bodyMarkdown).toContain("evidence://evidence-1");
  expect(result.article.source.title).toBe("Agent 工具调用意味着什么");
});

function submission(excerpt: string) {
  return {
    topic: "Agent",
    angle: "工程影响",
    synopsis: "解释变化",
    thesis: "工具调用提高适应性",
    outline: ["变化", "影响"],
    title: "Agent 工具调用意味着什么",
    digest: "解释新的内容生产方式",
    bodyMarkdown: "工具调用提高适应性。[来源](evidence://evidence-1)",
    claims: [{ id: "claim-1", statement: "提高适应性", evidenceIds: ["evidence-1"] }],
    evidence: [
      {
        id: "evidence-1",
        statement: "工具调用提高适应性",
        materialId: "material-1",
        locator: { type: "text", excerpt },
      },
    ],
  };
}
