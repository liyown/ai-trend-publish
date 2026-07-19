import { spawn } from "node:child_process";
import { mkdir } from "node:fs/promises";

import { initializeAppConfig } from "@trendpublish/core/config";
import type { ResolvedTrendPublishConfig } from "@trendpublish/core/config";
import { stringifyUnknown } from "@trendpublish/core/utilities";

interface SyncArgs {
  envFile?: string;
  dryRun: boolean;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const options = parseSyncArgs(argv);
  const config = initializeAppConfig();
  await syncSecrets(config, options);
}

if (import.meta.main) {
  await main();
}

async function syncSecrets(config: ResolvedTrendPublishConfig, options: SyncArgs): Promise<void> {
  const secrets = collectSecrets(config);
  if (secrets.length === 0) {
    console.log("没有可同步的 Cloudflare secrets。");
    return;
  }

  console.log(
    `准备同步 ${secrets.length} 个 Cloudflare secrets: ${secrets.map(([name]) => name).join(", ")}`,
  );

  for (const [name, value] of secrets) {
    if (options.dryRun) {
      console.log(`[dry-run] ${name}`);
      continue;
    }
    await putSecret(name, value, options);
    console.log(`已同步 ${name}`);
  }
}

function collectSecrets(config: ResolvedTrendPublishConfig): Array<[string, string]> {
  const pairs: Array<[string, unknown]> = [["SERVER_API_KEY", config.server.apiKey]];

  return pairs
    .map(([name, value]) => [name, stringifyUnknown(value).trim()] as [string, string])
    .filter(([, value]) => value.length > 0);
}

async function putSecret(name: string, value: string, options: SyncArgs): Promise<void> {
  const args = ["exec", "wrangler"];
  if (options.envFile) {
    args.push("--env-file", options.envFile);
  }
  args.push("secret", "put", name);

  await mkdir(".wrangler/logs", { recursive: true });
  const status = await runWithInput("vp", args, `${value}\n`, {
    WRANGLER_LOG_PATH: ".wrangler/logs",
  });
  if (status !== 0) {
    throw new Error(`同步 Cloudflare secret 失败: ${name}`);
  }
}

function runWithInput(
  command: string,
  args: string[],
  input: string,
  env: Record<string, string>,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["pipe", "inherit", "inherit"],
      env: { ...process.env, ...env },
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
    child.stdin.end(input);
  });
}

function parseSyncArgs(args: string[]): SyncArgs {
  let envFile: string | undefined;
  let dryRun = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--env-file") {
      envFile = args[++index];
      continue;
    }
    if (arg.startsWith("--env-file=")) {
      envFile = arg.slice("--env-file=".length);
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
    }
  }
  return { envFile, dryRun };
}
