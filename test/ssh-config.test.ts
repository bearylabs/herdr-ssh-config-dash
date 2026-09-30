import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { discoverSshAliases, lexArguments, parseDirective } from "../src/core/ssh-config.js";

async function home(t: test.TestContext): Promise<string> { const root = await mkdtemp(join(tmpdir(), "ssh-picker-")); t.after(() => rm(root, { recursive: true, force: true })); await mkdir(join(root, ".ssh"), { recursive: true }); return root; }
test("lexes quoted, escaped and commented directives", () => {
  assert.deepEqual(parseDirective('  HoSt = "alpha" beta\\ host # no'), { keyword: "host", args: ["alpha", "beta host"] });
  assert.deepEqual(parseDirective("Host foo#bar # comment"), { keyword: "host", args: ["foo#bar"] });
  assert.deepEqual(parseDirective("Host#not-a-directive x"), { keyword: "host#not-a-directive", args: ["x"] });
  assert.deepEqual(lexArguments("'a#b' c"), ["a#b", "c"]);
  assert.throws(() => lexArguments("'oops"), /unterminated/);
  assert.throws(() => parseDirective("Host"), /missing argument/);
});
test("discovers mixed literals, excludes patterns and ambiguous targets, and deduplicates case-insensitively", async (t) => {
  const root = await home(t);
  await writeFile(join(root, ".ssh/config"), "Host build *.corp !old other build BUILD foo@bar host:22 path/name comma,name foo#bar\nHost -bad foo? bar[0]\n");
  const found = await discoverSshAliases({ home: root });
  assert.deepEqual(found.aliases.map((a) => a.name), ["build", "other", "foo#bar"]);
  assert.equal(found.aliases[0]?.sources.length, 3);
});
test("expands relative, tilde and sorted nested glob includes and guards cycles", async (t) => { const root = await home(t); await mkdir(join(root, ".ssh/conf.d")); await writeFile(join(root, ".ssh/config"), "Include conf.d/*.conf ~/.ssh/extra\nHost root\n"); await writeFile(join(root, ".ssh/conf.d/b.conf"), "Host beta\n"); await writeFile(join(root, ".ssh/conf.d/a.conf"), "Include config\nHost alpha\n"); await writeFile(join(root, ".ssh/extra"), "Host extra\n"); const found = await discoverSshAliases({ home: root }); assert.deepEqual(found.aliases.map((a) => a.name), ["alpha", "beta", "extra", "root"]); assert.ok(found.warnings.some((w) => w.includes("cycle"))); });
test("missing root is an empty state and missing optional globs are harmless", async (t) => { const root = await home(t); let found = await discoverSshAliases({ home: root }); assert.equal(found.rootExists, false); await writeFile(join(root, ".ssh/config"), "Include missing/*.conf\nHost yes\n"); found = await discoverSshAliases({ home: root }); assert.deepEqual(found.aliases.map((a) => a.name), ["yes"]); assert.deepEqual(found.warnings, []); });
test("uses the configured home for environment includes and ignores hidden glob entries", async (t) => {
  const root = await home(t);
  await mkdir(join(root, ".ssh/conf.d"));
  await writeFile(join(root, ".ssh/config"), "Include ${HOME}/.ssh/conf.d/*\nInclude ~other/config\n");
  await writeFile(join(root, ".ssh/conf.d/visible"), "Host visible\n");
  await writeFile(join(root, ".ssh/conf.d/.hidden"), "Host hidden\n");
  const found = await discoverSshAliases({ home: root, env: {} });
  assert.deepEqual(found.aliases.map((a) => a.name), ["visible"]);
  assert.ok(found.warnings.some((warning) => warning.includes("~other/config")));
});
test("skips symlinks whose targets are not regular files", async (t) => {
  const root = await home(t);
  await mkdir(join(root, ".ssh/directory"));
  await symlink(join(root, ".ssh/directory"), join(root, ".ssh/not-a-file"));
  await writeFile(join(root, ".ssh/config"), "Include not-a-file\nHost safe\n");
  const found = await discoverSshAliases({ home: root });
  assert.deepEqual(found.aliases.map((a) => a.name), ["safe"]);
  assert.ok(found.warnings.some((warning) => warning.includes("non-regular")));
});
test("reports malformed relevant directives in the root config", async (t) => {
  const root = await home(t);
  await writeFile(join(root, ".ssh/config"), "Host\n");
  await assert.rejects(discoverSshAliases({ home: root }), /missing argument after host/);
});
test("does not execute Match exec and warns on dynamic includes", async (t) => { const root = await home(t); const marker = join(root, "owned"); await writeFile(join(root, ".ssh/config"), `Match exec "touch ${marker}"\nHost safe\nInclude %h/config\n`); const found = await discoverSshAliases({ home: root }); assert.deepEqual(found.aliases.map((a) => a.name), ["safe"]); assert.match(found.warnings[0] ?? "", /unsupported/); });
