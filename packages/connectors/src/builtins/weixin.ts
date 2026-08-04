import { z } from "zod";
import { ChannelId } from "@trendpublish/contracts";
import { ConnectorError, ConnectorOutcome } from "../errors.ts";
import { defineConnector, type ConnectorCreateContext } from "../definition.ts";
import type { HttpRequest, HttpResponse, HttpTransport } from "../http.ts";
import { defineCapability, type CallContext, type JsonObject } from "../types.ts";

export interface WeixinAssetInput {
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
  sourceUrl?: string;
}

export interface WeixinDraftInput {
  title: string;
  digest: string;
  contentHtml: string;
  coverMediaId: string;
  author?: string;
  needOpenComment?: boolean;
  onlyFansCanComment?: boolean;
}

export interface WeixinDraftResult {
  mediaId: string;
  articleId?: string;
  url?: string;
  raw?: JsonObject;
}

export interface WeixinClient {
  check(context?: CallContext): Promise<string>;
  uploadCover(asset: WeixinAssetInput, context?: CallContext): Promise<string>;
  uploadContentImage(asset: WeixinAssetInput, context?: CallContext): Promise<string>;
  createDraft(input: WeixinDraftInput, context?: CallContext): Promise<WeixinDraftResult>;
}

export const WeixinCapability = defineCapability<WeixinClient>("weixin");

const directSettingsSchema = z.object({
  baseUrl: z.string().url().default("https://api.weixin.qq.com"),
  author: z.string().default(""),
  needOpenComment: z.boolean().default(false),
  onlyFansCanComment: z.boolean().default(false),
});
const directCredentialsSchema = z.object({
  appId: z.string().min(1),
  appSecret: z.string().min(1),
  proxyUrl: z
    .string()
    .url()
    .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
      message: "HTTP 代理地址只支持 http:// 或 https://",
    })
    .optional(),
});
type DirectSettings = z.infer<typeof directSettingsSchema>;
type DirectCredentials = z.infer<typeof directCredentialsSchema>;

const relaySettingsSchema = z.object({
  relayUrl: z.string().url(),
  author: z.string().default(""),
  needOpenComment: z.boolean().default(false),
  onlyFansCanComment: z.boolean().default(false),
});
const relayCredentialsSchema = z.object({
  relayToken: z.string().min(1),
  appId: z.string().min(1),
  appSecret: z.string().min(1),
});
type RelaySettings = z.infer<typeof relaySettingsSchema>;
type RelayCredentials = z.infer<typeof relayCredentialsSchema>;

const tokenOperation = { name: "weixin.token", capability: "weixin" } as const;
const uploadCoverOperation = { name: "weixin.upload-cover", capability: "weixin" } as const;
const uploadContentOperation = {
  name: "weixin.upload-content-image",
  capability: "weixin",
} as const;
const createDraftOperation = { name: "weixin.create-draft", capability: "weixin" } as const;
const relayOperation = { name: "weixin.relay", capability: "weixin" } as const;
const WEIXIN_RELAY_PROTOCOL_VERSION = 2;

export const weixinOfficialAccountConnector = defineConnector({
  id: ChannelId.WeixinOfficialAccount,
  version: 1,
  displayName: "微信公众号",
  description: "由当前服务直接调用微信公众平台 API。",
  capabilities: ["weixin"],
  settingsSchema: directSettingsSchema,
  credentialsSchema: directCredentialsSchema,
  fields: [
    {
      key: "baseUrl",
      location: "settings",
      label: "API 地址",
      input: "url",
      required: true,
      defaultValue: "https://api.weixin.qq.com",
      order: 10,
    },
    {
      key: "author",
      location: "settings",
      label: "默认作者",
      input: "text",
      required: false,
      order: 20,
    },
    {
      key: "needOpenComment",
      location: "settings",
      label: "开启评论",
      input: "boolean",
      required: false,
      order: 30,
    },
    {
      key: "onlyFansCanComment",
      location: "settings",
      label: "仅粉丝评论",
      input: "boolean",
      required: false,
      order: 40,
    },
    {
      key: "appId",
      location: "credentials",
      label: "App ID",
      input: "text",
      required: true,
      order: 50,
    },
    {
      key: "appSecret",
      location: "credentials",
      label: "App Secret",
      input: "password",
      required: true,
      order: 60,
    },
    {
      key: "proxyUrl",
      location: "credentials",
      label: "HTTP 代理地址",
      description: "可选。微信 API 将通过该代理的固定出口 IP 请求，支持用户名和密码。",
      input: "password",
      required: false,
      placeholder: "http://username:password@proxy.example.com:8080",
      order: 70,
    },
  ],
  requestOverrides: true,
  create(context) {
    return { weixin: new DirectWeixinClient(context) };
  },
  async check(context, signal) {
    return await new DirectWeixinClient(context).check({ signal });
  },
});

