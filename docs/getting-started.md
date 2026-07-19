# 快速开始

## 安装

需要 Node.js 24+、pnpm 10 和 Vite+ CLI `vp`。

```bash
vp install
cp trendpublish.config.example.ts trendpublish.config.ts
vp run doctor
vp run dev
```

服务地址为 `http://localhost:8000`，Dashboard 为 `http://localhost:8000/dashboard/`。

## 建立第一个内容任务

1. 在“连接”新建 `OpenAI Compatible` 连接，填写 API 地址、模型和 API Key，并测试连接。
2. 在“内容身份”填写定位、受众、语气、质量标准和禁止话题。
3. 在“知识库”添加长期参考材料；在“来源”配置 URL 或查询及其来源分组。
4. 在“内容方案”绑定身份、知识库、来源、可选文章插件和 `chat` 连接。
5. 创建自动化任务，可输入额外说明或主题后手动运行。
6. 在“运行记录”查看研究、写作、评估、资源与构建检查点，在“内容库”查看成品。

资料不足时会正常返回 `NoContent`；质量阻断或必要资源不可用时会正常保存 `ReviewRequest`。审阅时修改带注解的 Markdown 源稿和资源请求，提交后系统会重新编译、评估并处理资源；不要直接编辑 AST。这两种结果都不会伪装成系统故障，也不会强行发布不完整内容。

文章来源中的事实引用使用 `[来源](evidence://证据ID)`。成品至少需要一条有效引用；证据的文本摘录、时间段或页码必须通过校验，可比较的摘录还会与研究阶段冻结的素材核对。

如果你想直接聚合自己维护的 RSS / Atom / JSON Feed，也可以把订阅地址直接放进
`features.article.sources`：

```ts
features: {
  article: {
    renderer: {
      promptProfile: "technology",
    },
    sources: [
      "https://your-feed.example.com/rss.xml",
      "https://another-feed.example.com/atom.xml",
    ],
  },
},
fetchGroups: {
  default: ["auto"],
},
```

先运行 `deno task article --dry-run`，确认当天产物里已经出现自定义 RSS 的文章，
再继续接入正式发布链路。

## 发布到微信公众号

1. 在“连接”创建微信公众号直连或 Relay 连接。
2. 在“渠道与目标”创建渠道账号。
3. 基于渠道账号创建发布目标。
4. 在自动发布的内容方案中启用封面插件，将封面设为必要项并绑定图片连接。
5. 从内容库选择内容包和一个或多个目标发布。

每个目标独立执行；部分账号失败不会抹掉其他账号的成功结果。
