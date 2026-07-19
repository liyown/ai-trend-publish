# TrendPublish

TrendPublish 将研究素材与内容身份生成成平台中立的 `ContentPackage v5`，并把冻结内容包独立发布到一个或多个渠道账号。

系统保留三处明确扩展边界：

- Connector：接入模型、来源、图片、通知和渠道 API；来源 Connector 必须声明支持 URL、查询或两者。
- Article Plugin：只包含修改文章来源的 `Transformer`、只读评估编译视图的 `Evaluator` 和生产内容资源的 `AssetProvider`。
- Channel Adapter：把冻结内容包映射到外部发布协议。

作者和大模型只编辑带引用注解的 Markdown `ArticleSource`；`ArticleDocument` AST 由系统编译并由内容包冻结。人工审阅同样回填 Source 与资源请求，不直接操作 AST。

所有执行都会进入运行记录，并以内部检查点提供可靠恢复。开始使用请阅读[快速开始](/getting-started)。