export const weixinRelayConnector = defineConnector({
  id: "weixin-relay",
  version: 1,
  displayName: "微信 Relay",
  description: "通过固定出口 IP 的 Relay 调用微信公众平台。",
  capabilities: ["weixin"],
  settingsSchema: relaySettingsSchema,
  credentialsSchema: relayCredentialsSchema,
  fields: [
    {
      key: "relayUrl",
      location: "settings",
      label: "Relay 地址",
      input: "url",
      required: true,
      order: 10,
    },
    {
      key: "author",
      location: "settings",
      label: "默认作者",
      input: "text",
      required: false,
      order: 20,
    },
    {
      key: "needOpenComment",
      location: "settings",
      label: "开启评论",
      input: "boolean",
      required: false,
      order: 30,
    },
    {
      key: "onlyFansCanComment",
      location: "settings",
      label: "仅粉丝评论",
      input: "boolean",
      required: false,
      order: 40,
    },
    {
      key: "relayToken",
      location: "credentials",
      label: "Relay Token",
      input: "password",
      required: true,
      order: 50,
    },
    {
      key: "appId",
      location: "credentials",
      label: "App ID",
      input: "text",
      required: true,
      order: 60,
    },
    {
      key: "appSecret",
      location: "credentials",
      label: "App Secret",
      input: "password",
      required: true,
      order: 70,
    },
  ],
  requestOverrides: true,
  create(context) {
    return { weixin: new RelayWeixinClient(context) };
  },
  async check(context, signal) {
    return await new RelayWeixinClient(context).check({ signal });
  },
});

interface TokenResponse extends JsonObject {
  access_token: string;
  expires_in: number;
}

class DirectWeixinClient implements WeixinClient {
  private token?: { value: string; expiresAt: number };
  private readonly proxyTransport?: HttpTransport;

  constructor(private readonly context: ConnectorCreateContext<DirectSettings, DirectCredentials>) {
    if (context.credentials.proxyUrl) {
      this.proxyTransport = context.proxyTransport(context.credentials.proxyUrl);
    }
  }

  async check(callContext: CallContext = {}): Promise<string> {
    await this.accessToken(callContext);
    return "连接成功，微信凭证有效";
  }

  async uploadCover(asset: WeixinAssetInput, callContext: CallContext = {}): Promise<string> {
    const token = await this.accessToken(callContext);
    const form = assetForm(asset);
    const response = await this.request(
      uploadCoverOperation,
      {
        url: tokenUrl(this.context.settings.baseUrl, "/cgi-bin/material/add_material", token, {
          type: "image",
        }),
        method: "POST",
        body: form,
      },
      callContext,
    );
    const data = assertWeixinResponse<{ media_id?: string }>(response.json());
    if (!data.media_id) throw invalidResponse("微信未返回封面素材 ID");
    return data.media_id;
  }

  async uploadContentImage(
    asset: WeixinAssetInput,
    callContext: CallContext = {},
  ): Promise<string> {
    const token = await this.accessToken(callContext);
    const response = await this.request(
      uploadContentOperation,
      {
        url: tokenUrl(this.context.settings.baseUrl, "/cgi-bin/media/uploadimg", token),
        method: "POST",
        body: assetForm(asset),
      },
      callContext,
    );
    const data = assertWeixinResponse<{ url?: string }>(response.json());
    if (!data.url) throw invalidResponse("微信未返回正文图片 URL");
    return data.url;
  }

