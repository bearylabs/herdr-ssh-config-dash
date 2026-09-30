# Review: SSH-config machine picker

Date: 2026-09-30

## Recommendation

Build this as a **staged reconciliation UI**, not as an enable/disable picker:

1. Safely inventory literal `Host` aliases from the user's SSH config.
2. Join them to `herdr machine list --json` by exact machine `target` (never by label).
3. Let checkboxes stage a desired saved/not-saved state without changing anything immediately.
4. On Apply, add missing checked aliases first. Only if all additions succeed, remove every snapshotted profile ID for unchecked aliases.
5. Refresh from Herdr and report the actual resulting state, including partial failures.

Deselection must call `herdr machine remove <profile-id>`, not `disable`. A disabled profile is still saved and remains visible in Herdr 0.9.1. The picker should otherwise preserve a saved profile's enabled/disabled state.

## What was inspected

- This repository (currently only `README.md`).
- `/home/hrudek/dev/herdr-remote-picker`, including its command boundary, popup lifecycle, rendering, tests, and its Herdr core analysis.
- The installed `/home/hrudek/.local/bin/herdr` (`herdr 0.9.1`) and the live, read-only output of `herdr machine list --json`.
- Installed CLI help and harmless invalid-ID calls for `machine remove`, `enable`, and `disable`.
- The available Herdr v0.9.3 core checkout, especially endpoint catalog and machine command code. This is useful for internals but must not be mistaken for the installed 0.9.1 contract.
- The user's `~/.ssh/config`, OpenSSH 10.5 documentation, and controlled temporary-config experiments with `ssh -G -F`.

No machine was added, removed, enabled, or disabled during this review.

## Observed Herdr command contract

### Listing

`herdr machine list --json` is the correct authoritative read API. On 0.9.1 it returns an array of:

```json
{
  "id": "32-lowercase-hex-characters",
  "label": "display name",
  "target": "SSH target",
  "session": "default",
  "enabled": false,
  "selected": false
}
```

The parser should validate the top-level array and every required field. Unknown fields may be ignored for forward compatibility. Keep labels display-only and retain IDs as opaque, nonempty strings; the installed format is 32 lowercase hex characters, but the plugin should not manufacture IDs or make that current encoding its identity contract.

The installed catalog currently demonstrates the important case: saved profiles may be disabled and are still returned. `selected` is client selection state, not ownership and not whether a row should be checked.

### Adding

For compatibility with installed 0.9.1 and newer behavior, use:

```text
herdr machine add <alias> --label <chosen-label> --remote-session default
```

Always pass `--label`: it is required by installed 0.9.1, although v0.9.3 source permits a default. Always pass `--remote-session default` for deterministic plugin behavior and to avoid the newer CLI's remote-session picker.

`machine add` is not a cheap catalog edit. It connects over SSH, prepares/starts the remote Herdr server, may require authentication or approval, and saves only after preparation succeeds. It has no JSON output in the inspected versions. Success text contains the generated profile ID, but the plugin should always re-list afterward and treat the list as authoritative.

Because approval/authentication may require a terminal, the popup cannot use the reference plugin's normal piped `CommandRunner` unchanged. Before add, restore the terminal/leave the alternate screen, spawn Herdr with literal argv and inherited TTY stdio, then resume and refresh the popup. A piped child appears noninteractive to Herdr and changes session/approval behavior.

### Removing

Use only:

```text
herdr machine remove <profile-id>
```

Installed behavior:

- malformed ID: exit 2;
- well-formed but absent ID: exit 1;
- success: exit 0.

Removal clears the saved profile and any current selection of that ID. It leaves remote sessions running. Core also invalidates the profile's SSH metadata cache. It does not edit SSH config or remove SSH credentials.

Never pass a label or target to remove. Profile IDs are the only unambiguous mutation key.

### Duplicates and limits

The v0.9.3 catalog explicitly permits multiple profiles with the same target/session and gives each a distinct ID. Explicit duplicate labels are also accepted by catalog validation; labels therefore cannot be keys. The source has a 64-profile catalog limit, 128-byte label limit, and 1,024-byte target limit. Treat those as useful current constraints, but surface native CLI errors rather than duplicating all validation as a supposedly stable API.

