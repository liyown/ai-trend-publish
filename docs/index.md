# TrendPublish

TrendPublish 使用共享 ReAct Agent 将身份、任务和工具 observation 冻结为带 `MasterContent` 的平台中立内容包，再由每种发布类型的独立 ReAct 会话生成渠道变体。

系统保留三处明确扩展边界：

- Connector：接入模型、来源、图片、通知和渠道 API；来源 Connector 必须声明支持 URL、查询或两者。
- Agent Tool：由授权 Connector 能力或内置增强适配而来，拥有输入 Schema、版本和副作用语义。
- Publication Type Profile：声明微信图文、视频、音频等发布类型的领域要求、输出 Schema 和校验器。
- Channel Adapter：把冻结内容包映射到外部发布协议。

作者和大模型只编辑带引用注解的 Markdown `ArticleSource`；`ArticleDocument` AST 由系统编译并由内容包冻结。质量问题自动降级为告警，不设置人工审阅环节。

所有执行都会进入运行记录，并以内部检查点提供可靠恢复。开始使用请阅读[快速开始](/getting-started)。