  async createDraft(
    input: WeixinDraftInput,
    callContext: CallContext = {},
  ): Promise<WeixinDraftResult> {
    const token = await this.accessToken(callContext);
    const response = await this.request(
      createDraftOperation,
      {
        url: tokenUrl(this.context.settings.baseUrl, "/cgi-bin/draft/add", token),
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          articles: [
            {
              title: input.title,
              author: input.author ?? this.context.settings.author,
              digest: input.digest,
              content: input.contentHtml,
              thumb_media_id: input.coverMediaId,
              need_open_comment:
                (input.needOpenComment ?? this.context.settings.needOpenComment) ? 1 : 0,
              only_fans_can_comment:
                (input.onlyFansCanComment ?? this.context.settings.onlyFansCanComment) ? 1 : 0,
            },
          ],
        }),
      },
      callContext,
    );
    const data = assertWeixinResponse<{ media_id?: string; article_id?: string }>(response.json());
    if (!data.media_id) throw invalidResponse("微信未返回草稿 ID");
    return {
      mediaId: data.media_id,
      articleId: data.article_id,
      url: `https://mp.weixin.qq.com/s/${data.media_id}`,
      raw: data as JsonObject,
    };
  }

  private async accessToken(callContext: CallContext): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const url = new URL("/cgi-bin/token", this.context.settings.baseUrl);
    url.searchParams.set("grant_type", "client_credential");
    url.searchParams.set("appid", this.context.credentials.appId);
    url.searchParams.set("secret", this.context.credentials.appSecret);
    const response = await this.request(tokenOperation, { url: url.href }, callContext);
    const data = assertWeixinResponse<Partial<TokenResponse>>(response.json());
    if (!data.access_token || typeof data.expires_in !== "number") {
      throw invalidResponse("微信未返回有效 access_token");
    }
    this.token = {
      value: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    return this.token.value;
  }

  private request(
    operation:
      | typeof tokenOperation
      | typeof uploadCoverOperation
      | typeof uploadContentOperation
      | typeof createDraftOperation,
    request: HttpRequest,
    callContext: CallContext,
  ): Promise<HttpResponse> {
    return this.proxyTransport
      ? this.context.executeWithTransport(this.proxyTransport, operation, request, callContext)
      : this.context.execute(operation, request, callContext);
  }
}

class RelayWeixinClient implements WeixinClient {
  constructor(private readonly context: ConnectorCreateContext<RelaySettings, RelayCredentials>) {}

  async check(callContext: CallContext = {}): Promise<string> {
    const result = await this.request<{ result: string | boolean; protocolVersion?: number }>(
      "/api/weixin/validate-ip",
      {},
      callContext,
    );
    if (result.protocolVersion !== WEIXIN_RELAY_PROTOCOL_VERSION) {
      throw invalidResponse("微信 Relay 版本过旧，请升级 Relay 后重试");
    }
    return "连接成功，微信 Relay 可用";
  }

  async uploadCover(asset: WeixinAssetInput, callContext: CallContext = {}): Promise<string> {
    const payload = await assetPayload(asset);
    const result = await this.request<{ mediaId: string; receivedChecksum?: string }>(
      "/api/weixin/upload-image",
      payload,
      callContext,
    );
    assertRelayAssetReceipt(result.receivedChecksum, payload.checksum);
    return result.mediaId;
  }

  async uploadContentImage(
    asset: WeixinAssetInput,
    callContext: CallContext = {},
  ): Promise<string> {
    const payload = await assetPayload(asset);
    const result = await this.request<{ url: string; receivedChecksum?: string }>(
      "/api/weixin/upload-content-image",
      payload,
      callContext,
    );
    assertRelayAssetReceipt(result.receivedChecksum, payload.checksum);
    return result.url;
  }

