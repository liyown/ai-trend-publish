import { ChannelId, type ChannelDefinition, type JsonObject } from "@trendpublish/contracts";
import type { PublicationTypeProfile } from "../profile.ts";

export interface WeixinArticleVariantPayload extends JsonObject {
  title: string;
  digest: string;
  contentHtml: string;
  coverAssetId: string;
  contentAssetIds: string[];
}

export const WEIXIN_CHANNEL_DEFINITION: ChannelDefinition = {
  id: ChannelId.WeixinOfficialAccount,
  name: "微信公众号",
  description: "通过公众号 API 创建 HTML 图文草稿。",
  connectorIds: [ChannelId.WeixinOfficialAccount, "weixin-relay"],
  defaultPublicationType: "article",
};

export const WEIXIN_ARTICLE_PROFILE: PublicationTypeProfile<WeixinArticleVariantPayload> = {
  definition: {
    channel: ChannelId.WeixinOfficialAccount,
    type: "article",
    version: "1",
    name: "微信公众号图文",
    description: "微信公众号 HTML 图文草稿，包含标题、摘要、封面和正文图片。",
    supportedModalities: ["article", "image"],
    requiredArtifacts: ["html", "cover"],
    optionalArtifacts: ["content-images"],
    publisherTools: [
      {
        id: "cover-image",
        name: "封面图片生成",
        description: "为本次微信图文生成发布所需的封面图片。",
        capability: "image",
        required: true,
      },
    ],
  },
  instructions:
    "生成微信公众号图文。正文必须是安全、完整、适合移动端阅读的 HTML；不得包含 script、style、iframe、表单、事件属性或 javascript URL。只引用内容包中存在的资源，图片地址使用 asset://资源ID。",
  outputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["title", "digest", "contentHtml", "coverAssetId", "contentAssetIds"],
    properties: {
      title: { type: "string", minLength: 1, maxLength: 64 },
      digest: { type: "string", minLength: 1, maxLength: 120 },
      contentHtml: { type: "string", minLength: 1 },
      coverAssetId: { type: "string", minLength: 1 },
      contentAssetIds: { type: "array", items: { type: "string" }, uniqueItems: true },
    },
  },
  parse(value) {
    const title = requiredText(value.title, "微信标题");
    const digest = requiredText(value.digest, "微信摘要");
    const contentHtml = requiredText(value.contentHtml, "微信 HTML");
    const coverAssetId = requiredText(value.coverAssetId, "微信封面资源");
    const contentAssetIds = stringArray(value.contentAssetIds, "微信正文资源");
    if (title.length > 64) throw new Error("微信标题不能超过 64 个字符");
    if (digest.length > 120) throw new Error("微信摘要不能超过 120 个字符");
    assertSafeWeixinHtml(contentHtml);
    return { title, digest, contentHtml, coverAssetId, contentAssetIds };
  },
  migrateLegacyOptions(value) {
    return structuredClone(value);
  },
};

function assertSafeWeixinHtml(html: string): void {
  if (/<\/?(?:script|style|iframe|form|object|embed)\b/i.test(html)) {
    throw new Error("微信 HTML 包含禁止标签");
  }
  if (/\son[a-z]+\s*=/i.test(html) || /(?:href|src)\s*=\s*["']\s*javascript:/i.test(html)) {
    throw new Error("微信 HTML 包含不安全属性");
  }
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}不能为空`);
  return value.trim();
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
    throw new Error(`${label}必须是字符串数组`);
  }
  return [...new Set(value.map((item) => String(item).trim()))];
}
