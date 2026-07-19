# 更新日志

## [Unreleased]

### Modular content runtime

- 以 `runtime`、`connectors`、`article`、`publishing`、`core` 五个独立边界重建核心能力。
- 移除旧 `workflow`、`integrations`、`agents` 包、根 `src` 树、旧 HTTP 接口和旧迁移链，
  不保留兼容导入。
- 引入 `ArticlePipeline`、`ArticleExecutionPlan`、四类文章插件能力和基于问题与预算收敛的
  质量循环，以及支持纯计算、幂等和不安全副作用的 Job/Task 检查点。
- 升级到 `ContentPackage v5`：结果协议统一为 `ArticleResultKind`，来源记录使用 `jobId`，
  工作区统一以 `contentPackage` 保存冻结内容包；开发期 v4 数据不自动迁移。
- 内容生成与渠道发布解耦；内容身份属于内容方案，发布目标只引用渠道账号；同一内容包可以
  独立扇出到多个同类或异类账号。
- 外部能力统一改为 Web 管理的连接。Connector 定义基础字段和连接测试，并支持
  Headers、Query、Body 请求覆盖；Client 只执行一次 API 调用。
- Dashboard 改为连接、内容身份、知识库、来源配置、内容方案、渠道与目标、任务和内容包的
  标准列表/表单/对话框界面，并通过 SSE 展示运行活动。
- HTTP DTO 全部收口到 `packages/contracts`；各包只公开稳定命名入口，不再允许任意源码深导入。
- 本地存储统一为 SQLite，Cloudflare 统一为 D1；新部署只使用
  `0001_modular_runtime.sql`。

## [2.0.7] - 2026-06-04

### Cloudflare 发布稳定性

- 修复 Cloudflare 真实发布在封面生成失败后仍可能因子请求数耗尽而失败的问题。
- 封面生成失败或超时时改为直接使用内置默认封面 `mediaId` 兜底，不再通过
  relay/微信上传接口二次获取默认封面，避免在 Worker 子请求数接近上限时
  继续发起网络请求。
- 封面服务测试覆盖生成失败和生成 hang 住时都不再调用默认封面上传接口。

## [2.0.6] - 2026-06-04

### 发布稳定性

- 修复真实发布时可能卡在封面生成的问题：封面图片生成、封面上传和默认封面上传都增加
  明确超时预算，生成异常或超时会自动回退默认封面，避免卡住整个发布流程。
- 阿里云图片生成 provider 增加提交任务、查询任务、同步多模态请求和异步任务总等待
  超时，DashScope 长时间无响应时会尽快失败并交给上层兜底。
- 补充封面生成 hang 住时的回退单测，确保后续不会再次阻塞真实发布。
- 修正抓取服务单测中的固定日期和缺失 source 类型字段，避免测试随时间漂移误报。

## [2.0.5] - 2026-06-02

### 内容身份质量闭环

- 新增多身份矩阵能力，每个内容身份可以维护独立的定位、目标读者、语气风格、
  标题偏好、默认文章方案和来源分组。
- 新增身份级运行时解析，矩阵内容包
  会按内容身份读取专属画像、来源分组和默认参数，
  同一批素材可生成不同主线和不同文章形态。
- 新增账号学习快照
  artifact，记录本次生成前读取到的身份画像、历史文章、人工反馈、
  主题取舍和来源信号，便于解释系统为什么这样选题和写作。
- 新增身份洞察 API 和 Dashboard
  内容身份页，展示身份画像完整度、最近运行、质量趋势、 反馈统计、微信 relay
  检查状态和下一步建议。

### 选题、审稿与人工反馈

- 新增选题工作台，按主题聚类、评分、编辑决策和身份适配组织内容，支持将主题标记为
  `lead`、`adopt` 或 `skip`。
- 新增 run 级人工反馈，支持对每次生成结果标记 `good`、`ok`、`bad` 并记录原因。
- 主题反馈和 run
  反馈会按内容身份入账，下一次选题时用于提升相似主线、适度采用相似主题、
  或硬降级曾被跳过的重复主题。
