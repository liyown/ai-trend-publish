import {
  decodeContentDataUri,
  verifyContentAssetChecksum,
  type ContentAsset,
  type ContentPackage,
} from "@trendpublish/article";
import {
  ConnectorError,
  ConnectorOutcome,
  type WeixinAssetInput,
  type WeixinClient,
} from "@trendpublish/connectors";
import { ChannelId, PublicationTargetStatus } from "@trendpublish/contracts";
import { TaskEffect, UnknownTaskOutcomeError } from "@trendpublish/runtime";
import type { ChannelAdapter } from "../adapter.ts";
import type {
  ChannelAccount,
  PreparedPublication,
  PreparedPublicationInput,
  PublicationMetadataValue,
  PublishReceipt,
  PublishTarget,
} from "../domain.ts";
import {
  articleAssetUri,
  escapeHtmlAttribute,
  renderArticleDocumentHtml,
  type RenderedArticleHtml,
} from "../rendering/article-html-renderer.ts";

export interface LoadedAsset {
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
}

export interface PublicationAssetLoader {
  load(asset: ContentAsset, signal: AbortSignal): Promise<LoadedAsset>;
}

export interface WeixinHtmlRenderer {
  render(
    contentPackage: ContentPackage,
    target: PublishTarget,
    account: ChannelAccount,
  ): Promise<RenderedArticleHtml>;
}

export interface WeixinChannelAdapterOptions {
  resolveClient(connectionId: string): Promise<WeixinClient>;
  assetLoader: PublicationAssetLoader;
  renderer?: WeixinHtmlRenderer;
}

export class WeixinChannelAdapter implements ChannelAdapter {
  readonly id = ChannelId.WeixinOfficialAccount;
  readonly version = "2";
  readonly channel = ChannelId.WeixinOfficialAccount;
  private readonly renderer: WeixinHtmlRenderer;

  constructor(private readonly options: WeixinChannelAdapterOptions) {
    this.renderer = options.renderer ?? new DefaultWeixinHtmlRenderer();
  }

  async prepare(
    contentPackage: ContentPackage,
    target: PublishTarget,
    account: ChannelAccount,
    _context: Parameters<ChannelAdapter["prepare"]>[3],
  ): Promise<PreparedPublicationInput> {
    const cover = contentPackage.assets.find(
      (asset) => asset.id === contentPackage.document.coverAssetId,
    );
    if (!cover) throw new Error("微信公众号发布需要封面素材");
    const rendered = await this.renderer.render(contentPackage, target, account);
    if (!rendered.html.trim()) throw new Error("微信公众号正文渲染结果为空");
    return {
      title: contentPackage.document.title,
      digest: contentPackage.document.digest,
      body: { format: "html", content: rendered.html },
      assets: structuredClone(contentPackage.assets),
      metadata: {
        coverAssetId: cover.id,
        contentAssetIds: rendered.contentAssetIds,
      },
    };
  }

  async publish(
    prepared: PreparedPublication,
    account: ChannelAccount,
    context: Parameters<ChannelAdapter["publish"]>[2],
  ): Promise<PublishReceipt> {
    const client = await this.options.resolveClient(account.connectionId);
    const coverAssetId = stringMetadata(prepared.metadata, "coverAssetId");
    const cover = prepared.assets.find((asset) => asset.id === coverAssetId);
    if (!cover) throw new Error("准备稿缺少封面素材");

    const coverMediaId = await context.task.run(
      {
        id: `upload-cover:${cover.checksum}`,
        version: this.version,
        input: cover,
        effect: TaskEffect.Unsafe,
      },
      async (signal) =>
        callExternalEffect(async () =>
          client.uploadCover(await this.loadAsset(cover, signal, "cover"), {
            signal,
            traceId: context.task.jobId,
          }),
        ),
    );

    let contentHtml = prepared.body.content;
    const contentAssetIds = stringArrayMetadata(prepared.metadata, "contentAssetIds");
    for (const asset of prepared.assets.filter((item) => contentAssetIds.includes(item.id))) {
      const uploadedUrl = await context.task.run(
        {
          id: `upload-content-image:${asset.checksum}`,
          version: this.version,
          input: asset,
          effect: TaskEffect.Unsafe,
        },
        async (signal) =>
          callExternalEffect(async () =>
            client.uploadContentImage(await this.loadAsset(asset, signal, "content"), {
              signal,
              traceId: context.task.jobId,
            }),
          ),
      );
      contentHtml = contentHtml
        .split(articleAssetUri(asset.id))
        .join(escapeHtmlAttribute(uploadedUrl));
    }

    const draft = await context.task.run(
      {
        id: "create-draft",
        version: this.version,
        input: {
          preparedChecksum: prepared.checksum,
          coverMediaId,
          contentHtml,
          idempotencyKey: context.idempotencyKey,
        },
        effect: TaskEffect.Unsafe,
      },
      async (signal) =>
        callExternalEffect(async () =>
          client.createDraft(
            {
              title: prepared.title,
              digest: prepared.digest,
              contentHtml,
              coverMediaId,
            },
            {
              signal,
              traceId: context.task.jobId,
              idempotencyKey: context.idempotencyKey,
            },
          ),
        ),
    );
    return {
      status: PublicationTargetStatus.Succeeded,
      externalId: draft.mediaId,
      url: draft.url,
      publishedAt: context.now().toISOString(),
      metadata: draft.articleId ? { articleId: draft.articleId } : undefined,
    };
  }

