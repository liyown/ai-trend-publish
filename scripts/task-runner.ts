import { Command } from "@cliffy/command";

const DENO = Deno.execPath();

const CHECK_FILES = [
  "src/index.ts",
  "src/apps/weixin-relay/server.ts",
  "scripts/run.workflow.ts",
  "src/experiments/article-quality/run.ts",
  "scripts/preview.weixin.ts",
  "scripts/doctor.ts",
  "scripts/cloudflare-smoke.ts",
  "scripts/cloudflare-sync-secrets.ts",
  "scripts/print-relay-systemd.ts",
  "scripts/install-relay-systemd.ts",
  "src/platform/cloudflare/worker.ts",
];

const TEST_FILES = [
  "src/architecture-boundaries.test.ts",
  "src/release-readiness.test.ts",
  "src/utils/config/define-config.test.ts",
  "src/utils/config/app-config.test.ts",
  "src/core/logger/logger.test.ts",
  "src/core/storage/runtime-stores.test.ts",
  "src/core/observability/observability.test.ts",
  "src/platform/local/sqlite-editorial-memory-store.test.ts",
  "src/integrations/vector/sqlite-vector-store.test.ts",
  "src/integrations/publish/providers/weixin-api-client.test.ts",
  "src/integrations/image/providers/minimax/minimax-image-generator.test.ts",
  "src/integrations/fetch/providers/jina/jina-search-scraper.test.ts",
  "src/integrations/fetch/providers/parallel-search-scraper.test.ts",
  "src/utils/image/safe-image-downloader.test.ts",
  "src/utils/image/image-processor.test.ts",
  "src/features/weixin-article/domain/article-source.test.ts",
  "src/app/weixin-article/fetch/article-fetch-planner.test.ts",
  "src/app/weixin-article/fetch/article-fetch-router.test.ts",
  "src/app/weixin-article/fetch/parallel-intake.test.ts",
  "src/app/weixin-article/local-matrix-runner.test.ts",
  "src/app/weixin-article/runtime/article-runtime-config.test.ts",
  "src/registry/provider-registry.test.ts",
  "src/core/workflow/local-workflow-runtime.test.ts",
  "src/utils/llm-output.test.ts",
  "src/utils/llm-structured-output.test.ts",
  "src/modules/content-rank/ai.content-ranker.test.ts",
  "src/features/weixin-article/workflow.test.ts",
  "src/features/weixin-article/services/article-cover.service.test.ts",
  "src/features/weixin-article/services/article-image-layout.service.test.ts",
  "src/features/weixin-article/services/article-render.service.test.ts",
  "src/features/weixin-article/services/content-scrape.service.test.ts",
  "src/features/weixin-article/services/content-process.service.test.ts",
  "src/features/weixin-article/services/editorial-topic.service.test.ts",
  "src/features/weixin-article/services/editorial-decision.service.test.ts",
  "src/features/weixin-article/services/article-plan.service.test.ts",
  "src/features/weixin-article/services/article-research.service.test.ts",
  "src/features/weixin-article/services/article-revision.service.test.ts",
  "src/features/weixin-article/services/quality-review.service.test.ts",
  "src/features/weixin-article/services/quality-gate.service.test.ts",
  "src/experiments/article-quality/research.service.test.ts",
  "src/features/weixin-article/rendering/dynamic",
  "src/features/weixin-article/rendering/test/test.weixin.dynamic.template.ts",
  "src/features/weixin-article/rendering/test/test.weixin.template.ts",
];

