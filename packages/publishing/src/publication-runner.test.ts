import { expect, test } from "vite-plus/test";
import { computeContentPackageChecksum, type ContentPackage } from "@trendpublish/article";
import {
  MemoryTaskStore,
  TaskFingerprintConflictError,
  TaskRunner,
  UnknownTaskOutcomeError,
} from "@trendpublish/runtime";
import type { ChannelAdapter } from "./adapter.ts";
import type { ChannelAccount, PublicationDestination, PublicationRequest } from "./domain.ts";
import { ChannelRegistry } from "./profile.ts";
import { PublicationRunner } from "./publication-runner.ts";

test("one package fans out independently and unknown outcome dominates aggregate status", async () => {
  const calls = new Map<string, number>();
  const adapter = fakeAdapter(calls, {
    "target-b": "fail-once",
    "target-c": "unknown",
  });
  const store = new MemoryTaskStore();
  const service = new PublicationRunner(testRegistry(adapter), { now: fixedNow });
  const request = await publicationRequest();

  const first = await service.publish(request, new TaskRunner(store).forJob("publish-1"));
  expect(first.status).toBe("needs_attention");
  expect(first.destinations.find((item) => item.destinationId === "target-a")?.status).toBe(
    "succeeded",
  );
  expect(first.destinations.find((item) => item.destinationId === "target-b")?.status).toBe(
    "failed",
  );
  expect(first.destinations.find((item) => item.destinationId === "target-c")?.status).toBe(
    "unknown",
  );

  const second = await service.publish(request, new TaskRunner(store).forJob("publish-1"));
  expect(second.status).toBe("needs_attention");
  expect(second.destinations.find((item) => item.destinationId === "target-b")?.status).toBe(
    "succeeded",
  );
  expect(calls.get("target-a:upload-cover")).toBe(1);
  expect(calls.get("target-b:upload-cover")).toBe(1);
  expect(calls.get("target-b:create")).toBe(2);
  expect(calls.get("target-c:create")).toBe(1);
});

test("same publication job rejects a changed package or target request", async () => {
  const store = new MemoryTaskStore();
  const service = new PublicationRunner(testRegistry(fakeAdapter(new Map(), {})), {
    now: fixedNow,
  });
  const request = await publicationRequest();
  await service.publish(request, new TaskRunner(store).forJob("publish-2"));

  const changedPackage = await sealContentPackage({
    ...request.contentPackage,
    source: { ...request.contentPackage.source, title: "changed" },
    document: { ...request.contentPackage.document, title: "changed" },
  });
  await expect(
    service.publish(
      { ...request, contentPackage: changedPackage },
      new TaskRunner(store).forJob("publish-2"),
    ),
  ).rejects.toBeInstanceOf(TaskFingerprintConflictError);
});

test("publication rejects a content package whose payload no longer matches its checksum", async () => {
  const request = await publicationRequest();
  request.contentPackage.source.title = "tampered";
  const service = new PublicationRunner(testRegistry(fakeAdapter(new Map(), {})));

  await expect(
    service.publish(request, new TaskRunner(new MemoryTaskStore()).forJob("publish-corrupt")),
  ).rejects.toThrow(/完整性校验失败/);
});

test("publisher tools are resolved separately for each destination account", async () => {
  const resolved: Array<{ destinationId: string; connectionIds: string[] }> = [];
  const receivedImages = new Map<string, unknown>();
  const image = {
    generate: async () => ({ images: [{ url: "https://example.com/cover.png" }] }),
  };
  const adapter: ChannelAdapter = {
    id: "test-channel-adapter",
    version: "1",
    channel: "test",
    publicationType: "article",
    async prepare(contentPackage, destination, _account, context) {
      receivedImages.set(destination.id, context.image);
      return {
        title: contentPackage.document.title,
        digest: contentPackage.document.digest,
        body: { format: "html", content: `<p>${destination.id}</p>` },
        assets: contentPackage.assets,
      };
    },
    async publish(_prepared, _account, context) {
      return { status: "succeeded", publishedAt: context.now().toISOString() };
    },
  };
  const service = new PublicationRunner(testRegistry(adapter, true), {
    resolveImage: async (_contentPackage, destination, account) => {
      resolved.push({
        destinationId: destination.id,
        connectionIds: account.publisher?.toolConnectionIds ?? [],
      });
      return image;
    },
  });
  const request = await publicationRequest();
  request.accounts[0]!.publisher = { toolConnectionIds: ["image-a"] };
  request.accounts[1]!.publisher = { toolConnectionIds: ["image-b"] };
  request.accounts[2]!.publisher = { toolConnectionIds: [] };

  await service.publish(request, new TaskRunner(new MemoryTaskStore()).forJob("publish-images"));

  expect(resolved).toEqual([
    { destinationId: "target-a", connectionIds: ["image-a"] },
    { destinationId: "target-b", connectionIds: ["image-b"] },
    { destinationId: "target-c", connectionIds: [] },
  ]);
  expect(receivedImages.get("target-a")).toBe(image);
  expect(receivedImages.get("target-b")).toBe(image);
  expect(receivedImages.get("target-c")).toBe(image);
});

