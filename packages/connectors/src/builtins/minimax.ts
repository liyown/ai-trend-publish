import { z } from "zod";
import { ConnectorError } from "../errors.ts";
import { defineConnector, type ConnectorCreateContext } from "../definition.ts";
import type { ImageClient, ImageInput, ImageOutput, JsonObject } from "../types.ts";

const settingsSchema = z.object({
  apiHost: z.string().url().default("https://api.minimaxi.com"),
  model: z.enum(["image-01", "image-01-live"]).default("image-01"),
});
const credentialsSchema = z.object({ apiKey: z.string().min(1) });
type Settings = z.infer<typeof settingsSchema>;
type Credentials = z.infer<typeof credentialsSchema>;

const generateOperation = {
  name: "image.generate",
  capability: "image",
} as const;
const checkOperation = {
  name: "connection.check",
  capability: "image",
} as const;

export const miniMaxConnector = defineConnector({
  id: "minimax",
  version: 2,
  displayName: "MiniMax",
  description: "MiniMax 图片生成服务。",
  capabilities: ["image"],
  settingsSchema,
  credentialsSchema,
  fields: [
    {
      key: "model",
      location: "settings",
      label: "默认模型",
      input: "select",
      required: true,
      defaultValue: "image-01",
      options: [
        { value: "image-01", label: "Image 01" },
        { value: "image-01-live", label: "Image 01 Live" },
      ],
      order: 10,
    },
    {
      key: "apiKey",
      location: "credentials",
      label: "API Key",
      input: "password",
      required: true,
      order: 20,
    },
  ],
  requestOverrides: true,
  create(context) {
    return { image: new MiniMaxImageClient(context) };
  },
  async check(context, signal) {
    const response = await context.execute(
      checkOperation,
      {
        url: `${context.settings.apiHost.replace(/\/+$/, "")}/v1/image_generation`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
      { signal },
      authorization(context.credentials.apiKey),
    );
    const data = response.json<MiniMaxResponse>();
    const code = data.base_resp?.status_code;
    // A parameter error is expected from the empty, non-billable probe after authentication.
    if (code === 2013 || code === 0) return "连接成功，MiniMax 凭证有效";
    if (code !== undefined) {
      throw miniMaxProviderError(code, data.base_resp?.status_msg);
    }
    throw new ConnectorError({ kind: "invalid_response", message: "MiniMax 未返回状态码" });
  },
});

class MiniMaxImageClient implements ImageClient {
  constructor(private readonly context: ConnectorCreateContext<Settings, Credentials>) {}

  async generate(input: ImageInput, callContext = {}): Promise<ImageOutput> {
    const model = miniMaxModel(input.model ?? this.context.settings.model);
    const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
    if (!prompt || prompt.length > 1500) {
      throw invalidRequest("MiniMax prompt 必须为 1 到 1500 个字符");
    }
    const payload: JsonObject = {
      model,
      prompt,
      response_format: enumValue(input.response_format, ["url", "base64"], "url"),
      n: boundedInteger(input.n, "n", 1, 9, 1),
      prompt_optimizer: booleanValue(input.prompt_optimizer, "prompt_optimizer", false),
      aigc_watermark: booleanValue(input.aigc_watermark, "aigc_watermark", false),
    };
    if (input.aspect_ratio !== undefined) {
      const ratios =
        model === "image-01"
          ? (["1:1", "16:9", "4:3", "3:2", "2:3", "3:4", "9:16", "21:9"] as const)
          : (["1:1", "16:9", "4:3", "3:2", "2:3", "3:4", "9:16"] as const);
      payload.aspect_ratio = enumValue(input.aspect_ratio, ratios);
    }
    const hasWidth = input.width !== undefined;
    const hasHeight = input.height !== undefined;
    if (hasWidth !== hasHeight) {
      throw invalidRequest("MiniMax width 和 height 必须同时设置");
    }
    if (hasWidth && hasHeight) {
      if (model !== "image-01") {
        throw invalidRequest("MiniMax width 和 height 仅适用于 image-01");
      }
      payload.width = imageDimension(input.width, "width");
      payload.height = imageDimension(input.height, "height");
    }
    if (input.seed !== undefined) {
      if (typeof input.seed !== "number" || !Number.isSafeInteger(input.seed)) {
        throw invalidRequest("MiniMax seed 必须是安全整数");
      }
      payload.seed = input.seed;
    }
    if (input.style !== undefined) {
      if (model !== "image-01-live" || !isJsonObject(input.style)) {
        throw invalidRequest("MiniMax style 只接受 image-01-live 的对象配置");
      }
      payload.style = input.style;
    }
    const response = await this.context.execute(
      generateOperation,
      {
        url: `${this.context.settings.apiHost.replace(/\/+$/, "")}/v1/image_generation`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      },
      callContext,
      authorization(this.context.credentials.apiKey),
    );
    const data = response.json<MiniMaxResponse>();
    if (data.base_resp?.status_code && data.base_resp.status_code !== 0) {
      throw miniMaxProviderError(data.base_resp.status_code, data.base_resp.status_msg);
    }
    const images = [
      ...(data.data?.image_urls ?? []).map((url) => ({ url })),
      ...(data.data?.image_base64 ?? []).map((base64) => ({ base64, mimeType: "image/jpeg" })),
    ];
    if (!images.length) {
      throw new ConnectorError({ kind: "invalid_response", message: "MiniMax 未返回图片" });
    }
    return { images, taskId: data.id, raw: data as unknown as JsonObject };
  }
}

interface MiniMaxResponse {
  id?: string;
  data?: { image_urls?: string[]; image_base64?: string[] };
  base_resp?: { status_code?: number; status_msg?: string };
}

function authorization(apiKey: string): Record<string, string> {
  return { Authorization: `Bearer ${apiKey}` };
}

function booleanValue(value: unknown, name: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value === "boolean") return value;
  throw invalidRequest(`MiniMax ${name} 必须是布尔值`);
}

