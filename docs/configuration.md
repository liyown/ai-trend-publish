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
- 渠道账号
- 发布目标
- 内容包、发布记录、Job 和 Task

系统不读取旧 Provider 配置，也不执行兼容性导入。

## 连接

Connector 定义基础配置字段和凭证字段。保存后凭证不会通过 API 回显；页面只返回每个凭证字段是否已设置。

支持连接级请求覆盖：

- `Headers`：合并到标准请求头，认证保留字段不可覆盖。
- `Query`：追加到 URL，同名参数以覆盖值为准。
- `Body`：只对标准 JSON 对象请求递归合并，数组直接替换；GET 和文件上传不受影响。

模型参数如 `temperature`、`top_p` 可以放在 Body 覆盖中；具体调用显式传入的能力参数仍由 Connector 构造标准请求。超时、重试、任务恢复不属于连接配置。

内置 Connector 包括对话模型、图片生成、网页读取、搜索、通知以及微信公众号直连与 Relay。提供来源抓取的 Connector 会同时声明支持 URL、查询或两者，来源分组只能服务与其中启用连接兼容的输入。Connector 只声明并执行能力；文章 Pipeline 决定何时研究、评估和生产资源。

内容方案如果自动发布到微信公众号，必须启用封面图片插件，把封面设为“必要项”，并绑定图片连接。系统会在保存和编译方案时检查这些条件，避免生成一个注定无法发布的内容包。
