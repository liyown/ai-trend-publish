import { z } from "zod";
import { ConnectorError } from "../errors.ts";
import { defineConnector, type ConnectorCreateContext } from "../definition.ts";
import type { CallContext, ImageClient, ImageInput, ImageOutput, JsonObject } from "../types.ts";

const settingsSchema = z.object({
  apiHost: z.string().url().default("https://dashscope.aliyuncs.com"),
  model: z.string().min(1).default("qwen-image-2.0"),
});
const credentialsSchema = z.object({ apiKey: z.string().min(1) });
type Settings = z.infer<typeof settingsSchema>;
type Credentials = z.infer<typeof credentialsSchema>;

const generateOperation = {
  name: "image.generate",
  capability: "image",
} as const;
const pollOperation = {
  name: "image.poll",
  capability: "image",
} as const;
const checkOperation = {
  name: "connection.check",
  capability: "image",
} as const;

export const dashScopeConnector = defineConnector({
  id: "dashscope",
  version: 1,
  displayName: "DashScope",
  description: "阿里云百炼图片生成服务。",
  capabilities: ["image"],
  settingsSchema,
  credentialsSchema,
  fields: [
    {
      key: "apiHost",
      location: "settings",
      label: "API Host",
      input: "url",
      required: true,
      order: 10,
    },
    {
      key: "model",
      location: "settings",
      label: "默认模型",
      input: "text",
      required: true,
      order: 20,
    },
    {
      key: "apiKey",
      location: "credentials",
      label: "API Key",
      input: "password",
      required: true,
      order: 30,
    },
  ],
  requestOverrides: true,
  create(context) {
    return { image: new DashScopeImageClient(context) };
  },
  async check(context, signal) {
    await context.execute(
      checkOperation,
      {
        url: `${context.settings.apiHost.replace(/\/+$/, "")}/compatible-mode/v1/models`,
        method: "GET",
      },
      { signal },
      authorization(context.credentials.apiKey),
    );
    return "连接成功，DashScope 凭证有效";
  },
});

class DashScopeImageClient implements ImageClient {
  constructor(private readonly context: ConnectorCreateContext<Settings, Credentials>) {}

  async generate(input: ImageInput, callContext: CallContext = {}): Promise<ImageOutput> {
    const model = input.model ?? this.context.settings.model;
    return model.startsWith("wanx-")
      ? await this.generateAsync(model, input, callContext)
      : await this.generateMultimodal(model, input, callContext);
  }

  private async generateMultimodal(
    model: string,
    input: ImageInput,
    callContext: CallContext,
  ): Promise<ImageOutput> {
    const parameters: JsonObject = {};
    if (input.size !== undefined) parameters.size = input.size;
    if (input.n !== undefined) parameters.n = input.n;
    const response = await this.context.execute(
      generateOperation,
      {
        url: `${this.context.settings.apiHost.replace(/\/+$/, "")}/api/v1/services/aigc/multimodal-generation/generation`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          input: {
            messages: [{ role: "user", content: [{ text: input.prompt }] }],
          },
          parameters,
        }),
      },
      callContext,
      authorization(this.context.credentials.apiKey),
    );
    const data = response.json<DashScopeMultimodalResponse>();
    const images = extractMultimodalImages(data);
    if (!images.length) {
      throw new ConnectorError({ kind: "invalid_response", message: "DashScope 未返回图片" });
    }
    return { images, raw: data as unknown as JsonObject };
  }

  private async generateAsync(
    model: string,
    input: ImageInput,
    callContext: CallContext,
  ): Promise<ImageOutput> {
    const parameters: JsonObject = {
      size: typeof input.size === "string" ? input.size : "1024*1024",
      n: typeof input.n === "number" ? input.n : 1,
    };
    const response = await this.context.execute(
      generateOperation,
      {
        url: `${this.context.settings.apiHost.replace(/\/+$/, "")}/api/v1/services/aigc/text2image/image-synthesis`,
        method: "POST",
        headers: { "Content-Type": "application/json", "X-DashScope-Async": "enable" },
        body: JSON.stringify({
          model,
          input: { prompt: input.prompt },
          parameters,
        }),
      },
      callContext,
      authorization(this.context.credentials.apiKey),
    );
    const submitted = response.json<DashScopeTaskResponse>();
    const taskId = submitted.output?.task_id;
    if (!taskId) {
      throw new ConnectorError({ kind: "invalid_response", message: "DashScope 未返回任务 ID" });
    }

    for (let poll = 0; poll < 60; poll += 1) {
      await wait(2_000, callContext.signal);
      const statusResponse = await this.context.execute(
        pollOperation,
        {
          url: `${this.context.settings.apiHost.replace(/\/+$/, "")}/api/v1/tasks/${encodeURIComponent(taskId)}`,
          method: "GET",
        },
        callContext,
        authorization(this.context.credentials.apiKey),
      );
      const data = statusResponse.json<DashScopeTaskStatusResponse>();
      if (data.output?.task_status === "FAILED") {
        throw new ConnectorError({ kind: "provider", message: "DashScope 图片生成任务失败" });
      }
      if (data.output?.task_status === "SUCCEEDED") {
        const images = (data.output.results ?? []).map((item) => ({ url: item.url }));
        if (!images.length) {
          throw new ConnectorError({
            kind: "invalid_response",
            message: "DashScope 任务未返回图片",
          });
        }
        return { images, taskId, raw: data as unknown as JsonObject };
      }
    }
    throw new ConnectorError({ kind: "timeout", message: "等待 DashScope 图片任务完成超时" });
  }
}

interface DashScopeMultimodalResponse {
  output?: {
    choices?: Array<{
      message?: { content?: Array<{ image?: string; url?: string }> };
    }>;
  };
}

interface DashScopeTaskResponse {
  output?: { task_id?: string };
}

interface DashScopeTaskStatusResponse {
  output?: {
    task_status?: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";
    results?: Array<{ url: string }>;
  };
}

function extractMultimodalImages(data: DashScopeMultimodalResponse): Array<{ url: string }> {
  return (data.output?.choices ?? []).flatMap((choice) =>
    (choice.message?.content ?? []).flatMap((item) => {
      const url = item.image ?? item.url;
      return typeof url === "string" && url.trim() ? [{ url }] : [];
    }),
  );
}

function authorization(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` };
}

function wait(durationMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, durationMs);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
