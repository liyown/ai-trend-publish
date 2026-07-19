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
      { text: "API", link: "/api/rest-api" },
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
          { text: "帮助文档", link: "/help" },
        ],
      },
      {
        text: "扩展与接口",
        items: [
          { text: "REST API", link: "/api/rest-api" },
          { text: "Connector 扩展", link: "/connectors" },
        ],
      },
    ],
    socialLinks: [{ icon: "github", link: "https://github.com/liyown/ai-trend-publish" }],
    search: {
      provider: "local",
    },
    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © TrendPublish",
    },
  },
});
