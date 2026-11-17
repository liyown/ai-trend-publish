import { useEffect, useMemo, useState } from "react";
import { Drawer } from "@mantine/core";
import { Plus, Save, Settings } from "lucide-react";
import { apiArtifact, apiJson } from "../api/client.ts";
import type {
  ArticleFormDraft,
  ArticleRunDetail,
  ArticleRuntimeProfileDetail,
  ArtifactRef,
  CapabilityFormDraft,
  CapabilityProfile,
  EditorialMemoryContext,
  FetchGroupDraft,
  SourceDraft,
  SourceHealthReport,
} from "../api/types.ts";
import {
  Badge,
  Button,
  EmptyState,
  Input,
  MetricChip,
  SectionTitle,
  Select,
  Textarea,
} from "../components/ui.tsx";

const FETCH_PROVIDER_OPTIONS = [
  "auto",
  "firecrawl",
  "jina",
  "jina-search",
  "parallel-search",
  "brave-search",
  "tavily-search",
  "exa-search",
  "serper-search",
  "newsapi",
  "gdelt",
  "hackernews",
  "arxiv",
  "twitter",
  "rss",
];
const TEMPLATE_OPTIONS = [
  "minimal",
  "dynamic",
  "modern",
  "longform",
  "product",
  "tech",
  "mianpro",
  "darktech",
  "default",
  "random",
];
const PROMPT_PROFILE_OPTIONS = [
  "technology",
  "general",
  "business",
  "product",
  "developer",
  "research",
];
const BODY_IMAGE_MODE_OPTIONS = [
  { value: "off", label: "关闭" },
  { value: "missing", label: "缺图时生成" },
  { value: "all", label: "每篇都生成" },
];
const CAPABILITY_KIND_OPTIONS = [
  "llm",
  "image-generation",
  "notification",
  "fetch-strategy",
  "embedding",
];
const NOTIFICATION_CHANNEL_OPTIONS = ["bark", "dingtalk", "feishu"];

