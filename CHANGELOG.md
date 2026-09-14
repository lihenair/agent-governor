# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - 2026-09-14

### Added

- **Bash capability analysis**: parse Bash tool calls into program + argv and tag
  capabilities (`git.push.force`, `hooks.bypass`, `git.branch.delete`,
  `secret.path.read`, `ci.path.write`, ...). Deny orders run before regex
  patterns, so `git push --force` is blocked with a precise rule id even when a
  generic pattern would also match.
- **Bash write protection**: `tee`, `sed -i`, `perl -pi`, `ruby -pi`, and
  `>` / `>>` redirections that target protected files (or argv-like writes such
  as `sh -c '...'`) are now blocked at the PreToolUse stage.
- **Audit log**: every decision is appended to `.agent-governor/audit.log` with
  SHA-256 tool-input hashes, git branch, decision, rule id, and a redacted
  preview. Log rotates at 10 MB. Secrets (`token` / `key` / `secret` /
  `password` / `authorization` assignments, `ghp_*`, `sk-*`, `Bearer ...`) are
  redacted with built-in patterns before anything touches disk.
- **Self-protection**: `.agent-governor/` state (including the audit log) is
  write-protected so an agent cannot erase its own trail.
- **`dry-run` / `governor test` CLI**: test a `--command` or `--file` payload
  against the real policy engine without a Claude Code session; `--json` emits
  machine-readable reports with fix suggestions.
- **`governor explain`**: print the compiled rule set (ids + counts) for the
  current config, useful for debugging `unprotect` / `override` merges.
- **Config `unprotect` / `override`**: subtract names from the merged
  `protectedFiles` list, or replace the defaults entirely.
- **Relative protected directories**: `protectedDirectories` entries now match
  repo-relative path prefixes reliably on Windows and POSIX.
- **Python runtime alignment**: the zero-dep `python3` runtime shares the same
  bash denylist semantics (DOTALL matching) as the Node dispatcher.
- **CI matrix**: Node 20 / 22 / 24, actions upgraded to v7.

### Changed

- Single-dispatcher architecture: one `PreToolUse` + one `PostToolUse` hook
  covers all languages; the file extension picks the inspector.
- Native Bash fallback fails closed (exit 2) when `python3` is missing instead
  of silently allowing every tool call (see
  [ADR 0001](./docs/adr/0001-native-runtime.md)).

## [0.1.0] - 2026-09-12

### Added

- Initial release: deterministic PreToolUse / PostToolUse guardrails for
  Claude Code via exit-code-2 feedback loops.
- Config shield across 9 ecosystems: JS/TS (`package.json`, `tsconfig.json`,
  lockfiles, eslint/biome), Python (`pyproject.toml`, `requirements.txt`,
  `setup.py`, Pipfile), Rust (`Cargo.toml`/`Cargo.lock`), Go (`go.mod`/`go.sum`),
  Dart/Flutter (`pubspec.yaml`), Swift/iOS (`Podfile`, `Package.swift`),
  Kotlin/Android (`build.gradle(.kts)`, `AndroidManifest.xml`), Java, C/C++
  (`CMakeLists.txt`, `Makefile`).
- Polyglot source policy: Babel AST for JS/TS (`eval`, `new Function`, custom
  forbidden calls), zero-dependency Python `ast` for `eval` / `exec` and
  deprecated imports, regex SOP for Rust `unsafe`, Go `panic`, Dart mirrors,
  Swift `try!`/`as!`, Kotlin `!!`/`TODO()`, Java `Runtime.exec`, C/C++
  `gets`/`system`.
- `agent-governor init` setup wizard writing `.claude/settings.json` dispatcher
  hooks, plus a Cursor soft adapter (`.cursor/rules/agent-governor.mdc`).
- Windows-safe default dispatcher (Node); Bash/Python runtimes stay optional.
- `governor.config.json` shared by Node, Python, and native runtimes.

[0.2.0]: https://github.com/lihenair/agent-governor/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/lihenair/agent-governor/releases/tag/v0.1.0
