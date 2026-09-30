import assert from "node:assert/strict";
import test from "node:test";
import { PickerApp } from "../src/ui/app.js";
import type { Key } from "../src/ui/terminal.js";
import { targetMatchesAlias, type Machine } from "../src/core/machines.js";

class FakeTerminal {
  readonly size = { width: 100, height: 24 }; frames: string[] = []; suspended = 0; resumed = 0;
  start() {} stop() {} paint(frame: string) { this.frames.push(frame); }
  suspendForInteractive() { this.suspended++; } resumeAfterInteractive() { this.resumed++; }
}
class FakeService {
  machines: Machine[] = []; calls: string[] = [];
  async list(): Promise<Machine[]> { this.calls.push("list"); return [...this.machines]; }
  async add(alias: string): Promise<void> { this.calls.push(`add:${alias}`); this.machines.push({ id: "new-id", label: alias, target: alias, session: "default", enabled: true, selected: false }); }
  async removeAll(alias: string): Promise<number> { this.calls.push(`remove:${alias}`); const before = this.machines.length; this.machines = this.machines.filter((m) => !targetMatchesAlias(m.target, alias)); return before - this.machines.length; }
}
const inventory = async () => ({ rootExists: true, warnings: [], aliases: [{ name: "build", sources: [{ path: "/h/.ssh/config", line: 1 }] }] });
const manyAliases = async () => ({ rootExists: true, warnings: [], aliases: ["alpha", "beta", "gamma"].map((name, index) => ({ name, sources: [{ path: "/h/.ssh/config", line: index + 1 }] })) });
async function waitFor(check: () => boolean): Promise<void> { for (let i = 0; i < 100; i++) { if (check()) return; await new Promise((r) => setTimeout(r, 5)); } throw new Error("timed out"); }
const text = (value: string): Key => ({ name: "text", text: value });

test("checking immediately adds through inherited terminal flow and refreshes", async (t) => { const terminal = new FakeTerminal(), service = new FakeService(), app = new PickerApp(terminal, service, inventory); t.after(() => app.stop()); app.start(); await waitFor(() => terminal.frames.some((f) => f.includes("Loaded 1 literal"))); app.onKey(text(" ")); await waitFor(() => service.calls.includes("add:build") && terminal.frames.some((f) => f.includes("Added build"))); assert.equal(terminal.suspended, 1); assert.equal(terminal.resumed, 1); assert.match(terminal.frames.at(-1) ?? "", /saved/); });

test("unchecking requires confirmation then removes every matching profile", async (t) => { const terminal = new FakeTerminal(), service = new FakeService(); service.machines = [{ id: "a", label: "a", target: "build", session: "default", enabled: false, selected: false }, { id: "b", label: "b", target: "user@BUILD", session: "other", enabled: true, selected: false }]; const app = new PickerApp(terminal, service, inventory); t.after(() => app.stop()); app.start(); await waitFor(() => terminal.frames.some((f) => f.includes("Loaded 1 literal"))); app.onKey(text(" ")); await waitFor(() => terminal.frames.at(-1)?.includes("Remove 2 saved profiles") === true); assert.ok(!service.calls.includes("remove:build")); app.onKey(text("y")); await waitFor(() => service.calls.includes("remove:build") && terminal.frames.some((f) => f.includes("Removed 2 profiles"))); assert.equal(service.machines.length, 0); });

test("cancelling destructive confirmation refreshes without removal", async (t) => { const terminal = new FakeTerminal(), service = new FakeService(); service.machines = [{ id: "a", label: "a", target: "build", session: "default", enabled: true, selected: false }]; const app = new PickerApp(terminal, service, inventory); t.after(() => app.stop()); app.start(); await waitFor(() => terminal.frames.some((f) => f.includes("Loaded 1 literal"))); app.onKey({ name: "enter" }); await waitFor(() => terminal.frames.at(-1)?.includes("Remove 1 saved profile") === true); const lists = service.calls.filter((x) => x === "list").length; app.onKey({ name: "escape" }); await waitFor(() => terminal.frames.some((f) => f.includes("nothing was changed"))); assert.ok(service.calls.filter((x) => x === "list").length > lists); assert.ok(!service.calls.includes("remove:build")); });

test("slash filtering edits with Backspace, accepts with Enter, and restores stable selection on Escape", async (t) => {
  const terminal = new FakeTerminal(), service = new FakeService(), app = new PickerApp(terminal, service, manyAliases); t.after(() => app.stop()); app.start();
  await waitFor(() => terminal.frames.some((frame) => frame.includes("Loaded 3 literal")));
  app.onKey({ name: "down" }); // beta
  app.onKey(text("/"));
  for (const character of "betx") app.onKey(text(character));
  assert.match(terminal.frames.at(-1) ?? "", /No aliases match/);
  app.onKey({ name: "backspace" });
  assert.match(terminal.frames.at(-1) ?? "", /1\/3 aliases/);
  assert.match(terminal.frames.at(-1) ?? "", /beta/);
  app.onKey({ name: "enter" });
  assert.match(terminal.frames.at(-1) ?? "", /filter \/bet/);
  app.onKey({ name: "escape" });
  const cleared = terminal.frames.at(-1) ?? "";
  assert.doesNotMatch(cleared, /filter \/bet/);
  assert.match(cleared, /beta · \/h\/\.ssh\/config:2/);
});

test("discovery/config failures are visible and do not mutate", async (t) => {
  const terminal = new FakeTerminal(), service = new FakeService();
  const app = new PickerApp(terminal, service, async () => { throw new Error("Invalid plugin config /tmp/config.json: excludeHosts must be an array"); });
  t.after(() => app.stop()); app.start();
  await waitFor(() => terminal.frames.some((frame) => frame.includes("Invalid plugin config")));
  assert.deepEqual(service.calls, ["list"]);
});
