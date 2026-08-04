import {
  computeContentAssetChecksum,
  decodeContentDataUri,
  encodeContentDataUri,
  verifyContentAssetChecksum,
  type ContentAsset,
  type ContentPackage,
} from "@trendpublish/article";
import { ReactAgent, type AgentTool } from "@trendpublish/agent";
import {
  ConnectorError,
  ConnectorOutcome,
  describeConnectorError,
  type WeixinAssetInput,
  type WeixinClient,
  type ChatClient,
  type ImageClient,
} from "@trendpublish/connectors";
import {
  ChannelId,
  ChannelVariantSchemaVersion,
  ContentAssetMediaType,
  PublicationTargetStatus,
  type JsonObject,
} from "@trendpublish/contracts";
import { fingerprint, TaskEffect, UnknownTaskOutcomeError } from "@trendpublish/runtime";
import type { ChannelAdapter } from "../adapter.ts";
import type {
  ChannelAccount,
  PreparedPublication,
  PreparedPublicationInput,
  PublicationMetadataValue,
  PublishReceipt,
  PublicationDestination,
} from "../domain.ts";
import {
  articleAssetUri,
  escapeHtmlAttribute,
  renderArticleDocumentHtml,
  type RenderedArticleHtml,
} from "../rendering/article-html-renderer.ts";
import { WEIXIN_ARTICLE_PROFILE, type WeixinArticleVariantPayload } from "./weixin-profile.ts";

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
    destination: PublicationDestination,
    account: ChannelAccount,
  ): Promise<RenderedArticleHtml>;
}

export interface WeixinChannelAdapterOptions {
  resolveClient(connectionId: string): Promise<WeixinClient>;
  assetLoader: PublicationAssetLoader;
  renderer?: WeixinHtmlRenderer;
  /** Test-only fallback; production resolves the content plan model per publication run. */
  model?: ChatClient;
  fetcher?: typeof fetch;
}

export class WeixinChannelAdapter implements ChannelAdapter {
  readonly id = ChannelId.WeixinOfficialAccount;
  readonly version = "2";
  readonly channel = ChannelId.WeixinOfficialAccount;
  readonly publicationType = WEIXIN_ARTICLE_PROFILE.definition.type;
  private readonly renderer: WeixinHtmlRenderer;

  constructor(private readonly options: WeixinChannelAdapterOptions) {
    this.renderer = options.renderer ?? new DefaultWeixinHtmlRenderer();
  }

  async prepare(
    contentPackage: ContentPackage,
    destination: PublicationDestination,
    account: ChannelAccount,
    context: Parameters<ChannelAdapter["prepare"]>[3],
  ): Promise<PreparedPublicationInput> {
    const publicationType = destination.publicationType;
    if (publicationType !== WEIXIN_ARTICLE_PROFILE.definition.type) {
      throw new Error(`微信公众号不支持发布类型 ${publicationType}`);
    }
    const model = context.model ?? this.options.model;
    if (!model) throw new Error("微信公众号渠道适配需要支持 Tool Calling 的生成模型");
    const adapted = await this.adaptWithReact(contentPackage, destination, account, model, context);
    const { payload } = adapted;
    const assets = [...structuredClone(contentPackage.assets), ...adapted.generatedAssets];
    const assetIds = new Set(assets.map((asset) => asset.id));
    if (!assetIds.has(payload.coverAssetId)) throw new Error("微信渠道稿引用了不存在的封面资源");
    for (const assetId of payload.contentAssetIds) {
      if (!assetIds.has(assetId)) throw new Error(`微信渠道稿引用了不存在的正文资源 ${assetId}`);
    }
    const variantBase = {
      schemaVersion: ChannelVariantSchemaVersion,
      packageId: contentPackage.id,
      packageChecksum: contentPackage.checksum,
      destinationId: destination.id,
      channel: this.channel,
      publicationType,
      profileVersion: WEIXIN_ARTICLE_PROFILE.definition.version,
      payload,
      assetIds: [payload.coverAssetId, ...payload.contentAssetIds],
      createdAt: context.now().toISOString(),
    };
    const variantChecksum = await fingerprint(variantBase);
    return {
      title: payload.title,
      digest: payload.digest,
      body: { format: "html", content: payload.contentHtml },
      assets,
      metadata: {
        coverAssetId: payload.coverAssetId,
        contentAssetIds: payload.contentAssetIds,
      },
      variant: {
        ...variantBase,
        id: `variant_${variantChecksum.slice(0, 24)}`,
        checksum: variantChecksum,
      },
    };
  }

