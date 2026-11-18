import { BaseImageGenerator } from "@src/integrations/image/providers/base-image-generator.ts";
import { HttpClient } from "@src/utils/http/http-client.ts";

export const MINIMAX_DEFAULT_IMAGE_MODEL = "image-01";
export const MINIMAX_H3_TIMEOUT_MS = 600_000;

export function isMiniMaxH3ImageModel(model?: string): boolean {
  return model?.trim() === "MiniMax-H3-Image" ||
    model?.trim() === "MiniMax-H3-Image-Highspeed";
}

const MINIMAX_DEFAULT_API_HOST = "https://api.minimax.io";

export interface MiniMaxImageOptions {
  prompt?: string;
  model?: string;
  size?: string;
  aspect_ratio?: string;
  n?: number;
  prompt_optimizer?: boolean;
  response_format?: "url" | "base64" | "b64_json";
  seed?: number;
  title?: string;
  sub_title?: string;
  prompt_text_zh?: string;
  prompt_text_en?: string;
}

interface MiniMaxImageGenerationResponse {
  id?: string;
  data?: {
    image_urls?: string[];
    image_base64?: string[];
  };
  metadata?: {
    failed_count?: string;
    success_count?: string;
  };
  base_resp?: {
    status_code?: number;
    status_msg?: string;
  };
}

interface MiniMaxH3Response {
  data?: Array<{
    url?: string;
    b64_json?: string;
    error?: { message?: string };
  }>;
}

export class MiniMaxImageGenerator extends BaseImageGenerator<
  MiniMaxImageOptions,
  string
> {
  private apiKey = "";
  private apiHost = MINIMAX_DEFAULT_API_HOST;

  constructor(
    private readonly configuredApiKey?: string,
    private readonly configuredApiHost?: string,
    private readonly httpClient = HttpClient.getInstance(),
  ) {
    super();
  }

  async refresh(): Promise<void> {
    if (!this.configuredApiKey) {
      throw new Error("providers.image.minimax.apiKey is not set");
    }
    this.apiKey = this.configuredApiKey;
    this.apiHost = (this.configuredApiHost || MINIMAX_DEFAULT_API_HOST)
      .replace(/\/$/, "");
  }

  async generate(options: MiniMaxImageOptions): Promise<string> {
    const prompt = buildPrompt(options);
    if (!prompt) {
      throw new Error("MiniMax 图片生成需要 prompt 或标题提示词");
    }

    const model = normalizeMiniMaxImageModel(options.model);
    if (isMiniMaxH3ImageModel(model)) {
      return await this.generateH3(options, model, prompt);
    }
    const payload: Record<string, unknown> = {
      model,
      prompt: prompt.slice(0, 1500),
      response_format: options.response_format === "b64_json"
        ? "base64"
        : options.response_format ?? "url",
      n: clampInteger(options.n, 1, 9, 1),
      prompt_optimizer: options.prompt_optimizer ?? true,
    };

    const aspectRatio = options.aspect_ratio ?? aspectRatioFromSize(
      options.size,
    );
    if (aspectRatio) {
      payload.aspect_ratio = aspectRatio;
    } else {
      const size = parseSize(options.size);
      if (size) {
        payload.width = size.width;
        payload.height = size.height;
      }
    }

    if (typeof options.seed === "number" && Number.isFinite(options.seed)) {
      payload.seed = Math.trunc(options.seed);
    }

    const response = await this.post<MiniMaxImageGenerationResponse>(
      "/v1/image_generation",
      payload,
      90000,
    );

    if (
      response.base_resp?.status_code && response.base_resp.status_code !== 0
    ) {
      throw new Error(
        `MiniMax 图片生成失败: ${response.base_resp.status_msg ?? "unknown"}`,
      );
    }

    const imageUrl = response.data?.image_urls?.find((url) => url.trim());
    if (imageUrl) return imageUrl;

    const base64 = response.data?.image_base64?.find((item) => item.trim());
    if (base64) return `data:image/jpeg;base64,${base64}`;

    throw new Error("MiniMax 图片生成成功但未返回图片 URL");
  }

  private async generateH3(
    options: MiniMaxImageOptions,
    model: string,
    prompt: string,
  ): Promise<string> {
    if (options.seed !== undefined) {
      throw new Error("MiniMax H3 text-to-image does not support seed");
    }

    const payload: Record<string, unknown> = {
      model,
      prompt,
      response_format: options.response_format === "base64"
        ? "b64_json"
        : options.response_format ?? "url",
      n: clampInteger(options.n, 1, 10, 1),
    };
    if (options.aspect_ratio) {
      payload.aspect_ratio = options.aspect_ratio;
    } else if (options.size) {
      payload.size = options.size.replace("*", "x");
    }
    if (options.prompt_optimizer !== undefined) {
      payload.disable_prompt_enhanced = !options.prompt_optimizer;
    }

    const response = await this.post<MiniMaxH3Response>(
      "/v1/images/generations",
      payload,
      MINIMAX_H3_TIMEOUT_MS,
    );
    const items = response.data ?? [];
    for (const item of items) {
      if (item.url?.trim()) return item.url;
      if (item.b64_json?.trim()) {
        return `data:image/jpeg;base64,${item.b64_json}`;
      }
    }
    throw new Error(
      items.find((item) => item.error?.message)?.error?.message ??
        "MiniMax H3 returned no image",
    );
  }

  private post<T>(
    path: string,
    payload: Record<string, unknown>,
    timeout: number,
  ): Promise<T> {
    return this.httpClient.request<T>(`${this.apiHost}${path}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      // HttpClient counts total attempts. A generation must only be submitted once.
      retries: 1,
      timeout,
    });
  }
}

function normalizeMiniMaxImageModel(model?: string): string {
  const trimmed = model?.trim();
  if (!trimmed) return MINIMAX_DEFAULT_IMAGE_MODEL;
  if (trimmed.startsWith("qwen-") || trimmed.startsWith("wanx-")) {
    return MINIMAX_DEFAULT_IMAGE_MODEL;
  }
  return trimmed;
}

function buildPrompt(options: MiniMaxImageOptions): string {
  if (options.prompt?.trim()) return options.prompt.trim();
  return [
    options.title ? `标题：${options.title}` : "",
    options.sub_title ? `副标题：${options.sub_title}` : "",
    options.prompt_text_zh ? `画面要求：${options.prompt_text_zh}` : "",
    options.prompt_text_en ? `English guidance: ${options.prompt_text_en}` : "",
  ].filter(Boolean).join("\n");
}

function parseSize(size?: string): { width: number; height: number } | null {
  if (!size) return null;
  const match = /^(\d{2,5})\*(\d{2,5})$/.exec(size);
  if (!match) return null;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!isValidDimension(width) || !isValidDimension(height)) return null;
  return { width, height };
}

function aspectRatioFromSize(size?: string): string | null {
  const parsed = parseSize(size);
  if (!parsed) return null;
  const ratio = `${parsed.width}:${parsed.height}`;
  const normalized: Record<string, string> = {
    "1024:1024": "1:1",
    "1280:720": "16:9",
    "1152:864": "4:3",
    "1248:832": "3:2",
    "832:1248": "2:3",
    "864:1152": "3:4",
    "720:1280": "9:16",
    "1344:576": "21:9",
  };
  return normalized[ratio] ?? null;
}

function isValidDimension(value: number): boolean {
  return Number.isInteger(value) && value >= 512 && value <= 2048 &&
    value % 8 === 0;
}

function clampInteger(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value!)));
}
