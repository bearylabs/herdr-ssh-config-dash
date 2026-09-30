import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { ReadStream, WriteStream } from "node:tty";
import { Terminal } from "../src/ui/terminal.js";

class FakeInput extends EventEmitter {
  isTTY = true;
  isRaw = false;
  pauses = 0;
  resumes = 0;
  unrefs = 0;
  setRawMode(value: boolean): this { this.isRaw = value; return this; }
  pause(): this { this.pauses++; return this; }
  resume(): this { this.resumes++; return this; }
  unref(): this { this.unrefs++; return this; }
}

class FakeOutput extends EventEmitter {
  isTTY = true;
  columns = 80;
  rows = 24;
  writes: string[] = [];
  write(value: string): boolean { this.writes.push(value); return true; }
}

test("suspending for an inherited-TTY child stops the parent from consuming stdin", () => {
  const input = new FakeInput();
  const output = new FakeOutput();
  const terminal = new Terminal(
    input as unknown as ReadStream,
    output as unknown as WriteStream,
    () => {},
    () => {},
    () => {},
  );

  terminal.start();
  assert.equal(input.isRaw, true);
  assert.equal(input.resumes, 1);

  terminal.suspendForInteractive();
  assert.equal(input.isRaw, false);
  assert.equal(input.pauses, 1, "the popup must not race the interactive child for terminal input");
  assert.match(output.writes.at(-1) ?? "", /\?1049l/);

  terminal.resumeAfterInteractive();
  assert.equal(input.isRaw, true);
  assert.equal(input.resumes, 2);
  terminal.stop();
  assert.equal(input.isRaw, false);
  assert.ok(input.pauses >= 2);
});
