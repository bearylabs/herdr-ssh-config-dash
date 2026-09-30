import { spawn } from "node:child_process";
import { userInfo } from "node:os";
import { basename } from "node:path";

export type CommandResult = { readonly stdout: string; readonly stderr: string; readonly code: number };
export interface CommandRunner {
  run(command: string, args: ReadonlyArray<string>, options?: { readonly signal?: AbortSignal }): Promise<CommandResult>;
  runInteractive(command: string, args: ReadonlyArray<string>): Promise<CommandResult>;
}

export type ShellInvocation = { readonly command: string; readonly args: ReadonlyArray<string> };

export class NodeCommandRunner implements CommandRunner {
  constructor(private readonly timeoutMs = 60_000, private readonly maxOutput = 256_000, private readonly loginShell?: string) {}

  run(command: string, args: ReadonlyArray<string>, options?: { readonly signal?: AbortSignal }): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, [...args], {
        stdio: ["ignore", "pipe", "pipe"], timeout: this.timeoutMs,
        ...(options?.signal ? { signal: options.signal } : {}),
      });
      let stdout = ""; let stderr = "";
      child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => { stdout = bounded(stdout + chunk, this.maxOutput); });
      child.stderr.on("data", (chunk: string) => { stderr = bounded(stderr + chunk, this.maxOutput); });
      child.once("error", reject);
      child.once("close", (code) => resolve({ stdout, stderr, code: code ?? -1 }));
    });
  }

  runInteractive(command: string, args: ReadonlyArray<string>): Promise<CommandResult> {
    let invocation: ShellInvocation;
    try { invocation = loginShellInvocation(resolveLoginShell(this.loginShell), command, args); }
    catch (error) { return Promise.reject(error); }
    return new Promise((resolve, reject) => {
      const child = spawn(invocation.command, [...invocation.args], { stdio: "inherit" });
      child.once("error", reject);
      child.once("close", (code) => resolve({ stdout: "", stderr: "", code: code ?? -1 }));
    });
  }
}

export function resolveLoginShell(override?: string): string {
  if (override) return override;
  let passwdShell: string | undefined;
  try { passwdShell = userInfo().shell || undefined; } catch {}
  return passwdShell || process.env.SHELL || "/bin/sh";
}

export function loginShellInvocation(shell: string, command: string, args: ReadonlyArray<string>): ShellInvocation {
  if (!shell || shell.includes("\u0000")) throw new Error("Cannot run interactive machine setup: the login shell path is invalid.");
  const name = basename(shell).toLowerCase();
  const pathHint = shell.toLowerCase();
  const wrapped = name === "wrapper";
  const isFish = name === "fish" || (wrapped && /(?:^|[/_.-])fish(?:[/_.-]|$)/u.test(pathHint));
  if (isFish) {
    // Fish expands $argv as a list: argument boundaries are retained and its
    // contents are not parsed as fish source.
    return { command: shell, args: ["--login", "--interactive", "--command", "exec $argv", command, ...args] };
  }
  const posixNames = new Set(["sh", "bash", "dash", "ash", "zsh", "ksh", "mksh"]);
  const wrappedPosix = wrapped && /(?:^|[/_.-])(?:ba|da|a|z|k|mk)sh(?:[/_.-]|$)/u.test(pathHint);
  if (posixNames.has(name) || wrappedPosix) {
    // The source is constant. The executable and its arguments are positional
    // parameters, so no user-controlled value is interpolated into shell code.
    return { command: shell, args: ["-l", "-i", "-c", "exec \"$@\"", "herdr-ssh-config-picker", command, ...args] };
  }
  throw new Error(`Cannot run interactive machine setup with unsupported login shell ${shell}. Supported shells: fish, sh, bash, dash, ash, zsh, and ksh.`);
}

function bounded(value: string, limit: number): string { return value.length <= limit ? value : value.slice(-limit); }