function miniMaxModel(value: unknown): Settings["model"] {
  return enumValue(value, ["image-01", "image-01-live"] as const);
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback?: T): T {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value === "string" && allowed.includes(value as T)) return value as T;
  throw invalidRequest(`MiniMax 参数必须是以下值之一：${allowed.join("、")}`);
}

function boundedInteger(
  value: unknown,
  name: string,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw invalidRequest(`MiniMax ${name} 必须是 ${min} 到 ${max} 之间的整数`);
  }
  return value;
}

function imageDimension(value: unknown, name: "width" | "height"): number {
  const dimension = boundedInteger(value, name, 512, 2048, 1024);
  if (dimension % 8 !== 0) throw invalidRequest(`MiniMax ${name} 必须是 8 的倍数`);
  return dimension;
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidRequest(message: string): ConnectorError {
  return new ConnectorError({ kind: "invalid_request", message });
}

function miniMaxProviderError(code: number, message?: string): ConnectorError {
  const common = {
    message: message?.trim() || `MiniMax 图片生成失败（${code}）`,
    providerCode: String(code),
  };
  if (code === 1004 || code === 2049) {
    return new ConnectorError({ ...common, kind: "authentication" });
  }
  if (code === 1008) return new ConnectorError({ ...common, kind: "quota" });
  if (code === 1002 || code === 2045) {
    return new ConnectorError({ ...common, kind: "rate_limit", retryable: true });
  }
  if (code === 1001) return new ConnectorError({ ...common, kind: "timeout", retryable: true });
  if (code === 1026 || code === 1027 || code === 2013) {
    return new ConnectorError({ ...common, kind: "invalid_request" });
  }
  return new ConnectorError({
    ...common,
    kind: "provider",
    retryable: code === 1000 || code === 1024 || code === 1033,
  });
}
