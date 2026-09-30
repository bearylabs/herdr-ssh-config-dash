import { NodeCommandRunner } from "./core/runner.js";
import { HerdrService } from "./core/machines.js";
try { await new HerdrService(new NodeCommandRunner()).openPopup(process.cwd()); }
catch (error) { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; }
