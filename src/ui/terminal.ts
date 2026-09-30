import { emitKeypressEvents } from "node:readline";
import type { Interface } from "node:readline";
import type { ReadStream, WriteStream } from "node:tty";
export type Key = { readonly name: "up" | "down" | "enter" | "escape" | "backspace" | "ctrl-c" } | { readonly name: "text"; readonly text: string };

export class Terminal {
  private active = false; private suspended = false; private wasRaw = false;
  private readonly signalHandlers = new Map<NodeJS.Signals, () => void>();
  private readonly exitHandler = () => this.stop(); private readonly resizeHandler = () => this.onResize();
  private readonly keyHandler = (text: string | undefined, key: Record<string, unknown> | undefined) => { const normalized = normalizeKey(text, key); if (normalized) this.onKey(normalized); };
  constructor(private readonly input: ReadStream, private readonly output: WriteStream, private readonly onKey: (key: Key) => void, private readonly onResize: () => void, private readonly onQuit: () => void) {}
  get size(): { width: number; height: number } { return { width: this.output.columns || 80, height: this.output.rows || 24 }; }
  start(): void {
    if (this.active) return;
    if (!this.input.isTTY || !this.output.isTTY || typeof this.input.setRawMode !== "function") throw new Error("SSH config picker requires an interactive terminal.");
    this.active = true; this.wasRaw = Boolean(this.input.isRaw); emitKeypressEvents(this.input, { escapeCodeTimeout: 25 } as unknown as Interface);
    this.output.on("resize", this.resizeHandler);
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) { const handler = () => { this.onQuit(); try { process.kill(process.pid, signal); } catch { process.exitCode = 1; } }; this.signalHandlers.set(signal, handler); process.on(signal, handler); }
    process.on("exit", this.exitHandler);
    try { this.enterUi(); } catch (error) { this.stop(); throw error; }
  }
  paint(content: string): void { if (this.active && !this.suspended) this.output.write(`\u001b[?2026h\u001b[H\u001b[2J${content}\u001b[0m\u001b[?25l\u001b[?2026l`); }
  suspendForInteractive(): void { if (!this.active || this.suspended) return; this.suspended = true; this.input.off("keypress", this.keyHandler); try { this.input.setRawMode(false); } catch {} try { this.output.write("\u001b[0m\u001b[?25h\u001b[?1049l\r\n"); } catch {} }
  resumeAfterInteractive(): void { if (!this.active || !this.suspended) return; this.suspended = false; this.enterUi(); }
  stop(): void {
    if (!this.active) return; this.active = false; this.input.off("keypress", this.keyHandler); this.output.off("resize", this.resizeHandler);
    for (const [signal, handler] of this.signalHandlers) process.off(signal, handler); this.signalHandlers.clear(); process.off("exit", this.exitHandler);
    try { this.input.setRawMode(this.wasRaw); } catch {} try { this.input.pause(); this.input.unref(); } catch {} try { this.output.write("\u001b[0m\u001b[?25h\u001b[?1049l"); } catch {}
  }
  private enterUi(): void { this.input.on("keypress", this.keyHandler); this.input.setRawMode(true); this.input.resume(); this.output.write("\u001b[?1049h\u001b[?25l"); }
}
export function normalizeKey(text: string | undefined, key: Record<string, unknown> | undefined): Key | undefined {
  if (key?.ctrl === true && (key.name === "c" || text === "\u0003")) return { name: "ctrl-c" };
  const name = typeof key?.name === "string" ? key.name : "";
  if (["up", "down", "return", "enter", "escape", "backspace"].includes(name)) return { name: name === "return" ? "enter" : name as "up" | "down" | "enter" | "escape" | "backspace" };
  const value = typeof key?.sequence === "string" ? key.sequence : text;
  if (!value || value.startsWith("\u001b") || /[\u0000-\u001f\u007f]/u.test(value)) return undefined;
  return { name: "text", text: value };
}
