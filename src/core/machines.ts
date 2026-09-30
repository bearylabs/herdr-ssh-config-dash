import type { CommandRunner } from "./runner.js";

export type Machine = {
  readonly id: string; readonly label: string; readonly target: string; readonly session: string;
  readonly enabled: boolean; readonly selected: boolean;
};
export type AliasRow = { readonly alias: string; readonly sources: ReadonlyArray<{ readonly path: string; readonly line: number }>; readonly profiles: ReadonlyArray<Machine> };

export class HerdrService {
  constructor(private readonly runner: CommandRunner, readonly binary = process.env.HERDR_BIN_PATH || "herdr") {}

  async list(signal?: AbortSignal): Promise<Machine[]> {
    return parseMachines(await this.captured(["machine", "list", "--json"], signal));
  }
  async add(alias: string): Promise<void> {
    const result = await this.runner.runInteractive(this.binary, ["machine", "add", alias, "--label", alias, "--remote-session", "default"]);
    if (result.code !== 0) throw new Error(commandError(result.stderr || result.stdout, result.code));
  }
  async removeAll(alias: string, signal?: AbortSignal, maxPasses = 4): Promise<number> {
    let removed = 0;
    for (let pass = 0; pass < maxPasses; pass++) {
      const matches = (await this.list(signal)).filter((machine) => targetMatchesAlias(machine.target, alias));
      if (matches.length === 0) return removed;
      const failures = new Map<string, string>();
      for (const machine of matches) {
        try { await this.captured(["machine", "remove", machine.id], signal); removed++; }
        catch (error) { failures.set(machine.id, `${shortId(machine.id)}: ${message(error)}`); }
      }
      const remaining = (await this.list(signal)).filter((machine) => targetMatchesAlias(machine.target, alias));
      if (remaining.length === 0) return removed; // Includes concurrently absent IDs.
      const persistentFailures = remaining.flatMap((machine) => failures.has(machine.id) ? [failures.get(machine.id)!] : []);
      if (persistentFailures.length) throw new Error(`Could not remove all profiles (${persistentFailures.join("; ")}); ${remaining.length} remain.`);
    }
    throw new Error(`Machine removal did not converge after ${maxPasses} passes.`);
  }
  async openPopup(cwd: string): Promise<void> {
    const pluginId = process.env.HERDR_PLUGIN_ID || "herdr-ssh-config-picker";
    await this.captured(["plugin", "pane", "open", "--plugin", pluginId, "--entrypoint", "picker", "--placement", "popup", "--width", "100", "--height", "72%", "--cwd", cwd, "--focus"]);
  }
  private async captured(args: ReadonlyArray<string>, signal?: AbortSignal): Promise<string> {
    const result = await this.runner.run(this.binary, args, signal ? { signal } : undefined);
    if (result.code !== 0) throw new Error(commandError(result.stderr || result.stdout, result.code));
    return result.stdout;
  }
}

export function parseMachines(input: string): Machine[] {
  let value: unknown; try { value = JSON.parse(input); } catch { throw new Error("Herdr returned invalid machine JSON."); }
  if (!Array.isArray(value)) throw new Error("Herdr returned an unexpected machine list.");
  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object") throw new Error(`Machine ${index + 1} is invalid.`);
    const item = entry as Record<string, unknown>;
    for (const key of ["id", "label", "target", "session"] as const) if (typeof item[key] !== "string" || item[key].length === 0) throw new Error(`Machine ${index + 1} has no valid ${key}.`);
    if (typeof item.enabled !== "boolean") throw new Error(`Machine ${index + 1} has no valid enabled state.`);
    return { id: item.id as string, label: item.label as string, target: item.target as string, session: item.session as string, enabled: item.enabled, selected: item.selected === true };
  });
}

export function extractTargetHost(target: string): string | undefined {
  if (!target || target.trim() !== target || /[\s\u0000-\u001f]/u.test(target) || target.startsWith("-")) return undefined;
  if (target.startsWith("ssh://")) {
    try {
      const url = new URL(target);
      if (url.protocol !== "ssh:" || !url.hostname || url.password || (target.slice(6).startsWith("@") && !url.username)) return undefined;
      return url.hostname.startsWith("[") && url.hostname.endsWith("]") ? url.hostname.slice(1, -1) : url.hostname;
    } catch { return undefined; }
  }
  if (target.includes(":") || target.includes("/") || target.includes("\\")) return undefined;
  const pieces = target.split("@"); if (pieces.length > 2) return undefined;
  const host = pieces.at(-1); if (!host || (pieces.length === 2 && !pieces[0])) return undefined;
  return host;
}
export function targetMatchesAlias(target: string, alias: string): boolean { return extractTargetHost(target)?.toLocaleLowerCase("en-US") === alias.toLocaleLowerCase("en-US"); }
export function reconcile(aliases: ReadonlyArray<{ name: string; sources: ReadonlyArray<{ path: string; line: number }> }>, machines: ReadonlyArray<Machine>): { rows: AliasRow[]; unmatched: number } {
  const rows = aliases.map(({ name, sources }) => ({ alias: name, sources, profiles: machines.filter((machine) => targetMatchesAlias(machine.target, name)) }));
  const matched = new Set(rows.flatMap((row) => row.profiles.map((profile) => profile.id)));
  return { rows, unmatched: machines.filter((machine) => !matched.has(machine.id)).length };
}
function commandError(output: string, code: number): string { const text = output.trim(); try { const parsed = JSON.parse(text) as { error?: { message?: unknown } }; if (typeof parsed.error?.message === "string") return parsed.error.message; } catch {} return text || `herdr exited with status ${code}`; }
function shortId(id: string): string { return id.length > 12 ? `${id.slice(0, 12)}…` : id; }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