- 质量复盘链路增强，文章会经历质量审稿、可控修订、质量门禁和最终发布决策；低质量
  真实发布可由配置或显式 force publish 覆盖。
- 发布后的文章记忆会记录标题、主论点、关键词、主题、来源 URL、质量分和发布状态，
  为后续身份级学习提供数据基础。

### 稳定性与数据获取

- LLM provider 错误分类更精确，网络、超时、鉴权、限流和配额错误不再被误判为普通
  JSON 结构错误，减少无效纠偏重试。
- 内容排序在 LLM 不可用时会回退到本地可解释排序，并优先选择近期、信息密度高的
  原始文章，降低列表页被误选为主线的概率。
- 普通数据源和列表页抓取增加截断、展开和候选过滤，OpenAI News 一类索引页会优先
  展开具体文章再参与选题。
- 草稿兜底逻辑会清理内部编辑字段，避免 `章节目标`、`待核对编辑要点`
  等内部标签泄漏 到最终公众号 HTML。

### Dashboard 与运行体验

- Dashboard 增强内容身份、运行阶段、质量复盘、运行反馈、身份学习依据和产物预览。
- 运行入口支持单身份运行和多身份矩阵内容包，矩阵批次会生成身份对比 artifact。
- 运行列表和详情页展示内容身份、文章方案、质量分、发布状态、步骤产物和人工反馈入口。
- 配置页补充质量门禁 force publish
  配置项，支持后续生产运行按配置决定是否强制发布。

### Cloudflare 与存储

- Cloudflare / D1 / SQLite 存储补齐账号作用域字段、账号 ops 状态和主题反馈表。
- Cloudflare Worker、本地服务和 Dashboard API
  对齐账号、矩阵运行、反馈、账号洞察和 runtime config 管理接口。
- 新增 migration：账号级编辑记忆字段、公众号 ops JSON、主题反馈表。

### 验证

- 已通过 `deno task verify`：类型检查、Dashboard 构建、架构边界检查和 194
  个测试全部通过。
- 已通过多账号真实 dry-run：`default` 与 `engineering-lab`
  两个账号均成功，质量分分别为 91 / 92，主线主题和文章形态均已拉开差异。

## [1.0.10] - 2026-05-22

### Dashboard 工程化

- 新增独立 `dashboard/` 前端工程，使用 React、Vite、TypeScript 和 Tailwind CSS
  构建运行看板，不再使用原来的内联 HTML 作为主实现。
- Dashboard 固定挂载到 `/dashboard`，本地服务、Docker 镜像和 Cloudflare Worker
  使用同一套构建产物。
- 新增 API key 登录页，密钥仅保存在浏览器 `sessionStorage`，后续请求通过
  `Authorization: Bearer <key>` 调用后端 API。
- 首页展示运行环境、健康状态、脱敏配置摘要、最近运行和当前存储 / workflow
  状态，便于快速判断部署是否可用。
- 运行列表支持状态筛选、手动刷新和自动刷新；运行详情展示步骤时间线、状态、耗时、
  attempt、错误信息、summary 和产物列表。
- Artifact 面板支持 HTML、JSON、文本和图片预览，所有产物仍通过认证 API 读取，
  不直接公开本地目录或 R2 bucket。
- 触发任务弹窗默认执行 dry-run；真实发布必须勾选确认并发送
  `forcePublish: true`，降低误发布风险。

### API 与服务端

- 本地服务新增 `GET /api/health`，与 Cloudflare Worker 健康检查接口保持一致。
- 新增 `GET /api/config/summary`，仅返回脱敏后的运行配置摘要，不暴露 provider
  secret。
- 本地服务新增 dashboard 静态资源托管。存在 `dist/dashboard`
  时直接读取；缺少构建产物时返回提示页。
- Cloudflare Worker 新增 Workers Static Assets 支持，`/dashboard` 和
  `/dashboard/*` 直接托管前端资源，`/api/*` 继续走 Worker 后端逻辑。
