import type { AliasRow } from "../core/machines.js";
const e = "\u001b[", reset = `${e}0m`, bold = `${e}1m`, dim = `${e}2m`, cyan = `${e}36m`, green = `${e}32m`, yellow = `${e}33m`, red = `${e}31m`;
export type ViewState = { readonly rows: ReadonlyArray<AliasRow>; readonly selected: number; readonly unmatched: number; readonly warnings: ReadonlyArray<string>; readonly rootExists: boolean; readonly busy?: string; readonly error?: string; readonly notice?: string; readonly help: boolean; readonly confirmation?: { readonly alias: string; readonly count: number } };
export function render(state: ViewState, width: number, height: number, tick = 0): string {
  const w = Math.max(1, width), h = Math.max(1, height), row = state.rows[state.selected];
  if (w < 36 || h < 8) return ["SSH CONFIG MACHINES", state.busy ? `${spinner(tick)} ${state.busy}` : row ? `${row.profiles.length ? "[✓]" : "[ ]"} ${row.alias}` : "No literal hosts.", state.error ? `Error: ${state.error}` : "Space/Enter toggle · q close"].slice(0, h).map((line) => crop(clean(line), w)).join("\r\n");
  const lines: string[] = [`${bold}${cyan}  HERDR  /  SSH CONFIG MACHINES${reset}`, `${dim}  Literal ~/.ssh/config hosts · ${state.rows.length} alias${state.rows.length === 1 ? "" : "es"} · ${state.unmatched} unmatched saved profile${state.unmatched === 1 ? "" : "s"}${reset}`, ""];
  if (state.busy && !state.rows.length) lines.push(`  ${cyan}${spinner(tick)}${reset} ${clean(state.busy)}`);
  else if (!state.rows.length) { lines.push(`  ${yellow}${state.rootExists ? "No literal Host aliases found." : "No ~/.ssh/config file found."}${reset}`); lines.push(`  ${dim}Wildcard and negated Host patterns are intentionally excluded.${reset}`); }
  else {
    const available = Math.max(3, h - 12), start = Math.max(0, Math.min(state.selected - Math.floor(available / 2), state.rows.length - available));
    for (let i = start; i < Math.min(state.rows.length, start + available); i++) {
      const item = state.rows[i]!, active = i === state.selected, count = item.profiles.length, disabled = item.profiles.filter((profile) => !profile.enabled).length;
      const status = !count ? `${dim}not saved${reset}` : count === 1 ? `${green}saved${reset}${disabled ? `${yellow}, disabled${reset}` : ""}` : `${yellow}saved ×${count}${reset}${disabled ? ` (${disabled} disabled)` : ""}`;
      lines.push(`${active ? bold : ""} ${active ? `${cyan}▶${reset}` : " "} ${count ? `${green}[✓]${reset}` : "[ ]"} ${pad(clean(item.alias), Math.max(10, Math.floor(w * .42)))}  ${status}${reset}`);
      if (active && w >= 60) { const source = item.sources[0]; lines.push(`${dim}       ${source ? `${clean(source.path)}:${source.line}` : ""}${count ? ` · IDs ${item.profiles.map((p) => clean(p.id).slice(0, 10)).join(", ")}` : ""}${reset}`); }
    }
  }
  lines.push("");
  if (state.confirmation) { lines.push(`  ${bold}${red}Remove ${state.confirmation.count} saved profile${state.confirmation.count === 1 ? "" : "s"} for ${clean(state.confirmation.alias)}?${reset}`); lines.push(`  ${yellow}This includes disabled/duplicate profiles and removes them from Herdr's sidebar.${reset}`); lines.push(`  ${bold}y / Enter${reset} remove all   ${bold}n / Esc${reset} cancel`); }
  else if (state.help) { lines.push(`  ${bold}Keys${reset}  ↑/↓ or j/k select · Space/Enter add or remove · r refresh · ? help · q/Esc close`); lines.push(`  ${dim}Add may connect/install remotely and opens Herdr's interactive setup. Remove only forgets local profiles.${reset}`); }
  else lines.push(`  ${dim}↑↓ select · Space/Enter toggle immediately · r refresh · ? help · q close${reset}`);
  if (!state.confirmation) {
    if (state.busy && state.rows.length) lines.push(`  ${cyan}${spinner(tick)}${reset} ${crop(clean(state.busy), w - 6)}`);
    else if (state.error) lines.push(`  ${red}Error:${reset} ${crop(clean(state.error), w - 11)}`);
    else if (state.notice) lines.push(`  ${green}✓${reset} ${crop(clean(state.notice), w - 6)}`);
    else if (state.warnings.length) lines.push(`  ${yellow}Warning:${reset} ${crop(clean(state.warnings[0]!), w - 13)}${state.warnings.length > 1 ? ` (+${state.warnings.length - 1})` : ""}`);
  }
  return lines.slice(0, h).join("\r\n");
}
function spinner(t: number): string { return ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"][t % 10]!; }
function clean(v: string): string { return v.replace(/[\u0000-\u001f\u007f-\u009f]/gu, " "); }
function crop(v: string, n: number): string { if (n <= 0) return ""; return v.length <= n ? v : n === 1 ? "…" : `${v.slice(0, n - 1)}…`; }
function pad(v: string, n: number): string { const x = crop(v, n); return x + " ".repeat(Math.max(0, n - x.length)); }
