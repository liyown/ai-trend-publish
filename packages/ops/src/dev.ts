import { spawn, type ChildProcess } from "node:child_process";

const VP = process.env.VP_BIN ?? "vp";
const dashboardDevServerUrl =
  process.env.TRENDPUBLISH_DASHBOARD_DEV_SERVER_URL ?? "http://localhost:5173";

console.log("Local API server:           http://localhost:8000");
console.log("Dashboard (proxied):        http://localhost:8000/dashboard/");
console.log("Dashboard Vite dev server:  http://localhost:5173/dashboard/");

const backend = spawnChild("backend", VP, ["exec", "tsx", "watch", "apps/server/src/index.ts"], {
  TRENDPUBLISH_DASHBOARD_DEV_SERVER_URL: dashboardDevServerUrl,
});

const dashboard = spawnChild("dashboard", VP, [
  "run",
  "@trendpublish/dashboard#dev",
  "--strictPort",
]);

let stopping = false;

const stop = () => {
  if (stopping) return;
  stopping = true;
  terminateTree(backend);
  terminateTree(dashboard);
};

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

const code = await Promise.race([waitFor(backend), waitFor(dashboard)]);
stop();
if (code !== 0 && !stopping) process.exit(code);

// ── helpers ──────────────────────────────────────────────────────────────────

function spawnChild(
  label: string,
  cmd: string,
  args: string[],
  env: Record<string, string> = {},
): ChildProcess {
  console.log(`[${label}] ${cmd} ${args.join(" ")}`);
  return spawn(cmd, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
    shell: false,
    detached: process.platform !== "win32",
  });
}

function terminateTree(child: ChildProcess): void {
  if (!child.pid || child.exitCode !== null || child.killed) return;
  if (process.platform === "win32") {
    child.kill("SIGTERM");
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException)?.code !== "ESRCH") throw err;
  }
}

function waitFor(child: ChildProcess): Promise<number> {
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => resolve(typeof code === "number" ? code : signal ? 1 : 0));
  });
}