await new Command()
  .name("trendpublish")
  .description("TrendPublish 项目任务入口。")
  .action(() => printHelp())
  .command(
    "dev",
    passthrough("启动本地服务和 dashboard 前端热更新。", runDev),
  )
  .command(
    "doctor",
    passthrough(
      "检查配置和发布前置条件。",
      (args) => run(DENO, ["run", "-A", "scripts/doctor.ts", ...args]),
    ),
  )
  .command(
    "verify",
    new Command()
      .description("运行格式、lint、类型检查、dashboard 构建和测试。")
      .action(async () => {
        await run(DENO, ["fmt", "--check"]);
        await run(DENO, ["lint"]);
        await checkBackend();
        await checkDashboard();
        await buildDashboard();
        await testBackend();
      }),
  )
  .command(
    "test",
    passthrough("运行后端和核心模块测试。", (args) => testBackend(args)),
  )
  .command(
    "article",
    passthrough(
      "运行微信文章工作流。",
      (args) => run(DENO, ["run", "-A", "scripts/run.workflow.ts", ...args]),
    ),
  )
  .command("experiment", experimentCommand())
  .command(
    "preview",
    passthrough(
      "生成微信模板预览。",
      (args) => run(DENO, ["run", "-A", "scripts/preview.weixin.ts", ...args]),
    ),
  )
  .command("relay", relayCommand())
  .command("docker", dockerCommand())
  .command("cf", cloudflareCommand())
  .command(
    "build",
    passthrough("编译当前平台二进制。", (args) =>
      run(DENO, [
        "compile",
        "-A",
        "--include",
        "src/features/weixin-article/rendering/templates",
        "--output",
        "trendFinder",
        "src/index.ts",
        ...args,
      ])),
  )
  .command("dashboard", dashboardCommand())
  .command("docs", docsCommand())
  .parse(Deno.args);

function relayCommand() {
  return new Command()
    .description("启动或安装微信发布 relay。")
    .option("--config <path:string>", "指定配置文件路径。")
    .action(({ config }) => {
      const configPath = typeof config === "string" ? config : undefined;
      const args = configPath ? ["--config", configPath] : [];
      return run(DENO, [
        "run",
        "--node-modules-dir=none",
        "-A",
        "src/apps/weixin-relay/server.ts",
        ...args,
      ]);
    })
    .command(
      "systemd",
      passthrough("打印 relay systemd unit。", (args) =>
        run(DENO, [
          "run",
          "--node-modules-dir=none",
          "-A",
          "scripts/print-relay-systemd.ts",
          ...args,
        ])),
    )
    .command(
      "install",
      passthrough("安装 relay systemd 服务。", (args) =>
        run(DENO, [
          "run",
          "--node-modules-dir=none",
          "-A",
          "scripts/install-relay-systemd.ts",
          ...args,
        ])),
    );
}

function dockerCommand() {
  return new Command()
    .description("Docker / Docker Compose 操作。")
    .action(() => run("docker", ["compose", "up", "-d"]))
    .command(
      "build",
      passthrough(
        "本地构建 Docker 镜像。",
        (args) => run("docker", ["build", "-t", "trendpublish", ".", ...args]),
      ),
    )
    .command(
      "down",
      passthrough(
        "停止主服务 compose。",
        (args) => run("docker", ["compose", "down", ...args]),
      ),
    )
    .command(
      "logs",
      passthrough(
        "查看主服务日志。",
        (args) =>
          run("docker", ["compose", "logs", "-f", "trendpublish", ...args]),
      ),
    )
    .command("relay", dockerRelayCommand());
}

function dockerRelayCommand() {
  return new Command()
    .description("Docker 方式运行微信 relay。")
    .action(() =>
      run("docker", [
        "compose",
        "-f",
        "docker-compose.relay.yml",
        "up",
        "-d",
      ])
    )
    .command(
      "down",
      passthrough("停止 relay compose。", (args) =>
        run("docker", [
          "compose",
          "-f",
          "docker-compose.relay.yml",
          "down",
          ...args,
        ])),
    )
    .command(
      "logs",
      passthrough("查看 relay 日志。", (args) =>
        run("docker", [
          "compose",
          "-f",
          "docker-compose.relay.yml",
          "logs",
          "-f",
          "weixin-relay",
          ...args,
        ])),
    );
}

