import { ArticlePluginId } from "@trendpublish/contracts";
import type { WorkingArticle } from "../domain.ts";
import type { ArticleOperationContext, ArticleTransformer } from "../extensions.ts";
import { parseModelJson, type LanguageModel } from "../operations/language-model.ts";

export interface TitleStyleTransformerOptions {
  languageModel: LanguageModel;
  rules?: string[];
  minLength?: number;
  maxLength?: number;
}

export class TitleStyleTransformer implements ArticleTransformer {
  readonly id = ArticlePluginId.TitleStyle;
  readonly version = "1";

  constructor(private readonly options: TitleStyleTransformerOptions) {}

  async transform(
    input: Parameters<ArticleTransformer["transform"]>[0],
    context: ArticleOperationContext,
  ): Promise<WorkingArticle> {
    const rules = this.options.rules?.filter(Boolean) ?? [];
    if (!rules.length) return structuredClone(input.article);
    const result = parseModelJson<{ title?: string }>(
      await this.options.languageModel.generate({
        system:
          "你是标题编辑。只调整标题表达，不改变文章事实和结论。严格遵守配置规则。返回 JSON：{title:string}。",
        user: JSON.stringify({
          currentTitle: input.article.source.title,
          digest: input.article.source.digest,
          rules,
          minLength: this.options.minLength ?? 8,
          maxLength: this.options.maxLength ?? 40,
        }),
        temperature: 0.25,
        json: true,
        signal: context.signal,
        events: context.task,
      }),
    );
    const title = result.title?.trim();
    if (!title || title === input.article.source.title) return structuredClone(input.article);
    return {
      ...structuredClone(input.article),
      source: { ...structuredClone(input.article.source), title },
    };
  }
}
