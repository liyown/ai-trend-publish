import {
  ContentPlanTemplateId,
  DefaultContentPlanTemplateId,
  DiagnosticSeverity,
  type ContentPlanTemplateDefinition,
  type DiagnosticSeverity as DiagnosticSeverityValue,
} from "@trendpublish/contracts";

export interface ContentPlanTemplate {
  definition: ContentPlanTemplateDefinition;
  title: { rules: string[]; minLength: number; maxLength: number };
  quality: {
    standards: string[];
    severity: Exclude<DiagnosticSeverityValue, typeof DiagnosticSeverity.Info>;
    maxRounds: number;
  };
  cover: { style: string };
}

export const CONTENT_PLAN_TEMPLATES: readonly ContentPlanTemplate[] = [
  {
    definition: {
      id: ContentPlanTemplateId.DailyBrief,
      name: "每日资讯解读",
      description: "从当天材料提炼变化、影响和行动建议，适合稳定日更。",
      stages: ["研究与选题", "资讯写作", "标题整理", "质量修订", "封面生成"],
    },
    title: {
      rules: ["突出核心变化和读者影响", "避免夸张、悬念和泛泛速递"],
      minLength: 8,
      maxLength: 40,
    },
    quality: {
      standards: ["区分已知事实与编辑判断", "优先说明影响、限制和下一步"],
      severity: DiagnosticSeverity.Error,
      maxRounds: 1,
    },
    cover: { style: "克制的编辑插画，现代、清晰、无文字和水印" },
  },
  {
    definition: {
      id: ContentPlanTemplateId.DeepAnalysis,
      name: "深度分析",
      description: "围绕一个主题形成完整论点、背景、影响与边界。",
      stages: ["深度研究", "论点写作", "标题整理", "多轮质量修订", "封面生成"],
    },
    title: {
      rules: ["标题表达明确判断", "避免把推测写成结论"],
      minLength: 10,
      maxLength: 46,
    },
    quality: {
      standards: ["论点、证据和结论保持一致", "说明反例、限制和适用范围"],
      severity: DiagnosticSeverity.Error,
      maxRounds: 2,
    },
    cover: { style: "高质感编辑视觉，抽象但可理解，无文字和水印" },
  },
  {
    definition: {
      id: ContentPlanTemplateId.PracticalGuide,
      name: "实用指南",
      description: "把主题整理成可执行步骤、注意事项与适用条件。",
      stages: ["资料整理", "步骤化写作", "标题整理", "可执行性修订", "封面生成"],
    },
    title: {
      rules: ["明确读者能完成什么", "避免空泛的大全和终极指南"],
      minLength: 8,
      maxLength: 42,
    },
    quality: {
      standards: ["步骤可以直接执行", "明确前置条件、风险和失败处理"],
      severity: DiagnosticSeverity.Error,
      maxRounds: 1,
    },
    cover: { style: "简洁的信息图风格，结构清楚，无文字和水印" },
  },
];

export function resolveContentPlanTemplate(templateId: string | undefined): ContentPlanTemplate {
  const id = templateId ?? DefaultContentPlanTemplateId;
  return (
    CONTENT_PLAN_TEMPLATES.find((template) => template.definition.id === id) ??
    CONTENT_PLAN_TEMPLATES[0]!
  );
}
