import type {
  ChatClient,
  ChatMessage,
  ChatToolCall,
  ChatToolDefinition,
} from "@trendpublish/connectors";
import type { JsonObject, JsonValue } from "@trendpublish/contracts";
import { describeUnknown, TaskEffect, type TaskContext } from "@trendpublish/runtime";

export interface AgentToolContext {
  signal: AbortSignal;
  task: TaskContext;
}

export interface AgentTool {
  name: string;
  description: string;
  inputSchema: JsonObject;
  version: string;
  effect?: TaskEffect;
  execute(input: JsonObject, context: AgentToolContext): Promise<JsonValue>;
}

export interface AgentTerminal<T> {
  name: string;
  description: string;
  inputSchema: JsonObject;
  parse(input: JsonObject): T | Promise<T>;
  repair?: {
    name: string;
    description: string;
    inputSchema: JsonObject;
    apply(candidate: JsonObject, patch: JsonObject): JsonObject | Promise<JsonObject>;
  };
}

export interface ReactAgentBudget {
  maxTurns?: number;
}

export interface RunReactAgentInput<T> {
  system: string;
  user: string;
  tools: AgentTool[];
  terminal: AgentTerminal<T>;
  task: TaskContext;
  budget?: ReactAgentBudget;
}

export class ReactAgentFinalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReactAgentFinalizationError";
  }
}

const CONTEXT_WINDOW_TARGET_TOKENS = 64_000;

/** A durable native-tool-calling loop. It stores public actions and observations, never hidden reasoning. */
export class ReactAgent {
  constructor(private readonly model: ChatClient) {}

  async run<T>(input: RunReactAgentInput<T>): Promise<T> {
    const maxTurns = bounded(input.budget?.maxTurns, 24, 1, 100);
    const toolsByName = new Map(input.tools.map((tool) => [tool.name, tool]));
    if (toolsByName.size !== input.tools.length) throw new Error("Agent 工具名称不能重复");
    if (toolsByName.has(input.terminal.name)) throw new Error("终止工具不能与普通工具重名");
    if (
      input.terminal.repair &&
      (toolsByName.has(input.terminal.repair.name) ||
        input.terminal.repair.name === input.terminal.name)
    ) {
      throw new Error("修复工具不能与普通工具或终止工具重名");
    }
    for (const name of [
      ...toolsByName.keys(),
      input.terminal.name,
      ...(input.terminal.repair ? [input.terminal.repair.name] : []),
    ])
      assertToolName(name);

    const definitions: ChatToolDefinition[] = [
      ...input.tools.map(toolDefinition),
      {
        name: input.terminal.name,
        description: input.terminal.description,
        inputSchema: input.terminal.inputSchema,
      },
      ...(input.terminal.repair
        ? [
            {
              name: input.terminal.repair.name,
              description: input.terminal.repair.description,
              inputSchema: input.terminal.repair.inputSchema,
            },
          ]
        : []),
    ];
    const messages: ChatMessage[] = [
      { role: "system", content: input.system },
      { role: "user", content: input.user },
    ];
    let terminalCandidate: JsonObject | undefined;
    let finalizationFailure: string | undefined;

    for (let turn = 1; turn <= maxTurns; turn += 1) {
      const finalTurn = turn === maxTurns;
      const finalToolName =
        terminalCandidate && input.terminal.repair
          ? input.terminal.repair.name
          : input.terminal.name;
      if (finalTurn) {
        messages.push({
          role: "user",
          content: `这是最后一个允许轮次。停止继续研究，不要调用普通工具；现在必须调用 ${finalToolName} 提交当前最佳结构化结果。`,
        });
      }
      const modelMessages = fitContext(messages, CONTEXT_WINDOW_TARGET_TOKENS);
      const availableDefinitions = finalTurn
        ? definitions.filter((definition) => definition.name === finalToolName)
        : terminalCandidate && input.terminal.repair
          ? definitions.filter((definition) => definition.name !== input.terminal.name)
          : definitions;
      const output = await input.task.run(
        {
          id: `agent/turn/${turn}`,
          version: "1",
          input: { messages: modelMessages, tools: availableDefinitions },
          transient: true,
        },
        (signal, task) =>
          this.model.complete(
            {
              messages: structuredClone(modelMessages),
              tools: availableDefinitions,
              toolChoice: finalTurn ? { name: finalToolName } : "auto",
            },
            {
              signal,
              traceId: task.jobId,
              taskId: task.taskId,
              onEvent: (event) => {
                if (event.type === "response.started") {
                  task.emit("agent.response.started", { turn, model: event.model });
                } else if (event.type === "response.completed") {
                  task.emit("agent.response.completed", {
                    turn,
                    model: event.model,
                    usage: event.usage,
                    accumulatedCharacters: event.accumulatedCharacters,
                  });
                } else if (event.type === "response.delta") {
                  task.emit("agent.response.delta", {
                    turn,
                    delta: event.delta,
                    accumulatedCharacters: event.accumulatedCharacters,
                  });
                } else if (event.type === "response.tool_delta") {
                  task.emit("agent.tool_call.delta", { turn, ...event });
                }
              },
            },
          ),
      );
      const calls = output.toolCalls ?? [];
      messages.push({
        role: "assistant",
        content: output.content || undefined,
        toolCalls: structuredClone(calls),
      });
      if (!calls.length) {
        if (finalTurn) {
          finalizationFailure = `模型最后一轮没有调用 ${finalToolName}`;
          continue;
        }
        messages.push({
          role: "user",
          content: `请继续使用可用工具，并最终调用 ${finalToolName} 提交结构化结果。`,
        });
        continue;
      }

      for (const [index, call] of calls.entries()) {
        let parsed: JsonObject;
        try {
          parsed = parseArguments(call);
        } catch (error) {
          messages.push(toolObservation(call, { ok: false, error: describeUnknown(error) }));
          continue;
        }
        if (call.name === input.terminal.name) {
          terminalCandidate = structuredClone(parsed);
          try {
            return await input.task.run(
              {
                id: `agent/submission/${turn}/${index + 1}-${input.terminal.name}`,
                version: "1",
                input: parsed,
              },
              async () => await input.terminal.parse(terminalCandidate!),
            );
          } catch (error) {
            if (finalTurn) finalizationFailure = describeUnknown(error);
            messages.push(terminalFailureObservation(call, error, input.terminal.repair?.name));
            continue;
          }
        }
        if (input.terminal.repair && call.name === input.terminal.repair.name) {
          if (!terminalCandidate) {
            messages.push(
              toolObservation(call, {
                ok: false,
                error: `尚无失败候选稿，请先调用 ${input.terminal.name} 完整提交`,
              }),
            );
            continue;
          }
          try {
            const repaired = await input.terminal.repair.apply(
              structuredClone(terminalCandidate),
              parsed,
            );
            terminalCandidate = structuredClone(repaired);
            return await input.task.run(
              {
                id: `agent/repair/${turn}/${index + 1}-${input.terminal.repair.name}`,
                version: "1",
                input: parsed,
              },
              async () => await input.terminal.parse(terminalCandidate!),
            );
          } catch (error) {
            if (finalTurn) finalizationFailure = describeUnknown(error);
            messages.push(terminalFailureObservation(call, error, input.terminal.repair.name));
            continue;
          }
        }
        const tool = toolsByName.get(call.name);
        if (!tool) {
          messages.push(toolObservation(call, { ok: false, error: `未知工具：${call.name}` }));
          continue;
        }
        try {
          const result = await input.task.run(
            {
              id: `agent/tool/${turn}/${index + 1}-${tool.name}`,
              version: tool.version,
              input: parsed,
              effect: tool.effect ?? TaskEffect.Pure,
            },
            (signal, task) => tool.execute(parsed, { signal, task }),
          );
          messages.push(toolObservation(call, { ok: true, result }));
        } catch (error) {
          messages.push(toolObservation(call, { ok: false, error: describeUnknown(error) }));
        }
      }
    }
    throw new ReactAgentFinalizationError(
      finalizationFailure
        ? `Agent 最后一轮未能提交有效结果：${finalizationFailure}`
        : `Agent 最后一轮未能通过 ${input.terminal.name} 提交有效结果`,
    );
  }
}

