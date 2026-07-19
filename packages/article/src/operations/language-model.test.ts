import { expect, test } from "vite-plus/test";
import { parseModelJson } from "./language-model.ts";

test("parses JSON after a model thinking block", () => {
  expect(
    parseModelJson<{ queries: string[] }>(
      '<think>先分析主题，并避免重复查询。</think>\n\n{"queries":["MiniMax M3 发布说明"]}',
    ),
  ).toEqual({ queries: ["MiniMax M3 发布说明"] });
});

test("parses fenced JSON after a model thinking block", () => {
  expect(
    parseModelJson<{ queries: string[] }>(
      '<think>规划检索词</think>\n```json\n{"queries":["Agent runtime evidence"]}\n```',
    ),
  ).toEqual({ queries: ["Agent runtime evidence"] });
});

test("extracts one balanced JSON value without accepting malformed JSON", () => {
  expect(parseModelJson<{ queries: string[] }>('结果如下：{"queries":["A } value"]}。')).toEqual({
    queries: ["A } value"],
  });
  expect(() => parseModelJson('{"queries":[}')).toThrow("模型没有返回有效 JSON");
});
