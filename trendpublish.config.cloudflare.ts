import { defineConfig } from "@trendpublish/core/config";

// Cloudflare 的数据库和密钥来自 ARTICLE_DB / SERVER_API_KEY bindings；
// 此文件只保留构建时可共享的非业务配置。
export default defineConfig({
  observability: { enabled: true, serviceName: "trendpublish", environment: "cloudflare" },
});
