import { lstat, readFile, realpath, readdir, stat } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";

export type AliasSource = { readonly path: string; readonly line: number };
export type SshAlias = { readonly name: string; readonly sources: ReadonlyArray<AliasSource> };
export type Discovery = { readonly aliases: ReadonlyArray<SshAlias>; readonly warnings: ReadonlyArray<string>; readonly rootExists: boolean };
export type DiscoveryOptions = {
  readonly home?: string; readonly env?: NodeJS.ProcessEnv; readonly maxDepth?: number;
  readonly maxFiles?: number; readonly maxBytes?: number; readonly maxAliases?: number;
};

export async function discoverSshAliases(options: DiscoveryOptions = {}): Promise<Discovery> {
  const configuredHome = options.home ?? process.env.HOME;
  if (!configuredHome) throw new Error("Cannot locate ~/.ssh/config because HOME is not set.");
  const home: string = configuredHome;
  const environment: NodeJS.ProcessEnv = { ...process.env, HOME: home, ...options.env };
  const root = join(home, ".ssh", "config");
  const warnings: string[] = []; const aliases: SshAlias[] = []; const index = new Map<string, number>();
  const stack = new Set<string>(); let files = 0; let rootExists = true;
  const limits = { depth: options.maxDepth ?? 16, files: options.maxFiles ?? 256, bytes: options.maxBytes ?? 2_000_000, aliases: options.maxAliases ?? 10_000 };

  async function scan(path: string, depth: number, required: boolean): Promise<void> {
    if (depth > limits.depth) { warnings.push(`Include depth limit reached at ${path}.`); return; }
    let metadata;
    try { metadata = await lstat(path); } catch (error) {
      if (required && isMissing(error)) { rootExists = false; return; }
      if (required) throw new Error(`Cannot read SSH config ${path}: ${message(error)}`);
      warnings.push(`Cannot read included config ${path}: ${message(error)}`); return;
    }
    if (!metadata.isFile() && !metadata.isSymbolicLink()) { warnings.push(`Skipped non-regular SSH config ${path}.`); return; }
    let canonical: string;
    try { canonical = await realpath(path); } catch (error) {
      if (required) throw new Error(`Cannot resolve SSH config ${path}: ${message(error)}`);
      warnings.push(`Cannot resolve included config ${path}: ${message(error)}`); return;
    }
    try {
      if (!(await stat(canonical)).isFile()) { warnings.push(`Skipped non-regular SSH config ${path}.`); return; }
    } catch (error) {
      if (required) throw new Error(`Cannot inspect SSH config ${path}: ${message(error)}`);
      warnings.push(`Cannot inspect included config ${path}: ${message(error)}`); return;
    }
    if (stack.has(canonical)) { warnings.push(`Include cycle skipped at ${path}.`); return; }
    if (++files > limits.files) { warnings.push(`SSH config file limit (${limits.files}) reached.`); return; }
    let bytes: Buffer;
    try { bytes = await readFile(canonical); } catch (error) {
      if (required) throw new Error(`Cannot read SSH config ${path}: ${message(error)}`);
      warnings.push(`Cannot read included config ${path}: ${message(error)}`); return;
    }
    if (bytes.length > limits.bytes) {
      const text = `SSH config ${path} exceeds the ${limits.bytes}-byte limit.`;
      if (required) throw new Error(text); warnings.push(text); return;
    }
    let text: string;
    try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { const error = `SSH config ${path} is not valid UTF-8.`; if (required) throw new Error(error); warnings.push(error); return; }
    stack.add(canonical);
    try {
      const lines = text.replace(/\r\n?/gu, "\n").split("\n");
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        let directive: { keyword: string; args: string[] } | undefined;
        try { directive = parseDirective(lines[lineIndex] ?? ""); }
        catch (error) {
          const detail = `${path}:${lineIndex + 1}: ${message(error)}`;
          if (required) throw new Error(detail); warnings.push(detail); continue;
        }
        if (!directive) continue;
        if (directive.keyword === "host") {
          for (const token of directive.args) {
            if (!isLiteralAlias(token)) continue;
            const key = token.toLocaleLowerCase("en-US"); const source = { path, line: lineIndex + 1 };
            const found = index.get(key);
            if (found === undefined) {
              if (aliases.length >= limits.aliases) { warnings.push(`SSH alias limit (${limits.aliases}) reached.`); break; }
              index.set(key, aliases.length); aliases.push({ name: token, sources: [source] });
            } else {
              const current = aliases[found]!; aliases[found] = { ...current, sources: [...current.sources, source] };
            }
            // A Host directive represents one picker entry. OpenSSH may apply
            // the block to more names, but only its first selectable literal
            // token is exposed here.
            break;
          }
        } else if (directive.keyword === "include") {
          for (const pattern of directive.args) {
            const expanded = expandVariables(pattern, environment, home);
            if (!expanded) { warnings.push(`${path}:${lineIndex + 1}: unsupported Include path ${pattern}.`); continue; }
            const absolute = isAbsolute(expanded) ? expanded : resolve(home, ".ssh", expanded);
            let matches: string[];
            try { matches = await expandGlob(absolute); } catch (error) { warnings.push(`${path}:${lineIndex + 1}: Include failed: ${message(error)}`); continue; }
            for (const match of matches) await scan(match, depth + 1, false);
          }
        }
      }
    } finally { stack.delete(canonical); }
  }

  await scan(root, 0, true);
  return { aliases, warnings, rootExists };
}

