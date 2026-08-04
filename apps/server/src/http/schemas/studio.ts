import { z } from "zod";
import { ContentPlanTemplateId, type JsonValue } from "@trendpublish/contracts";

export const idParam = z.string().trim().min(1).max(200);
const revision = z.number().int().positive();
const jsonValue: z.ZodType<JsonValue> = z.lazy(() =>
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
    templateId: z
      .enum([
        ContentPlanTemplateId.DailyBrief,
        ContentPlanTemplateId.DeepAnalysis,
        ContentPlanTemplateId.PracticalGuide,
      ])
      .default(ContentPlanTemplateId.DailyBrief),
    identityId: idParam,
    knowledgeBaseIds: z.array(idParam).max(50).default([]),
    sourceCollectionIds: z.array(idParam).max(50),
    connections: z.record(z.string().min(1).max(80), idParam),
    agent: z
      .object({
        modelConnectionId: idParam,
        strategyId: z.enum([
          ContentPlanTemplateId.DailyBrief,
          ContentPlanTemplateId.DeepAnalysis,
          ContentPlanTemplateId.PracticalGuide,
        ]),
        toolConnectionIds: z.array(idParam).max(50).default([]),
        enhancementToolIds: z
          .array(z.enum(["remove-ai-tone", "optimize-style"]))
          .max(20)
          .default([]),
        budget: z
          .object({
            maxTurns: z.number().int().min(1).max(100).optional(),
          })
          .optional(),
      })
      .optional(),
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
        destinations: z
          .array(
            z.object({
              accountId: idParam,
              publicationType: idParam,
              options: settings.optional(),
            }),
          )
          .max(50),
      })
      .default({ destinations: [] }),
  })
  .superRefine((value, context) => {
    const keys = value.publishing.destinations.map(
      (destination) => `${destination.accountId}:${destination.publicationType}`,
    );
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: "custom",
        path: ["publishing", "destinations"],
        message: "同一账号的发布类型不能重复添加",
      });
    }
  });

export const saveChannelAccountSchema = z.object({
  revision: revision.optional(),
  name: z.string().trim().min(1).max(120),
  enabled: z.boolean().default(true),
  channel: idParam,
  connectorId: idParam,
  settings,
  credentials: settings.optional(),
  clearCredentials: z.array(idParam).max(50).optional(),
  publisher: z
    .object({
      toolConnectionIds: z.array(idParam).max(20).default([]),
    })
    .optional(),
});

export const testChannelAccountSchema = saveChannelAccountSchema.extend({
  accountId: idParam.optional(),
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

export const publishContentSchema = z
  .object({
    packageId: idParam,
    destinations: z
      .array(
        z.object({
          accountId: idParam,
          publicationType: idParam,
          options: settings.optional(),
        }),
      )
      .min(1)
      .max(50),
  })
  .superRefine((value, context) => {
    const keys = value.destinations.map(
      (destination) => `${destination.accountId}:${destination.publicationType}`,
    );
    if (new Set(keys).size !== keys.length) {
      context.addIssue({
        code: "custom",
        path: ["destinations"],
        message: "同一账号的发布类型不能重复添加",
      });
    }
  });

export const objectIdParam = z.object({ id: idParam });
export const jobIdParam = z.object({ jobId: idParam });