  private async loadAsset(
    asset: ContentAsset,
    signal: AbortSignal,
    role: "cover" | "content",
  ): Promise<WeixinAssetInput> {
    const loaded = await this.options.assetLoader.load(asset, signal);
    if (!(await verifyContentAssetChecksum(loaded.bytes, asset.checksum))) {
      throw new Error(`资源 ${asset.id} 的 SHA-256 校验失败，已拒绝上传`);
    }
    const maxBytes = role === "cover" ? 10 * 1024 * 1024 : 1024 * 1024;
    if (loaded.bytes.byteLength > maxBytes) {
      throw new Error(
        role === "cover" ? "封面图片超过微信素材大小限制" : "正文图片超过微信图文图片大小限制",
      );
    }
    return {
      ...loaded,
      sourceUrl: /^https?:\/\//i.test(asset.source.uri) ? asset.source.uri : undefined,
    };
  }
}

export class FetchPublicationAssetLoader implements PublicationAssetLoader {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async load(asset: ContentAsset, signal: AbortSignal): Promise<LoadedAsset> {
    if (asset.source.uri.startsWith("data:")) return loadDataUri(asset.source.uri, asset);
    const response = await this.fetcher(asset.source.uri, { signal });
    if (!response.ok) throw new Error(`素材下载失败：HTTP ${response.status}`);
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim();
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      mimeType: contentType || asset.mimeType || "application/octet-stream",
      filename: assetFilename(asset, contentType),
    };
  }
}

function loadDataUri(uri: string, asset: ContentAsset): LoadedAsset {
  const decoded = decodeContentDataUri(uri);
  const mimeType = decoded.mimeType || asset.mimeType || "application/octet-stream";
  const bytes = decoded.bytes;
  return { bytes, mimeType, filename: assetFilename(asset, mimeType) };
}

export class DefaultWeixinHtmlRenderer implements WeixinHtmlRenderer {
  render(contentPackage: ContentPackage): Promise<RenderedArticleHtml> {
    return Promise.resolve(renderArticleDocumentHtml(contentPackage));
  }
}

async function callExternalEffect<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ConnectorError && error.outcome === ConnectorOutcome.Unknown) {
      throw new UnknownTaskOutcomeError(error.message, { cause: error });
    }
    throw error;
  }
}

function stringMetadata(
  metadata: Record<string, PublicationMetadataValue> | undefined,
  key: string,
): string {
  const value = metadata?.[key];
  return typeof value === "string" ? value : "";
}

function assetFilename(asset: ContentAsset, contentType?: string): string {
  const extension =
    contentType === "image/png"
      ? "png"
      : contentType === "image/webp"
        ? "webp"
        : contentType === "image/gif"
          ? "gif"
          : "jpg";
  return `${asset.id.replace(/[^a-zA-Z0-9_-]/g, "-")}.${extension}`;
}

function stringArrayMetadata(
  metadata: Record<string, PublicationMetadataValue> | undefined,
  key: string,
): string[] {
  const value = metadata?.[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
