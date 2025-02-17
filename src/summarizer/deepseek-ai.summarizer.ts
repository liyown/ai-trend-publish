import { OpenAI } from "openai";
import { ContentSummarizer, Summary } from "./interfaces/summarizer.interface";
import { ConfigManager } from "../utils/config/config-manager";

const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

export class DeepseekAISummarizer implements ContentSummarizer {
  private client!: OpenAI;
  private readonly model: string = "deepseek-chat";

  constructor() {
    this.refresh();
  }

  async refresh(): Promise<void> {
    await this.validateConfig();
    this.client = new OpenAI({
      apiKey: await ConfigManager.getInstance().get("DEEPSEEK_API_KEY"),
      baseURL: "https://api.deepseek.com",
    });
  }

  async validateConfig(): Promise<void> {
    if (!(await ConfigManager.getInstance().get("DEEPSEEK_API_KEY"))) {
      throw new Error("DeepSeek API key is required");
    }
  }

  private async retryOperation<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await operation();
      } catch (error) {
        if (attempt === MAX_RETRIES) {
          throw error;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, RETRY_DELAY * attempt)
        );
      }
    }
    throw new Error("Operation failed after max retries");
  }

  async summarize(
    content: string,
    options?: Record<string, any>
  ): Promise<Summary> {
    if (!content) {
      throw new Error("Content is required for summarization");
    }

    return this.retryOperation(async () => {
      const systemPrompt = `你是一个专业的内容创作者和摘要生成器。你的任务是：
        1. 理解原始内容的核心观点和背景
        2. 基于原始内容进行扩充，补充相关的背景信息、技术细节或实际应用场景
        3. 确保扩充后的内容准确、专业，并保持行文流畅
        4. 生成一个引人入胜的标题和3-5个关键词
        5. ！生成一个0-100的分数，表示内容的重要性和价值，分数越高，表示内容越重要和有价值，同时越可能被读者关注，同时具有区分度，不应该分数很集中，精确到小数点后两位；

        请只返回JSON格式数据，格式如下：
        {
            "title": "引人注目且专业的标题",
            "content": "扩充和完善后的内容",
            "keywords": ["关键词1", "关键词2", "关键词3"],
            "score": 0-100
        }`;

      const userPrompt = `请分析以下内容，在保持原意的基础上进行专业的扩充和完善，使用${
        options?.language || "中文"
      }，完善后的内容不少于${options?.minLength || 200}字；
      }字：\n\n${content}\n\n要求：
        1. 保持专业性，可以补充相关的技术细节、应用场景或行业背景；
        2. 注意内容的连贯性和可读性；
        3. 如果原文涉及技术点，可以补充相关的技术原理或最新进展；
        4. 如果原文是新闻，可以补充相关的行业影响或未来趋势；
        5. 确保扩充的内容真实可靠，避免主观臆测；
        6. 关键字的长度不超过4个字；
        7. !!内容不要像是AIGC生成的，要像是一个人写的，不要出现"根据以上信息"、"根据以上内容"等字样，需要是新闻类型的；
        8. 内容不要出现其他格式，例如markdown格式，而是纯文本；`;

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      });

      const completion = response.choices[0]?.message?.content;
      if (!completion) {
        throw new Error("未获取到有效的摘要结果");
      }

      try {
        const summary = JSON.parse(completion) as Summary;
        if (
          !summary.title ||
          !summary.content ||
          !Array.isArray(summary.keywords)
        ) {
          throw new Error("摘要结果格式不正确");
        }
        return summary;
      } catch (error) {
        throw new Error(
          `解析摘要结果失败: ${
            error instanceof Error ? error.message : "未知错误"
          }`
        );
      }
    });
  }

  async generateTitle(
    content: string,
    options?: Record<string, any>
  ): Promise<string> {
    return this.retryOperation(async () => {
      const systemPrompt = `你是一个专业的内容创作者和标题生成器。你的任务是：
        1. 从所有标题中选择最重要、最有价值的一个；
        2. 标题简洁明了，不超过10个字；
        3. 标题能够准确反映内容的核心观点；
        4. 标题不要出现"根据以上信息"、"根据以上内容"等字样，要像新闻类型的；
        5. 标题不要出现其他格式，例如markdown格式，而是纯文本`;

      const userPrompt = `请从以下内容中选择最重要的一个标题，用于微信公众号文章标题，使用${
        options?.language || "中文"
      }：\n\n${content}\n\n`;

      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      });

      const title = response.choices[0]?.message?.content;
      if (!title) {
        throw new Error("未获取到有效的标题");
      }
      return title;
    });
  }
}
