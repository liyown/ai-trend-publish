import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { platform, userInfo } from "node:os";
import { parseRelaySystemdArgs, renderRelaySystemdUnit } from "./print-relay-systemd.ts";

interface InstallOptions {
  serviceName: string;
  dryRun: boolean;
  noStart: boolean;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const installOptions = parseInstallOptions(argv);
  const commonArgs = pickCommonSystemdArgs(argv);
  const defaultUser = currentLoginUser();
  const unitOptions = parseRelaySystemdArgs(commonArgs, {
    user: defaultUser,
    group: defaultUser,
  });
  const unit = renderRelaySystemdUnit(unitOptions);
  const serviceFile = `/etc/systemd/system/${installOptions.serviceName}.service`;

  if (installOptions.dryRun) {
    console.log(`# Would write: ${serviceFile}\n${unit}`);
    return;
  }

  if (platform() !== "linux") {
    throw new Error("relay install 只支持 Linux systemd 环境");
  }

  await writeServiceFile(serviceFile, unit);
  await runPrivileged("systemctl", ["daemon-reload"]);

  if (!installOptions.noStart) {
    const unitName = `${installOptions.serviceName}.service`;
    await runPrivileged("systemctl", ["enable", unitName]);
    await runPrivileged("systemctl", ["restart", unitName]);
  }

  console.log(`relay systemd 服务已安装: ${installOptions.serviceName}`);
  console.log(`查看状态: sudo systemctl status ${installOptions.serviceName}`);
  console.log(`查看日志: sudo journalctl -u ${installOptions.serviceName} -f`);
}

if (import.meta.main) {
  await main();
}

function parseInstallOptions(args: string[]): InstallOptions {
  return {
    serviceName: readStringArg(args, "service-name") ?? "trendpublish-weixin-relay",
    dryRun: hasFlag(args, "dry-run"),
    noStart: hasFlag(args, "no-start"),
  };
}

function pickCommonSystemdArgs(args: string[]): string[] {
  const names = new Set(["workdir", "config", "vp", "port", "user", "group"]);
  const result: string[] = [];

  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;

    const [rawName, inlineValue] = arg.slice(2).split("=", 2);
    const name = rawName.trim();
    if (!names.has(name)) {
      if (inlineValue === undefined && args[index + 1]?.startsWith("--") === false) {
        index++;
      }
      continue;
    }

    if (inlineValue !== undefined) {
      result.push(`--${name}=${inlineValue}`);
      continue;
    }

    const value = args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`参数 --${name} 需要提供值`);
    }
    result.push(`--${name}`, value);
    index++;
  }

  return result;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

function readStringArg(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
    if (arg === `--${name}`) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`参数 --${name} 需要提供值`);
      }
      return value;
    }
  }
  return undefined;
}

function currentLoginUser(): string {
  return (
    process.env.SUDO_USER ??
    process.env.USER ??
    process.env.LOGNAME ??
    userInfo().username ??
    "trendpublish"
  );
}

async function writeServiceFile(path: string, content: string): Promise<void> {
  if (isRoot()) {
    await writeFile(path, content + "\n");
    return;
  }

  await runPrivileged("tee", [path], content + "\n", { hideStdout: true });
}

async function runPrivileged(
  command: string,
  args: string[],
  input?: string,
  options: { hideStdout?: boolean } = {},
): Promise<void> {
  const fullCommand = isRoot() ? command : "sudo";
  const fullArgs = isRoot() ? args : [command, ...args];
  const { stdout, stderr } = await runCommand(fullCommand, fullArgs, input);
  if (stdout && !options.hideStdout) console.log(stdout.trim());
  if (stderr) console.error(stderr.trim());
}

function isRoot(): boolean {
  return typeof process.getuid === "function" && process.getuid() === 0;
}

function runCommand(
  command: string,
  args: string[],
  input?: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: [input ? "pipe" : "ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr?.on("data", (chunk) => (stderr += String(chunk)));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(
        new Error(
          `${command} ${args.join(" ")} 执行失败` + (stderr.trim() ? `: ${stderr.trim()}` : ""),
        ),
      );
    });
    if (input) child.stdin?.end(input);
  });
}
