import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
const managerUrl = pathToFileURL(resolve("src/manager.ts")).href, tsxUrl = import.meta.resolve("tsx");
const bootstrap = `Object.defineProperty(process.stdin,"isTTY",{value:true});Object.defineProperty(process.stdout,"isTTY",{value:true});Object.defineProperty(process.stdout,"columns",{value:90});Object.defineProperty(process.stdout,"rows",{value:20});Object.defineProperty(process.stdin,"isRaw",{value:false,writable:true});process.stdin.setRawMode=function(v){this.isRaw=v;return this};await import(${JSON.stringify(managerUrl)});`;
function run(input: string, t: test.TestContext): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const root = mkdtempSync(join(tmpdir(), "picker-entry-")); t.after(() => rmSync(root, { recursive: true, force: true })); mkdirSync(join(root, ".ssh")); writeFileSync(join(root, ".ssh/config"), "Host fixture\n");
  const binary = join(root, "herdr"); writeFileSync(binary, "#!/usr/bin/env node\nif(process.argv.slice(2).join(' ')==='machine list --json') console.log('[]');\n"); chmodSync(binary, 0o755);
  return new Promise((done, reject) => { const child = spawn(process.execPath, ["--import", tsxUrl, "--input-type=module", "--eval", bootstrap], { env: { ...process.env, HOME: root, HERDR_BIN_PATH: binary }, stdio: ["pipe", "pipe", "pipe"] }); let stdout = "", stderr = "", sent = false; const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("manager did not exit")); }, 5_000); child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8"); child.stdout.on("data", (chunk: string) => { stdout += chunk; if (!sent && stdout.includes("Loaded 1 literal")) { sent = true; child.stdin.write(input); } }); child.stderr.on("data", (chunk: string) => { stderr += chunk; }); child.once("error", reject); child.once("close", (code) => { clearTimeout(timer); done({ code, stdout, stderr }); }); });
}
for (const [name, key] of [["q", "q"], ["Escape", "\u001b"], ["Ctrl-C", "\u0003"]] as const) test(`manager restores terminal on ${name}`, async (t) => { const result = await run(key, t); assert.equal(result.code, 0, result.stderr); assert.match(result.stdout, /\?25h\u001b\[\?1049l/); });