function cloudflareCommand() {
  return new Command()
    .description("Cloudflare Worker / Workflow 操作。")
    .action(() => printCloudflareHelp())
    .command(
      "dry-run",
      passthrough(
        "构建 dashboard 并执行 wrangler deploy dry-run。",
        async (args) => {
          await buildDashboard();
          await run(DENO, [
            "run",
            "-A",
            "npm:wrangler",
            "deploy",
            "--dry-run",
            "--outdir",
            ".wrangler/dry-run",
            ...args,
          ]);
        },
      ),
    )
    .command(
      "dev",
      passthrough(
        "启动 wrangler dev。",
        (args) => run(DENO, ["run", "-A", "npm:wrangler", "dev", ...args]),
      ),
    )
    .command(
      "migrate:local",
      passthrough("应用本地 D1 migration。", (args) =>
        run(DENO, [
          "run",
          "-A",
          "npm:wrangler",
          "d1",
          "migrations",
          "apply",
          "ARTICLE_DB",
          "--local",
          ...args,
        ])),
    )
    .command(
      "migrate",
      passthrough("应用远端 D1 migration。", (args) =>
        run(DENO, [
          "run",
          "-A",
          "npm:wrangler",
          "d1",
          "migrations",
          "apply",
          "ARTICLE_DB",
          "--remote",
          ...args,
        ])),
    )
    .command(
      "deploy",
      passthrough("构建 dashboard 并部署 Worker。", async (args) => {
        await buildDashboard();
        await run(DENO, ["run", "-A", "npm:wrangler", "deploy", ...args]);
      }),
    )
    .command(
      "sync-secrets",
      passthrough("同步 Cloudflare secrets。", (args) =>
        run(DENO, [
          "run",
          "-A",
          "scripts/cloudflare-sync-secrets.ts",
          ...args,
        ])),
    )
    .command(
      "smoke",
      passthrough(
        "部署后冒烟检查。",
        (args) =>
          run(DENO, ["run", "-A", "scripts/cloudflare-smoke.ts", ...args]),
      ),
    );
}

function dashboardCommand() {
  return new Command()
    .description("Dashboard 前端开发和构建。")
    .action(() =>
      run(DENO, [
        "run",
        "--config",
        "dashboard/deno.json",
        "-A",
        "npm:vite@8.0.13",
        "--config",
        "dashboard/vite.config.ts",
        "--host",
        "0.0.0.0",
      ])
    )
    .command(
      "check",
      passthrough("检查 dashboard 类型。", (args) => checkDashboard(args)),
    )
    .command(
      "build",
      passthrough("构建 dashboard。", (args) => buildDashboard(args)),
    )
    .command(
      "preview",
      passthrough("预览 dashboard 构建产物。", (args) =>
        run(DENO, [
          "run",
          "--config",
          "dashboard/deno.json",
          "-A",
          "npm:vite@8.0.13",
          "preview",
          "--config",
          "dashboard/vite.config.ts",
          ...args,
        ])),
    );
}

function experimentCommand() {
  return new Command()
    .description("研发实验工具。")
    .action(() => printExperimentHelp())
    .command(
      "article-quality",
      passthrough("运行文章质量 A/B dry-run 实验。", (args) =>
        run(DENO, [
          "run",
          "-A",
          "src/experiments/article-quality/run.ts",
          ...args,
        ])),
    );
}

function docsCommand() {
  return new Command()
    .description("VitePress 文档开发和构建。")
    .action(() =>
      run(DENO, ["run", "-A", "npm:vitepress@1.6.4", "dev", "docs"])
    )
    .command(
      "build",
      passthrough(
        "构建文档站点。",
        (args) =>
          run(DENO, [
            "run",
            "-A",
            "npm:vitepress@1.6.4",
            "build",
            "docs",
            ...args,
          ]),
      ),
    );
}

function passthrough(
  description: string,
  action: (args: string[]) => Promise<void>,
) {
  return new Command()
    .description(description)
    .useRawArgs()
    .action((_options, ...args: string[]) => action(args));
}

