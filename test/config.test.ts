import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { excludeConfiguredHosts, hostGlobMatches, loadPickerConfig } from "../src/core/config.js";

async function configDir(t: test.TestContext): Promise<string> { const root = await mkdtemp(join(tmpdir(), "picker-config-")); t.after(() => rm(root, { recursive: true, force: true })); return root; }
const aliases = ["github.com", "work.ghe.com", "WORK.GHE.NET", "gitlab.local"].map((name) => ({ name, sources: [] }));

test("optional config excludes exact names and glob patterns case-insensitively", async (t) => {
  const root = await configDir(t);
  await writeFile(join(root, "config.json"), JSON.stringify({ excludeHosts: ["GITHUB.COM", "*.ghe.?et"] }));
  const config = await loadPickerConfig(root);
  assert.deepEqual(excludeConfiguredHosts(aliases, config.excludeHosts).map((alias) => alias.name), ["work.ghe.com", "gitlab.local"]);
});

test("missing config directory or file has no global exclusions", async (t) => {
  const root = await configDir(t);
  assert.deepEqual(await loadPickerConfig(undefined), { excludeHosts: [] });
  assert.deepEqual(await loadPickerConfig(root), { excludeHosts: [] });
  assert.deepEqual(excludeConfiguredHosts(aliases, []).map((alias) => alias.name), aliases.map((alias) => alias.name));
});

test("glob matching treats regex syntax literally and only star/question as wildcards", () => {
  assert.ok(hostGlobMatches("BUILD.+1.EXAMPLE", "build.+?.example"));
  assert.ok(!hostGlobMatches("build-xx.example", "build.+?.example"));
  assert.ok(hostGlobMatches("anything", "***"));
});

test("invalid config reports its path and field", async (t) => {
  const root = await configDir(t), path = join(root, "config.json");
  await writeFile(path, '{"excludeHosts":"*.internal"}');
  await assert.rejects(loadPickerConfig(root), (error: Error) => error.message.includes(path) && error.message.includes("excludeHosts"));
  await writeFile(path, '{"excludeHost":["x"]}');
  await assert.rejects(loadPickerConfig(root), /unknown field excludeHost/);
  await writeFile(path, "not json");
  await assert.rejects(loadPickerConfig(root), /Invalid plugin config/);
});
