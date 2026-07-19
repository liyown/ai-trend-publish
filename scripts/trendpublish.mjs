#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";

const VP = process.env.VP_BIN || "vp";

const [command = "help", ...args] = process.argv.slice(2);

try {
  await dispatch(command, args);
} catch (error) {
  if (error instanceof Error) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
}

async function dispatch(command, args) {
  switch (command) {
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return;
    case "dev":
      await runDev(args);
      return;
    case "doctor":
      await runTsScript("scripts/doctor.ts", args);
      return;
    case "verify":
      await verify();
      return;
    case "test":
      await testBackend(args);
      return;
    case "relay":
      await relay(args);
      return;
    case "docker":
      await docker(args);
      return;
    case "cf":
      await cloudflare(args);
      return;
    case "build":
      await checkBackend();
      await buildDashboard(args);
      return;
    case "dashboard":
      await dashboard(args);
      return;
    case "docs":
      await docs(args);
      return;
    default:
      throw new Error(`Unknown command: ${command}\n\nRun: vp run trend -- help`);
  }
}

async function verify() {
  await checkBackend();
  await checkDashboard();
  await buildDashboard();
  await testBackend();
}

async function relay(args) {
  const [subcommand, ...rest] = args;
  if (subcommand === "systemd") {
    await runTsScript("scripts/print-relay-systemd.ts", rest);
    return;
  }
  if (subcommand === "install") {
    await runTsScript("scripts/install-relay-systemd.ts", rest);
    return;
  }
  await runTs("apps/server/src/apps/weixin-relay/server.ts", args);
}

async function docker(args) {
  const [subcommand, ...rest] = args;
  if (!subcommand) {
    await run("docker", ["compose", "up", "-d"]);
    return;
  }
  if (subcommand === "build") {
    await run("docker", ["build", "-t", "trendpublish", ".", ...rest]);
    return;
  }
  if (subcommand === "down") {
    await run("docker", ["compose", "down", ...rest]);
    return;
  }
  if (subcommand === "logs") {
    await run("docker", ["compose", "logs", "-f", "trendpublish", ...rest]);
    return;
  }
  if (subcommand === "relay") {
    await dockerRelay(rest);
    return;
  }
  throw new Error(`Unknown docker command: ${subcommand}`);
}

async function dockerRelay(args) {
  const [subcommand, ...rest] = args;
  if (!subcommand) {
    await run("docker", ["compose", "-f", "docker-compose.relay.yml", "up", "-d"]);
    return;
  }
  if (subcommand === "down") {
    await run("docker", ["compose", "-f", "docker-compose.relay.yml", "down", ...rest]);
    return;
  }
  if (subcommand === "logs") {
    await run("docker", [
      "compose",
      "-f",
      "docker-compose.relay.yml",
      "logs",
      "-f",
      "weixin-relay",
      ...rest,
    ]);
    return;
  }
  throw new Error(`Unknown docker relay command: ${subcommand}`);
}

async function cloudflare(args) {
  const [subcommand, ...rest] = args;
  if (!subcommand) {
    printCloudflareHelp();
    return;
  }
  if (subcommand === "dry-run") {
    await buildDashboard();
    await wrangler(["deploy", "--dry-run", "--outdir", ".wrangler/dry-run", ...rest]);
    return;
  }
  if (subcommand === "dev") {
    await wrangler(["dev", ...rest]);
    return;
  }
  if (subcommand === "migrate:local") {
    await wrangler(["d1", "migrations", "apply", "ARTICLE_DB", "--local", ...rest]);
    return;
  }
  if (subcommand === "migrate") {
    await wrangler(["d1", "migrations", "apply", "ARTICLE_DB", "--remote", ...rest]);
    return;
  }
  if (subcommand === "deploy") {
    await buildDashboard();
    await wrangler(["deploy", ...rest]);
    return;
  }
  if (subcommand === "sync-secrets") {
    await runTsScript("scripts/cloudflare-sync-secrets.ts", rest);
    return;
  }
  if (subcommand === "smoke") {
    await runTsScript("scripts/cloudflare-smoke.ts", rest);
    return;
  }
  throw new Error(`Unknown Cloudflare command: ${subcommand}`);
}

async function dashboard(args) {
  const [subcommand, ...rest] = args;
  if (!subcommand) {
    await run(VP, ["run", "@trendpublish/dashboard#dev"]);
    return;
  }
  if (subcommand === "check") {
    await checkDashboard(rest);
    return;
  }
  if (subcommand === "build") {
    await buildDashboard(rest);
    return;
  }
  if (subcommand === "preview") {
    await run(VP, ["run", "@trendpublish/dashboard#preview", ...rest]);
    return;
  }
  throw new Error(`Unknown dashboard command: ${subcommand}`);
}

