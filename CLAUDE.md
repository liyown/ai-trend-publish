# Repository guide

TrendPublish is a TypeScript modular monolith for high-quality content generation and independent multi-channel publication.

## Architectural rules

- `packages/runtime` is business-agnostic. It owns jobs, tasks, checkpoints, replay and unknown side-effect states.
- `packages/connectors` owns external API protocol mapping, connection definitions and one-call clients. Clients do not implement retries, scheduling or business orchestration.
- `packages/article` owns `ContentPackage v5`, the shared content ReAct session, annotated Markdown source, the document compiler and asset production. It does not publish.
- `packages/publishing` owns the internal channel registry and channel adapters. It consumes frozen content packages and publishes each destination independently.
- `packages/core` is the application layer and workspace model. It coordinates article and publishing use cases without importing server delivery code.
- `apps/server` is the composition root and HTTP delivery layer. Local uses SQLite; Cloudflare uses D1.
- `apps/dashboard` talks only to the HTTP API.
- The removed `packages/workflow`, `packages/integrations`, `packages/agents` and root `src` trees must not return.

The authoritative boundary tests are in `tests/architecture-boundaries.test.ts`.

## Commands

```bash
vp run dev
vp run doctor
vp test
vp run verify
vp run @trendpublish/dashboard#build
vp run cf:migrate
vp run cf:deploy
vp run relay
```

Use Vite+ tasks from `vite.config.ts`. Before handing off a change, run `vp run verify` or the proportional type/test/build subset.

## Extension paths

- New external API: add a Connector definition and typed capability client under `packages/connectors/src/builtins` or a separate package, then register it at the composition root.
- New article behavior: add model-driven research, writing and repair to the shared ReAct agent; add deterministic source invariants to its terminal validation; use an `AssetProvider` only for resource production. Do not add a second evaluator/reviser loop outside the agent.
- New channel: add a channel adapter in `packages/publishing` and register it in local and Cloudflare runtimes.
- New business object or use case: add it to the workspace/application layer, expose it through `apps/server/src/http`, then add a Dashboard page.

Deployment config contains only server, database and observability settings. Connections, credentials and content configuration are Web-managed and have no legacy import path.
