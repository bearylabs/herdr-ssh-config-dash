import type { AliasRow } from "../core/machines.js";

const e = "\u001b[";
const reset = `${e}0m`, bold = `${e}1m`, dim = `${e}2m`, reverse = `${e}7m`;
const cyan = `${e}36m`, green = `${e}32m`, yellow = `${e}33m`, red = `${e}31m`;

export type ViewState = {
  readonly rows: ReadonlyArray<AliasRow>;
  readonly totalRows?: number;
  readonly selected: number;
  readonly unmatched: number;
  readonly warnings: ReadonlyArray<string>;
  readonly rootExists: boolean;
  readonly filter?: string;
  readonly filterEditing?: boolean;
  readonly busy?: string;
  readonly error?: string;
  readonly notice?: string;
  readonly help: boolean;
  readonly confirmation?: { readonly alias: string; readonly count: number };
};

export function render(state: ViewState, width: number, height: number, tick = 0): string {
  const w = Math.max(1, width), h = Math.max(1, height), selectedRow = state.rows[state.selected];
  const totalRows = state.totalRows ?? state.rows.length;
  if (w < 48 || h < 13) return renderCompact(state, w, h, tick, selectedRow, totalRows);
  if (state.confirmation) {
    const { confirmation, ...backgroundState } = state;
    return renderConfirmation(render(backgroundState, w, h, tick), confirmation, w, h);
  }

  const count = state.filter ? `${state.rows.length}/${totalRows}` : String(totalRows);
  const filterSummary = state.filter ? ` · filter /${clean(state.filter)}` : "";
  const summary = `Literal hosts from ~/.ssh/config · ${count} alias${totalRows === 1 ? "" : "es"}${filterSummary} · ${state.unmatched} unmatched profile${state.unmatched === 1 ? "" : "s"}`;
  const lines: string[] = [
    `${bold}${cyan}  SSH config machines${reset}`,
    `${dim}  ${crop(summary, w - 2)}${reset}`,
    `${dim}  ${"─".repeat(Math.max(1, w - 4))}${reset}`,
  ];

  const footer = renderFooter(state, w, tick);
  const detailHeight = 3;
  const headerHeight = 3;
  const available = Math.max(1, h - headerHeight - detailHeight - footer.length);
  const listLines: string[] = [];
  if (state.busy && !state.rows.length && !state.filter) {
    listLines.push(`  ${cyan}${spinner(tick)}${reset} ${crop(clean(state.busy), w - 5)}`);
  } else if (!state.rows.length) {
    const empty = state.filter ? "No aliases match the active filter." : state.rootExists ? "No literal Host aliases found." : "No ~/.ssh/config file found.";
    listLines.push(`  ${yellow}${crop(empty, w - 2)}${reset}`);
    if (!state.filter) listLines.push(`  ${dim}${crop("Wildcard and negated Host patterns are excluded.", w - 2)}${reset}`);
  } else {
    const start = Math.max(0, Math.min(state.selected - Math.floor(available / 2), state.rows.length - available));
    const aliasWidth = Math.max(10, Math.min(38, Math.floor(w * .42)));
    for (let i = start; i < Math.min(state.rows.length, start + available); i++) {
      const item = state.rows[i]!, active = i === state.selected;
      const countProfiles = item.profiles.length;
      const enabled = item.profiles.filter((profile) => profile.enabled).length;
      const disabled = countProfiles - enabled;
      const status = !countProfiles ? "not saved"
        : enabled === countProfiles ? `enabled${countProfiles > 1 ? ` · ${countProfiles} profiles` : ""}`
        : disabled === countProfiles ? `disabled${countProfiles > 1 ? ` · ${countProfiles} profiles` : ""}`
        : `mixed · ${enabled} enabled, ${disabled} disabled`;
      const marker = !countProfiles ? "[ ]" : enabled ? "[●]" : "[○]";
      const content = `${active ? "›" : " "} ${marker} ${pad(clean(item.alias), aliasWidth)}  ${status}`;
      if (active) {
        listLines.push(`${reverse}${bold}${pad(crop(`  ${content}`, w), w)}${reset}`);
      } else {
        const markerColor = !countProfiles ? dim : enabled ? green : yellow;
        const statusColor = !countProfiles ? dim : enabled === countProfiles ? green : yellow;
        listLines.push(`    ${markerColor}${marker}${reset} ${pad(clean(item.alias), aliasWidth)}  ${statusColor}${crop(status, Math.max(1, w - aliasWidth - 12))}${reset}`);
      }
    }
  }
  lines.push(...listLines.slice(0, available));
  while (lines.length < headerHeight + available) lines.push("");

  lines.push(`${dim}  DETAILS${reset}`);
  if (selectedRow) {
    const source = selectedRow.sources[0];
    const location = source ? `${clean(source.path)}:${source.line}` : "source unavailable";
    const profileCount = selectedRow.profiles.length;
    const profileSummary = profileCount ? `${profileCount} saved profile${profileCount === 1 ? "" : "s"} · IDs ${selectedRow.profiles.map((profile) => clean(profile.id).slice(0, 10)).join(", ")}` : "not saved in Herdr";
    lines.push(`  ${crop(`${clean(selectedRow.alias)} · ${location} · ${profileSummary}`, w - 2)}`);
  } else {
    lines.push(`  ${dim}${state.filter ? "No selected alias matches the filter." : "No alias selected."}${reset}`);
  }
  lines.push("");
  lines.push(...footer);
  while (lines.length < h) lines.splice(Math.max(headerHeight + available + detailHeight, lines.length - footer.length), 0, "");
  return lines.slice(0, h).join("\r\n");
}