  async createDraft(
    input: WeixinDraftInput,
    callContext: CallContext = {},
  ): Promise<WeixinDraftResult> {
    const result = await this.request<{
      publishId?: string;
      mediaId?: string;
      url?: string;
      coverMediaId?: string;
    }>(
      "/api/weixin/publish",
      {
        title: input.title,
        digest: input.digest,
        content: input.contentHtml,
        coverMediaId: input.coverMediaId,
      },
      callContext,
    );
    if (result.coverMediaId !== input.coverMediaId) {
      throw relayReceiptMismatch("微信 Relay 未确认草稿使用了本次上传的封面素材，请升级 Relay");
    }
    const mediaId = result.mediaId ?? result.publishId;
    if (!mediaId) throw invalidResponse("微信 Relay 未返回草稿 ID");
    return { mediaId, url: result.url, raw: result as JsonObject };
  }

  private async request<T>(path: string, payload: unknown, callContext: CallContext): Promise<T> {
    const response = await this.context.execute(
      relayOperation,
      {
        url: `${this.context.settings.relayUrl.replace(/\/+$/, "")}${path}`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ account: this.account(), payload }),
      },
      callContext,
      { Authorization: `Bearer ${this.context.credentials.relayToken}` },
    );
    const result = response.json<{ success?: boolean; data?: T; error?: string }>();
    if (!result.success || result.data === undefined) {
      throw new ConnectorError({
        kind: "provider",
        message: result.error ?? "微信 Relay 返回失败",
      });
    }
    return result.data;
  }

  private account() {
    return {
      appId: this.context.credentials.appId,
      appSecret: this.context.credentials.appSecret,
      author: this.context.settings.author,
      needOpenComment: this.context.settings.needOpenComment,
      onlyFansCanComment: this.context.settings.onlyFansCanComment,
    };
  }
}

function assertWeixinResponse<T>(value: T & { errcode?: number; errmsg?: string }): T {
  if (value.errcode && value.errcode !== 0) {
    throw new ConnectorError({
      kind: classifyWeixinError(value.errcode),
      message: `微信 API 错误 ${value.errcode}: ${value.errmsg ?? "unknown error"}`,
      providerCode: String(value.errcode),
    });
  }
  return value;
}

function classifyWeixinError(code: number): ConnectorError["kind"] {
  if ([40001, 40013, 40125, 40164, 48001].includes(code)) return "authentication";
  if ([45009, 45011].includes(code)) return "rate_limit";
  if ([45008, 45028].includes(code)) return "quota";
  return "provider";
}

function tokenUrl(
  baseUrl: string,
  path: string,
  token: string,
  params: Record<string, string> = {},
): string {
  const url = new URL(path, baseUrl);
  url.searchParams.set("access_token", token);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.href;
}

function assetForm(asset: WeixinAssetInput): FormData {
  const form = new FormData();
  const buffer = new ArrayBuffer(asset.bytes.byteLength);
  new Uint8Array(buffer).set(asset.bytes);
  form.append("media", new Blob([buffer], { type: asset.mimeType }), asset.filename);
  return form;
}

async function assetPayload(asset: WeixinAssetInput) {
  return {
    imageUrl: asset.sourceUrl,
    imageBufferBase64: bytesToBase64(asset.bytes),
    mimeType: asset.mimeType,
    filename: asset.filename,
    checksum: await sha256(asset.bytes),
  };
}

function assertRelayAssetReceipt(received: string | undefined, expected: string): void {
  if (received !== expected) {
    throw relayReceiptMismatch("微信 Relay 未确认收到本次上传的图片，请升级 Relay 后重试");
  }
}

function relayReceiptMismatch(message: string): ConnectorError {
  return new ConnectorError({
    kind: "invalid_response",
    message,
    outcome: ConnectorOutcome.Unknown,
  });
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
}

function invalidResponse(message: string): ConnectorError {
  return new ConnectorError({ kind: "invalid_response", message });
}