  private async adaptWithReact(
    contentPackage: ContentPackage,
    destination: PublicationDestination,
    account: ChannelAccount,
    model: ChatClient,
    context: Parameters<ChannelAdapter["prepare"]>[3],
  ): Promise<{ payload: WeixinArticleVariantPayload; generatedAssets: ContentAsset[] }> {
    const generatedAssets = new Map<string, ContentAsset>();
    const renderTool: AgentTool = {
      name: "render_canonical_html",
      version: "1",
      description: "把共享内容包确定性渲染为安全 HTML 初稿，并返回正文资源 ID。",
      inputSchema: { type: "object", additionalProperties: false, properties: {} },
      execute: async () => {
        const rendered = await this.renderer.render(contentPackage, destination, account);
        return { html: rendered.html, contentAssetIds: rendered.contentAssetIds };
      },
    };
    const createCoverTool: AgentTool = {
      name: "create_cover_asset",
      version: "1",
      description:
        "为当前微信公众号文章生成并冻结可上传封面；返回的 assetId 必须原样用于最终 coverAssetId。",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["prompt", "alt"],
        properties: {
          prompt: { type: "string", minLength: 1 },
          alt: { type: "string", minLength: 1 },
        },
      },
      execute: async (value, toolContext) => {
        const prompt = toolText(value.prompt, "封面提示词");
        const alt = toolText(value.alt, "封面替代文本");
        const asset = await createCoverAsset({
          image: context.image,
          prompt,
          alt,
          signal: toolContext.signal,
          traceId: toolContext.task.jobId,
          taskId: toolContext.task.taskId,
          fetcher: this.options.fetcher ?? fetch,
        });
        generatedAssets.set(asset.id, asset);
        return {
          assetId: asset.id,
          mimeType: asset.mimeType ?? "image/png",
        };
      },
    };
    const payload = await new ReactAgent(model).run({
      system: [
        "你是独立的微信公众号渠道适配 ReAct Agent。只负责当前目标，不执行真实发布。",
        WEIXIN_ARTICLE_PROFILE.instructions,
        "可先调用 render_canonical_html 获得可靠初稿；如果输入资源中没有可用封面，必须调用 create_cover_asset，并把返回的 assetId 原样用于 coverAssetId；最后调用 submit_weixin_article。",
      ].join("\n"),
      user: JSON.stringify({
        master: contentPackage.master ?? null,
        source: contentPackage.source,
        documentTitle: contentPackage.document.title,
        documentDigest: contentPackage.document.digest,
        assets: contentPackage.assets.map((asset) => ({
          id: asset.id,
          mediaType: asset.mediaType,
          alt: asset.alt,
          caption: asset.caption,
        })),
        destination: {
          id: destination.id,
          publicationType: destination.publicationType,
          options: destination.options,
        },
        account: { id: account.id, name: account.name, settings: account.config },
      }),
      tools: [renderTool, createCoverTool],
      terminal: {
        name: "submit_weixin_article",
        description: "提交严格符合微信公众号 Profile 的标题、摘要、HTML 和资源引用。",
        inputSchema: WEIXIN_ARTICLE_PROFILE.outputSchema,
        parse: (value: JsonObject) => {
          const payload = WEIXIN_ARTICLE_PROFILE.parse(value);
          const assetIds = new Set([
            ...contentPackage.assets.map((asset) => asset.id),
            ...generatedAssets.keys(),
          ]);
          if (!assetIds.has(payload.coverAssetId)) {
            throw new Error("微信渠道稿引用了不存在的封面资源");
          }
          for (const assetId of payload.contentAssetIds) {
            if (!assetIds.has(assetId))
              throw new Error(`微信渠道稿引用了不存在的正文资源 ${assetId}`);
          }
          const htmlAssetIds = [...payload.contentHtml.matchAll(/asset:\/\/([^"'\s<]+)/g)].map(
            (match) => decodeURIComponent(match[1] ?? ""),
          );
          for (const assetId of htmlAssetIds) {
            if (!payload.contentAssetIds.includes(assetId)) {
              throw new Error(`微信 HTML 使用了未声明的正文资源 ${assetId}`);
            }
          }
          return payload;
        },
      },
      task: context.task.scope("channel-agent"),
      budget: { maxTurns: 8 },
    });
    return { payload, generatedAssets: [...generatedAssets.values()] };
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

async function createCoverAsset(input: {
  image?: ImageClient;
  prompt: string;
  alt: string;
  signal: AbortSignal;
  traceId: string;
  taskId?: string;
  fetcher: typeof fetch;
}): Promise<ContentAsset> {
  if (!input.image) throw new Error("发布账号未配置可用的图片生成连接");
  let output: Awaited<ReturnType<ImageClient["generate"]>>;
  try {
    output = await input.image.generate(
      { prompt: input.prompt, aspect_ratio: "16:9" },
      {
        signal: input.signal,
        traceId: input.traceId,
        taskId: input.taskId,
      },
    );
  } catch (error) {
    if (input.signal.aborted) throw error;
    throw new Error(`封面图片生成失败：${describeConnectorError(error)}`, { cause: error });
  }

  const first = output.images[0];
  if (!first) throw new Error("图片连接没有返回封面");
  let bytes: Uint8Array;
  let mimeType: string;
  if (first.base64) {
    mimeType = first.mimeType ?? "image/png";
    bytes = decodeContentDataUri(`data:${mimeType};base64,${first.base64}`).bytes;
  } else if (first.url) {
    try {
      const response = await input.fetcher(first.url, { signal: input.signal });
      if (!response.ok) throw new Error(`封面资源下载失败：HTTP ${response.status}`);
      bytes = new Uint8Array(await response.arrayBuffer());
      mimeType =
        response.headers.get("content-type")?.split(";", 1)[0]?.trim() ||
        first.mimeType ||
        "image/jpeg";
    } catch (error) {
      if (input.signal.aborted) throw error;
      throw new Error(`封面资源下载失败：${describeConnectorError(error)}`, { cause: error });
    }
  } else {
    throw new Error("图片连接返回的封面没有 URL 或 Base64 内容");
  }
  if (!bytes.byteLength) throw new Error("图片连接返回了空封面");
  const checksum = await computeContentAssetChecksum(bytes);
  return {
    id: `asset-${checksum.slice(0, 20)}`,
    mediaType: ContentAssetMediaType.Image,
    source: { uri: encodeContentDataUri(bytes, mimeType) },
    mimeType,
    checksum,
    alt: input.alt,
  };
}

function toolText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}不能为空`);
  return value.trim();
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
