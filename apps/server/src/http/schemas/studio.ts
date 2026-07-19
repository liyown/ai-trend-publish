import { z } from "zod";
import { ArticleSourceFormat } from "@trendpublish/contracts";

export const idParam = z.string().trim().min(1).max(200);
const revision = z.number().int().positive();
const jsonValue: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(jsonValue),
    z.record(z.string(), jsonValue),
  ]),
);
const settings = z.record(z.string().min(1).max(120), jsonValue);

export const saveConnectionSchema = z.object({
  id: idParam.optional(),
  revision: revision.optional(),
  connectorId: idParam,
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().default(true),
  settings,
  credentials: settings.default({}),
  clearCredentials: z.array(z.string().min(1).max(120)).max(50).default([]),
  overrides: z
    .object({
      headers: z.record(z.string(), z.string()).optional(),
      query: z.record(z.string(), z.string()).optional(),
      body: z.record(z.string(), jsonValue).optional(),
    })
    .optional(),
});

export const saveIdentitySchema = z.object({
  revision: revision.optional(),
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
  positioning: z.string().trim().min(1).max(1000),
  audience: z.string().trim().min(1).max(1000),
  tone: z.string().trim().min(1).max(500),
  forbiddenTopics: z.array(z.string().trim().min(1).max(300)).max(50).default([]),
});

export const saveKnowledgeBaseSchema = z.object({
  revision: revision.optional(),
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
  documents: z
    .array(
      z.object({
        id: idParam.optional(),
        title: z.string().trim().min(1).max(500),
        content: z.string().trim().min(1).max(2_000_000),
        fileName: z.string().trim().max(500).optional(),
        mediaType: z.string().trim().max(200).optional(),
      }),
    )
    .max(200),
});

const sourceItemBaseSchema = z.object({
  id: idParam.optional(),
  title: z.string().trim().max(500).optional(),
  enabled: z.boolean().default(true),
});

export const sourceItemSchema = z.discriminatedUnion("kind", [
  sourceItemBaseSchema.extend({
    kind: z.literal("url"),
    url: z.string().url().max(4000),
  }),
  sourceItemBaseSchema.extend({
    kind: z.literal("query"),
    query: z.string().trim().min(1).max(1000),
  }),
]);

export const saveSourceCollectionSchema = z.object({
  revision: revision.optional(),
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
  sources: z.array(sourceItemSchema).min(1).max(500),
});

export const saveContentPlanSchema = z
  .object({
    revision: revision.optional(),
    name: z.string().trim().min(1).max(120),
    enabled: z.boolean(),
    identityId: idParam,
    knowledgeBaseIds: z.array(idParam).max(50).default([]),
    sourceCollectionIds: z.array(idParam).max(50),
    plugins: z
      .array(z.object({ pluginId: idParam, enabled: z.boolean(), config: jsonValue.optional() }))
      .max(50)
      .refine((items) => new Set(items.map((item) => item.pluginId)).size === items.length, {
        message: "同一个插件不能重复添加",
      }),
    connections: z.record(z.string().min(1).max(80), idParam),
    researchConnections: z
      .object({
        search: z.array(idParam).max(20),
        fetch: z.array(idParam).max(20),
      })
      .refine(
        (value) =>
          new Set(value.search).size === value.search.length &&
          new Set(value.fetch).size === value.fetch.length,
        { message: "同一种研究连接不能重复添加" },
      )
      .default({ search: [], fetch: [] }),
    publishing: z
      .object({
        mode: z.enum(["content_only", "publish"]),
        targetIds: z.array(idParam).max(50),
      })
      .default({ mode: "content_only", targetIds: [] }),
  })
  .superRefine((value, context) => {
    if (value.publishing.mode === "publish" && !value.publishing.targetIds.length) {
      context.addIssue({
        code: "custom",
        path: ["publishing", "targetIds"],
        message: "发布模式至少需要一个发布目标",
      });
    }
  });

export const saveChannelAccountSchema = z.object({
  revision: revision.optional(),
  name: z.string().trim().min(1).max(120),
  channel: idParam,
  connectionId: idParam,
  settings,
});

export const savePublishTargetSchema = z.object({
  revision: revision.optional(),
  name: z.string().trim().min(1).max(120),
  channelAccountId: idParam,
  settings,
});

export const saveAutomationSchema = z.object({
  revision: revision.optional(),
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean(),
  contentPlanId: idParam,
  instructions: z.string().trim().max(4000).optional(),
  keywords: z.array(z.string().trim().min(1).max(100)).max(50).default([]),
  trigger: z.discriminatedUnion("type", [
    z.object({ type: z.literal("manual") }),
    z.object({
      type: z.literal("schedule"),
      cron: z.string().trim().min(1).max(120),
      timezone: z.string().trim().min(1).max(120),
    }),
    z.object({
      type: z.literal("hotspot"),
      query: z.string().trim().min(1).max(500),
      intervalMinutes: z.number().int().min(5).max(10_080),
    }),
    z.object({ type: z.literal("api"), tokenName: z.string().trim().max(120).optional() }),
  ]),
});

export const runAutomationSchema = z.object({
  requestedTopic: z.string().trim().min(1).max(500).optional(),
});

export const generateArticleSchema = z.object({
  planId: idParam,
  requestedTopic: z.string().trim().min(1).max(500).optional(),
});

export const articleSourceSchema = z
  .object({
    format: z.literal(ArticleSourceFormat.Markdown),
    title: z.string().trim().min(1).max(500),
    digest: z.string().trim().min(1).max(2000),
    bodyMarkdown: z.string().trim().min(1).max(2_000_000),
  })
  .strict();

export const assetRequestSchema = z
  .object({
    id: idParam,
    type: z.enum(["cover", "illustration", "diagram", "chart"]),
    necessity: z.enum(["enhancement", "essential"]),
    brief: z.string().trim().min(1).max(10_000),
    alt: z.string().trim().min(1).max(2_000).optional(),
    caption: z.string().trim().min(1).max(4_000).optional(),
  })
  .strict();

export const completeArticleSchema = z
  .object({
    planId: idParam,
    source: articleSourceSchema,
    assetRequests: z.array(assetRequestSchema).max(100),
    reviewRequestId: idParam,
  })
  .strict();

export const publishContentSchema = z.object({
  packageId: idParam,
  targetIds: z.array(idParam).min(1).max(50),
});

export const objectIdParam = z.object({ id: idParam });
export const jobIdParam = z.object({ jobId: idParam });