function toolDefinition(tool: AgentTool): ChatToolDefinition {
  return { name: tool.name, description: tool.description, inputSchema: tool.inputSchema };
}

function parseArguments(call: ChatToolCall): JsonObject {
  let value: unknown;
  try {
    value = JSON.parse(call.arguments || "{}") as unknown;
  } catch (cause) {
    throw new Error(`工具 ${call.name} 参数不是有效 JSON`, { cause });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`工具 ${call.name} 参数必须是 JSON 对象`);
  }
  return value as JsonObject;
}

function toolObservation(call: ChatToolCall, value: JsonValue): ChatMessage {
  return { role: "tool", toolCallId: call.id, content: JSON.stringify(value) };
}

function terminalFailureObservation(
  call: ChatToolCall,
  error: unknown,
  repairToolName?: string,
): ChatMessage {
  return toolObservation(call, {
    ok: false,
    error: describeUnknown(error),
    candidateRetained: true,
    ...(repairToolName
      ? {
          nextAction: `只修正失败字段，然后调用 ${repairToolName}；不要重新生成或重新提交完整内容`,
        }
      : {}),
  });
}

function assertToolName(name: string): void {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) {
    throw new Error(`Agent 工具名称不合法：${name}`);
  }
}

function bounded(value: number | undefined, fallback: number, minimum: number, maximum: number) {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < minimum || resolved > maximum) {
    throw new Error(`Agent 最大轮次必须是 ${minimum}-${maximum} 的整数`);
  }
  return resolved;
}

function fitContext(messages: ChatMessage[], maxTokens: number): ChatMessage[] {
  const maxCharacters = maxTokens * 4;
  if (JSON.stringify(messages).length <= maxCharacters) return structuredClone(messages);
  const fixed = messages.slice(0, 2);
  const groups: ChatMessage[][] = [];
  for (const message of messages.slice(2)) {
    if (message.role === "assistant" || !groups.length) groups.push([message]);
    else groups.at(-1)!.push(message);
  }
  const selected: ChatMessage[][] = [];
  let characters = JSON.stringify(fixed).length + 200;
  for (const group of groups.reverse()) {
    const size = JSON.stringify(group).length;
    if (characters + size > maxCharacters && selected.length) break;
    selected.unshift(group);
    characters += size;
  }
  return [
    ...structuredClone(fixed),
    {
      role: "user",
      content: "较早的公开 Agent turn 已因上下文长度限制省略；请使用保留的最近 observation 继续。",
    },
    ...structuredClone(selected.flat()),
  ];
}