export function parseDirective(line: string): { keyword: string; args: string[] } | undefined {
  let i = 0; while (/\s/u.test(line[i] ?? "")) i++;
  if (i >= line.length || line[i] === "#") return undefined;
  const start = i; while (i < line.length && !/[\s=]/u.test(line[i]!)) i++;
  const keyword = line.slice(start, i).toLowerCase();
  while (/\s/u.test(line[i] ?? "")) i++;
  if (line[i] === "=") { i++; while (/\s/u.test(line[i] ?? "")) i++; }
  const remainder = line.slice(i);
  const args = lexArguments(remainder);
  if ((keyword === "host" || keyword === "include") && args.length === 0 && !remainder.trimStart().startsWith("#")) throw new Error(`missing argument after ${keyword}`);
  return { keyword, args };
}

export function lexArguments(value: string): string[] {
  const result: string[] = []; let token = ""; let quote: "'" | '"' | undefined; let active = false;
  for (let i = 0; i < value.length; i++) {
    const char = value[i]!;
    if (!quote && char === "#" && !active) break;
    if (char === "\\") { if (i + 1 >= value.length) throw new Error("trailing escape"); token += value[++i]!; active = true; continue; }
    if (char === "'" || char === '"') {
      if (!quote) { quote = char; active = true; continue; }
      if (quote === char) { quote = undefined; continue; }
    }
    if (!quote && /\s/u.test(char)) { if (active) { result.push(token); token = ""; active = false; } continue; }
    token += char; active = true;
  }
  if (quote) throw new Error("unterminated quote");
  if (active) result.push(token);
  return result;
}

export function isLiteralAlias(value: string): boolean {
  const ambiguousTarget = ["@", ",", ":", "/", "\\"].some((character) => value.includes(character));
  return value.length > 0 && !value.startsWith("!") && !value.startsWith("-") && !/[*?[]/u.test(value)
    && !ambiguousTarget && !/[\s\u0000-\u001f\u007f]/u.test(value) && value.length <= 1024;
}

function expandVariables(value: string, env: NodeJS.ProcessEnv, home: string): string | undefined {
  if (value.includes("%") || (value.startsWith("~") && value !== "~" && !value.startsWith(`~${sep}`))) return undefined;
  let result = value === "~" || value.startsWith(`~${sep}`) ? home + value.slice(1) : value;
  let missing = false;
  result = result.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/gu, (_all, key: string) => { const found = env[key]; if (found === undefined) missing = true; return found ?? ""; });
  return missing ? undefined : result;
}

async function expandGlob(pattern: string): Promise<string[]> {
  if (!/[*?[]/u.test(pattern)) { try { await lstat(pattern); return [pattern]; } catch (error) { if (isMissing(error)) return []; throw error; } }
  const parts = pattern.split(sep); let paths = pattern.startsWith(sep) ? [sep] : [""];
  for (const part of parts) {
    if (!part) continue;
    const wildcard = /[*?[]/u.test(part); const next: string[] = [];
    for (const base of paths) {
      if (!wildcard) { next.push(join(base, part)); continue; }
      let names: string[]; try { names = await readdir(base || "."); } catch (error) { if (isMissing(error)) continue; throw error; }
      const regex = globRegex(part);
      for (const name of names.sort((a, b) => a.localeCompare(b))) {
        if (name.startsWith(".") && !part.startsWith(".")) continue;
        if (regex.test(name)) next.push(join(base, name));
      }
    }
    paths = next;
  }
  return paths;
}

function globRegex(pattern: string): RegExp {
  let out = "^";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "*") out += ".*"; else if (c === "?") out += ".";
    else if (c === "[") { const end = pattern.indexOf("]", i + 1); if (end < 0) out += "\\["; else { out += pattern.slice(i, end + 1); i = end; } }
    else out += c.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&");
  }
  return new RegExp(`${out}$`, "u");
}
function isMissing(error: unknown): boolean { return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT"); }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
