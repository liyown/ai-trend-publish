import type { TaskContext } from "@trendpublish/runtime";

export interface LanguageModelRequest {
  system: string;
  user: string;
  temperature?: number;
  json?: boolean;
  signal?: AbortSignal;
  events?: Pick<TaskContext, "jobId" | "taskId" | "emit">;
}

export interface LanguageModel {
  generate(request: LanguageModelRequest): Promise<string>;
}

export function parseModelJson<T>(value: string): T {
  const trimmed = value.trim().replace(/^\uFEFF/, "");
  const withoutThinking = stripLeadingThinking(trimmed);
  const fenced = withoutThinking.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1];
  const candidates = [trimmed, withoutThinking, fenced, ...balancedJsonValues(withoutThinking)];
  let cause: unknown;
  for (const candidate of candidates) {
    if (!candidate?.trim()) continue;
    try {
      return JSON.parse(candidate.trim()) as T;
    } catch (error) {
      cause = error;
    }
  }
  throw new Error("模型没有返回有效 JSON", { cause });
}

function stripLeadingThinking(value: string): string {
  let result = value.trim();
  while (/^<think(?:\s[^>]*)?>/i.test(result)) {
    const closing = result.search(/<\/think\s*>/i);
    if (closing < 0) break;
    const end = result.indexOf(">", closing);
    if (end < 0) break;
    result = result.slice(end + 1).trim();
  }
  return result;
}

function balancedJsonValues(value: string): string[] {
  const results: string[] = [];
  for (let start = 0; start < value.length; start += 1) {
    const opening = value[start];
    if (opening !== "{" && opening !== "[") continue;
    const stack: string[] = [];
    let quoted = false;
    let escaped = false;
    for (let index = start; index < value.length; index += 1) {
      const character = value[index]!;
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
        continue;
      }
      if (character === '"') {
        quoted = true;
        continue;
      }
      if (character === "{" || character === "[") stack.push(character);
      else if (character === "}" || character === "]") {
        const expected = character === "}" ? "{" : "[";
        if (stack.pop() !== expected) break;
        if (!stack.length) {
          results.push(value.slice(start, index + 1));
          break;
        }
      }
    }
  }
  return results;
}