test("publisher tool resolution failure only fails its destination", async () => {
  const prepared: string[] = [];
  const adapter: ChannelAdapter = {
    id: "test-channel-adapter",
    version: "1",
    channel: "test",
    publicationType: "article",
    async prepare(contentPackage, destination) {
      prepared.push(destination.id);
      return {
        title: contentPackage.document.title,
        digest: contentPackage.document.digest,
        body: { format: "html", content: `<p>${destination.id}</p>` },
        assets: contentPackage.assets,
      };
    },
    async publish(_prepared, _account, context) {
      return { status: "succeeded", publishedAt: context.now().toISOString() };
    },
  };
  const service = new PublicationRunner(testRegistry(adapter, true), {
    resolveImage: async (_contentPackage, destination) => {
      if (destination.id === "target-b") throw new Error("图片生成连接初始化失败：连接已禁用");
      return { generate: async () => ({ images: [{ url: "https://example.com/cover.png" }] }) };
    },
  });

  const result = await service.publish(
    await publicationRequest(),
    new TaskRunner(new MemoryTaskStore()).forJob("publish-image-resolution-failure"),
  );

  expect(result.status).toBe("partial");
  expect(prepared).toEqual(["target-a", "target-c"]);
  expect(result.destinations.find((item) => item.destinationId === "target-b")).toMatchObject({
    status: "failed",
    error: "图片生成连接初始化失败：连接已禁用",
  });
});

function fakeAdapter(
  calls: Map<string, number>,
  behavior: Record<string, "fail-once" | "unknown">,
): ChannelAdapter {
  return {
    id: "test-channel-adapter",
    version: "1",
    channel: "test",
    publicationType: "article",
    async prepare(contentPackage, destination) {
      return {
        title: contentPackage.document.title,
        digest: contentPackage.document.digest,
        body: { format: "html", content: `<p>${destination.id}</p>` },
        assets: contentPackage.assets,
        metadata: { destinationId: destination.id },
      };
    },
    async publish(prepared, _account, context) {
      await context.task.run(
        {
          id: `upload-cover:${prepared.packageChecksum}`,
          version: "1",
          input: prepared.assets,
          effect: "idempotent",
        },
        async () => increment(calls, `${prepared.destinationId}:upload-cover`),
      );
      const created = await context.task.run(
        {
          id: "create",
          version: "1",
          input: { checksum: prepared.checksum, idempotencyKey: context.idempotencyKey },
          effect: "unsafe",
        },
        async () => {
          const count = increment(calls, `${prepared.destinationId}:create`);
          if (behavior[prepared.destinationId] === "fail-once" && count === 1) {
            throw new Error("rate limited");
          }
          if (behavior[prepared.destinationId] === "unknown") {
            throw new UnknownTaskOutcomeError("create response lost");
          }
          return { externalId: `${prepared.destinationId}-draft` };
        },
      );
      return {
        status: "succeeded",
        externalId: created.externalId,
        publishedAt: context.now().toISOString(),
      };
    },
  };
}

async function publicationRequest(): Promise<PublicationRequest> {
  const accounts: ChannelAccount[] = ["a", "b", "c"].map((id) => ({
    id: `account-${id}`,
    channel: "test",
    name: id,
    connectionId: `connection-${id}`,
    revision: 1,
  }));
  const destinations: PublicationDestination[] = ["a", "b", "c"].map((id) => ({
    id: `target-${id}`,
    channel: "test",
    accountId: `account-${id}`,
    publicationType: "article",
  }));
  return { contentPackage: await sealContentPackage(contentPackage()), accounts, destinations };
}

function testRegistry(adapter: ChannelAdapter, withPublisherTools = false): ChannelRegistry {
  return new ChannelRegistry([
    {
      definition: {
        id: "test",
        name: "测试渠道",
        description: "测试",
        connectorIds: ["test-connector"],
        defaultPublicationType: "article",
      },
      profiles: [
        {
          definition: {
            channel: "test",
            type: "article",
            version: "1",
            name: "文章",
            description: "测试文章",
            supportedModalities: ["article"],
            requiredArtifacts: [],
            optionalArtifacts: [],
            publisherTools: withPublisherTools
              ? [
                  {
                    id: "image",
                    name: "图片生成",
                    description: "测试图片生成工具",
                    capability: "image",
                  },
                ]
              : undefined,
          },
          instructions: "测试",
          outputSchema: {},
          parse: (value) => value,
        },
      ],
      adapters: [adapter],
    },
  ]);
}

async function sealContentPackage(value: ContentPackage): Promise<ContentPackage> {
  const { checksum: _checksum, ...payload } = structuredClone(value);
  return { ...payload, checksum: await computeContentPackageChecksum(payload) };
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
      bodyMarkdown: "正文",
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
        ],
      },
    },
    evidence: [],
    assets: [
      {
        id: "cover",
        mediaType: "image",
        source: { uri: "memory://cover" },
        checksum: "0".repeat(64),
      },
    ],
    materials: [],
    identity: {
      id: "identity-tech",
      name: "Tech",
      positioning: "技术",
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

function increment(calls: Map<string, number>, key: string): number {
  const next = (calls.get(key) ?? 0) + 1;
  calls.set(key, next);
  return next;
}

function fixedNow(): Date {
  return new Date("2026-07-14T00:00:00.000Z");
}
