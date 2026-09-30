# Herdr SSH Config Picker

A Herdr 0.9.1+ plugin that reconciles literal `Host` aliases from `~/.ssh/config` with Herdr's saved machines. It is independent from the older `herdr-remote-picker` plugin and uses the distinct id `herdr-ssh-config-picker`.

## Behavior

- `[ ]` means no saved Herdr profile targets the alias. Space or Enter immediately runs `herdr machine add <alias> --label <alias> --remote-session default`.
- `[✓]` means one or more profiles target the alias, including disabled profiles. Space or Enter asks for destructive confirmation and then removes **every** matching profile by its opaque ID.
- Matching extracts the destination from bare aliases, `user@alias`, and `ssh://` targets, then compares the host and alias exactly, case-insensitively. Labels, resolved `HostName` values, and unrelated profiles are never used as identity.
- Removing forgets local profiles, causing them to disappear from Herdr's native sidebar after its normal reload. It does not stop remote sessions or agents. The plugin never reads or edits Herdr's private catalog.

Adding invokes Herdr with an inherited TTY. It can SSH to the host, install/start/update the remote Herdr server, and request authentication or approval. The popup safely leaves raw/alternate-screen mode while that command runs and restores itself afterward.

## SSH config support

The picker reads `~/.ssh/config` without evaluating it (so `Match exec` is never executed). It supports case-insensitive directives, quotes, escapes, comments, multiple Host/Include values, relative paths (based at `~/.ssh`), `~`, `${VAR}`, sorted globs, nested includes, and cycle/size limits. Literal positive Host tokens are listed; wildcard (`*`, `?`, bracket pattern) and negated tokens are excluded. Unreadable optional includes and unsupported `%` expansions appear as warnings.

## Install locally

```sh
npm ci
npm run build
herdr plugin link "$PWD"
herdr plugin list
```

Run the global action `herdr-ssh-config-picker.manage` from Herdr.

## Controls

- `↑`/`↓` or `j`/`k`: move
- Space or Enter: immediately add, or confirm removal of all matches
- `r`: reload SSH config and native machine state
- `?`: help
- `q`, Escape, or Ctrl-C: close

All state is refreshed immediately before mutation and after success, cancellation, or failure. Duplicate and disabled profiles are annotated; profiles that do not match a displayed alias are only counted and are never changed.

## Development

```sh
npm test
npm run typecheck
npm run build
```

Tests use temporary homes and fake Herdr executables; normal test runs make no SSH connections and modify no Herdr state. Linux and macOS are supported.
