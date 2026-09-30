import assert from "node:assert/strict";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { discoverSshAliases } from "../src/core/ssh-config.js";
import { HerdrService, reconcile } from "../src/core/machines.js";
import { NodeCommandRunner } from "../src/core/runner.js";

test("temporary HOME and fake herdr reconcile and remove end to end", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ssh-picker-integration-")); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".ssh")); await writeFile(join(root, ".ssh/config"), "Host build *.invalid\n");
  const state = join(root, "state.json"), log = join(root, "calls.log"), binary = join(root, "herdr");
  await writeFile(state, JSON.stringify([{ id: "opaque-id", label: "anything", target: "user@build", session: "legacy", enabled: false, selected: false }]));
  await writeFile(binary, `#!/usr/bin/env node\nconst fs=require('fs'); const a=process.argv.slice(2); fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(a)+'\\n'); let s=JSON.parse(fs.readFileSync(${JSON.stringify(state)},'utf8')); if(a.join(' ')==='machine list --json') console.log(JSON.stringify(s)); else if(a[0]==='machine'&&a[1]==='remove'){s=s.filter(x=>x.id!==a[2]);fs.writeFileSync(${JSON.stringify(state)},JSON.stringify(s));}\n`); await chmod(binary, 0o755);
  const inventory = await discoverSshAliases({ home: root }), service = new HerdrService(new NodeCommandRunner(5_000), binary), machines = await service.list();
  assert.equal(reconcile(inventory.aliases, machines).rows[0]?.profiles.length, 1); assert.equal(await service.removeAll("build"), 1); assert.deepEqual(await service.list(), []);
  const calls = (await readFile(log, "utf8")).trim().split("\n").map((line) => JSON.parse(line)); assert.ok(calls.some((a) => a.join(" ") === "machine remove opaque-id"));
});
