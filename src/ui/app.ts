import { homedir } from "node:os";
import { discoverSshAliases, type Discovery } from "../core/ssh-config.js";
import { HerdrService, reconcile, type AliasRow } from "../core/machines.js";
import type { Key, Terminal } from "./terminal.js";
import { render } from "./view.js";

type Confirmation = { readonly alias: string; readonly count: number };
type Discover = () => Promise<Discovery>;
export class PickerApp {
  private rows: AliasRow[] = []; private unmatched = 0; private warnings: readonly string[] = []; private rootExists = true;
  private selected = 0; private selectedAlias: string | undefined; private busy: string | undefined; private error: string | undefined; private notice: string | undefined;
  private help = false; private confirmation: Confirmation | undefined; private stopped = false; private tick = 0; private controller: AbortController | undefined; private timer: NodeJS.Timeout | undefined;
  private resolveStopped!: () => void; readonly stoppedPromise = new Promise<void>((resolve) => { this.resolveStopped = resolve; });
  constructor(private readonly terminal: Pick<Terminal, "size" | "start" | "stop" | "paint" | "suspendForInteractive" | "resumeAfterInteractive">, private readonly service: Pick<HerdrService, "list" | "add" | "removeAll">, private readonly discover: Discover = () => discoverSshAliases({ home: process.env.HOME || homedir() })) {}
  start(): void { this.terminal.start(); this.timer = setInterval(() => { if (this.busy) { this.tick++; this.paint(); } }, 80); this.paint(); void this.refresh(); }
  stop(): void { if (this.stopped) return; this.stopped = true; this.controller?.abort(); if (this.timer) clearInterval(this.timer); this.terminal.stop(); this.resolveStopped(); }
  onResize = (): void => this.paint();
  onKey = (key: Key): void => {
    if (key.name === "ctrl-c") { this.stop(); return; }
    if (this.busy) return;
    if (this.confirmation) { this.handleConfirmation(key); return; }
    if (key.name === "escape") { if (this.help) { this.help = false; this.paint(); } else this.stop(); return; }
    if (key.name === "up") this.move(-1); else if (key.name === "down") this.move(1); else if (key.name === "enter") void this.toggle();
    else if (key.name === "text") {
      if (key.text === "q") this.stop(); else if (key.text === "j") this.move(1); else if (key.text === "k") this.move(-1);
      else if (key.text === "r") void this.refresh(); else if (key.text === " ") void this.toggle(); else if (key.text === "?") { this.help = !this.help; this.paint(); }
    }
  };
  private move(delta: number): void { if (!this.rows.length) return; this.selected = (this.selected + delta + this.rows.length) % this.rows.length; this.selectedAlias = this.rows[this.selected]?.alias; this.error = undefined; this.notice = undefined; this.paint(); }
  private async load(signal?: AbortSignal): Promise<void> {
    const [inventory, machines] = await Promise.all([this.discover(), this.service.list(signal)]);
    const joined = reconcile(inventory.aliases, machines); this.rows = joined.rows; this.unmatched = joined.unmatched; this.warnings = inventory.warnings; this.rootExists = inventory.rootExists;
    const index = this.selectedAlias ? this.rows.findIndex((row) => row.alias.toLowerCase() === this.selectedAlias?.toLowerCase()) : -1;
    this.selected = index >= 0 ? index : Math.min(this.selected, Math.max(0, this.rows.length - 1)); this.selectedAlias = this.rows[this.selected]?.alias;
  }
  private async refresh(): Promise<void> { await this.perform("Refreshing SSH config and machines…", async (signal) => { await this.load(signal); this.notice = `Loaded ${this.rows.length} literal host${this.rows.length === 1 ? "" : "s"}.`; }); }
  private async toggle(): Promise<void> {
    const alias = this.current()?.alias; if (!alias) return;
    await this.perform(`Checking current state for ${alias}…`, async (signal) => {
      await this.load(signal); const row = this.rows.find((item) => item.alias.toLowerCase() === alias.toLowerCase());
      if (!row) throw new Error(`${alias} is no longer declared by SSH config.`);
      this.selectedAlias = row.alias;
      if (row.profiles.length) { this.confirmation = { alias: row.alias, count: row.profiles.length }; return; }
      this.busy = `Adding ${row.alias}…`; this.paint(); this.terminal.suspendForInteractive();
      let addError: unknown;
      try { await this.service.add(row.alias); } catch (error) { addError = error; } finally { this.terminal.resumeAfterInteractive(); }
      await this.load(signal);
      if (addError) throw addError;
      const saved = this.rows.find((item) => item.alias.toLowerCase() === row.alias.toLowerCase());
      if (!saved?.profiles.length) throw new Error(`Herdr completed but no saved profile targets ${row.alias}.`);
      this.notice = `Added ${row.alias}. It is now available in Herdr.`;
    });
  }
  private handleConfirmation(key: Key): void {
    if (key.name === "escape" || (key.name === "text" && ["n", "q"].includes(key.text.toLowerCase()))) { this.confirmation = undefined; void this.cancelRemoval(); return; }
    if (key.name === "enter" || (key.name === "text" && key.text.toLowerCase() === "y")) { const confirmation = this.confirmation; this.confirmation = undefined; if (confirmation) void this.remove(confirmation.alias); }
  }
  private async remove(alias: string): Promise<void> {
    await this.perform(`Removing every saved profile for ${alias}…`, async (signal) => {
      await this.load(signal); const current = this.rows.find((row) => row.alias.toLowerCase() === alias.toLowerCase());
      if (!current?.profiles.length) { this.notice = `${alias} was already removed.`; return; }
      let removed = 0; let removalError: unknown;
      try { removed = await this.service.removeAll(current.alias, signal); } catch (error) { removalError = error; }
      await this.load(signal);
      if (removalError) throw removalError;
      const remaining = this.rows.find((row) => row.alias.toLowerCase() === alias.toLowerCase())?.profiles.length ?? 0;
      if (remaining) throw new Error(`${remaining} matching profile${remaining === 1 ? " remains" : "s remain"}.`);
      this.notice = `Removed ${removed} profile${removed === 1 ? "" : "s"} for ${alias}; the native sidebar will refresh.`;
    });
  }
  private async cancelRemoval(): Promise<void> { await this.perform("Refreshing after cancellation…", async (signal) => { await this.load(signal); this.notice = "Removal cancelled; nothing was changed."; }); }
  private current(): AliasRow | undefined { return this.rows[this.selected]; }
  private async perform(label: string, operation: (signal: AbortSignal) => Promise<void>): Promise<void> {
    if (this.busy || this.stopped) return; this.busy = label; this.error = undefined; this.notice = undefined; this.controller = new AbortController(); this.paint();
    try { await operation(this.controller.signal); } catch (error) { if (!this.stopped && !this.controller.signal.aborted) this.error = error instanceof Error ? error.message : String(error); }
    finally { this.busy = undefined; this.controller = undefined; this.paint(); }
  }
  private paint(): void { if (!this.stopped) this.terminal.paint(render({ rows: this.rows, selected: this.selected, unmatched: this.unmatched, warnings: this.warnings, rootExists: this.rootExists, help: this.help, ...(this.busy ? { busy: this.busy } : {}), ...(this.error ? { error: this.error } : {}), ...(this.notice ? { notice: this.notice } : {}), ...(this.confirmation ? { confirmation: this.confirmation } : {}) }, this.terminal.size.width, this.terminal.size.height, this.tick)); }
}
