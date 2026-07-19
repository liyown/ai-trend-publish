import { expect, test } from "vite-plus/test";
import { computeContentPackageChecksum, type ContentPackage } from "@trendpublish/article";
import {
  MemoryTaskStore,
  TaskFingerprintConflictError,
  TaskRunner,
  UnknownTaskOutcomeError,
} from "@trendpublish/runtime";
import { ChannelAdapterRegistry, type ChannelAdapter } from "./adapter.ts";
import type { ChannelAccount, PublicationRequest, PublishTarget } from "./domain.ts";
import { PublicationRunner } from "./publication-runner.ts";

test("one package fans out independently and unknown outcome dominates aggregate status", async () => {
  const calls = new Map<string, number>();
  const adapter = fakeAdapter(calls, {
    "target-b": "fail-once",
    "target-c": "unknown",
  });
  const store = new MemoryTaskStore();
  const service = new PublicationRunner(new ChannelAdapterRegistry([adapter]), { now: fixedNow });
  const request = await publicationRequest();

  const first = await service.publish(request, new TaskRunner(store).forJob("publish-1"));
  expect(first.status).toBe("needs_attention");
  expect(first.targets.find((item) => item.targetId === "target-a")?.status).toBe("succeeded");
  expect(first.targets.find((item) => item.targetId === "target-b")?.status).toBe("failed");
  expect(first.targets.find((item) => item.targetId === "target-c")?.status).toBe("unknown");

  const second = await service.publish(request, new TaskRunner(store).forJob("publish-1"));
  expect(second.status).toBe("needs_attention");
  expect(second.targets.find((item) => item.targetId === "target-b")?.status).toBe("succeeded");
  expect(calls.get("target-a:upload-cover")).toBe(1);
  expect(calls.get("target-b:upload-cover")).toBe(1);
  expect(calls.get("target-b:create")).toBe(2);
  expect(calls.get("target-c:create")).toBe(1);
});

test("same publication job rejects a changed package or target request", async () => {
  const store = new MemoryTaskStore();
  const service = new PublicationRunner(new ChannelAdapterRegistry([fakeAdapter(new Map(), {})]), {
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
  const service = new PublicationRunner(new ChannelAdapterRegistry([fakeAdapter(new Map(), {})]));

  await expect(
    service.publish(request, new TaskRunner(new MemoryTaskStore()).forJob("publish-corrupt")),
  ).rejects.toThrow(/完整性校验失败/);
});

function fakeAdapter(
  calls: Map<string, number>,
  behavior: Record<string, "fail-once" | "unknown">,
): ChannelAdapter {
  return {
    id: "test-channel-adapter",
    version: "1",
    channel: "test",
    async prepare(contentPackage, target) {
      return {
        title: contentPackage.document.title,
        digest: contentPackage.document.digest,
        body: { format: "html", content: `<p>${target.id}</p>` },
        assets: contentPackage.assets,
        metadata: { targetId: target.id },
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
        async () => increment(calls, `${prepared.targetId}:upload-cover`),
      );
      const created = await context.task.run(
        {
          id: "create",
          version: "1",
          input: { checksum: prepared.checksum, idempotencyKey: context.idempotencyKey },
          effect: "unsafe",
        },
        async () => {
          const count = increment(calls, `${prepared.targetId}:create`);
          if (behavior[prepared.targetId] === "fail-once" && count === 1) {
            throw new Error("rate limited");
          }
          if (behavior[prepared.targetId] === "unknown") {
            throw new UnknownTaskOutcomeError("create response lost");
          }
          return { externalId: `${prepared.targetId}-draft` };
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
  const targets: PublishTarget[] = ["a", "b", "c"].map((id) => ({
    id: `target-${id}`,
    name: id,
    channel: "test",
    channelAccountId: `account-${id}`,
    revision: 1,
  }));
  return { contentPackage: await sealContentPackage(contentPackage()), accounts, targets };
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