async function checkBackend(extraArgs: string[] = []) {
  await run(DENO, ["check", ...CHECK_FILES, ...extraArgs]);
}

async function testBackend(extraArgs: string[] = []) {
  await run(DENO, [
    "test",
    "-A",
    "--no-check",
    ...TEST_FILES,
    ...extraArgs,
  ]);
}

async function checkDashboard(extraArgs: string[] = []) {
  await run(DENO, [
    "check",
    "--config",
    "dashboard/deno.json",
    "dashboard/src/env.d.ts",
    "dashboard/vite.config.ts",
    "dashboard/src/app.tsx",
    ...extraArgs,
  ]);
}

async function buildDashboard(extraArgs: string[] = []) {
  await run(DENO, [
    "run",
    "--config",
    "dashboard/deno.json",
    "-A",
    "npm:vite@8.0.13",
    "build",
    "--config",
    "dashboard/vite.config.ts",
    ...extraArgs,
  ]);
}

async function runDev(args: string[]) {
  await buildDashboard();
  console.log("本地 API / 静态服务: http://localhost:8000");
  console.log("Dashboard 前端热更新: http://localhost:5173/dashboard/");

  const backend = spawn("backend", DENO, [
    "run",
    "-A",
    "src/index.ts",
    ...args,
  ]);
  const dashboard = spawn("dashboard", DENO, [
    "run",
    "--config",
    "dashboard/deno.json",
    "-A",
    "npm:vite@8.0.13",
    "--config",
    "dashboard/vite.config.ts",
    "--host",
    "0.0.0.0",
    "--strictPort",
  ]);

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    for (const child of [backend.child, dashboard.child]) {
      try {
        child.kill("SIGTERM");
      } catch {
        // Process may have already exited.
      }
    }
  };

  try {
    Deno.addSignalListener("SIGINT", stop);
    Deno.addSignalListener("SIGTERM", stop);
  } catch {
    // Signal listeners are not available in every runtime.
  }

  const result = await Promise.race([
    waitChild("backend", backend.child),
    waitChild("dashboard", dashboard.child),
  ]);

  const shouldExitFailure = !result.status.success && !stopping;
  stop();
  if (shouldExitFailure) {
    Deno.exit(result.status.code);
  }
}

function spawn(label: string, command: string, args: string[]) {
  console.log(`[${label}] ${command} ${args.join(" ")}`);
  return {
    label,
    child: new Deno.Command(command, {
      args,
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
    }).spawn(),
  };
}

async function waitChild(label: string, child: Deno.ChildProcess) {
  return { label, status: await child.status };
}

async function run(command: string, args: string[]) {
  const child = new Deno.Command(command, {
    args,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  const status = await child.status;

  if (!status.success) {
    Deno.exit(status.code);
  }
}

function printCloudflareHelp() {
  console.log(`Cloudflare 用法:
  deno task cf dry-run
  deno task cf dev
  deno task cf migrate:local
  deno task cf migrate
  deno task cf sync-secrets --env-file cloudflare-token.local
  deno task cf deploy
  deno task cf smoke --url https://<worker-url> --api-key <key>
`);
}

function printHelp() {
  console.log(`TrendPublish 任务入口:
  deno task dev                 启动本地服务 + dashboard 前端热更新
  deno task doctor              检查配置
  deno task verify              发布前完整检查
  deno task test                运行测试
  deno task article --dry-run   跑微信文章 dry-run
  deno task experiment article-quality  运行临时文章质量实验
  deno task article             真实创建微信公众号草稿
  deno task preview             生成模板预览
  deno task relay               启动微信发布 relay
  deno task docker              启动 Docker 服务
  deno task docker relay        启动 relay Docker 服务
  deno task cf deploy           部署 Cloudflare Worker
  deno task dashboard           只启动 dashboard 前端开发服务
  deno task docs                启动文档开发服务
`);
}

function printExperimentHelp() {
  console.log(`实验工具:
  deno task experiment article-quality
`);
}