- Cloudflare Worker 同步支持 `/api/config/summary`，Dashboard 在本地、Docker 和
  Cloudflare 下使用一致 API。
- 微信文章 workflow 识别 `forcePublish`，Dashboard 二次确认后可以覆盖默认
  dry-run 配置并创建微信公众号草稿。

### 部署体验

- Dockerfile 在镜像构建阶段自动构建 dashboard，GHCR
  镜像内置控制台，部署后可直接访问 `/dashboard`。
- Docker 基础镜像固定为 Deno `2.7.14`，满足 Vite 8 对 Node 兼容 API 的要求。
- Docker 默认启动命令改为 `deno task dev`，避免引用已删除的旧 `start` 任务。
- `wrangler.jsonc` 增加 Workers Static Assets 绑定，Cloudflare 部署会同时上传
  dashboard 静态资源。
- `deno task cf dry-run` 和 `deno task cf deploy` 会自动先构建 dashboard，再执行
  Wrangler 打包或部署。
- 文档站构建改为 Deno 直接驱动 VitePress，GitHub Pages workflow 不再依赖
  Node/npm 安装步骤。
- 删除 `package.json` 和 `package-lock.json`，项目命令、文档站、Dashboard 和
  Wrangler 入口统一由 Deno task / npm compatibility 执行。
- 微信 relay 继续支持源码运行、Docker 运行和 systemd 保活安装；systemd 模板和
  compose 配置统一使用新的 `deno task relay` 入口。

### 命令行体验

- 新增基于 pnpm/Node 的统一任务入口 `scripts/trendpublish.mjs`。
- 任务入口由声明式命令树维护，不再手写 if/else 分发。
- 精简 `deno task` 公共命令，只保留日常入口：`dev`、`doctor`、`verify`、`test`、
  `article`、`preview`、`relay`、`docker`、`cf`、`build`、`dashboard`、`docs`。
- 将大量重复别名收敛为参数式子命令：
  - `deno task article --dry-run`
  - `deno task docker logs`
  - `deno task docker relay`
  - `deno task docker relay logs`
  - `deno task cf dry-run`
  - `deno task cf migrate`
  - `deno task cf deploy`
  - `deno task relay install`
  - `deno task relay systemd`
  - `deno task docs build`
  - `deno task dashboard build`
- 暂时保留 `deno task weixin:relay` 作为兼容别名，避免已经安装的旧 systemd
  服务立即失效。

### 文档

- 重写 README 常用命令和部署说明，突出 Deno-only、Docker、Cloudflare、relay 和
  dashboard 的推荐入口。
- 更新 `docs/deployment.md`，补充 Docker 推荐部署和 Cloudflare dashboard
  静态资源说明。
- 补充 relay 源码部署、Docker 部署、systemd 保活安装，以及新的参数式命令。
- 更新快速开始、配置说明、帮助文档和 JSON-RPC API 文档，统一使用
  `deno task article --dry-run`、`deno task cf deploy` 等新命令。
- 文档中不再推荐 npm 命令、旧 `article:dry`、旧 `cf:*`、旧 `docker:*` 或旧
  `relay:*` 任务。

### 验证

- 已通过 `deno task verify`：格式检查、lint、后端类型检查、dashboard 类型检查、
  dashboard 生产构建和 78 个测试全部通过。
- 已通过 `deno task doctor`：当前配置 0 个失败，提醒项仅为 Cloudflare
  绑定、通知渠道、未启用向量去重。
- 已通过 `deno task docs build`：VitePress 文档站可以正常构建。
- 已通过 `deno task cf dry-run`：Wrangler 能识别 Worker、Workflow、KV、D1 和
  Workers Static Assets 绑定。沙箱环境下 Wrangler 写本地日志会出现 EPERM 提示，
  但 dry-run 打包本身成功。

## [1.0.9] - 2026-05-21

### 架构与配置

- 重构项目为以 `src/app/weixin-article` 组装、`features/weixin-article`
  承载业务、 `integrations` 适配外部服务、`core/ports` 定义端口的模块化结构。
