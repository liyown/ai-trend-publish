# @trendpublish/connectors

独立的外部服务连接层。它只负责把稳定的能力接口映射到第三方 HTTP API，不依赖 Dashboard、Server、Workflow 或业务领域对象。

## 使用方式

应用已经有连接存储时，使用 `ConnectorClientResolver` 按连接 ID 获取能力客户端：

```ts
import {
  ChatCapability,
  ConnectorClientResolver,
  createBuiltInConnectorRegistry,
} from "@trendpublish/connectors";

const runtime = new ConnectorClientResolver({
  registry: createBuiltInConnectorRegistry(),
  connections,
  credentials,
});

const chat = await runtime.get("ai-default", ChatCapability);
const result = await chat.complete({
  messages: [{ role: "user", content: "总结这篇文章" }],
  temperature: 0.3,
});
```

脚本或适配层不需要连接存储时，可以直接创建客户端：

```ts
import {
  createStandaloneConnectorClients,
  openAICompatibleConnector,
} from "@trendpublish/connectors";

const { chat } = createStandaloneConnectorClients(openAICompatibleConnector, {
  id: "local-ai",
  settings: { baseUrl: "https://api.example.com/v1", model: "model-name" },
  credentials: { apiKey: process.env.API_KEY! },
  overrides: {
    headers: { "X-Tenant": "editorial" },
    body: { metadata: { source: "trendpublish" } },
  },
});
```

## 扩展规则

新增服务只需提供一个 `ConnectorDefinition`：

- 用 Zod 声明 settings 和 credentials，密钥不能放进 settings。
- 声明能力并返回对应的纯客户端；客户端不读取全局配置。
- 一次客户端调用严格只产生一次物理请求；重试和超时预算属于上层任务，不属于 Connection 或 Client。
- Provider 特有参数放在能力输入中；通用 Headers、Query、Body 覆盖由执行器最后合并，认证 Header 最后写入。
- Provider 返回的业务错误必须转成 `ConnectorError`，不能吞掉异常并返回假成功。

内置连接包括 OpenAI Compatible、DashScope、MiniMax、Bark、钉钉和飞书。