async function docs(args) {
  const [subcommand, ...rest] = args;
  if (!subcommand) {
    await run(VP, ["exec", "vitepress", "dev", "docs"]);
    return;
  }
  if (subcommand === "build") {
    await run(VP, ["exec", "vitepress", "build", "docs", ...rest]);
    return;
  }
  throw new Error(`Unknown docs command: ${subcommand}`);
}

async function checkBackend(extraArgs = []) {
  await run(VP, ["check", ...extraArgs]);
}

async function testBackend(extraArgs = []) {
  await run(VP, ["test", "run", ...extraArgs]);
}

async function checkDashboard(extraArgs = []) {
  await run(VP, ["run", "@trendpublish/dashboard#check", ...extraArgs]);
}

async function buildDashboard(extraArgs = []) {
  await run(VP, ["run", "@trendpublish/dashboard#build", ...extraArgs]);
}

async function runDev(args) {
  const dashboardDevServerUrl =
    process.env.TRENDPUBLISH_DASHBOARD_DEV_SERVER_URL || "http://localhost:5173";
  console.log("Local API server: http://localhost:8000");
  console.log("Dashboard: http://localhost:8000/dashboard/ (proxied to Vite dev server)");
  console.log("Dashboard Vite server: http://localhost:5173/dashboard/");

  const backend = spawnProcess(
    "backend",
    VP,
    ["exec", "tsx", "watch", "apps/server/src/index.ts", ...args],
    {
      TRENDPUBLISH_DASHBOARD_DEV_SERVER_URL: dashboardDevServerUrl,
    },
  );
  const dashboardProcess = spawnProcess("dashboard", VP, [
    "run",
    "@trendpublish/dashboard#dev",
    "--strictPort",
  ]);

  let requestedStop = false;
  const terminateChildren = () => {
    for (const child of [backend, dashboardProcess]) {
      terminateProcessTree(child);
    }
  };
  const stop = () => {
    if (requestedStop) return;
    requestedStop = true;
    terminateChildren();
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  const code = await Promise.race([waitChild(backend), waitChild(dashboardProcess)]);
  terminateChildren();
  if (code !== 0 && !requestedStop) {
    process.exit(code);
  }
}

async function wrangler(args) {
  mkdirSync(".wrangler/logs", { recursive: true });
  await run(VP, ["exec", "wrangler", ...args], {
    WRANGLER_LOG_PATH: ".wrangler/logs",
  });
}

async function runTsScript(path, args) {
  await runTs(path, args);
}

async function runTs(path, args) {
  await run(VP, ["exec", "tsx", path, ...args]);
}

async function run(command, args, env = {}) {
  const child = spawnProcess(command, command, args, env);
  const code = await waitChild(child);
  if (code !== 0) {
    process.exit(code);
  }
}

function spawnProcess(label, command, args, env = {}) {
  console.log(`[${label}] ${command} ${args.join(" ")}`);
  return spawn(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
    shell: false,
    detached: process.platform !== "win32",
  });
}

function terminateProcessTree(child) {
  if (!child.pid || child.exitCode !== null || child.killed) return;
  if (process.platform === "win32") {
    child.kill("SIGTERM");
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function waitChild(child) {
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (typeof code === "number") {
        resolve(code);
      } else {
        resolve(signal ? 1 : 0);
      }
    });
  });
}

function printCloudflareHelp() {
  console.log(`Cloudflare usage:
  vp run cf:dry-run
  vp run cf:dev
  vp run cf:migrate:local
  vp run cf:migrate
  vp run cf:sync-secrets --env-file cloudflare-token.local
  vp run cf:deploy
  vp run cf:smoke --url https://<worker-url> --api-key <key>
`);
}

function printHelp() {
  console.log(`TrendPublish task entry:
  vp run dev                              Start local API + dashboard dev server
  vp run doctor                           Check config
  vp run verify                           Run full verification
  vp test                                 Run backend/core tests
  vp run relay                            Start Weixin relay
  vp run cf:deploy                        Deploy Cloudflare Worker
  vp run dev:dashboard                    Start dashboard dev server only
  vp run docs:dev                         Start docs dev server

Runtime tasks use Vite+, vp, tsx, Vitest, Vite and Wrangler.
`);
}
