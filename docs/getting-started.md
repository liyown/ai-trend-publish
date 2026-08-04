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
4. 在“内容方案”选择 Agent 策略、支持 Tool Calling 的模型，并授权搜索、抓取、图片或增强工具。
5. 创建自动化任务，可输入额外说明或主题后手动运行。
6. 在“运行记录”查看研究、写作、评估、资源与构建检查点，在“内容库”查看成品。

共享 ReAct Agent 自主决定工具调用顺序，并通过 `submit_master_content` 提交结构化结果。参数或内容校验失败会作为 observation 返回 Agent 修复，不进入人工审核。

文章来源中的事实引用使用 `[来源](evidence://证据ID)`。有效证据的文本摘录、时间段或页码必须通过校验；无法解析的引用会自动变成普通文本，不阻止生成成品。

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

1. 在“发布账号”新增账号，选择微信公众号和“微信公众号”直连接入方式，并在同一对话框填写设置与凭证。需要固定出口 IP 时，在“HTTP 代理地址”中填写住宅代理 URL。
2. 在内容方案的“发布账号”步骤选择一个或多个账号；系统默认勾选“微信公众号图文”。
3. 运行内容方案后，系统为每个账号启动独立渠道 ReAct 会话并校验 HTML/JSON，然后确定性上传素材并创建草稿。
4. 也可以从内容库打开“发布”对话框，临时选择多个账号和发布类型。

未选择账号时只生成可发布内容包。每个发布目的地独立执行；部分账号失败不会抹掉其他账号的成功结果。
