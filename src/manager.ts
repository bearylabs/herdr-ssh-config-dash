import { NodeCommandRunner } from "./core/runner.js";
import { HerdrService } from "./core/machines.js";
import { PickerApp } from "./ui/app.js";
import { Terminal } from "./ui/terminal.js";
let app: PickerApp;
const terminal = new Terminal(process.stdin, process.stdout, (key) => app.onKey(key), () => app.onResize(), () => app.stop());
app = new PickerApp(terminal, new HerdrService(new NodeCommandRunner()));
try { app.start(); await app.stoppedPromise; } catch (error) { terminal.stop(); process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