function formatDuration(ms?: number) {
  if (ms === undefined) return "-";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function collectArtifacts(run: ArticleRunDetail | null): ArtifactRef[] {
  if (!run) return [];
  const byKey = new Map<string, ArtifactRef>();
  for (const artifact of run.artifacts ?? []) {
    byKey.set(artifact.key, artifact);
  }
  for (const step of run.steps ?? []) {
    for (const artifact of step.inputArtifacts ?? []) {
      byKey.set(artifact.key, artifact);
    }
    for (const artifact of step.outputArtifacts ?? []) {
      byKey.set(artifact.key, artifact);
    }
  }
  return [...byKey.values()];
}

function findSourceHealthArtifact(
  run: ArticleRunDetail | null,
): ArtifactRef | null {
  return collectArtifacts(run).find((artifact) =>
    artifact.key.includes("source-health") ||
    artifact.label === "数据源健康"
  ) ?? null;
}

function findEditorialMemoryArtifact(
  run: ArticleRunDetail | null,
): ArtifactRef | null {
  return collectArtifacts(run).find((artifact) =>
    artifact.key.includes("editorial-memory") ||
    artifact.label === "编辑记忆"
  ) ?? null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readPath(value: unknown, path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    current = asRecord(current)[key];
  }
  return current;
}

function readString(value: unknown, path: string[], fallback = "-") {
  const result = readPath(value, path);
  return typeof result === "string" && result.trim() ? result : fallback;
}

function readNumber(value: unknown, path: string[], fallback = 0) {
  const result = readPath(value, path);
  return typeof result === "number" && Number.isFinite(result)
    ? result
    : fallback;
}

function readBoolean(value: unknown, path: string[], fallback = false) {
  const result = readPath(value, path);
  return typeof result === "boolean" ? result : fallback;
}

function hostLabel(url: string) {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function compactConfig(config: Record<string, unknown>) {
  const labelForKey = (key: string) => {
    if (key === "model") return "模型";
    if (key === "size") return "尺寸";
    if (key === "count") return "数量";
    if (key === "channels") return "渠道";
    if (key === "temperature") return "温度";
    return key;
  };
  const entries = Object.entries(config)
    .filter(([, value]) =>
      typeof value === "string" || typeof value === "number" ||
      typeof value === "boolean"
    )
    .slice(0, 3);
  if (!entries.length) return "未配置额外参数";
  return entries.map(([key, value]) => `${labelForKey(key)}: ${String(value)}`)
    .join(" · ");
}

function capabilityKindLabel(kind: string) {
  if (kind === "llm") return "大模型";
  if (kind === "image-generation") return "图片生成";
  if (kind === "notification") return "通知";
  if (kind === "fetch-strategy") return "抓取策略";
  if (kind === "embedding") return "向量去重";
  return kind;
}

function capabilityKindDescription(kind: string) {
  if (kind === "llm") return "用于排序、摘要、标题、动态模板和审稿。";
  if (kind === "image-generation") return "用于封面图和正文配图。";
  if (kind === "notification") return "运行成功、失败和关键风险通知。";
  if (kind === "fetch-strategy") return "定义抓取 provider 的 fallback 顺序。";
  if (kind === "embedding") return "用于文章去重和相似度判断。";
  return "共享能力配置。";
}

function capabilityOptions(
  capabilities: CapabilityProfile[],
  kind: string,
) {
  return capabilities.filter((item) => item.kind === kind && item.enabled);
}

function firstCapabilityId(
  capabilities: CapabilityProfile[],
  kind: string,
) {
  return capabilityOptions(capabilities, kind)[0]?.id ?? "";
}

function providerForCapabilityKind(kind: string) {
  if (kind === "llm") return "openai-compatible";
  if (kind === "image-generation") return "dashscope";
  if (kind === "notification") return "multi-channel";
  if (kind === "fetch-strategy") return "configured-fetch-groups";
  if (kind === "embedding") return "dashscope";
  return "";
}

function capabilityDraftFromProfile(
  profile?: CapabilityProfile,
): CapabilityFormDraft {
  const kind = profile?.kind ?? "llm";
  const config = asRecord(profile?.config);
  const channelsValue = config.channels;
  return {
    id: profile?.id ?? `cap-${crypto.randomUUID()}`,
    kind,
    name: profile?.name ?? "",
    enabled: profile?.enabled ?? true,
    provider: profile?.provider ?? providerForCapabilityKind(kind),
    model: readString(config, ["model"], ""),
    count: readNumber(config, ["count"], 1).toString(),
    size: readString(config, ["size"], "1024*1024"),
    channels: Array.isArray(channelsValue)
      ? channelsValue.filter((item): item is string => typeof item === "string")
      : [],
  };
}

function capabilityConfigFromDraft(draft: CapabilityFormDraft) {
  if (draft.kind === "image-generation") {
    const config: Record<string, unknown> = {};
    if (draft.model.trim()) config.model = draft.model.trim();
    const count = Number(draft.count);
    if (Number.isFinite(count)) config.count = count;
    if (draft.size.trim()) config.size = draft.size.trim();
    return config;
  }
  if (draft.kind === "notification") {
    return { channels: draft.channels };
  }
  if (draft.kind === "llm" || draft.kind === "embedding") {
    return draft.model.trim() ? { model: draft.model.trim() } : {};
  }
  return {};
}

function articleDraftFromConfig(
  article: Record<string, unknown>,
  capabilities: CapabilityProfile[],
): ArticleFormDraft {
  const coverOverrides = asRecord(readPath(article, ["cover", "overrides"]));
  const bodyOverrides = asRecord(
    readPath(article, ["bodyImages", "overrides"]),
  );
  const qualityGate = asRecord(readPath(article, ["qualityGate"]));
  return {
    count: readNumber(article, ["count"], 10).toString(),
    dryRun: readBoolean(article, ["dryRun"], true),
    template: readString(article, ["renderer", "template"], "minimal"),
    promptProfile: readString(
      article,
      ["renderer", "promptProfile"],
      "technology",
    ),
    llmProfileId: readString(article, ["renderer", "llmProfileId"], "") ||
      firstCapabilityId(capabilities, "llm"),
    publisherProvider: readString(
      article,
      ["publisher", "provider"],
      "weixin-relay",
    ),
    publisherAccountId: readString(article, ["publisher", "accountId"], ""),
    coverEnabled: readBoolean(article, ["cover", "enabled"], false),
    coverImageProfileId: readString(article, ["cover", "imageProfileId"], "") ||
      firstCapabilityId(capabilities, "image-generation"),
    coverModel: readString(coverOverrides, ["model"], ""),
    bodyImagesMode: readString(article, ["bodyImages", "mode"], "off"),
    bodyImageProfileId:
      readString(article, ["bodyImages", "imageProfileId"], "") ||
      firstCapabilityId(capabilities, "image-generation"),
    bodyImageCount: readNumber(bodyOverrides, ["count"], 1).toString(),
    bodyImageSize: readString(bodyOverrides, ["size"], "1024*1024"),
    dedupEnabled: readBoolean(article, ["deduplication", "enabled"], false),
    embeddingProfileId:
      readString(article, ["deduplication", "embeddingProfileId"], "") ||
      firstCapabilityId(capabilities, "embedding"),
    vectorStore: readString(
      article,
      ["deduplication", "vectorStore"],
      "sqlite",
    ),
    notificationProfileId: readString(
      article,
      ["notifications", "profileId"],
      "",
    ),
    qualityGateEnabled: readBoolean(qualityGate, ["enabled"], true),
    qualityGateMinScore: readNumber(qualityGate, ["minScore"], 80).toString(),
    qualityGateBlockOnHighFactIssue: readBoolean(
      qualityGate,
      ["blockOnHighFactIssue"],
      true,
    ),
    qualityGateForcePublish: readBoolean(
      qualityGate,
      ["forcePublish"],
      false,
    ),
    qualityGateAllowForcePublish: readBoolean(
      qualityGate,
      ["allowForcePublish"],
      true,
    ),
    qualityGateMaxRevisionRounds: readNumber(
      qualityGate,
      ["maxRevisionRounds"],
      1,
    ).toString(),
  };
}

function articlePatchFromDraft(draft: ArticleFormDraft) {
  const count = Number(draft.count);
  const bodyImageCount = Number(draft.bodyImageCount);
  const minScore = Number(draft.qualityGateMinScore);
  const maxRevisionRounds = Number(draft.qualityGateMaxRevisionRounds);
  return {
    count: Number.isFinite(count) ? count : 10,
    dryRun: draft.dryRun,
    renderer: {
      template: draft.template,
      promptProfile: draft.promptProfile,
      llmProfileId: draft.llmProfileId,
    },
    publisher: {
      provider: draft.publisherProvider,
      accountId: draft.publisherAccountId.trim(),
    },
    cover: {
      enabled: draft.coverEnabled,
      imageProfileId: draft.coverImageProfileId,
      overrides: draft.coverModel.trim()
        ? { model: draft.coverModel.trim() }
        : {},
    },
    bodyImages: {
      mode: draft.bodyImagesMode,
      imageProfileId: draft.bodyImageProfileId,
      overrides: {
        count: Number.isFinite(bodyImageCount) ? bodyImageCount : 1,
        size: draft.bodyImageSize.trim() || "1024*1024",
      },
    },
    deduplication: {
      enabled: draft.dedupEnabled,
      embeddingProfileId: draft.embeddingProfileId,
      vectorStore: draft.vectorStore,
    },
    notifications: {
      profileId: draft.notificationProfileId || undefined,
    },
    qualityGate: {
      enabled: draft.qualityGateEnabled,
      minScore: Number.isFinite(minScore) ? minScore : 80,
      blockOnHighFactIssue: draft.qualityGateBlockOnHighFactIssue,
      forcePublish: draft.qualityGateForcePublish,
      allowForcePublish: draft.qualityGateAllowForcePublish,
      maxRevisionRounds: Number.isFinite(maxRevisionRounds)
        ? maxRevisionRounds
        : 1,
    },
  };
}

function TrendProfileView(
  { article, capabilities, saving, onSave }: {
    article: Record<string, unknown>;
    capabilities: CapabilityProfile[];
    saving: string;
    onSave: (patch: Record<string, unknown>) => Promise<void>;
  },
) {
  const [draft, setDraft] = useState<ArticleFormDraft>(() =>
    articleDraftFromConfig(article, capabilities)
  );

  useEffect(() => {
    setDraft(articleDraftFromConfig(article, capabilities));
  }, [article, capabilities]);

  const update = <K extends keyof ArticleFormDraft>(
    key: K,
    value: ArticleFormDraft[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));

  return (
    <form
      className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]"
      onSubmit={async (event) => {
        event.preventDefault();
        await onSave(articlePatchFromDraft(draft));
      }}
    >
      <section className="tp-section rounded-md border p-4">
        <SectionTitle
          title="文章工作流"
          description="新手只需要改这里：数量、模板、提示词、发布方式。"
          action={
            <Button size="sm" type="submit" disabled={saving === "article"}>
              <Save className="size-3.5" />
              保存
            </Button>
          }
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="tp-muted text-xs font-medium">每次文章数</span>
            <Input
              type="number"
              min="1"
              max="50"
              value={draft.count}
              onChange={(event) => update("count", event.currentTarget.value)}
            />
          </label>
          <label className="space-y-1.5">
            <span className="tp-muted text-xs font-medium">发布方式</span>
            <Select
              value={draft.publisherProvider}
              onChange={(event) =>
                update("publisherProvider", event.currentTarget.value)}
            >
              <option value="weixin-relay">微信 Relay</option>
              <option value="weixin">直连微信</option>
            </Select>
          </label>
          <label className="space-y-1.5">
            <span className="tp-muted text-xs font-medium">公众号账号 ID</span>
            <Input
              value={draft.publisherAccountId}
              placeholder="默认账号可留空；多公众号填写 main / lab 等"
              onChange={(event) =>
                update("publisherAccountId", event.currentTarget.value)}
            />
          </label>
          <label className="space-y-1.5">
            <span className="tp-muted text-xs font-medium">正文模板</span>
            <Select
              value={draft.template}
              onChange={(event) =>
                update("template", event.currentTarget.value)}
            >
              {TEMPLATE_OPTIONS.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </Select>
          </label>
          <label className="space-y-1.5">
            <span className="tp-muted text-xs font-medium">内容方向</span>
            <Select
              value={draft.promptProfile}
              onChange={(event) =>
                update("promptProfile", event.currentTarget.value)}
            >
              {PROMPT_PROFILE_OPTIONS.map((item) => (
                <option key={item} value={item}>{item}</option>
              ))}
            </Select>
          </label>
          <label className="space-y-1.5 sm:col-span-2">
            <span className="tp-muted text-xs font-medium">
              使用的大模型能力
            </span>
            <Select
              value={draft.llmProfileId}
              onChange={(event) =>
                update("llmProfileId", event.currentTarget.value)}
            >
              {capabilityOptions(capabilities, "llm").map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.provider}
                </option>
              ))}
            </Select>
          </label>
          <label className="tp-card-soft flex items-center justify-between gap-3 rounded-md border p-3 sm:col-span-2">
            <span>
              <span className="tp-title block text-sm font-medium">
                默认 dry-run
              </span>
              <span className="tp-muted block text-xs">
                开启后默认只生成产物，不创建微信草稿。
              </span>
            </span>
            <input
              className="size-4 accent-[#0f172a]"
              type="checkbox"
              checked={draft.dryRun}
              onChange={(event) =>
                update("dryRun", event.currentTarget.checked)}
            />
          </label>
        </div>
      </section>

      <section className="tp-section rounded-md border p-4">
        <SectionTitle
          title="增强能力"
          description="封面、正文配图、去重、通知都可以按需开启。"
        />
        <div className="space-y-3">
          <label className="tp-card-soft flex items-center justify-between gap-3 rounded-md border p-3">
            <span>
              <span className="tp-title block text-sm font-medium">封面图</span>
              <span className="tp-muted block text-xs">
                用图片生成能力生成公众号封面。
              </span>
            </span>
            <input
              className="size-4 accent-[#0f172a]"
              type="checkbox"
              checked={draft.coverEnabled}
              onChange={(event) =>
                update("coverEnabled", event.currentTarget.checked)}
            />
          </label>
          {draft.coverEnabled && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Select
                value={draft.coverImageProfileId}
                onChange={(event) =>
                  update("coverImageProfileId", event.currentTarget.value)}
              >
                {capabilityOptions(capabilities, "image-generation").map((
                  item,
                ) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
              <Input
                placeholder="覆盖模型，可留空"
                value={draft.coverModel}
                onChange={(event) =>
                  update("coverModel", event.currentTarget.value)}
              />
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="tp-muted text-xs font-medium">正文配图</span>
              <Select
                value={draft.bodyImagesMode}
                onChange={(event) =>
                  update("bodyImagesMode", event.currentTarget.value)}
              >
                {BODY_IMAGE_MODE_OPTIONS.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </label>
            <label className="space-y-1.5">
              <span className="tp-muted text-xs font-medium">图片能力</span>
              <Select
                value={draft.bodyImageProfileId}
                onChange={(event) =>
                  update("bodyImageProfileId", event.currentTarget.value)}
                disabled={draft.bodyImagesMode === "off"}
              >
                {capabilityOptions(capabilities, "image-generation").map((
                  item,
                ) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className="space-y-1.5">
              <span className="tp-muted text-xs font-medium">配图数量</span>
              <Input
                type="number"
                min="1"
                max="4"
                value={draft.bodyImageCount}
                disabled={draft.bodyImagesMode === "off"}
                onChange={(event) =>
                  update("bodyImageCount", event.currentTarget.value)}
              />
            </label>
            <label className="space-y-1.5">
              <span className="tp-muted text-xs font-medium">图片尺寸</span>
              <Input
                value={draft.bodyImageSize}
                disabled={draft.bodyImagesMode === "off"}
                onChange={(event) =>
                  update("bodyImageSize", event.currentTarget.value)}
              />
            </label>
          </div>

          <label className="tp-card-soft flex items-center justify-between gap-3 rounded-md border p-3">
            <span>
              <span className="tp-title block text-sm font-medium">
                文章去重
              </span>
              <span className="tp-muted block text-xs">
                避免重复发布相似内容。
              </span>
            </span>
            <input
              className="size-4 accent-[#0f172a]"
              type="checkbox"
              checked={draft.dedupEnabled}
              onChange={(event) =>
                update("dedupEnabled", event.currentTarget.checked)}
            />
          </label>
          {draft.dedupEnabled && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Select
                value={draft.embeddingProfileId}
                onChange={(event) =>
                  update("embeddingProfileId", event.currentTarget.value)}
              >
                {capabilityOptions(capabilities, "embedding").map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </Select>
              <Select
                value={draft.vectorStore}
                onChange={(event) =>
                  update("vectorStore", event.currentTarget.value)}
              >
                <option value="sqlite">SQLite</option>
                <option value="d1">D1</option>
              </Select>
            </div>
          )}

          <label className="space-y-1.5">
            <span className="tp-muted text-xs font-medium">通知能力</span>
            <Select
              value={draft.notificationProfileId}
              onChange={(event) =>
                update("notificationProfileId", event.currentTarget.value)}
            >
              <option value="">不通知</option>
              {capabilityOptions(capabilities, "notification").map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </Select>
          </label>

          <div className="rounded-md border border-[#cbd5e1] bg-[#ffffff]/70 p-3">
            <div className="mb-3 flex items-start justify-between gap-3">
              <span>
                <span className="tp-title block text-sm font-medium">
                  真实发布质量门禁
                </span>
                <span className="tp-muted block text-xs leading-5">
                  dry-run 继续产出，创建微信草稿前才会按审稿结果拦截。
                </span>
              </span>
              <input
                className="size-4 accent-[#0f172a]"
                type="checkbox"
                checked={draft.qualityGateEnabled}
                onChange={(event) =>
                  update("qualityGateEnabled", event.currentTarget.checked)}
              />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="tp-muted text-xs font-medium">最低分</span>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={draft.qualityGateMinScore}
                  disabled={!draft.qualityGateEnabled}
                  onChange={(event) =>
                    update("qualityGateMinScore", event.currentTarget.value)}
                />
              </label>
              <label className="space-y-1.5">
                <span className="tp-muted text-xs font-medium">修复轮次</span>
                <Input
                  type="number"
                  min="0"
                  max="2"
                  value={draft.qualityGateMaxRevisionRounds}
                  onChange={(event) =>
                    update(
                      "qualityGateMaxRevisionRounds",
                      event.currentTarget.value,
                    )}
                />
              </label>
            </div>
            <div className="mt-3 grid gap-2">
              <label className="flex items-center justify-between gap-3 text-sm">
                <span className="tp-muted">高危事实问题阻断发布</span>
                <input
                  className="size-4 accent-[#0f172a]"
                  type="checkbox"
                  checked={draft.qualityGateBlockOnHighFactIssue}
                  disabled={!draft.qualityGateEnabled}
                  onChange={(event) =>
                    update(
                      "qualityGateBlockOnHighFactIssue",
                      event.currentTarget.checked,
                    )}
                />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span className="tp-muted">真实发布默认强制发布</span>
                <input
                  className="size-4 accent-[#0f172a]"
                  type="checkbox"
                  checked={draft.qualityGateForcePublish}
                  disabled={!draft.qualityGateEnabled}
                  onChange={(event) =>
                    update(
                      "qualityGateForcePublish",
                      event.currentTarget.checked,
                    )}
                />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm">
                <span className="tp-muted">允许真实发布时手动强制绕过</span>
                <input
                  className="size-4 accent-[#0f172a]"
                  type="checkbox"
                  checked={draft.qualityGateAllowForcePublish}
                  disabled={!draft.qualityGateEnabled}
                  onChange={(event) =>
                    update(
                      "qualityGateAllowForcePublish",
                      event.currentTarget.checked,
                    )}
                />
              </label>
            </div>
          </div>
        </div>
      </section>
    </form>
  );
}

function SourceHealthPanel(
  { run, apiKey }: {
    run: ArticleRunDetail | null;
    apiKey: string;
  },
) {
  const artifact = useMemo(() => findSourceHealthArtifact(run), [run]);
  const memoryArtifact = useMemo(() => findEditorialMemoryArtifact(run), [run]);
  const [report, setReport] = useState<SourceHealthReport | null>(null);
  const [memory, setMemory] = useState<EditorialMemoryContext | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!artifact) {
      setReport(null);
      setError("");
      return;
    }
    setError("");
    apiArtifact(
      `/api/artifacts?key=${encodeURIComponent(artifact.key)}`,
      apiKey,
    )
      .then(async (response) =>
        setReport(JSON.parse(await response.text()) as SourceHealthReport)
      )
      .catch((err) =>
        setError(err instanceof Error ? err.message : String(err))
      );
  }, [artifact, apiKey]);

  useEffect(() => {
    if (!memoryArtifact) {
      setMemory(null);
      return;
    }
    apiArtifact(
      `/api/artifacts?key=${encodeURIComponent(memoryArtifact.key)}`,
      apiKey,
    )
      .then(async (response) =>
        setMemory(JSON.parse(await response.text()) as EditorialMemoryContext)
      )
      .catch(() => setMemory(null));
  }, [memoryArtifact, apiKey]);

  if (!run) {
    return (
      <section className="tp-section rounded-md border p-4">
        <SectionTitle
          title="最近一次抓取健康"
          description="运行一次 dry-run 后，这里会展示每个数据源的成功率和失败原因。"
        />
        <EmptyState>还没有运行记录</EmptyState>
      </section>
    );
  }

  if (!artifact) {
    return (
      <section className="tp-section rounded-md border p-4">
        <SectionTitle
          title="最近一次抓取健康"
          description="旧运行没有 source health 产物，新版本运行后会自动生成。"
        />
        <EmptyState>暂无抓取健康数据</EmptyState>
      </section>
    );
  }

  return (
    <section className="tp-section rounded-md border p-4">
      <SectionTitle
        title="最近一次抓取健康"
        description="优先处理 failed / empty 的源；长期失败的数据源会拖低文章质量。"
        action={<Badge>{run.runId.slice(0, 8)}</Badge>}
      />
      {error && (
        <div className="tp-danger rounded-md border p-3 text-sm">{error}</div>
      )}
      {report && (
        <div className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-4">
            <MetricChip label="数据源" value={report.totalSources} />
            <MetricChip label="成功" value={report.succeeded} />
            <MetricChip label="失败" value={report.failed + report.empty} />
            <MetricChip label="文章" value={report.totalArticles} />
          </div>
          {memory?.sourcePerformance.length
            ? (
              <div className="rounded-md border border-[#e2e8f0] bg-[#ffffff]/55 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="tp-title text-sm font-semibold">
                    历史来源表现
                  </div>
                  <Badge>{memory.sourcePerformance.length} sources</Badge>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {memory.sourcePerformance.slice(0, 6).map((source) => {
                    const successRate = source.runs
                      ? Math.round((source.successes / source.runs) * 100)
                      : 0;
                    return (
                      <div
                        key={source.url}
                        className="rounded border border-[#e2e8f0] bg-[#ffffff]/70 p-2 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="tp-title min-w-0 truncate font-medium">
                            {hostLabel(source.url)}
                          </span>
                          <Badge
                            tone={source.lastStatus === "succeeded"
                              ? "success"
                              : "danger"}
                          >
                            {successRate}%
                          </Badge>
                        </div>
                        <div className="tp-muted mt-1">
                          {source.runs} 次 · {source.totalArticles} 篇 · 最近
                          {" "}
                          {source.lastStatus}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )
            : null}
          <div className="grid gap-2">
            {report.records.map((record) => (
              <div
                key={`${record.group}-${record.url}`}
                className="rounded-md border border-[#e2e8f0] bg-[#ffffff]/55 p-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        tone={record.status === "succeeded"
                          ? "success"
                          : "danger"}
                      >
                        {record.status}
                      </Badge>
                      <Badge>{record.group}</Badge>
                      {record.selectedProvider && (
                        <Badge tone="info">{record.selectedProvider}</Badge>
                      )}
                    </div>
                    <div className="tp-title mt-2 truncate text-sm font-medium">
                      {hostLabel(record.url)}
                    </div>
                    <div className="tp-muted mt-1 truncate text-xs">
                      {record.url}
                    </div>
                  </div>
                  <div className="text-right text-xs text-[#64748b]">
                    <div>{record.articleCount} 篇</div>
                    <div>{formatDuration(record.durationMs)}</div>
                  </div>
                </div>
                {record.failures.length > 0 && (
                  <div className="mt-2 space-y-1">
                    {record.failures.slice(0, 2).map((failure) => (
                      <div
                        key={`${failure.provider}-${failure.message}`}
                        className="rounded border border-[#e2e8f0] bg-[#f8fafc] px-2 py-1 text-xs text-[#475569]"
                      >
                        {failure.provider}: {failure.message}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function SourcesView(
  {
    sourceDrafts,
    fetchGroupDrafts,
    saving,
    onSourcesChange,
    onFetchGroupsChange,
    onSaveSources,
    onSaveFetchGroups,
  }: {
    sourceDrafts: SourceDraft[];
    fetchGroupDrafts: FetchGroupDraft[];
    saving: string;
    onSourcesChange: (value: SourceDraft[]) => void;
    onFetchGroupsChange: (value: FetchGroupDraft[]) => void;
    onSaveSources: () => void;
    onSaveFetchGroups: () => void;
  },
) {
  const groupNames = fetchGroupDrafts.map((group) => group.name).filter(
    Boolean,
  );
  const addSource = () =>
    onSourcesChange([
      ...sourceDrafts,
      {
        raw: "",
        url: "",
        group: groupNames[0] ?? "default",
        enabled: true,
      },
    ]);
  const updateSource = (
    index: number,
    patch: Partial<SourceDraft>,
  ) => {
    onSourcesChange(
      sourceDrafts.map((source, currentIndex) =>
        currentIndex === index ? { ...source, ...patch } : source
      ),
    );
  };
  const removeSource = (index: number) => {
    onSourcesChange(
      sourceDrafts.filter((_, currentIndex) => currentIndex !== index),
    );
  };

  const addFetchGroup = () =>
    onFetchGroupsChange([
      ...fetchGroupDrafts,
      { name: "web", providers: ["auto"] },
    ]);
  const updateFetchGroup = (
    index: number,
    patch: Partial<FetchGroupDraft>,
  ) => {
    onFetchGroupsChange(
      fetchGroupDrafts.map((group, currentIndex) =>
        currentIndex === index ? { ...group, ...patch } : group
      ),
    );
  };
  const toggleProvider = (groupIndex: number, provider: string) => {
    const group = fetchGroupDrafts[groupIndex];
    const exists = group.providers.includes(provider);
    const providers = exists
      ? group.providers.filter((item) => item !== provider)
      : [...group.providers, provider];
    updateFetchGroup(groupIndex, { providers });
  };
  const removeFetchGroup = (index: number) => {
    onFetchGroupsChange(
      fetchGroupDrafts.filter((_, currentIndex) => currentIndex !== index),
    );
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
      <section className="tp-section min-w-0 rounded-md border p-4">
        <SectionTitle
          title="数据源"
          description="粘贴 URL，选择抓取策略。日常只维护这里，不需要手写 JSON。"
          action={
            <div className="flex gap-2">
              <Button size="sm" type="button" onClick={addSource}>
                <Plus className="size-3.5" />
                添加
              </Button>
              <Button
                size="sm"
                type="button"
                onClick={onSaveSources}
                disabled={saving === "sources"}
              >
                <Save className="size-3.5" />
                保存
              </Button>
            </div>
          }
        />
        <div className="mb-3 grid gap-2 rounded-md border border-[var(--tp-border)] bg-[var(--tp-panel-muted)] p-3 text-xs text-[var(--tp-muted)] sm:grid-cols-3">
          <div>
            <span className="font-medium text-[var(--tp-ink)]">
              {sourceDrafts.length}
            </span>{" "}
            个来源
          </div>
          <div>
            <span className="font-medium text-[var(--tp-ink)]">
              {sourceDrafts.filter((source) => source.enabled).length}
            </span>{" "}
            个启用
          </div>
          <div className="truncate">
            默认策略:{" "}
            <span className="font-medium text-[var(--tp-ink)]">
              {groupNames[0] ?? "default"}
            </span>
          </div>
        </div>
        <div className="min-w-0 overflow-hidden rounded-md border border-[var(--tp-border)]">
          <div className="hidden grid-cols-[52px_132px_minmax(0,1fr)_82px] border-b border-[var(--tp-border)] bg-[var(--tp-panel-muted)] px-3 py-2 text-xs font-medium text-[var(--tp-subtle)] md:grid">
            <div>状态</div>
            <div>分组</div>
            <div>URL</div>
            <div className="text-right">操作</div>
          </div>
          {sourceDrafts.length
            ? sourceDrafts.map((source, index) => (
              <div
                key={`${source.raw}-${index}`}
                className="grid min-w-0 gap-2 border-b border-[var(--tp-border)] bg-white px-3 py-3 last:border-b-0 md:grid-cols-[52px_132px_minmax(0,1fr)_82px] md:items-start"
              >
                <div className="flex items-center justify-between gap-2 md:block">
                  <label className="flex items-center gap-1.5 text-xs text-[var(--tp-muted)]">
                    <input
                      className="size-3.5 accent-[#0f172a]"
                      type="checkbox"
                      checked={source.enabled}
                      onChange={(event) =>
                        updateSource(index, {
                          enabled: event.currentTarget.checked,
                        })}
                    />
                    <span className="md:sr-only">启用</span>
                    <Badge tone={source.enabled ? "success" : "muted"}>
                      #{index + 1}
                    </Badge>
                  </label>
                  <div className="text-xs text-[var(--tp-subtle)] md:hidden">
                    {source.enabled ? "启用" : "停用"}
                  </div>
                </div>
                <Select
                  value={source.group}
                  onChange={(event) =>
                    updateSource(index, {
                      group: event.currentTarget.value,
                      raw: source.url
                        ? `${event.currentTarget.value}:${source.url}`
                        : source.raw,
                    })}
                >
                  {groupNames.length
                    ? groupNames.map((group) => (
                      <option key={group} value={group}>{group}</option>
                    ))
                    : <option value="default">default</option>}
                </Select>
                <div className="min-w-0">
                  <Input
                    placeholder="https://example.com/news"
                    value={source.url}
                    onChange={(event) =>
                      updateSource(index, {
                        url: event.currentTarget.value,
                        raw: source.group
                          ? `${source.group}:${event.currentTarget.value}`
                          : event.currentTarget.value,
                      })}
                  />
                  <div className="mt-1 truncate text-xs text-[var(--tp-subtle)]">
                    {source.url ? hostLabel(source.url) : "等待输入 URL"}
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    variant="ghost"
                    type="button"
                    onClick={() => removeSource(index)}
                  >
                    删除
                  </Button>
                </div>
              </div>
            ))
            : <EmptyState>还没有数据源，点击“添加”开始。</EmptyState>}
        </div>
      </section>

      <section className="tp-section min-w-0 rounded-md border p-4">
        <SectionTitle
          title="抓取分组"
          description="分组决定一条 URL 会按什么顺序尝试抓取。普通网页保留 auto 即可。"
          action={
            <div className="flex gap-2">
              <Button size="sm" type="button" onClick={addFetchGroup}>
                <Plus className="size-3.5" />
                添加
              </Button>
              <Button
                size="sm"
                type="button"
                onClick={onSaveFetchGroups}
                disabled={saving === "fetch-groups"}
              >
                <Save className="size-3.5" />
                保存
              </Button>
            </div>
          }
        />
        <div className="grid gap-2">
          {fetchGroupDrafts.length
            ? fetchGroupDrafts.map((group, groupIndex) => (
              <div
                key={`${group.name}-${groupIndex}`}
                className="min-w-0 rounded-md border border-[var(--tp-border)] bg-white p-3"
              >
                <div className="mb-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                  <Input
                    value={group.name}
                    placeholder="default"
                    onChange={(event) =>
                      updateFetchGroup(groupIndex, {
                        name: event.currentTarget.value,
                      })}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    type="button"
                    onClick={() => removeFetchGroup(groupIndex)}
                  >
                    删除
                  </Button>
                </div>
                <div className="mb-3 rounded-md bg-[var(--tp-panel-muted)] px-3 py-2 text-xs text-[var(--tp-muted)]">
                  fallback 顺序:{" "}
                  <span className="font-medium text-[var(--tp-ink)]">
                    {group.providers.length
                      ? group.providers.join(" -> ")
                      : "未选择"}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {FETCH_PROVIDER_OPTIONS.map((provider) => (
                    <label
                      key={`${group.name}-${provider}`}
                      className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[var(--tp-border-strong)] bg-white px-2.5 text-xs text-[var(--tp-muted)]"
                    >
                      <input
                        className="size-3.5 accent-[#0f172a]"
                        type="checkbox"
                        checked={group.providers.includes(provider)}
                        onChange={() => toggleProvider(groupIndex, provider)}
                      />
                      {provider}
                    </label>
                  ))}
                </div>
              </div>
            ))
            : <EmptyState>还没有抓取分组</EmptyState>}
        </div>
      </section>
    </div>
  );
}

function CapabilitiesView(
  { capabilities, apiKey, onReload }: {
    capabilities: CapabilityProfile[];
    apiKey: string;
    onReload: () => Promise<void>;
  },
) {
  const groupedCapabilities = capabilities.reduce<
    Record<string, CapabilityProfile[]>
  >(
    (groups, capability) => {
      groups[capability.kind] = [
        ...(groups[capability.kind] ?? []),
        capability,
      ];
      return groups;
    },
    {},
  );
  const entries = Object.entries(groupedCapabilities);
  const [editing, setEditing] = useState<CapabilityFormDraft | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const saveCapability = async () => {
    if (!editing) return;
    setSaving(true);
    setError("");
    try {
      const existing = capabilities.some((item) => item.id === editing.id);
      await apiJson(
        existing
          ? `/api/config/capabilities/${encodeURIComponent(editing.id)}`
          : "/api/config/capabilities",
        apiKey,
        {
          method: existing ? "PATCH" : "POST",
          body: JSON.stringify({
            id: editing.id,
            kind: editing.kind,
            name: editing.name,
            enabled: editing.enabled,
            provider: editing.provider ||
              providerForCapabilityKind(editing.kind),
            config: capabilityConfigFromDraft(editing),
          }),
        },
      );
      setEditing(null);
      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const deleteCapability = async (capability: CapabilityProfile) => {
    if (
      !confirm(
        `删除能力配置「${capability.name}」？如果它正在被文章方案引用，后续运行可能失败。`,
      )
    ) {
      return;
    }
    setSaving(true);
    setError("");
    try {
      await apiJson(
        `/api/config/capabilities/${encodeURIComponent(capability.id)}`,
        apiKey,
        { method: "DELETE" },
      );
      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="tp-section rounded-md border p-4">
        <SectionTitle
          title="共享能力"
          description="这里配置可复用能力：大模型、图片生成、通知、抓取策略和向量去重。密钥不在控制台保存。"
          action={
            <Button
              size="sm"
              type="button"
              onClick={() => setEditing(capabilityDraftFromProfile())}
            >
              <Plus className="size-3.5" />
              新增能力
            </Button>
          }
        />
        {error && (
          <div className="tp-danger mb-3 rounded-md border p-3 text-sm">
            {error}
          </div>
        )}
        <Drawer
          opened={Boolean(editing)}
          onClose={() => setEditing(null)}
          position="right"
          size="lg"
          title={editing
            ? capabilities.some((item) => item.id === editing.id)
              ? "编辑能力"
              : "新增能力"
            : "能力配置"}
          overlayProps={{ blur: 3 }}
        >
          {editing && (
            <div className="space-y-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="tp-title text-sm font-semibold">
                    {capabilities.some((item) => item.id === editing.id)
                      ? "编辑能力"
                      : "新增能力"}
                  </div>
                  <div className="tp-muted text-xs">
                    这里只保存非敏感参数，API Key 仍来自部署配置。
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setEditing(null)}
                >
                  取消
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="tp-muted text-xs font-medium">名称</span>
                  <Input
                    value={editing.name}
                    onChange={(event) =>
                      setEditing({
                        ...editing,
                        name: event.currentTarget.value,
                      })}
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="tp-muted text-xs font-medium">类型</span>
                  <Select
                    value={editing.kind}
                    onChange={(event) => {
                      const kind = event.currentTarget.value;
                      setEditing({
                        ...editing,
                        kind,
                        provider: providerForCapabilityKind(kind),
                      });
                    }}
                  >
                    {CAPABILITY_KIND_OPTIONS.map((kind) => (
                      <option key={kind} value={kind}>
                        {capabilityKindLabel(kind)}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="space-y-1.5">
                  <span className="tp-muted text-xs font-medium">
                    能力提供方
                  </span>
                  <Input
                    value={editing.provider}
                    onChange={(event) =>
                      setEditing({
                        ...editing,
                        provider: event.currentTarget.value,
                      })}
                  />
                </label>
                <label className="flex items-center gap-2 pt-6 text-sm">
                  <input
                    className="size-4 accent-[#0f172a]"
                    type="checkbox"
                    checked={editing.enabled}
                    onChange={(event) =>
                      setEditing({
                        ...editing,
                        enabled: event.currentTarget.checked,
                      })}
                  />
                  启用
                </label>
                {(editing.kind === "llm" ||
                  editing.kind === "embedding" ||
                  editing.kind === "image-generation") && (
                  <label className="space-y-1.5">
                    <span className="tp-muted text-xs font-medium">模型</span>
                    <Input
                      value={editing.model}
                      placeholder="例如 MiniMax-M2.7 / qwen-image-2.0-pro"
                      onChange={(event) =>
                        setEditing({
                          ...editing,
                          model: event.currentTarget.value,
                        })}
                    />
                  </label>
                )}
                {editing.kind === "image-generation" && (
                  <>
                    <label className="space-y-1.5">
                      <span className="tp-muted text-xs font-medium">
                        默认数量
                      </span>
                      <Input
                        type="number"
                        min="1"
                        max="4"
                        value={editing.count}
                        onChange={(event) =>
                          setEditing({
                            ...editing,
                            count: event.currentTarget.value,
                          })}
                      />
                    </label>
                    <label className="space-y-1.5">
                      <span className="tp-muted text-xs font-medium">尺寸</span>
                      <Input
                        value={editing.size}
                        onChange={(event) =>
                          setEditing({
                            ...editing,
                            size: event.currentTarget.value,
                          })}
                      />
                    </label>
                  </>
                )}
                {editing.kind === "notification" && (
                  <div className="space-y-2 sm:col-span-2">
                    <div className="tp-muted text-xs font-medium">通知渠道</div>
                    <div className="flex flex-wrap gap-2">
                      {NOTIFICATION_CHANNEL_OPTIONS.map((channel) => (
                        <label
                          key={channel}
                          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-[#cbd5e1] bg-[#ffffff]/70 px-2.5 text-xs text-[#4b4035]"
                        >
                          <input
                            className="size-3.5 accent-[#0f172a]"
                            type="checkbox"
                            checked={editing.channels.includes(channel)}
                            onChange={(event) => {
                              const channels = event.currentTarget.checked
                                ? [...editing.channels, channel]
                                : editing.channels.filter((item) =>
                                  item !== channel
                                );
                              setEditing({ ...editing, channels });
                            }}
                          />
                          {channel}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="mt-4 flex justify-end">
                <Button
                  type="button"
                  variant="primary"
                  onClick={saveCapability}
                  disabled={saving}
                >
                  <Save className="size-3.5" />
                  保存能力
                </Button>
              </div>
            </div>
          )}
        </Drawer>
      </div>

      <div className="grid min-w-0 gap-4 xl:grid-cols-2">
        {entries.length
          ? entries.map(([kind, items]) => (
            <section
              key={kind}
              className="tp-section min-w-0 rounded-md border p-4"
            >
              <SectionTitle
                title={capabilityKindLabel(kind)}
                description={`${items.length} 个配置 · ${
                  capabilityKindDescription(kind)
                }`}
              />
              <div className="grid min-w-0 gap-2">
                {items.map((capability) => (
                  <div
                    key={capability.id}
                    className="min-w-0 overflow-hidden rounded-md border border-[#e2e8f0] bg-[#ffffff]/55 p-3"
                  >
                    <div className="mb-2 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="tp-title truncate text-sm font-semibold">
                          {capability.name}
                        </div>
                        <div className="tp-muted truncate text-xs">
                          {capability.id}
                        </div>
                      </div>
                      <Badge
                        tone={capability.enabled ? "success" : "muted"}
                        className="max-w-[46%] shrink-0 px-2.5"
                        title={capability.provider}
                      >
                        <span className="min-w-0 truncate">
                          {capability.provider}
                        </span>
                      </Badge>
                    </div>
                    <div className="tp-subtle truncate text-xs">
                      {compactConfig(capability.config)}
                    </div>
                    <div className="mt-3 flex justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        onClick={() =>
                          setEditing(capabilityDraftFromProfile(capability))}
                      >
                        编辑
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => deleteCapability(capability)}
                        disabled={saving}
                      >
                        删除
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))
          : <EmptyState>还没有能力配置</EmptyState>}
      </div>
    </div>
  );
}

export function RuntimeConfigPanel(
  {
    apiKey,
    profiles,
    capabilities,
    latestRun,
    mode = "settings",
    selectedProfileId,
    onSelectProfile,
    onReload,
  }: {
    apiKey: string;
    profiles: ArticleRuntimeProfileDetail[];
    capabilities: CapabilityProfile[];
    latestRun?: ArticleRunDetail | null;
    mode?: "trend" | "sources" | "settings";
    selectedProfileId: string;
    onSelectProfile: (profileId: string) => void;
    onReload: () => Promise<void>;
  },
) {
  const selected =
    profiles.find((item) => item.profile.id === selectedProfileId) ??
      profiles[0];
  const [articleJson, setArticleJson] = useState("");
  const [showAdvancedJson, setShowAdvancedJson] = useState(false);
  const [sourceDrafts, setSourceDrafts] = useState<SourceDraft[]>([]);
  const [fetchGroupDrafts, setFetchGroupDrafts] = useState<FetchGroupDraft[]>(
    [],
  );
  const [profileMeta, setProfileMeta] = useState({
    name: "",
    enabled: true,
    isDefault: false,
  });
  const [schedule, setSchedule] = useState({
    enabled: true,
    cron: "0 3 * * *",
    timezone: "Asia/Shanghai",
    dryRun: true,
  });
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!selected) return;
    setArticleJson(JSON.stringify(selected.article, null, 2));
    setProfileMeta({
      name: selected.profile.name,
      enabled: selected.profile.enabled,
      isDefault: selected.profile.isDefault,
    });
    setSourceDrafts(selected.sources.map((source) => ({
      raw: source.raw,
      url: source.url,
      group: source.group,
      enabled: source.enabled,
    })));
    setFetchGroupDrafts(
      Object.entries(selected.fetchGroups).map(([name, providers]) => ({
        name,
        providers,
      })),
    );
    setSchedule({
      enabled: selected.schedule?.enabled ?? true,
      cron: selected.schedule?.cron ?? "0 3 * * *",
      timezone: selected.schedule?.timezone ?? "Asia/Shanghai",
      dryRun: selected.schedule?.dryRun ?? true,
    });
    setError("");
  }, [selected]);

  const saveArticlePatch = async (article: Record<string, unknown>) => {
    if (!selected) return;
    setSaving("article");
    setError("");
    try {
      await apiJson(
        `/api/config/features/article/profiles/${
          encodeURIComponent(selected.profile.id)
        }`,
        apiKey,
        {
          method: "PATCH",
          body: JSON.stringify({ article }),
        },
      );
      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving("");
    }
  };

  const saveArticle = async () => {
    await saveArticlePatch(JSON.parse(articleJson));
  };

  const saveProfileMeta = async () => {
    if (!selected) return;
    setSaving("profile-meta");
    setError("");
    try {
      await apiJson(
        `/api/config/features/article/profiles/${
          encodeURIComponent(selected.profile.id)
        }`,
        apiKey,
        {
          method: "PATCH",
          body: JSON.stringify(profileMeta),
        },
      );
      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving("");
    }
  };

  const saveSources = async () => {
    if (!selected) return;
    setSaving("sources");
    setError("");
    try {
      await apiJson(
        `/api/config/features/article/profiles/${
          encodeURIComponent(selected.profile.id)
        }/sources`,
        apiKey,
        {
          method: "PUT",
          body: JSON.stringify({
            sources: sourceDrafts
              .filter((source) => source.url.trim())
              .map((source, index) => ({
                raw: source.raw || `${source.group}:${source.url}`,
                url: source.url.trim(),
                group: source.group || "default",
                enabled: source.enabled,
                position: index,
              })),
          }),
        },
      );
      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving("");
    }
  };

  const saveFetchGroups = async () => {
    if (!selected) return;
    setSaving("fetch-groups");
    setError("");
    try {
      await apiJson(
        `/api/config/features/article/profiles/${
          encodeURIComponent(selected.profile.id)
        }/fetch-groups`,
        apiKey,
        {
          method: "PUT",
          body: JSON.stringify({
            fetchGroups: Object.fromEntries(
              fetchGroupDrafts
                .filter((group) => group.name.trim())
                .map((group) => [
                  group.name.trim(),
                  group.providers.length ? group.providers : ["auto"],
                ]),
            ),
          }),
        },
      );
      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving("");
    }
  };

  const saveSchedule = async () => {
    if (!selected) return;
    setSaving("schedule");
    setError("");
    try {
      await apiJson(
        `/api/config/features/article/profiles/${
          encodeURIComponent(selected.profile.id)
        }/schedule`,
        apiKey,
        {
          method: "PUT",
          body: JSON.stringify(schedule),
        },
      );
      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving("");
    }
  };

  const createProfile = async () => {
    setSaving("profile");
    setError("");
    try {
      const data = await apiJson<{ profile: ArticleRuntimeProfileDetail }>(
        "/api/config/features/article/profiles",
        apiKey,
        {
          method: "POST",
          body: JSON.stringify({
            copyFromProfileId: selected?.profile.id,
            name: selected ? `${selected.profile.name} 副本` : "新微信文章",
          }),
        },
      );
      onSelectProfile(data.profile.profile.id);
      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving("");
    }
  };

  const deleteProfile = async () => {
    if (!selected || selected.profile.isDefault) return;
    const confirmed = globalThis.confirm(
      `删除文章方案「${selected.profile.name}」？数据源、抓取分组和定时规则也会一起删除。`,
    );
    if (!confirmed) return;
    setSaving("profile");
    setError("");
    try {
      await apiJson(
        `/api/config/features/article/profiles/${
          encodeURIComponent(selected.profile.id)
        }`,
        apiKey,
        { method: "DELETE" },
      );
      const fallback = profiles.find((item) => item.profile.isDefault) ??
        profiles.find((item) => item.profile.id !== selected.profile.id);
      if (fallback) onSelectProfile(fallback.profile.id);
      await onReload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving("");
    }
  };

  const article = asRecord(selected?.article);
  const panelCopy = {
    trend: {
      title: "微信文章方案",
      description: "调整本次文章工作流的模板、数量、配图、发布与去重参数。",
    },
    sources: {
      title: "数据源与抓取策略",
      description: "维护 URL 列表和 fetchGroups，保存后下一次运行生效。",
    },
    settings: {
      title: "运行时配置",
      description: "业务配置保存在 SQLite/D1；密钥仍由部署环境管理。",
    },
  }[mode];

  return (
    <div className="space-y-4">
      <div className="tp-command rounded-lg border p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2">
              <Settings className="size-4 text-[#64748b]" />
              <h2 className="tp-title text-base font-semibold">
                {panelCopy.title}
              </h2>
            </div>
            <p className="tp-muted text-sm">{panelCopy.description}</p>
          </div>
          <div className="flex gap-2">
            <Select
              value={selected?.profile.id ?? ""}
              onChange={(event) => onSelectProfile(event.currentTarget.value)}
            >
              {profiles.map((item) => (
                <option value={item.profile.id} key={item.profile.id}>
                  {item.profile.name}
                  {item.profile.isDefault ? " · 默认" : ""}
                </option>
              ))}
            </Select>
            <Button
              size="sm"
              onClick={createProfile}
              disabled={saving === "profile"}
            >
              <Plus className="size-3.5" />
              复制
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={deleteProfile}
              disabled={saving === "profile" || !selected ||
                selected.profile.isDefault}
            >
              删除
            </Button>
          </div>
        </div>
        {selected && (
          <div className="mt-4 grid gap-2 border-t border-[#e2e8f0] pt-4 md:grid-cols-[minmax(0,1fr)_auto_auto_auto]">
            <Input
              value={profileMeta.name}
              onChange={(event) =>
                setProfileMeta({
                  ...profileMeta,
                  name: event.currentTarget.value,
                })}
              placeholder="文章方案名称"
            />
            <label className="flex h-[34px] items-center gap-2 rounded-md border border-[#cbd5e1] bg-[#ffffff]/60 px-3 text-xs text-[#475569]">
              <input
                className="size-3.5 accent-[#0f172a]"
                type="checkbox"
                checked={profileMeta.enabled}
                onChange={(event) =>
                  setProfileMeta({
                    ...profileMeta,
                    enabled: event.currentTarget.checked,
                  })}
              />
              启用
            </label>
            <label className="flex h-[34px] items-center gap-2 rounded-md border border-[#cbd5e1] bg-[#ffffff]/60 px-3 text-xs text-[#475569]">
              <input
                className="size-3.5 accent-[#0f172a]"
                type="checkbox"
                checked={profileMeta.isDefault}
                disabled={selected.profile.isDefault}
                onChange={(event) =>
                  setProfileMeta({
                    ...profileMeta,
                    isDefault: event.currentTarget.checked,
                  })}
              />
              默认
            </label>
            <Button
              size="sm"
              onClick={saveProfileMeta}
              disabled={saving === "profile-meta"}
            >
              <Save className="size-3.5" />
              保存方案
            </Button>
          </div>
        )}
      </div>

      {error && (
        <div className="tp-danger mb-4 rounded-md border p-3 text-sm">
          {error}
        </div>
      )}

      {mode === "trend" && (
        <TrendProfileView
          article={article}
          capabilities={capabilities}
          saving={saving}
          onSave={saveArticlePatch}
        />
      )}

      {mode === "sources" && (
        <div className="space-y-4">
          <SourceHealthPanel
            run={latestRun ?? null}
            apiKey={apiKey}
          />
          <SourcesView
            sourceDrafts={sourceDrafts}
            fetchGroupDrafts={fetchGroupDrafts}
            saving={saving}
            onSourcesChange={setSourceDrafts}
            onFetchGroupsChange={setFetchGroupDrafts}
            onSaveSources={saveSources}
            onSaveFetchGroups={saveFetchGroups}
          />
        </div>
      )}

      {mode === "settings" && (
        <div className="grid gap-4 xl:grid-cols-[1fr_0.8fr]">
          <section className="tp-section rounded-md border p-4">
            <SectionTitle
              title="高级配置 JSON"
              description="只在需要精确调试时打开。新手通常不需要编辑这里。"
              action={
                <Button
                  size="sm"
                  type="button"
                  onClick={() => setShowAdvancedJson(!showAdvancedJson)}
                >
                  {showAdvancedJson ? "收起" : "展开"}
                </Button>
              }
            />
            {showAdvancedJson
              ? (
                <div className="space-y-3">
                  <Textarea
                    className="min-h-[420px] font-mono text-xs"
                    value={articleJson}
                    onChange={(event) =>
                      setArticleJson(event.currentTarget.value)}
                  />
                  <div className="flex justify-end">
                    <Button
                      size="sm"
                      onClick={saveArticle}
                      disabled={saving === "article"}
                    >
                      <Save className="size-3.5" />
                      保存 JSON
                    </Button>
                  </div>
                </div>
              )
              : (
                <div className="tp-card-soft rounded-md border p-3 text-sm text-[#64748b]">
                  高级 JSON 已隐藏。日常配置请使用微信 Trend
                  和数据源页面；共享能力在当前设置页下方维护。
                </div>
              )}
          </section>

          <div className="space-y-4">
            <section className="tp-section rounded-md border p-4">
              <SectionTitle
                title="定时"
                description="本地、Docker、远程部署的 heartbeat 都会读取这里的规则。"
                action={
                  <Button
                    size="sm"
                    onClick={saveSchedule}
                    disabled={saving === "schedule"}
                  >
                    <Save className="size-3.5" />
                    保存
                  </Button>
                }
              />
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="tp-muted text-xs font-medium">Cron</span>
                  <Input
                    value={schedule.cron}
                    onChange={(event) =>
                      setSchedule({
                        ...schedule,
                        cron: event.currentTarget.value,
                      })}
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="tp-muted text-xs font-medium">时区</span>
                  <Input
                    value={schedule.timezone}
                    onChange={(event) =>
                      setSchedule({
                        ...schedule,
                        timezone: event.currentTarget.value,
                      })}
                  />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    className="size-4 accent-[#0f172a]"
                    type="checkbox"
                    checked={schedule.enabled}
                    onChange={(event) =>
                      setSchedule({
                        ...schedule,
                        enabled: event.currentTarget.checked,
                      })}
                  />
                  启用定时
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    className="size-4 accent-[#0f172a]"
                    type="checkbox"
                    checked={schedule.dryRun}
                    onChange={(event) =>
                      setSchedule({
                        ...schedule,
                        dryRun: event.currentTarget.checked,
                      })}
                  />
                  定时 dry-run
                </label>
              </div>
            </section>

            <CapabilitiesView
              capabilities={capabilities}
              apiKey={apiKey}
              onReload={onReload}
            />
          </div>
        </div>
      )}
    </div>
  );
}
