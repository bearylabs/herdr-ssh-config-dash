import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { SshAlias } from "./ssh-config.js";

export type PickerConfig = { readonly excludeHosts: ReadonlyArray<string> };
const emptyConfig: PickerConfig = { excludeHosts: [] };

export async function loadPickerConfig(configDir = process.env.HERDR_PLUGIN_CONFIG_DIR): Promise<PickerConfig> {
  if (!configDir) return emptyConfig;
  const path = join(configDir, "config.json");
  let source: string;
  try { source = await readFile(path, "utf8"); }
  catch (error) {
    if (isMissing(error)) return emptyConfig;
    throw new Error(`Cannot read plugin config ${path}: ${message(error)}`);
  }
  let value: unknown;
  try { value = JSON.parse(source); }
  catch (error) { throw new Error(`Invalid plugin config ${path}: ${message(error)}`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`Invalid plugin config ${path}: expected a JSON object.`);
  const object = value as Record<string, unknown>;
  const unknown = Object.keys(object).filter((key) => key !== "excludeHosts");
  if (unknown.length) throw new Error(`Invalid plugin config ${path}: unknown field ${unknown[0]}.`);
  if (object.excludeHosts === undefined) return emptyConfig;
  if (!Array.isArray(object.excludeHosts)) throw new Error(`Invalid plugin config ${path}: excludeHosts must be an array of glob strings.`);
  if (object.excludeHosts.length > 256) throw new Error(`Invalid plugin config ${path}: excludeHosts has more than 256 patterns.`);
  const patterns = object.excludeHosts.map((pattern, index) => {
    if (typeof pattern !== "string" || pattern.length === 0 || pattern.length > 1024 || /[\u0000-\u001f\u007f]/u.test(pattern)) {
      throw new Error(`Invalid plugin config ${path}: excludeHosts[${index}] must be a nonempty string without control characters (maximum 1024 characters).`);
    }
    return pattern;
  });
  return { excludeHosts: patterns };
}

export function excludeConfiguredHosts(aliases: ReadonlyArray<SshAlias>, patterns: ReadonlyArray<string>): SshAlias[] {
  return aliases.filter((alias) => !patterns.some((pattern) => hostGlobMatches(alias.name, pattern)));
}

export function hostGlobMatches(value: string, pattern: string): boolean {
  const input = Array.from(value.toLocaleLowerCase("en-US"));
  const glob = Array.from(pattern.toLocaleLowerCase("en-US"));
  let inputIndex = 0, patternIndex = 0, starIndex = -1, retryInputIndex = 0;
  while (inputIndex < input.length) {
    if (glob[patternIndex] === "?" || glob[patternIndex] === input[inputIndex]) { inputIndex++; patternIndex++; }
    else if (glob[patternIndex] === "*") { starIndex = patternIndex++; retryInputIndex = inputIndex; }
    else if (starIndex >= 0) { patternIndex = starIndex + 1; inputIndex = ++retryInputIndex; }
    else return false;
  }
  while (glob[patternIndex] === "*") patternIndex++;
  return patternIndex === glob.length;
}

function isMissing(error: unknown): boolean { return Boolean(error && typeof error === "object" && "code" in error && (error as { code?: unknown }).code === "ENOENT"); }
function message(error: unknown): string { return error instanceof Error ? error.message : String(error); }
