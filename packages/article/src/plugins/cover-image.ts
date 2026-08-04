import { ArticlePluginId, ContentAssetMediaType } from "@trendpublish/contracts";
import {
  computeContentAssetChecksum,
  decodeContentDataUri,
  encodeContentDataUri,
} from "../asset-integrity.ts";
import type { AssetNecessity, ContentAsset, WorkingArticle } from "../domain.ts";
import type { ArticleOperationContext, ArticleTransformer, AssetProvider } from "../extensions.ts";

export interface CoverRequestTransformerOptions {
  necessity?: AssetNecessity;
  style?: string;
  requestId?: string;
}

/** Declares cover intent; actual generation remains an AssetProvider concern. */
export class CoverRequestTransformer implements ArticleTransformer {
  readonly id = `${ArticlePluginId.CoverImage}-request`;
  readonly version = "1";

  constructor(private readonly options: CoverRequestTransformerOptions = {}) {}

  transform(input: Parameters<ArticleTransformer["transform"]>[0]): Promise<WorkingArticle> {
    if (input.article.assetRequests.some((request) => request.type === "cover")) {
      return Promise.resolve(structuredClone(input.article));
    }
    return Promise.resolve({
      ...structuredClone(input.article),
      assetRequests: [
        ...structuredClone(input.article.assetRequests),
        {
          id: this.options.requestId?.trim() || "cover-main",
          type: "cover",
          necessity: this.options.necessity ?? "essential",
          brief: [
            `为文章《${input.article.source.title}》生成横版封面`,
            input.article.source.digest,
            this.options.style ? `视觉风格：${this.options.style}` : undefined,
          ]
            .filter(Boolean)
            .join("。 "),
          alt: `${input.article.source.title}封面`,
        },
      ],
    });
  }
}

export interface CoverImageGenerator {
  generate(
    input: { title: string; prompt: string },
    context: CoverImageGenerationContext,
  ): Promise<{ uri: string; mimeType?: string; width?: number; height?: number }>;
}

/** Runtime correlation needed by an image connector without exposing article internals. */
export interface CoverImageGenerationContext {
  signal: AbortSignal;
  jobId: string;
  taskId?: string;
}

export interface CoverImageProviderOptions {
  generator?: CoverImageGenerator;
  style?: string;
  fetcher?: typeof fetch;
}

export class CoverImageProvider implements AssetProvider {
  readonly id = ArticlePluginId.CoverImage;
  readonly version = "1";

  constructor(private readonly options: CoverImageProviderOptions) {}

  async provide(
    input: Parameters<AssetProvider["provide"]>[0],
    context: ArticleOperationContext,
  ): Promise<ContentAsset> {
    if (input.request.type !== "cover") {
      throw new Error(`CoverImageProvider 不支持 ${input.request.type}`);
    }
    const prompt = [
      input.request.brief,
      `文章：《${input.article.source.title}》`,
      `账号定位：${input.identity.positioning}`,
      `视觉风格：${this.options.style ?? "克制、现代、编辑感，不要文字和水印"}`,
    ].join("。 ");
    let generated: Awaited<ReturnType<CoverImageGenerator["generate"]>> & {
      fallback?: boolean;
    };
    try {
      if (!this.options.generator) throw new Error("没有配置图片连接");
      generated = await this.options.generator.generate(
        { title: input.article.source.title, prompt },
        {
          signal: context.signal,
          jobId: context.task.jobId,
          ...(context.task.taskId ? { taskId: context.task.taskId } : {}),
        },
      );
    } catch (error) {
      if (context.signal.aborted) throw error;
      generated = {
        uri: DEFAULT_COVER_DATA_URI,
        mimeType: "image/png",
        width: 900,
        height: 383,
        fallback: true,
      };
    }
    const frozen = await materializeGeneratedImage(
      generated,
      context.signal,
      this.options.fetcher ?? fetch,
    );
    const checksum = await computeContentAssetChecksum(frozen.bytes);
    return {
      id: `asset-${checksum.slice(0, 20)}`,
      mediaType: ContentAssetMediaType.Image,
      source: { uri: encodeContentDataUri(frozen.bytes, frozen.mimeType) },
      mimeType: frozen.mimeType,
      checksum,
      width: generated.width,
      height: generated.height,
      alt: input.request.alt ?? `${input.article.source.title}封面`,
      caption: input.request.caption,
      ...(generated.fallback ? { metadata: { fallback: true } } : {}),
    };
  }
}

// A neutral 900x383 PNG keeps channel-required cover creation publishable when an image
// connector is absent or temporarily unavailable. It is intentionally text-free.
const DEFAULT_COVER_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAA4QAAAF/CAMAAAAmWvf6AAAAA1BMVEUYJjqwnZWEAAABZUlEQVR42u3BMQEAAADCoPVPbQ0PoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4MURGAAFVW6AAAAAAAElFTkSuQmCC";

async function materializeGeneratedImage(
  generated: Awaited<ReturnType<CoverImageGenerator["generate"]>>,
  signal: AbortSignal,
  fetcher: typeof fetch,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  if (generated.uri.startsWith("data:")) {
    const decoded = decodeContentDataUri(generated.uri);
    if (decoded.bytes.byteLength === 0) throw new Error("封面生成结果为空");
    return {
      bytes: decoded.bytes,
      mimeType: decoded.mimeType ?? generated.mimeType ?? "application/octet-stream",
    };
  }
  if (!/^https?:\/\//i.test(generated.uri)) {
    throw new Error("封面生成器必须返回 HTTP(S) URL 或 Data URI");
  }

  const response = await fetcher(generated.uri, { signal });
  if (!response.ok) throw new Error(`封面资源下载失败：HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0) throw new Error("封面生成结果为空");
  return {
    bytes,
    mimeType:
      response.headers.get("content-type")?.split(";", 1)[0]?.trim() ||
      generated.mimeType ||
      "application/octet-stream",
  };
}
