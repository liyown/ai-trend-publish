import { assertEquals, assertRejects } from "@std/assert";
import { HttpClient } from "@src/utils/http/http-client.ts";
import {
  MINIMAX_DEFAULT_IMAGE_MODEL,
  MiniMaxImageGenerator,
} from "@src/integrations/image/providers/minimax/minimax-image-generator.ts";

Deno.test("MiniMaxImageGenerator posts image generation request", async () => {
  let capturedUrl = "";
  let capturedBody: Record<string, unknown> = {};
  const httpClient = {
    request: async <T>(url: string, options: RequestInit): Promise<T> => {
      capturedUrl = url;
      capturedBody = JSON.parse(String(options.body));
      return {
        data: {
          image_urls: ["https://example.com/minimax-image.png"],
        },
        base_resp: { status_code: 0 },
      } as T;
    },
  } as unknown as HttpClient;

  const generator = new MiniMaxImageGenerator(
    "minimax-key",
    "https://api.minimax.io/",
    httpClient,
  );
  await generator.initialize();
  const imageUrl = await generator.generate({
    prompt: "一张公众号正文配图",
    model: "image-01",
    size: "1024*1024",
    n: 2,
  });

  assertEquals(capturedUrl, "https://api.minimax.io/v1/image_generation");
  assertEquals(capturedBody.model, "image-01");
  assertEquals(capturedBody.prompt, "一张公众号正文配图");
  assertEquals(capturedBody.aspect_ratio, "1:1");
  assertEquals(capturedBody.n, 2);
  assertEquals(imageUrl, "https://example.com/minimax-image.png");
});

Deno.test("MiniMaxImageGenerator falls back from DashScope model ids", async () => {
  let capturedBody: Record<string, unknown> = {};
  const httpClient = {
    request: async <T>(_url: string, options: RequestInit): Promise<T> => {
      capturedBody = JSON.parse(String(options.body));
      return {
        data: {
          image_base64: ["abc"],
        },
        base_resp: { status_code: 0 },
      } as T;
    },
  } as unknown as HttpClient;

  const generator = new MiniMaxImageGenerator(
    "minimax-key",
    undefined,
    httpClient,
  );
  await generator.initialize();
  const image = await generator.generate({
    title: "标题",
    prompt_text_zh: "专业配图",
    model: "qwen-image-2.0-pro",
  });

  assertEquals(capturedBody.model, MINIMAX_DEFAULT_IMAGE_MODEL);
  assertEquals(image, "data:image/jpeg;base64,abc");
});

Deno.test("MiniMaxImageGenerator requires api key", async () => {
  const generator = new MiniMaxImageGenerator("");
  await assertRejects(
    () => generator.initialize(),
    Error,
    "providers.image.minimax.apiKey is not set",
  );
});

Deno.test("H3 uses the configured host and returns the first successful output", async () => {
  const prompt = "A landscape. ".repeat(150).trim();
  const httpClient = {
    request: async <T>(
      url: string,
      req: RequestInit & { timeout: number; retries: number },
    ): Promise<T> => {
      assertEquals(url, "https://api.minimax.cn/v1/images/generations");
      assertEquals(req.retries, 1);
      assertEquals(req.timeout, 600_000);
      assertEquals(req.method, "POST");
      assertEquals(new Headers(req.headers).get("Authorization"), "Bearer key");
      assertEquals(JSON.parse(String(req.body)), {
        model: "MiniMax-H3-Image",
        prompt,
        n: 10,
        response_format: "url",
        size: "2720x1536",
      });
      return {
        data: [{ error: { message: "withheld" } }, {
          url: "https://example.com/map.jpg",
        }],
      } as T;
    },
  } as unknown as HttpClient;
  const gen = new MiniMaxImageGenerator(
    "key",
    "https://api.minimax.cn/",
    httpClient,
  );
  await gen.initialize();
  assertEquals(
    await gen.generate({
      model: "MiniMax-H3-Image",
      prompt,
      n: 10,
      size: "2720*1536",
    }),
    "https://example.com/map.jpg",
  );
});

Deno.test("H3 Highspeed maps base64 and aspect ratio options", async () => {
  const httpClient = {
    request: async <T>(url: string, req: RequestInit): Promise<T> => {
      assertEquals(url, "https://api.minimax.io/v1/images/generations");
      assertEquals(JSON.parse(String(req.body)), {
        model: "MiniMax-H3-Image-Highspeed",
        prompt: "A map",
        n: 1,
        response_format: "b64_json",
        aspect_ratio: "3:2",
        disable_prompt_enhanced: true,
      });
      return { data: [{ b64_json: "YWJj" }] } as T;
    },
  } as unknown as HttpClient;
  const gen = new MiniMaxImageGenerator("key", undefined, httpClient);
  await gen.initialize();
  assertEquals(
    await gen.generate({
      model: "MiniMax-H3-Image-Highspeed",
      prompt: "A map",
      response_format: "base64",
      size: "1024*1024",
      aspect_ratio: "3:2",
      prompt_optimizer: false,
    }),
    "data:image/jpeg;base64,YWJj",
  );
});

Deno.test("H3 reports a per-image error when no image was returned", async () => {
  const gen = new MiniMaxImageGenerator("key", undefined, {
    request: () =>
      Promise.resolve({ data: [{ error: { message: "withheld" } }] }),
  } as unknown as HttpClient);
  await gen.initialize();
  await assertRejects(
    () => gen.generate({ model: "MiniMax-H3-Image", prompt: "A map" }),
    Error,
    "withheld",
  );
});
