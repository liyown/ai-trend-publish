# 配置

## 部署配置

`trendpublish.config.ts` 只包含基础设施，不包含模型、密钥、素材或发布账号：

```ts
import { defineConfig } from "@trendpublish/core/utils/config/define-config.ts";

export default defineConfig({
  server: { apiKey: "change-me", port: 8000 },
  database: { sqlitePath: "data/trendpublish.sqlite3" },
  observability: {
    enabled: true,
    serviceName: "trendpublish",
    environment: "local",
  },
});
```

Docker 可以通过配置工厂读取 `/run/secrets` 或环境值。Cloudflare 的 API 鉴权使用 `SERVER_API_KEY` secret，业务数据使用 `ARTICLE_DB` D1 binding。

## Web 管理对象

以下对象只在 Dashboard 中维护，并存入本地 SQLite 或 Cloudflare D1：

- 连接与凭证
- 内容身份
- 知识库
- URL / 查询来源与来源分组
- 内容方案
- 发布账号（渠道接入方式、公开设置和凭证在一个流程中维护）
- 内容包、发布记录、Job 和 Task

系统不读取旧 Provider 配置，也不执行兼容性导入。

## 连接

Connector 定义基础配置字段和凭证字段。保存后凭证不会通过 API 回显；页面只返回每个凭证字段是否已设置。

支持连接级请求覆盖：

- `Headers`：合并到标准请求头，认证保留字段不可覆盖。
- `Query`：追加到 URL，同名参数以覆盖值为准。
- `Body`：只对标准 JSON 对象请求递归合并，数组直接替换；GET 和文件上传不受影响。

模型参数如 `temperature`、`top_p` 可以放在 Body 覆盖中；具体调用显式传入的能力参数仍由 Connector 构造标准请求。超时、重试、任务恢复不属于连接配置。

内置 Connector 包括对话模型、图片生成、网页读取、搜索、通知以及微信公众号直连与 Relay。普通“连接”页面只管理 Agent 工具连接；渠道专用 Connector 由发布账号内部维护并从该页面隐藏。系统只把内容方案明确授权的能力转换为 Agent Tool；模型看不到凭证或底层任意 API。

策略预设只提供目标、偏好和默认轮次，不固定工具顺序。内容方案只能覆盖最大 Agent 轮次，并选择“去 AI 化”“风格优化”等可调用增强；最后一个允许轮次只用于提交当前最佳结果。

渠道元数据、发布类型、内部提示词、终止工具 Schema、校验器和 Adapter 由版本化 `ChannelRegistry` 维护。Dashboard 只读取安全目录，不提供渠道或发布目标 CRUD。内容方案直接选择多个发布账号；未选择账号时仅生成可发布内容包。
