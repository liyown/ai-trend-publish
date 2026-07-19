import { z } from "zod";
import { ConnectorError } from "../errors.ts";
import { defineConnector, type ConnectorCreateContext } from "../definition.ts";
import type {
  JsonObject,
  NotificationClient,
  NotificationInput,
  NotificationOutput,
} from "../types.ts";

const emptySettingsSchema = z.object({});
type EmptySettings = z.infer<typeof emptySettingsSchema>;
const barkCredentialsSchema = z.object({ url: z.string().url() });
const dingTalkCredentialsSchema = z.object({ webhook: z.string().url() });
const feishuCredentialsSchema = z.object({ webhookUrl: z.string().url() });
type BarkCredentials = z.infer<typeof barkCredentialsSchema>;
type DingTalkCredentials = z.infer<typeof dingTalkCredentialsSchema>;
type FeishuCredentials = z.infer<typeof feishuCredentialsSchema>;

const sendOperation = {
  name: "notification.send",
  capability: "notification",
} as const;

export const barkConnector = defineConnector({
  id: "bark",
  version: 1,
  displayName: "Bark",
  description: "向 Bark 设备发送运行通知。",
  capabilities: ["notification"],
  settingsSchema: emptySettingsSchema,
  credentialsSchema: barkCredentialsSchema,
  fields: [
    { key: "url", location: "credentials", label: "服务地址", input: "password", required: true },
  ],
  requestOverrides: true,
  create(context) {
    return { notification: new BarkClient(context) };
  },
  async check(context, signal) {
    const client = new BarkClient(context);
    await client.send({ title: "TrendPublish", content: "Connector 连接测试成功" }, { signal });
    return "测试通知已发送到 Bark";
  },
});

export const dingTalkConnector = defineConnector({
  id: "dingtalk",
  version: 1,
  displayName: "钉钉",
  description: "通过钉钉机器人发送运行通知。",
  capabilities: ["notification"],
  settingsSchema: emptySettingsSchema,
  credentialsSchema: dingTalkCredentialsSchema,
  fields: [
    {
      key: "webhook",
      location: "credentials",
      label: "Webhook",
      input: "password",
      required: true,
    },
  ],
  requestOverrides: true,
  create(context) {
    return { notification: new DingTalkClient(context) };
  },
  async check(context, signal) {
    const client = new DingTalkClient(context);
    await client.send({ title: "TrendPublish", content: "Connector 连接测试成功" }, { signal });
    return "测试通知已发送到钉钉";
  },
});

export const feishuConnector = defineConnector({
  id: "feishu",
  version: 1,
  displayName: "飞书",
  description: "通过飞书机器人发送运行通知。",
  capabilities: ["notification"],
  settingsSchema: emptySettingsSchema,
  credentialsSchema: feishuCredentialsSchema,
  fields: [
    {
      key: "webhookUrl",
      location: "credentials",
      label: "Webhook",
      input: "password",
      required: true,
    },
  ],
  requestOverrides: true,
  create(context) {
    return { notification: new FeishuClient(context) };
  },
  async check(context, signal) {
    const client = new FeishuClient(context);
    await client.send({ title: "TrendPublish", content: "Connector 连接测试成功" }, { signal });
    return "测试通知已发送到飞书";
  },
});

class BarkClient implements NotificationClient {
  constructor(private readonly context: ConnectorCreateContext<EmptySettings, BarkCredentials>) {}

  async send(input: NotificationInput, callContext = {}): Promise<NotificationOutput> {
    const params = new URLSearchParams();
    if (input.level) params.set("level", input.level);
    if (input.url) params.set("url", input.url);
    for (const [key, value] of Object.entries(input.extras ?? {})) {
      if (typeof value === "string") params.set(key, value);
      else if (typeof value === "number" || typeof value === "boolean") {
        params.set(key, String(value));
      }
    }
    const base = this.context.credentials.url.replace(/\/+$/, "");
    const suffix = params.size ? `?${params.toString()}` : "";
    await this.context.execute(
      sendOperation,
      {
        url: `${base}/${encodeURIComponent(input.title)}/${encodeURIComponent(input.content)}${suffix}`,
        method: "GET",
      },
      callContext,
    );
    return { accepted: true };
  }
}

class DingTalkClient implements NotificationClient {
  constructor(
    private readonly context: ConnectorCreateContext<EmptySettings, DingTalkCredentials>,
  ) {}

  async send(input: NotificationInput, callContext = {}): Promise<NotificationOutput> {
    const response = await this.context.execute(
      sendOperation,
      {
        url: this.context.credentials.webhook,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          msgtype: "text",
          text: { content: formatMessage(input) },
          at: { isAtAll: input.level === "timeSensitive" },
        }),
      },
      callContext,
    );
    const data = response.json<Record<string, unknown>>();
    if (typeof data.errcode === "number" && data.errcode !== 0) {
      throw new ConnectorError({
        kind: "provider",
        message: typeof data.errmsg === "string" ? data.errmsg : "钉钉拒绝了通知",
        providerCode: String(data.errcode),
      });
    }
    return {
      accepted: true,
      requestId: typeof data.request_id === "string" ? data.request_id : undefined,
      raw: data as JsonObject,
    };
  }
}

class FeishuClient implements NotificationClient {
  constructor(private readonly context: ConnectorCreateContext<EmptySettings, FeishuCredentials>) {}

  async send(input: NotificationInput, callContext = {}): Promise<NotificationOutput> {
    const response = await this.context.execute(
      sendOperation,
      {
        url: this.context.credentials.webhookUrl,
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({
          msg_type: "text",
          content: { text: formatMessage(input) },
        }),
      },
      callContext,
    );
    const data = response.json<Record<string, unknown>>();
    const code = firstNumber(data.code, data.errcode, data.StatusCode);
    if (code !== undefined && code !== 0) {
      throw new ConnectorError({
        kind: "provider",
        message: typeof data.msg === "string" ? data.msg : "飞书拒绝了通知",
        providerCode: String(code),
      });
    }
    return {
      accepted: true,
      requestId: typeof data.request_id === "string" ? data.request_id : undefined,
      raw: data as JsonObject,
    };
  }
}

function formatMessage(input: NotificationInput): string {
  return `${input.title}\n${input.content}${input.url ? `\n${input.url}` : ""}`;
}

function firstNumber(...values: unknown[]): number | undefined {
  return values.find((value): value is number => typeof value === "number");
}
