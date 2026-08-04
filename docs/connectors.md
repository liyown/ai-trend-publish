# Connector 扩展

一个 Connector 包含：

1. 稳定 ID 和版本。
2. 设置与凭证的 Zod schema。
3. Dashboard 基础字段描述。
4. 支持的类型化 Capability。
5. 搜索来源声明 `source-search`，网页读取声明 `source-fetch`；两者是不同契约。
6. 创建 Client 的函数。
7. 一次真实的连接检查。

Client 应保持纯粹：接收能力输入，构造一次请求，映射一次响应，把协议错误转换为 `ConnectorError`。不要在 Client 中加入业务重试、定时、回退链、Job 状态或内容决策。

`SourceSearchClient` 只返回带 URL 的候选来源，snippet 只能用于发现和筛选，不能进入 `MaterialSnapshot`。`SourceFetchClient` 接收 URL 并返回抓取完成的文档。来源集合本身只保存 URL 和查询，不绑定 Connector。内容方案可分别选择多个搜索连接和网页抓取连接：搜索连接全部执行并合并候选，抓取连接按配置顺序回退，拿到正文后停止。未显式选择时，运行时自动使用一个已启用的兼容连接。

请求执行器统一处理连接级 Headers、Query、Body 覆盖、认证保留字段和观测事件。调用方通过 `AbortSignal` 控制取消。

新增 Connector 后，在本地和 Cloudflare 共用的 registry 中注册；如果它提供 Agent 能力，还要增加窄 Tool Adapter，把类型化 Client 映射为带 JSON Schema 的工具。内容方案必须明确授权连接，Agent 不会自动获得所有已启用连接。