## SSH alias inventory

### What constitutes a selectable alias

List tokens declared by `Host` directives, including multiple tokens on one line, while preserving source order. A selectable item must be a literal SSH destination alias. Exclude:

- `*` and any token containing SSH pattern metacharacters `*`, `?`, or `[`;
- negated tokens beginning with `!`;
- empty tokens, control characters, whitespace-containing values, and values beginning with `-`;
- tokens that cannot safely be represented as a Herdr/OpenSSH target.

This deliberately excludes wildcard rules such as `Host *`, `Host *.example`, and wildcard-with-negation policy blocks. Those are configuration rules, not enumerable hosts. A literal positive token next to wildcard or negative tokens may still be listed.

Do **not** resolve `HostName` and save that result. The target must be the alias itself so OpenSSH continues to apply `User`, `IdentityFile`, `ProxyJump`, `Match`, and future config changes. It also avoids copying credentials or connection details into Herdr.

Alias comparison should be exact and case-sensitive. Controlled OpenSSH tests showed differently cased `Host` tokens can select different first-value configurations. Deduplicate repeated exact aliases while retaining all source locations for diagnostics.

The current user config is a straightforward example: it has literal aliases, including multiple aliases on a `Host` line, and no wildcard or include directives. The live Herdr list also shows exact-target matching between some aliases and disabled saved profiles.

### Parsing safely

Do not parse with `grep`, a line-splitting regular expression, shell sourcing, or `ssh -G`.

`ssh -G` is useful for a known destination but cannot enumerate aliases. More importantly, evaluating a config can execute `Match exec`; merely opening the picker must never execute config-provided commands. It may also perform canonicalization-related work. Actual SSH execution is appropriate only after the user explicitly applies an add.

Implement a small, read-only lexer for the subset needed by `Host` and `Include`:

- keyword matching is case-insensitive;
- accept whitespace and `keyword=value` forms;
- handle comments only when OpenSSH treats `#` as comment syntax;
- handle quoted and backslash-escaped tokens rather than naïvely splitting whitespace;
- decode text strictly and report invalid bytes instead of silently replacing them;
- report filename and line for malformed relevant directives;
- cap bytes per file, include depth, total files, and total aliases to prevent hangs or memory abuse.

A syntax problem should produce an error/warning in the popup, not a crash and not a silently empty list. Parsing should remain read-only and should not follow FIFOs/devices. Regular files and symlinks to regular files are reasonable; use canonical paths for cycle detection.

### Includes

OpenSSH `Include` supports multiple paths, globs in lexical order, `~`, environment variables, and tokens. In a user config, relative include paths are based at `~/.ssh`, including an Include encountered in a nested file; they are not relative to the including file. Controlled tests confirmed this behavior.

Recommended v1 policy:

- support absolute paths, `~`, `${VAR}`, and glob expansion in lexical order;
- resolve relative paths against `~/.ssh`;
- silently allow an unmatched include glob, matching OpenSSH behavior;
- detect include cycles by canonical path;
- skip unsupported `%` expansions with a visible warning;
- follow includes at global scope and universally active `Host *` / `Match all` scope;
- warn and skip includes under other conditional `Host` or `Match` contexts rather than pretending to evaluate them.

Conditional includes are destination-dependent and a complete evaluator is disproportionate for an inventory tool. The conservative warning avoids false confidence. This limitation should appear in the README.

## Reconciliation model

### Identity and initial state

For each current alias `A`, compute:

```text
matchingProfiles(A) = machine list rows whose target === A
checked(A) = matchingProfiles(A).length > 0
```

Do not involve `label`, `session`, `enabled`, or `selected` in this join. If a matching profile is disabled, show that fact but keep the alias checked because it is still saved. If several IDs match, show `saved ×N` and a warning.

Checking a row with one or more exact-target profiles is a no-op. This prevents duplicate creation even if labels differ. Unchecking it means removing **all profile IDs shown for that exact target**, because retaining one would violate “not saved.” The confirmation must make the count explicit; this may include profiles originally created outside the plugin.