- 使用 `trendpublish.config.ts` 作为唯一运行配置入口，移除旧环境变量配置兼容，
  配置类型提供中文 TSDoc 和更完整的字段提示。
- 收敛配置模型：`providers` 只保留凭证和 provider 默认参数，功能开关与 provider
  选择统一放入 `features.article`。
- 新增 `features.article.notifications.channels`，通知渠道由 feature 显式启用，
  `providers.notify.*` 只保存 webhook / URL。
- 新增 URL 数据源前缀和 `fetchGroups` 抓取分组，支持按分组顺序 fallback。
- 将向量去重、图片生成、发布、通知和抓取能力通过 port / registry / app
  组装层注入，减少业务层对具体实现的依赖。

### 微信文章工作流

- 聚焦微信文章发布流程，移除旧的非文章工作流和按周 workflow 机制。
- 新增多套提示词风格：`technology`、`general`、`business`、`product`、
  `developer`、`research`，统一影响排序、摘要、标题、动态模板和配图提示词。
- 新增正文 AI 智能配图能力，可通过 `features.article.bodyImages` 开关控制。
- 优化 LLM 输出清理，统一兼容 `<think>`、Markdown fence、JSON 包裹文本等响应。
- 标题生成失败时使用本地兜底标题，降低发布链路失败率。
- 封面图和正文配图失败时保持 workflow 可继续，减少外部生图服务波动影响。

### 发布与文档

- 更新 `deno task`：推荐 `doctor`、`verify`、`preview`、`article:dry`。
- 更新 README、配置文档、架构文档、模板文档和快速开始，统一说明新配置结构。
- 新增 release readiness 静态检查，防止旧配置名、旧路径和已删除 workflow
  回流到文档或示例。
- 修复 GitHub Release workflow，改为编译 `src/index.ts` 并包含新的微信模板目录。
- 调整生产部署 workflow 为手动触发，避免 release tag 自动触发旧部署流程。

## [1.0.8] - 2026-05-21

### 微信文章模板

- 新增 `dynamic` 微信文章模板，支持根据文章内容调用 AI 实时生成公众号内联 HTML。
- 新增动态模板后处理与校验，清理公众号不兼容标签和属性，并在生成失败时回退
  `minimal`。
- 简化模型配置，内容排序、摘要、标题和动态模板默认统一使用 `providers.ai` 配置。
- 新增 `deno task doctor` 配置体检命令，方便快速定位缺失配置。
- 新增 `deno task preview:weixin` 微信模板预览命令。
- 新增 `deno task run:article:dry` 微信文章 dry-run 调试模式，跳过发布并输出本地
  HTML。
- 统一清理 LLM 输出中的 `<think>` 和 Markdown
  代码围栏，覆盖排序、摘要、标题、动态模板与内容润色。
- 拆分微信文章标题、封面、渲染和 dry-run 输出逻辑，降低 workflow 主流程复杂度。
- 新增 `longform`、`product`、`minimal`、`darktech` 四套微信文章模板。
- 优化 `default`、`modern`、`tech`、`mianpro` 模板的公众号兼容性与排版层级。
- 将微信模板结构统一调整为更适合公众号编辑器的内联样式与 `section` 标签。
- 更新模板预览测试，使用稳定占位图生成本地预览，避免示例图片失效。
- 更新模板展示文档，补充所有微信文章模板截图与
  `features.article.renderer.template` 可选值。

## [1.0.2] - 2024-03-11

### 内容排名和工作流优化

- 优化内容排名系统
  - 更新内容排名提示词，调整评分权重
  - 在用户提示中添加图片URL日志记录
  - 改进ID解析机制，提升内容排名结果的一致性
- 增强微信工作流程
  - 添加内容过滤功能
  - 实现动态文章数量配置
  - 增加调试日志记录
  - 优化内容处理的错误处理机制

### 文章渲染和图片处理增强