function renderConfirmation(background: string, confirmation: NonNullable<ViewState["confirmation"]>, width: number, height: number): string {
  const boxWidth = Math.min(72, width - 6);
  const innerWidth = boxWidth - 2;
  const contentWidth = innerWidth - 4;
  const question = `Remove ${confirmation.count} saved profile${confirmation.count === 1 ? "" : "s"} for ${clean(confirmation.alias)}?`;
  const explanation = "Includes disabled/duplicate profiles; remote sessions keep running.";
  const actions = `${bold}${red}Enter / y${reset} remove all   ${bold}Esc / n${reset} cancel`;
  const dialog = [
    `${cyan}╭${"─".repeat(innerWidth)}╮${reset}`,
    boxLine(`${bold}Remove from Herdr?${reset}`, innerWidth),
    boxLine("", innerWidth),
    ...wrapText(question, contentWidth).map((line) => boxLine(`${red}${line}${reset}`, innerWidth)),
    ...wrapText(explanation, contentWidth).map((line) => boxLine(`${dim}${line}${reset}`, innerWidth)),
    boxLine("", innerWidth),
    boxLine(actions, innerWidth),
    `${cyan}╰${"─".repeat(innerWidth)}╯${reset}`,
  ];
  const backgroundLines = background.split("\r\n");
  const left = Math.max(0, Math.floor((width - boxWidth) / 2));
  const top = Math.max(0, Math.floor((height - dialog.length) / 2));
  return Array.from({ length: height }, (_, row) => {
    const base = pad(crop(stripAnsi(backgroundLines[row] ?? ""), width), width);
    const overlay = dialog[row - top];
    if (!overlay) return `${dim}${base}${reset}`;
    const overlayWidth = visibleLength(overlay);
    return `${dim}${base.slice(0, left)}${reset}${overlay}${dim}${base.slice(left + overlayWidth)}${reset}`;
  }).join("\r\n");
}