Profiles with a colliding label but a different target are unrelated and must never be removed. When adding an alias whose desired label is already used by another target, avoid creating another ambiguous label: propose a deterministic unique display label such as `<alias> (SSH)` with a numeric suffix, truncated on UTF-8 byte boundaries to Herdr's limit. Show the chosen label in the Apply preview. Identity remains the target and returned ID.

### Plugin-owned state and stale aliases

Use `HERDR_PLUGIN_STATE_DIR` for a small, atomically replaced state file recording successful associations `{ alias, profileId, target }`. It is not the source of truth; native `machine list --json` is. Its purposes are:

- retain a “missing from SSH config” row when an alias is deleted/renamed after the plugin added it;
- permit deliberate cleanup of that stale saved profile;
- distinguish stale plugin-created profiles from unrelated direct SSH targets.

On load, verify every stored ID against the native list and its recorded target; prune absent IDs and refuse removal on an ID/target mismatch. Existing native profiles that exactly match a currently visible alias can be displayed and managed without claiming ownership. If the user unchecks such a row, the preview must say that all matching profiles will be removed.

Do not read or edit Herdr's private `endpoints.json` directly. This would bypass validation, locking/reload behavior, metadata cleanup, and future migrations.

### Apply algorithm

1. Freeze input and obtain a fresh `machine list --json` snapshot.
2. Recompute the plan by exact target and show/confirm any change from the preview.
3. For each checked alias with no matching target, run add serially with inherited TTY.
4. Re-list after each add. If output was lost or the command timed out, treat an observed exact-target profile as success and do not blindly retry.
5. If any addition is still failed or ambiguous, stop before the destructive phase. Keep successful additions and clearly report partial state.
6. For each unchecked alias, remove each **snapshotted** matching ID serially. Do not remove IDs that appeared concurrently after the snapshot.
7. Continue independent removals after a removal failure, collect per-ID errors, then re-list.
8. Update plugin state only from confirmed native state and render unresolved differences with a Retry action.

This is not transactionally atomic—the CLI has no transaction API. “Adds first; no removes after an add failure” is the safest approximation. A valid-but-absent remove can be considered converged only after refresh confirms that no relevant snapshotted ID remains.

All commands must use `spawn(binary, argv)` without a shell, honoring `HERDR_BIN_PATH` as in the reference plugin. Serialize mutations and disable duplicate Apply presses. Never log full environment, SSH config contents, or authentication output into plugin state.

Cancellation is inherently uncertain during `machine add`. Do not present Escape as an immediate safe cancellation while a native add is running. Let the child finish (or offer an explicit force-cancel warning), restore the popup, and reconcile. A killed add may have prepared a remote server without saving a local profile.

## Proposed UX

The popup should say **SSH config machines**, not “remote machines,” to make its scope clear.

Each row should show:

```text
[✓] alias            saved, disabled
[✓] duplicate-alias  saved ×2 (2 profiles will be removed if unchecked)
[ ] new-alias        not saved
[!] old-alias        saved; missing from SSH config
```

Show source file/line and target profile IDs in a detail area, with IDs shortened only for display. Useful controls:

- arrows / `j`,`k`: move;
- Space: stage checked state;
- `/`: filter;
- `a`: check all visible literal aliases;
- `u`: uncheck all visible aliases;
- Enter: preview Apply summary;
- `r`: discard staged changes and reload both sources;
- `q` / Escape: close, warning if changes are staged.

The summary should separate `Add N aliases` from `Remove M profiles for N aliases`, name duplicate-target removals, show generated collision-free labels, and require a second confirmation whenever removal is nonempty. Toggling a checkbox itself must never invoke Herdr.

During add, temporarily show the native terminal with a clear heading naming the alias. After return, redraw the popup. Errors must retain the staged selection and be attached to the relevant row. Empty-state text should distinguish “no config file,” “no literal aliases,” “all declarations were wildcard patterns,” and “config could not be read.”

## Failure handling

