import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loginShellInvocation } from "../src/core/runner.js";

const hostile = ["plain", "two words", "; touch /tmp/nope", "$(echo injected)", "`id`", "$HOME", "*", "quote'\"", ""];

test("fish login invocation carries hostile-looking values only in argv", () => {
  assert.deepEqual(loginShellInvocation("/nix/store/example-wrapped-fish/wrapper", "/path/herdr;nope", hostile), {
    command: "/nix/store/example-wrapped-fish/wrapper",
    args: ["--login", "--interactive", "--command", "exec $argv", "/path/herdr;nope", ...hostile],
  });
});

test("POSIX login invocation carries hostile-looking values only as positional parameters", () => {
  assert.deepEqual(loginShellInvocation("/bin/zsh", "/path/herdr;nope", hostile), {
    command: "/bin/zsh",
    args: ["-l", "-i", "-c", 'exec "$@"', "herdr-ssh-config-dash", "/path/herdr;nope", ...hostile],
  });
});

test("POSIX invocation executes without evaluating hostile-looking arguments", (t) => {
  const root = mkdtempSync(join(tmpdir(), "picker-shell-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = join(root, "argv.json"), executable = join(root, "record-argv");
  writeFileSync(executable, `#!/usr/bin/env node\nrequire("node:fs").writeFileSync(process.env.ARGV_OUTPUT, JSON.stringify(process.argv.slice(2)));\n`); chmodSync(executable, 0o755);
  const invocation = loginShellInvocation("/bin/sh", executable, hostile);
  const result = spawnSync(invocation.command, [...invocation.args], { env: { ...process.env, ARGV_OUTPUT: output }, stdio: "ignore" });
  assert.equal(result.status, 0, result.error?.message); assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), hostile);
});

test("fish invocation executes without evaluating hostile-looking arguments when fish is installed", (t) => {
  const lookup = spawnSync("fish", ["--version"], { encoding: "utf8" }); if (lookup.error || lookup.status !== 0) { t.skip("fish is not installed"); return; }
  const root = mkdtempSync(join(tmpdir(), "picker-fish-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const output = join(root, "argv.json"), executable = join(root, "record-argv");
  writeFileSync(executable, `#!/usr/bin/env node\nrequire("node:fs").writeFileSync(process.env.ARGV_OUTPUT, JSON.stringify(process.argv.slice(2)));\n`); chmodSync(executable, 0o755);
  const invocation = loginShellInvocation("fish", executable, hostile);
  const result = spawnSync(invocation.command, [...invocation.args], { env: { ...process.env, ARGV_OUTPUT: output }, stdio: "ignore" });
  assert.equal(result.status, 0, result.error?.message); assert.deepEqual(JSON.parse(readFileSync(output, "utf8")), hostile);
});

test("unsupported login shells fail clearly", () => {
  assert.throws(() => loginShellInvocation("/bin/tcsh", "herdr", []), /unsupported login shell \/bin\/tcsh.*fish.*bash/);
});
