import assert from "node:assert/strict";
import test from "node:test";
import { render } from "../src/ui/view.js";
const row = { alias: "prod\u001b[2J", sources: [{ path: "/home/x/.ssh/config", line: 2 }], profiles: [{ id: "opaque-profile-id", label: "x", target: "prod", session: "default", enabled: false, selected: false }] };
test("renders disabled saved state and strips controls", () => { const frame = render({ rows: [row], selected: 0, unmatched: 2, warnings: [], rootExists: true, help: false }, 100, 25); assert.match(strip(frame), /\[○\].*disabled/); assert.match(frame, /2 unmatched/); assert.doesNotMatch(frame, /prod\u001b/); });
test("renders destructive confirmation with profile count", () => { const frame = render({ rows: [row, { ...row, profiles: [...row.profiles, { ...row.profiles[0]!, id: "two" }] }], selected: 1, unmatched: 0, warnings: [], rootExists: true, help: false, confirmation: { alias: "prod", count: 2 } }, 100, 25); assert.match(frame, /Remove 2 saved profiles/); assert.match(frame, /disabled\/duplicate/); });

test("wraps modal copy over the dimmed picker instead of hiding it", () => {
  const safeRow = { ...row, alias: "prod" };
  const frame = strip(render({ rows: [safeRow], selected: 0, unmatched: 0, warnings: [], rootExists: true, help: false, confirmation: { alias: "prod", count: 1 } }, 80, 20));
  assert.match(frame, /› \[○\] prod/);
  assert.match(frame, /DETAILS/);
  assert.match(frame, /remote sessions keep/);
  assert.match(frame, /│  running\./);
  assert.doesNotMatch(frame, /keep ru…/);
});
test("renders missing config and compact dimensions", () => { assert.match(render({ rows: [], selected: 0, unmatched: 0, warnings: [], rootExists: false, help: false }, 80, 20), /No ~\/.ssh\/config/); const tiny = render({ rows: [row], selected: 0, unmatched: 0, warnings: [], rootExists: true, help: false }, 12, 2); assert.equal(tiny.split("\r\n").length, 2); assert.doesNotMatch(tiny, /\u001b/); });

test("keeps list rows fixed while selected details change below the list", () => {
  const second = { ...row, alias: "staging", sources: [{ path: "/home/x/.ssh/extra", line: 9 }], profiles: [] };
  const firstFrame = strip(render({ rows: [row, second], selected: 0, unmatched: 0, warnings: [], rootExists: true, help: false }, 100, 24)).split("\r\n");
  const secondFrame = strip(render({ rows: [row, second], selected: 1, unmatched: 0, warnings: [], rootExists: true, help: false }, 100, 24)).split("\r\n");
  assert.equal(firstFrame.findIndex((line) => line.includes("[○] prod")), secondFrame.findIndex((line) => line.includes("[○] prod")));
  assert.equal(firstFrame.findIndex((line) => line.includes("[ ] staging")), secondFrame.findIndex((line) => line.includes("[ ] staging")));
  assert.equal(firstFrame.indexOf("  DETAILS"), secondFrame.indexOf("  DETAILS"));
  assert.match(secondFrame[secondFrame.indexOf("  DETAILS") + 1] ?? "", /staging.*extra:9/);
});

test("anchors keybindings to the bottom of the popup", () => {
  const lines = strip(render({ rows: [row], selected: 0, unmatched: 0, warnings: [], rootExists: true, help: false }, 100, 25)).split("\r\n");
  assert.equal(lines.length, 25);
  assert.match(lines.at(-1) ?? "", /↑↓ select.*q close/);
});

test("renders active filter and filter input guidance", () => {
  const frame = render({ rows: [], totalRows: 3, selected: 0, unmatched: 0, warnings: [], rootExists: true, help: false, filter: "prod", filterEditing: true }, 100, 24);
  assert.match(frame, /0\/3 aliases/);
  assert.match(frame, /No aliases match the active filter/);
  assert.match(frame, /Filter aliases/);
  assert.match(frame, /Backspace edit/);
});

test("keeps destructive and filter controls visible in short compact views", () => {
  const confirmation = strip(render({ rows: [row], selected: 0, unmatched: 0, warnings: [], rootExists: true, help: false, confirmation: { alias: "prod", count: 1 } }, 80, 8));
  assert.match(confirmation, /Remove 1 profile for prod/);
  assert.match(confirmation, /y\/Enter remove · n\/Esc cancel/);

  const filter = strip(render({ rows: [row], totalRows: 3, selected: 0, unmatched: 0, warnings: [], rootExists: true, help: false, filter: "pro", filterEditing: true }, 80, 8));
  assert.match(filter, /\/pro_/);
  assert.match(filter, /1\/3 matches/);
  assert.match(filter, /Enter accept · Esc clear/);
});

function strip(value: string): string { return value.replace(/\u001b\[[0-9;?]*[A-Za-z]/gu, ""); }
