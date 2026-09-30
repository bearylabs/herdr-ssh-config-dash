import { spawn } from "node:child_process";

export type CommandResult = { readonly stdout: string; readonly stderr: string; readonly code: number };
export interface CommandRunner {
  run(command: string, args: ReadonlyArray<string>, options?: { readonly signal?: AbortSignal }): Promise<CommandResult>;
  runInteractive(command: string, args: ReadonlyArray<string>): Promise<CommandResult>;
}

export class NodeCommandRunner implements CommandRunner {
  constructor(private readonly timeoutMs = 60_000, private readonly maxOutput = 256_000) {}

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
    return new Promise((resolve, reject) => {
      const child = spawn(command, [...args], { stdio: "inherit" });
      child.once("error", reject);
      child.once("close", (code) => resolve({ stdout: "", stderr: "", code: code ?? -1 }));
    });
  }
}

function bounded(value: string, limit: number): string { return value.length <= limit ? value : value.slice(-limit); }
