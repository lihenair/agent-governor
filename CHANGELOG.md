# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.5.0] - 2026-09-15

### Added

- **Multi-host support: OpenAI Codex CLI + Google Gemini CLI.** The same
  policy engine now protects three coding agents. `pre-check` / `post-check` /
  `session-hook` auto-detect the calling host from the payload shape,
  normalize it (Gemini `BeforeTool`→`PreToolUse`, `PreCompress`→`PreCompact`;
  Codex 1:1), and emit decisions in each host's native contract (Claude Code
  exit-2, Codex and Gemini JSON `decision` fields). Shell tools named `shell`
  (Codex) and `run_shell_command` (Gemini) are analyzed as Bash.
- **Host adapter configs ship in the package**: `adapters/codex-hooks.json`
  and `adapters/gemini-settings-hooks.json`, plus a new
  [`docs/hosts.md`](./docs/hosts.md) setup guide.

### Fixed

- Shell-tool name normalization no longer clobbers native write-tool names
  (Edit/Write/MultiEdit) during policy evaluation.

## [0.4.0] - 2026-09-15

### Added

- **Claude Code plugin distribution**: `.claude-plugin/marketplace.json` +
  `plugin/` — install with `/plugin marketplace add lihenair/agent-governor`
  then `/plugin install agent-governor@agent-governor`. Plugin hooks wire all
  events including SessionStart/PreCompact and read-side scanning, with a
  `setup` skill.
- **`governor doctor`**: self-check everything the guardrails depend on —
  Node version, package integrity, config validity, hooks actually installed,
  audit writability, and a live deny dry-run. Exit 1 on failure; every failing
  check ships an actionable fix.
- **`governor status`**: team policy drift detection. Compares the working
  `governor.config.json` against the committed baseline and flags local
  weakening (unprotected files, removed bash patterns, disabled AST flags,
  injection scanning turned off). Exit 1 on drift — wire into CI.
- **`explain <command|file>`**: explain what the governor would do with one
  specific target and why (rule rationale + fix + override hint). The
  original `explain --config` rule dump is unchanged.
- **Rulebooks: additive policy packs.** JSON packs under `rulebooks/` that can
  only add protection — `unprotect`, `override`, `injectionMode: "off"`, and
  `preset` are stripped on load by construction. Official packs: `terraform`,
  `aws`, `k8s`. Activate with the `rule add` command or the config's
  `rulebooks` field.
- **SECURITY.md**: documented threat model — what standard mode is and is not,
  hardening recommendations, and known limitations.

## [0.3.0] - 2026-09-15

### Added

- **Read-side injection scanning (industry first)**: `PostToolUse` hooks on
  `Read` / `WebFetch` / `WebSearch` scan incoming content for prompt injection
  — instruction override, role hijack, `curl | sh` payloads, env/secret
  exfiltration, zero-width Unicode smuggling. Weighted scoring: ≥2 blocks and
  feeds the reason back to the agent. Configure via `injectionMode` and
  `injectionPatterns` in `governor.config.json`.
- **Rule re-injection on SessionStart / PreCompact**: `init` now wires session
  hooks that re-inject active-policy context after a fresh session or context
  compaction — including how many times the agent has been blocked. New CLI
  command `session-hook`.
- **Preset policy packs**: `--preset security-hard|frontend|python|strict` (or
  the `preset` field in `governor.config.json`, or the `GOVERNOR_PRESET` env
  var). Presets extend the default shield with supply-chain files (`.env`,
  `Dockerfile`, CI workflows), web/data toolchain configs, and stricter AST
  flags. Presets compose (`--preset a,b`); user config always wins.
- **`governor report`**: aggregate the audit log into a digest — total blocks,
  block rate, top triggered rules, per-hook counts, and the last intervention
  with a redacted preview. `--json` for machines.

### Changed

- `init` writes four hook groups by default: PreToolUse (write+bash),
  PostToolUse (write), PostToolUse (read-scan), SessionStart, PreCompact.

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
