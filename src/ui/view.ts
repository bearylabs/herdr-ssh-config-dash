import type { AliasRow } from "../core/machines.js";

const e = "\u001b[";
const reset = `${e}0m`, bold = `${e}1m`, dim = `${e}2m`, cyan = `${e}36m`, green = `${e}32m`, yellow = `${e}33m`, red = `${e}31m`;

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
  if (w < 36 || h < 10) {
    const filter = state.filter !== undefined && (state.filter || state.filterEditing) ? ` /${state.filter}${state.filterEditing ? "_" : ""}` : "";
    const lines = [`SSH CONFIG MACHINES${filter}`];
    if (state.confirmation) {
      lines.push(`Remove ${state.confirmation.count} profile${state.confirmation.count === 1 ? "" : "s"} for ${state.confirmation.alias}?`);
      lines.push("y/Enter remove · n/Esc cancel");
    } else if (state.filterEditing) {
      lines.push(`/${state.filter ?? ""}_ · ${state.rows.length}/${totalRows} matches`);
      lines.push("Type/Backspace · Enter accept · Esc clear");
    } else {
      lines.push(state.busy ? `${spinner(tick)} ${state.busy}` : selectedRow ? `${selectedRow.profiles.length ? "[✓]" : "[ ]"} ${selectedRow.alias}` : state.filter ? "No filter matches." : "No literal hosts.");
      lines.push(state.error ? `Error: ${state.error}` : state.notice ?? (state.warnings[0] ? `Warning: ${state.warnings[0]}` : "Space toggle state · x remove · / filter"));
    }
    return lines.slice(0, h).map((line) => crop(clean(line), w)).join("\r\n");
  }

  const count = state.filter ? `${state.rows.length}/${totalRows}` : String(totalRows);
  const lines: string[] = [
    `${bold}${cyan}  HERDR  /  SSH CONFIG MACHINES${reset}`,
    `${dim}  Literal ~/.ssh/config hosts · ${count} alias${totalRows === 1 ? "" : "es"} · ${state.unmatched} unmatched saved profile${state.unmatched === 1 ? "" : "s"}${reset}`,
    "",
  ];
  const available = Math.max(1, h - 14);
  const listLines: string[] = [];
  if (state.busy && !state.rows.length && !state.filter) listLines.push(`  ${cyan}${spinner(tick)}${reset} ${clean(state.busy)}`);
  else if (!state.rows.length) {
    listLines.push(`  ${yellow}${state.filter ? "No aliases match the active filter." : state.rootExists ? "No literal Host aliases found." : "No ~/.ssh/config file found."}${reset}`);
    if (!state.filter) listLines.push(`  ${dim}Wildcard and negated Host patterns are intentionally excluded.${reset}`);
  } else {
    const start = Math.max(0, Math.min(state.selected - Math.floor(available / 2), state.rows.length - available));
    for (let i = start; i < Math.min(state.rows.length, start + available); i++) {
      const item = state.rows[i]!, active = i === state.selected, countProfiles = item.profiles.length;
      const enabled = item.profiles.filter((profile) => profile.enabled).length;
      const disabled = countProfiles - enabled;
      const status = !countProfiles ? `${dim}not saved${reset}`
        : enabled === countProfiles ? `${green}enabled${reset}${countProfiles > 1 ? ` ×${countProfiles}` : ""}`
        : disabled === countProfiles ? `${yellow}disabled${reset}${countProfiles > 1 ? ` ×${countProfiles}` : ""}`
        : `${yellow}mixed${reset} (${enabled} enabled, ${disabled} disabled)`;
      const marker = !countProfiles ? "[ ]" : enabled ? `${green}[●]${reset}` : `${yellow}[○]${reset}`;
      listLines.push(`${active ? bold : ""} ${active ? `${cyan}▶${reset}` : " "} ${marker} ${pad(clean(item.alias), Math.max(10, Math.floor(w * .42)))}  ${status}${reset}`);
    }
  }
  lines.push(...listLines.slice(0, available));
  while (lines.length < 3 + available) lines.push("");

  lines.push(`${dim}  DETAILS${reset}`);
  if (selectedRow) {
    const source = selectedRow.sources[0];
    const location = source ? `${clean(source.path)}:${source.line}` : "source unavailable";
    const profiles = selectedRow.profiles.length ? ` · profile IDs ${selectedRow.profiles.map((profile) => clean(profile.id).slice(0, 10)).join(", ")}` : " · no saved profiles";
    lines.push(`  ${crop(`${clean(selectedRow.alias)} · ${location}${profiles}`, w - 2)}`);
  } else lines.push(`  ${dim}${state.filter ? "No selected alias matches the filter." : "No alias selected."}${reset}`);
  lines.push("");

  if (state.confirmation) {
    lines.push(`  ${bold}${red}Remove ${state.confirmation.count} saved profile${state.confirmation.count === 1 ? "" : "s"} for ${clean(state.confirmation.alias)}?${reset}`);
    lines.push(`  ${yellow}This includes disabled/duplicate profiles and removes them from Herdr's sidebar.${reset}`);
    lines.push(`  ${bold}y / Enter${reset} remove all   ${bold}n / Esc${reset} cancel`);
  } else if (state.filterEditing) {
    lines.push(`  ${bold}Filter aliases${reset}  ${cyan}/${reset}${clean(state.filter ?? "")}${bold}_${reset}`);
    lines.push(`  ${dim}Type to narrow · Backspace edit · Enter accept · Esc clear${reset}`);
  } else if (state.help) {
    lines.push(`  ${bold}Keys${reset}  ↑/↓ or j/k select · Space/Enter add/enable/disable · x remove`);
    lines.push(`        / filter · r refresh · ? help · q close · Esc clear filter/close`);
  } else {
    const activeFilter = state.filter ? ` · filter /${clean(state.filter)}` : "";
    lines.push(`  ${dim}↑↓ select · Space/Enter add/enable/disable · x remove · / filter · r refresh · ? help · q close${activeFilter}${reset}`);
  }
  if (!state.confirmation) {
    if (state.busy && state.rows.length) lines.push(`  ${cyan}${spinner(tick)}${reset} ${crop(clean(state.busy), w - 6)}`);
    else if (state.error) lines.push(`  ${red}Error:${reset} ${crop(clean(state.error), w - 11)}`);
    else if (state.notice) lines.push(`  ${green}✓${reset} ${crop(clean(state.notice), w - 6)}`);
    else if (state.warnings.length) lines.push(`  ${yellow}Warning:${reset} ${crop(clean(state.warnings[0]!), w - 13)}${state.warnings.length > 1 ? ` (+${state.warnings.length - 1})` : ""}`);
  }
  return lines.slice(0, h).join("\r\n");
}

function spinner(t: number): string { return ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"][t % 10]!; }
function clean(v: string): string { return v.replace(/[\u0000-\u001f\u007f-\u009f]/gu, " "); }
function crop(v: string, n: number): string { if (n <= 0) return ""; return v.length <= n ? v : n === 1 ? "…" : `${v.slice(0, n - 1)}…`; }
function pad(v: string, n: number): string { const x = crop(v, n); return x + " ".repeat(Math.max(0, n - x.length)); }
