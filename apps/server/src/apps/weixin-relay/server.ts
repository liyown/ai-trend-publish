import {
  createStandaloneConnectorClients,
  weixinOfficialAccountConnector,
  type WeixinAssetInput,
  type WeixinClient,
  type WeixinDraftInput,
} from "@trendpublish/connectors";
import { initializeAppConfig } from "@trendpublish/core/config";
import { Logger } from "@trendpublish/core/logging";
import { serveFetch } from "@trendpublish/core/node";
import { redactSensitiveText } from "@trendpublish/core/utilities";

const logger = new Logger("weixin-relay");
const WEIXIN_RELAY_PROTOCOL_VERSION = 2;
const config = initializeAppConfig();
if (!config.server.apiKey.trim()) throw new Error("weixin-relay 需要 server.apiKey");
const port = Number(process.env.PORT ?? config.server.port ?? 8080);

serveFetch({ port }, async (request) => {
  const url = new URL(request.url);
  if (request.method === "GET" && url.pathname === "/health") {
    return Response.json({
      ok: true,
      service: "weixin-relay",
      timestamp: new Date().toISOString(),
    });
  }
  if (!(await authorized(request, config.server.apiKey))) {
    return Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const body = await readRequest(request);
    const client = createClient(body.account);
    if (request.method === "POST" && url.pathname === "/api/weixin/validate-ip") {
      return ok({
        result: await client.check(),
        protocolVersion: WEIXIN_RELAY_PROTOCOL_VERSION,
      });
    }
    if (request.method === "POST" && url.pathname === "/api/weixin/upload-image") {
      const asset = await verifiedAssetInput(body.payload);
      return ok({
        mediaId: await client.uploadCover(asset.input),
        receivedChecksum: asset.checksum,
      });
    }
    if (request.method === "POST" && url.pathname === "/api/weixin/upload-content-image") {
      const asset = await verifiedAssetInput(body.payload);
      return ok({
        url: await client.uploadContentImage(asset.input),
        receivedChecksum: asset.checksum,
      });
    }
    if (request.method === "POST" && url.pathname === "/api/weixin/publish") {
      const draft = draftInput(body.payload);
      return ok({ ...(await client.createDraft(draft)), coverMediaId: draft.coverMediaId });
    }
    return Response.json({ success: false, error: "Not Found" }, { status: 404 });
  } catch (error) {
    const message = redactSensitiveText(error instanceof Error ? error.message : String(error));
    logger.error("Relay request failed:", message);
    return Response.json({ success: false, error: message }, { status: 500 });
  }
});

logger.info(`Weixin relay listening on http://0.0.0.0:${port}`);

interface RelayAccount {
  appId: string;
  appSecret: string;
  author?: string;
  needOpenComment?: boolean;
  onlyFansCanComment?: boolean;
}

interface RelayRequest {
  account: RelayAccount;
  payload: Record<string, unknown>;
}

async function readRequest(request: Request): Promise<RelayRequest> {
  const body = (await request.json()) as Partial<RelayRequest>;
  if (!body.account?.appId?.trim() || !body.account.appSecret?.trim()) {
    throw new Error("account.appId 和 account.appSecret 必填");
  }
  return { account: body.account, payload: body.payload ?? {} };
}

function createClient(account: RelayAccount): WeixinClient {
  const clients = createStandaloneConnectorClients(weixinOfficialAccountConnector, {
    id: `relay-${account.appId}`,
    settings: {
      baseUrl: "https://api.weixin.qq.com",
      author: account.author ?? "",
      needOpenComment: account.needOpenComment ?? false,
      onlyFansCanComment: account.onlyFansCanComment ?? false,
    },
    credentials: { appId: account.appId, appSecret: account.appSecret },
  });
  return clients.weixin!;
}

async function assetInput(payload: Record<string, unknown>): Promise<WeixinAssetInput> {
  const mimeType = typeof payload.mimeType === "string" ? payload.mimeType : "image/jpeg";
  const filename = typeof payload.filename === "string" ? payload.filename : "image.jpg";
  const base64 = typeof payload.imageBufferBase64 === "string" ? payload.imageBufferBase64 : "";
  if (base64) return { bytes: base64Bytes(base64), mimeType, filename };
  const imageUrl = typeof payload.imageUrl === "string" ? payload.imageUrl : "";
  if (!imageUrl) throw new Error("图片内容为空");
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`图片下载失败：HTTP ${response.status}`);
  return {
    bytes: new Uint8Array(await response.arrayBuffer()),
    mimeType: response.headers.get("content-type")?.split(";")[0] || mimeType,
    filename,
    sourceUrl: imageUrl,
  };
}

async function verifiedAssetInput(
  payload: Record<string, unknown>,
): Promise<{ input: WeixinAssetInput; checksum: string }> {
  const input = await assetInput(payload);
  const checksum = await sha256(input.bytes);
  if (typeof payload.checksum !== "string" || payload.checksum !== checksum) {
    throw new Error("图片校验和不一致，Relay 已拒绝上传");
  }
  return { input, checksum };
}

function draftInput(payload: Record<string, unknown>): WeixinDraftInput {
  const required = (key: string) => {
    const value = payload[key];
    if (typeof value !== "string" || !value.trim()) throw new Error(`${key} 必填`);
    return value;
  };
  return {
    title: required("title"),
    digest: required("digest"),
    contentHtml: required("content"),
    coverMediaId: required("coverMediaId"),
  };
}

async function authorized(request: Request, expected: string): Promise<boolean> {
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(provided)),
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(expected)),
  ]);
  const a = new Uint8Array(left);
  const b = new Uint8Array(right);
  let different = provided.length === expected.length ? 0 : 1;
  for (let index = 0; index < a.length; index++) different |= a[index] ^ b[index];
  return Boolean(provided) && different === 0;
}

function base64Bytes(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", buffer));
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function ok(data: unknown): Response {
  return Response.json({ success: true, data }, { headers: { "Cache-Control": "no-store" } });
}