- 改进文章模板渲染系统
  - 新增`processArticleContent`方法，支持段落间自动插入图片
  - 更新基础模板渲染器，支持数据预处理
  - 优化文章模板，移除默认文本缩进
  - 重命名`ArticleTemplateRenderer`为`WeixinArticleTemplateRenderer`
- 微信图片处理优化
  - 实现`uploadContentImage`方法，支持微信图片上传
  - 重构`WeixinImageProcessor`，改进图片处理方法

### Twitter爬虫增强

- 增加媒体内容支持
  - 添加Media和Size接口定义
  - 实现推文媒体内容提取
  - 支持引用推文的内容和媒体提取
- 性能优化
  - 将推文获取限制从10条增加到20条
  - 改进错误日志记录
  - 优化配置刷新机制

### 配置管理

- 新增文章数量配置
  - 在旧配置示例中添加文章数量配置项
  - 更新README.md文档，添加相关配置说明

### 依赖更新

- 升级axios至1.8.2版本
- 更新npm源配置，优化包管理
- 移除husky包依赖

### 类型系统优化

- 重构模板类型定义
  - 将`template.type.ts`重命名为`article.type.ts`
  - 新增`GeneratedTemplate`和`WeixinTemplate`接口
  - 更新相关文件的导入路径

### 文档更新

- 更新环境变量配置说明
- 完善README文档

## [1.0.0] - 2024-03-05

### 架构优化

- 重构LLM工厂模式，提升代码复用性和可维护性
  - 实现统一的LLM提供者接口，支持多种AI服务商
  - 优化模型切换机制，支持动态指定模型名称
  - 增强错误处理和重试机制

- 增强模型配置灵活性
  - 多模型配置支持：可在配置中为同一提供商定义多个可用模型
    - 使用竖线分隔多个模型名称，例如：`DEEPSEEK_MODEL="deepseek-chat|deepseek-reasoner"`
    - 默认使用列表中的第一个模型
  - 指定特定模型支持：可在使用LLM提供商时指定特定模型
    - 使用格式：`提供商:模型名称`，例如：`DEEPSEEK:deepseek-reasoner`
    - 适用于所有支持指定模型的配置项

- LLM工厂类技术改进
  - 重构getLLMProvider方法，支持解析`PROVIDER:model`格式的配置
  - 优化提供商缓存机制，使用`PROVIDER:model`作为缓存键
  - 添加配置字符串解析方法

- OpenAI兼容LLM类增强
  - 添加多模型支持和管理
  - 新增模型选择和查询方法：
    - `setModel(model: string)`：设置当前使用的模型
    - `getModel()`：获取当前使用的模型
    - `getAvailableModels()`：获取所有可用模型列表
  - 支持在请求时通过options指定模型

### 功能增强

- 优化AISummarizer模块
  - 重构摘要生成接口，支持自定义语言和长度
  - 增加JSON格式响应支持，提升数据处理效率
  - 完善错误处理机制，提供更详细的错误信息

- 改进ContentRanker模块
  - 优化内容排名算法，提升准确性
  - 支持自定义排名规则和权重
  - 增加批量处理能力

### 工具类优化

- 封装RetryUtil工具类
  - 实现统一的重试机制，支持自定义重试策略
  - 添加指数退避算法，优化重试间隔
  - 提供详细的重试日志，便于问题排查

### 配置管理

- 重构环境变量配置
  - 优化配置项结构，提升可维护性
  - 支持多环境配置，便于开发和部署
  - 完善配置文档，提供详细的配置说明

### 其他改进

- 优化项目目录结构，提升代码组织性
- 更新依赖包版本，修复潜在安全问题
- 完善错误处理机制，提供更友好的错误提示
- 增加单元测试覆盖率，提升代码质量

### 文档更新

- 更新环境变量配置文档
- 完善API接口文档
- 添加开发指南和最佳实践

### 依赖更新

- 升级sharp至0.33.5
- 升级mysql2至3.12.0
- 升级typeorm至0.3.20
- 升级其他依赖包到最新稳定版本