- **Herdr missing/version mismatch:** fail before Apply with the binary path and version; do not mutate.
- **Malformed machine JSON:** fail closed; never plan removals from incomplete data.
- **SSH config unreadable/malformed:** preserve any loaded native machine information but disable Apply until inventory is trustworthy. Stale owned rows may be offered only when state and native ID/target agree.
- **Alias disappears between preview and Apply:** fresh planning must require reconfirmation.
- **Profile disappears concurrently:** refresh; do not substitute another same-label profile.
- **Concurrent profile appears:** do not delete its unseen ID automatically; show remaining drift and Retry.
- **Add succeeds but state-file write fails:** report degraded tracking, but native profile remains authoritative.
- **Plugin state corrupt:** quarantine/rename it, rebuild current rows from config plus native list, and never infer stale ownership.
- **Terminal resize/close/signals:** copy the reference plugin's terminal restoration discipline and test it around inherited-TTY add transitions.
- **Native stderr:** show a sanitized, bounded tail. Preserve exit code and distinguish command failure, spawn failure, timeout, and abort.

## Test plan

### SSH parser unit tests

Use fixtures only—never the developer's real `~/.ssh/config`:

- case-insensitive keywords, tabs, indentation, `Host=...`, comments, quoting, and escapes;
- multiple aliases on one Host line and repeated exact aliases;
- case-distinct aliases remain distinct;
- exclusion of `*`, `?`, bracket patterns, negations, whitespace/control values, and option-like values;
- mixed literal/wildcard/negated tokens retains only literals;
- CRLF, strict decode failure, overlong files/lines, and malformed quotes;
- absolute, `~`, environment, relative, globbed, nested, missing, cyclic, unreadable, and excessive includes;
- lexical include order and relative-to-`~/.ssh` behavior;
- conditional includes are skipped with diagnostics;
- a fixture containing `Match exec "touch ..."` proves listing never executes it.

### Join/planning unit tests

- no profiles, one exact target, disabled target, and selected target;
- labels never determine checked state;
- same label/different target remains unrelated;
- same target with different labels/sessions/enabled states yields one checked row with all IDs;
- deselection plans every snapshotted duplicate-target ID;
- checking an already represented target plans no add;
- label collision generates a valid deterministic unique label;
- stale owned ID, missing ID, and ID/target mismatch;
- config alias removal/rename produces a stale row only for tracked IDs;
- fresh state changes invalidate the preview and require confirmation.

### Command-service unit tests

With a fake runner, assert exact argv and binary path for list/add/remove. Cover malformed JSON, structured/plain stderr, output bounds, timeout, abort, spawn error, and all exit-code classes. Verify shell metacharacters in aliases/labels remain literal argv entries. Verify add uses inherited TTY while list/remove use captured pipes.

Test add ID reconciliation rather than trusting prose output: normal success, changed success text, successful list diff, command timeout followed by observed target, and ambiguous concurrent additions.

### Apply state-machine tests

- additions run before removals;
- one add failure prevents every removal;
- successful earlier additions survive and are reported after a later add failure;
- removal failures are aggregated and followed by refresh;
- absent-ID plus converged refresh is accepted;
- concurrent new IDs are not removed;
- double Apply is suppressed;
- state is atomically updated only for confirmed ID/target pairs.

### Entrypoint/UI tests

Adapt the reference plugin's fake-Herdr process tests for `q`, Escape, Ctrl-C, resize, and terminal restoration. Add coverage for suspending/restoring the alternate screen around an inherited-TTY add, dirty-close confirmation, destructive summary confirmation, duplicate warnings, narrow terminals, filtering/bulk actions, and partial-failure rendering.

An optional integration test can put fake `herdr` and `ssh` binaries first in `PATH`, use temporary HOME/XDG directories, and prove no real SSH or Herdr state is touched. Real-network tests should be opt-in and excluded from normal CI.

## Scope boundaries for v1

- Linux and macOS only, matching the reference plugin.
- Default user SSH config (`~/.ssh/config`) and supported includes; no system-wide host enumeration.
- Literal aliases only; no expansion of wildcard host spaces.
- Default Herdr remote session only.
- No SSH config edits, key management, connectivity probing, workspace opening, or enable/disable controls.
- No direct Herdr catalog edits.

These boundaries keep the plugin understandable: checked means “at least one saved Herdr profile targets this literal SSH alias,” unchecked means “none of the confirmed in-scope profiles remain.”