function renderFooter(state: ViewState, width: number, tick: number): string[] {
  const w = width;
  const warningSuffix = state.warnings.length > 1 ? ` (+${state.warnings.length - 1})` : "";
  const status = state.busy && state.rows.length ? `${cyan}${spinner(tick)}${reset} ${crop(clean(state.busy), w - 5)}`
    : state.error ? `${red}Error:${reset} ${crop(clean(state.error), w - 11)}`
    : state.notice ? `${green}✓${reset} ${crop(clean(state.notice), w - 6)}`
    : state.warnings.length ? `${yellow}Warning:${reset} ${crop(clean(state.warnings[0]!), w - 13 - warningSuffix.length)}${warningSuffix}`
    : "";
  const statusLine = status ? `  ${status}` : "";

  if (state.filterEditing) {
    const guidance = w < 64 ? "Type · Backspace · Enter accept · Esc clear" : "Type to filter · Backspace edit · Enter accept · Esc clear";
    return [
      statusLine,
      `  ${bold}Filter aliases${reset}  ${cyan}/${reset}${crop(clean(state.filter ?? ""), Math.max(1, w - 22))}${bold}_${reset}`,
      `  ${dim}${crop(guidance, w - 2)}${reset}`,
    ];
  }
  if (state.help) {
    const primary = w < 72 ? "Keys  ↑↓ select · Space toggle · x remove" : "Keys  ↑↓ / j k select   Space / Enter toggle   x remove";
    const secondary = w < 72 ? "/ filter · r refresh · q close · Esc back" : "/ filter   r refresh   ? hide help   q close   Esc back";
    return [
      statusLine,
      `  ${bold}${crop(primary, w - 2)}${reset}`,
      `  ${dim}${crop(secondary, w - 2)}${reset}`,
    ];
  }
  const hints = w < 72 ? "↑↓ select · Space toggle · ? help · q close"
    : w < 90 ? "↑↓ select · Space toggle · x remove · / filter · ? help · q close"
    : "↑↓ select · Space toggle · x remove · / filter · r refresh · ? help · q close";
  return [
    statusLine,
    `  ${dim}${crop(hints, w - 2)}${reset}`,
  ];
}

function renderCompact(state: ViewState, width: number, height: number, tick: number, selectedRow: AliasRow | undefined, totalRows: number): string {
  const filter = state.filter !== undefined && (state.filter || state.filterEditing) ? ` /${state.filter}${state.filterEditing ? "_" : ""}` : "";
  const count = state.filter ? `${state.rows.length}/${totalRows}` : String(totalRows);
  const lines = [`SSH CONFIG MACHINES · ${count}${filter}`];
  if (state.confirmation) {
    lines.push(`Remove ${state.confirmation.count} profile${state.confirmation.count === 1 ? "" : "s"} for ${state.confirmation.alias}?`);
    lines.push("y/Enter remove · n/Esc cancel");
  } else if (state.filterEditing) {
    lines.push(`/${state.filter ?? ""}_ · ${state.rows.length}/${totalRows} matches`);
    lines.push("Type/Backspace · Enter accept · Esc clear");
  } else {
    lines.push(state.busy ? `${spinner(tick)} ${state.busy}` : selectedRow ? `${selectedRow.profiles.length ? "[✓]" : "[ ]"} ${selectedRow.alias}` : state.filter ? "No filter matches." : "No literal hosts.");
    lines.push(state.error ? `Error: ${state.error}` : state.notice ?? (state.warnings[0] ? `Warning: ${state.warnings[0]}` : "↑↓ select · Space toggle · / filter · q close"));
  }
  return lines.slice(0, height).map((line) => crop(clean(line), width)).join("\r\n");
}

function boxLine(content: string, width: number): string {
  const padding = " ".repeat(Math.max(0, width - visibleLength(content) - 2));
  return `${cyan}│${reset}  ${content}${padding}${cyan}│${reset}`;
}
function wrapText(value: string, width: number): string[] {
  const words = value.split(/\s+/u);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (!word) continue;
    if (line && line.length + word.length + 1 <= width) { line += ` ${word}`; continue; }
    if (line) { lines.push(line); line = ""; }
    let rest = word;
    while (rest.length > width) { lines.push(rest.slice(0, width)); rest = rest.slice(width); }
    line = rest;
  }
  if (line || !lines.length) lines.push(line);
  return lines;
}
function stripAnsi(value: string): string { return value.replace(/\u001b\[[0-9;?]*[A-Za-z]/gu, ""); }
function visibleLength(value: string): number { return stripAnsi(value).length; }
function spinner(t: number): string { return ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"][t % 10]!; }
function clean(v: string): string { return v.replace(/[\u0000-\u001f\u007f-\u009f]/gu, " "); }
function crop(v: string, n: number): string { if (n <= 0) return ""; return v.length <= n ? v : n === 1 ? "…" : `${v.slice(0, n - 1)}…`; }
function pad(v: string, n: number): string { const x = crop(v, n); return x + " ".repeat(Math.max(0, n - x.length)); }
