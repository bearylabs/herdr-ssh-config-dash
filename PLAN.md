# Implementation plan

## Product contract

- Ship a new plugin with id `herdr-ssh-config-dash` (not `herdr-remote-picker`) and `min_herdr_version = "0.9.1"`.
- The popup lists concrete aliases declared by the user's `~/.ssh/config` graph. A checked row means that at least one saved Herdr machine targets that alias; it does **not** mean that an existing profile is enabled.
- Checking an unsaved alias runs the supported CLI as argv, never through a shell or by editing Herdr state: `herdr machine add <alias> --label <alias> --remote-session default`.
- Unchecking confirms the destructive action, then runs `herdr machine remove <profile-id>` for every matching profile (enabled or disabled, in every remote session). This is intentionally removal rather than disable so the native sidebar drops the machine on its normal catalog reload, without a Herdr change.
- Profiles whose targets do not match a displayed alias are visible only as an informational unmatched count and are never modified.

## Structure and reuse

- Follow the old plugin's small TypeScript/Node 18 layout: manifest action opening a popup pane, bundled `open-popup` and `manager` entrypoints, an argv-based `CommandRunner`, a stateful picker app, isolated terminal handling, and pure rendering. Keep this repository/package independent rather than importing or sharing the old plugin.
- Reuse its useful interaction patterns: alternate-screen popup, resize-safe compact view, `j`/`k` and arrows, Space/Enter to toggle, `r` to refresh, `?` for help, `q`/Esc to close, stable selection by alias, spinner, notices, and structured command errors. Remove the old enable/disable and workspace-opening flows.
- Add modules for SSH-config discovery, saved-machine parsing/matching, Herdr mutations, and UI orchestration; keep parsing and reconciliation pure behind filesystem/runner interfaces for tests.

## SSH alias discovery

- Start at `~/.ssh/config` (using the process home directory); a missing root config produces an empty state, while an unreadable or malformed root produces a visible error.
- Tokenize OpenSSH-style lines with case-insensitive keywords, whitespace or `=` separators, quoting, escaping, and comments. From each `Host` directive, retain individual positive tokens that contain no pattern syntax (`*`, `?`, bracket classes, or leading `!`). Thus mixed declarations such as `Host build *.corp !old` still contribute `build`, while wildcard-only declarations do not become selectable machines.
- Expand `Include` directives recursively, including quoted paths, `~`, multiple arguments, and `*`/`?`/bracket globs. Resolve relative user-config includes against `~/.ssh`, sort glob results for deterministic OpenSSH-like order, silently accept unmatched globs, and guard symlink cycles plus excessive depth/file counts. Scan includes as textual config references; show non-fatal warnings for unreadable included files or unsupported dynamic paths rather than discarding aliases already found.
- Deduplicate aliases case-insensitively while preserving the first spelling and first-seen order. Repeated aliases in one line, later `Host` blocks, or multiple included files therefore render once. Keep source path/line metadata internally for diagnostics and parser tests.

## Saved-machine reconciliation

- Load `herdr machine list --json` via `HERDR_BIN_PATH` (fallback `herdr`) and validate `id`, `label`, `target`, `session`, and `enabled`; IDs are the only values passed to `machine remove`.
- Conservatively extract the destination host from forms Herdr/OpenSSH accepts: bare `alias`, `user@alias`, and `ssh://[user@]alias[:port][/...]`, including bracketed IPv6. Compare the extracted host to aliases case-insensitively. Do not match by display label or by resolved `HostName`, because either could delete an unrelated profile; leave malformed or ambiguous targets unmatched.
- Group every matching profile under its alias. Render the row as saved when the group is non-empty, with disabled and duplicate/profile-count details so pre-existing catalog states are understandable.
- Before either mutation, refresh aliases and machines to avoid acting on a stale row. Add only if no matching profile now exists. For removal, re-list after each batch and continue removing matching opaque IDs until none remain (with a bounded convergence guard); tolerate a concurrently removed ID by refreshing, but report other failures and any profiles left behind. Always refresh after success, cancellation, or failure.
- Serialize mutations while the UI is busy. For `machine add`, suspend raw mode and the alternate screen and run the child with inherited stdio so Herdr 0.9.1 can perform SSH setup and ask for installation/restart approval; restore and repaint the popup afterward. Removal and JSON listing remain captured, non-interactive commands. Do not impose the old short runner timeout on interactive setup.

## Manifest and documentation

- Declare a global `manage` action and `picker` popup in `herdr-plugin.toml`, using `HERDR_PLUGIN_ID` when opening it and dimensions similar to the old picker. Add package/build/typecheck/test scripts and document local linking, the qualified action id `herdr-ssh-config-dash.manage`, controls, matching rules, default remote session, and the destructive remove semantics.
- State clearly that adding can contact/install/update the remote Herdr server and may prompt, while removing only forgets the local profile and leaves remote sessions/agents running, matching the Herdr 0.9.1 CLI documentation.

## Verification

- Unit-test SSH tokenization and include expansion with temp homes: quoted/commented values, relative/absolute/tilde includes, sorted globs, missing includes, cycles, nested includes, mixed concrete/wildcard/negated hosts, and duplicate aliases/casing.
- Unit-test machine JSON validation and target matching for bare, user-qualified, URI/port, bracketed IPv6, different labels/sessions, disabled profiles, duplicates, malformed targets, and nonmatching resolved hostnames.
- Service tests with a fake runner must assert exact argv: deterministic add arguments; removal of all matching IDs and no unrelated IDs; refresh/no-op behavior under races; partial failures; and use of `HERDR_BIN_PATH`.
- App/view/terminal tests should cover loading/empty/warning/error states, stable selection after refresh, duplicate and disabled annotations, destructive confirmation, busy-key suppression, interactive terminal suspend/resume, compact rendering, and cleanup on signals/abort.
- Add an integration smoke test using a temporary HOME, fixture SSH configs, and a fake `herdr` executable to verify end-to-end discovery and command calls without SSH or catalog mutation. Finish with typecheck, unit tests, bundle build, manifest link/list validation against Herdr 0.9.1, and manual popup checks for one successful add and complete removal from the native sidebar.
