import { expect, test } from "vite-plus/test";
import type { ContentPackage } from "@trendpublish/article";
import { ConnectorError, type WeixinClient } from "@trendpublish/connectors";
import { MemoryTaskStore, TaskNeedsAttentionError, TaskRunner } from "@trendpublish/runtime";
import type { ChannelAccount, PreparedPublication, PublishTarget } from "../domain.ts";
import { WeixinChannelAdapter } from "./weixin.ts";

test("weixin adapter checkpoints uploads and draft creation independently", async () => {
  const calls = { cover: 0, content: 0, draft: 0 };
  const adapter = adapterWithClient(client(calls));
  const account = channelAccount();
  const target = publishTarget();
  const input = await adapter.prepare(contentPackage(), target, account, {
    task: new TaskRunner(new MemoryTaskStore()).forJob("prepare"),
    now: fixedNow,
  });
  const prepared = preparedPublication(input);
  const task = new TaskRunner(new MemoryTaskStore()).forJob("publish");
  const receipt = await adapter.publish(prepared, account, {
    task,
    idempotencyKey: "publish-key",
    now: fixedNow,
  });

  expect(receipt.status).toBe("succeeded");
  expect(calls.cover).toBe(1);
  expect(calls.content).toBe(1);
  expect(calls.draft).toBe(1);
});

test("weixin unknown network outcome becomes needs attention and is not retried", async () => {
  let calls = 0;
  const broken = client({ cover: 0, content: 0, draft: 0 });
  broken.createDraft = async () => {
    calls += 1;
    throw new ConnectorError({
      kind: "timeout",
      message: "response lost",
      outcome: "unknown",
    });
  };
  const adapter = adapterWithClient(broken);
  const store = new MemoryTaskStore();
  const task = new TaskRunner(store).forJob("publish-unknown");
  const prepared = preparedPublication(
    await adapter.prepare(contentPackage(), publishTarget(), channelAccount(), {
      task: task.scope("prepare"),
      now: fixedNow,
    }),
  );

  await expect(
    adapter.publish(prepared, channelAccount(), {
      task: task.scope("publish"),
      idempotencyKey: "key",
      now: fixedNow,
    }),
  ).rejects.toBeInstanceOf(TaskNeedsAttentionError);
  await expect(
    adapter.publish(prepared, channelAccount(), {
      task: task.scope("publish"),
      idempotencyKey: "key",
      now: fixedNow,
    }),
  ).rejects.toBeInstanceOf(TaskNeedsAttentionError);
  expect(calls).toBe(1);
});

test("weixin refuses to upload asset bytes that do not match the package checksum", async () => {
  const calls = { cover: 0, content: 0, draft: 0 };
  const adapter = new WeixinChannelAdapter({
    resolveClient: async () => client(calls),
    assetLoader: {
      async load(asset) {
        return {
          bytes: new TextEncoder().encode(`tampered-${asset.id}`),
          mimeType: "image/jpeg",
          filename: `${asset.id}.jpg`,
        };
      },
    },
  });
  const prepared = preparedPublication(
    await adapter.prepare(contentPackage(), publishTarget(), channelAccount(), {
      task: new TaskRunner(new MemoryTaskStore()).forJob("prepare-tampered"),
      now: fixedNow,
    }),
  );

  await expect(
    adapter.publish(prepared, channelAccount(), {
      task: new TaskRunner(new MemoryTaskStore()).forJob("publish-tampered"),
      idempotencyKey: "tampered-key",
      now: fixedNow,
    }),
  ).rejects.toThrow(/资源 cover 的 SHA-256 校验失败/);
  expect(calls.cover).toBe(0);
  expect(calls.content).toBe(0);
  expect(calls.draft).toBe(0);
});

function adapterWithClient(weixin: WeixinClient): WeixinChannelAdapter {
  return new WeixinChannelAdapter({
    resolveClient: async () => weixin,
    assetLoader: {
      async load(asset) {
        return {
          bytes: new TextEncoder().encode(asset.id),
          mimeType: "image/jpeg",
          filename: `${asset.id}.jpg`,
        };
      },
    },
  });
}

function client(calls: { cover: number; content: number; draft: number }): WeixinClient {
  return {
    async check() {
      return "ok";
    },
    async uploadCover() {
      calls.cover += 1;
      return "cover-media";
    },
    async uploadContentImage() {
      calls.content += 1;
      return "https://weixin.example/content.jpg";
    },
    async createDraft(input) {
      calls.draft += 1;
      expect(input.contentHtml.includes("https://weixin.example/content.jpg")).toBe(true);
      return { mediaId: "draft-media" };
    },
  };
}

function channelAccount(): ChannelAccount {
  return {
    id: "account-1",
    channel: "weixin-official-account",
    name: "公众号",
    connectionId: "weixin-connection",
    revision: 1,
  };
}

function publishTarget(): PublishTarget {
  return {
    id: "target-1",
    name: "科技号",
    channel: "weixin-official-account",
    channelAccountId: "account-1",
    revision: 1,
  };
}

function contentPackage(): ContentPackage {
  return {
    schemaVersion: "content-package.v5",
    id: "content-1",
    checksum: "package-checksum",
    source: {
      format: "article-markdown.v1",
      title: "标题",
      digest: "摘要",
      bodyMarkdown: "正文\n\n![配图](asset-request://body-image)",
    },
    document: {
      schemaVersion: "article-document.v1",
      title: "标题",
      digest: "摘要",
      coverAssetId: "cover",
      root: {
        id: "root",
        type: "root",
        children: [
          {
            id: "body",
            type: "paragraph",
            children: [{ id: "body-text", type: "text", text: "正文" }],
          },
          {
            id: "image-paragraph",
            type: "paragraph",
            children: [{ id: "image", type: "asset", assetId: "body-image", alt: "配图" }],
          },
        ],
      },
    },
    evidence: [],
    assets: [
      {
        id: "cover",
        mediaType: "image",
        source: { uri: "memory://cover" },
        checksum: "3fa405a8301ace34d11cf44a816080b8f0e49a48fbd048b8aef1543a8c58bdb6",
      },
      {
        id: "body-image",
        mediaType: "image",
        source: { uri: "memory://body-image" },
        checksum: "2e9fbfd6839f18eb205674e5ed7573f63bd1f8ee6f2ece807a2651e048c02d6b",
      },
    ],
    materials: [],
    identity: {
      id: "identity-tech",
      name: "科技",
      positioning: "技术解释",
      audience: "开发者",
      tone: "清晰",
      revision: 1,
    },
    build: { sourceHash: "source-hash", compilerVersion: "1" },
    quality: { reportId: "quality-1", policyVersion: "1", warnings: [] },
    origin: { jobId: "job-1", planId: "plan-1", planRevision: 1 },
    createdAt: "2026-07-14T00:00:00.000Z",
  };
}

function preparedPublication(
  input: Awaited<ReturnType<WeixinChannelAdapter["prepare"]>>,
): PreparedPublication {
  return {
    ...input,
    id: "prepared-1",
    checksum: "prepared-checksum",
    packageId: "content-1",
    packageChecksum: "package-checksum",
    targetId: "target-1",
    targetRevision: 1,
    accountId: "account-1",
    accountRevision: 1,
    adapterId: "weixin-official-account",
    adapterVersion: "2",
    createdAt: "2026-07-14T00:00:00.000Z",
  };
}

function fixedNow(): Date {
  return new Date("2026-07-14T00:00:00.000Z");
}
