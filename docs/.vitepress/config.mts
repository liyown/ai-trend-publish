import { defineConfig } from "vitepress";

const repoName = process.env.GITHUB_REPOSITORY?.split("/")[1];
const defaultBase = process.env.GITHUB_ACTIONS && repoName ? `/${repoName}/` : "/";

export default defineConfig({
  lang: "zh-CN",
  title: "TrendPublish 文档",
  description: "TrendPublish 项目文档中心",
  base: process.env.BASE_PATH ?? defaultBase,
  cleanUrls: true,
  lastUpdated: true,
  themeConfig: {
    nav: [
      { text: "首页", link: "/" },
      { text: "快速开始", link: "/getting-started" },
      { text: "配置", link: "/configuration" },
      { text: "架构", link: "/architecture" },
      { text: "部署", link: "/deployment" },
      { text: "帮助", link: "/help" },
      { text: "模板", link: "/templates" }
    ],
    sidebar: [
      {
        text: "开始",
        items: [
          { text: "首页", link: "/" },
          { text: "快速开始", link: "/getting-started" },
          { text: "配置说明", link: "/configuration" },
          { text: "架构总览", link: "/architecture" },
          { text: "部署与发布", link: "/deployment" },
          { text: "帮助文档", link: "/help" }
        ]
      },
      {
        text: "接口与集成",
        items: [
          { text: "JSON-RPC API", link: "/api/json-rpc-api" },
          { text: "钉钉 Webhook 指南", link: "/integrations/dingtalk-webhook-guide" },
          { text: "Jina AI 集成指南", link: "/integrations/jina-integration-guide" }
        ]
      },
      {
        text: "模板",
        items: [{ text: "模板展示", link: "/templates" }]
      }
    ],
    socialLinks: [
      { icon: "github", link: "https://github.com/liyown/ai-trend-publish" }
    ],
    search: {
      provider: "local"
    },
    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © TrendPublish"
    }
  }
});
