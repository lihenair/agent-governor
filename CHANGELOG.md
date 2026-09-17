# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.7.1] - 2026-09-17

### Changed

- **Default `npm i` is ~8.5 MB, not ~300 MB.** `@ast-grep/napi` is an optional
  peer; `@ast-grep/lang-*` packs are installed only for CI/tests or when you
  opt into `"engine": "ast-grep"`. Unused csharp/php/ruby packs are gone.
  Runtime deps: Babel + `shell-quote`. `governor doctor` reports napi status.

### Added

- **`governor validate`** — schema check of `governor.config.json` (file,
  field path, reason). Default `failureMode: "open"`.
- **`governor audit`** — query the JSONL log (`--since` / `--decision` /
  `--rule` / `--session` / `--format table|json`) and `audit gc --older-than`.

### Fixed

- **`npx agent-governor version`** printed `0.1.0` via the `.bin` shim.
  Version is now read from `import.meta.url`.

### Docs

- How-it-works diagram is a mermaid flowchart (PreToolUse / PostToolUse /
  allow-deny / audit.log).

## [0.7.0] - 2026-09-16

### Added

- **Cursor hard enforcement**: `hooks.json` adapter (`adapters/cursor-hooks.json`)
  wiring `beforeShellExecution` / `beforeEditFile` / `beforeReadFile` /
  `beforeMCPExecution` to the governor. Decisions emit as
  `{ permission: "deny", agentMessage }` — Cursor's native contract. The old
  "Cursor is rules-only" limitation is gone.
- **Windsurf (Cascade) support**: `adapters/windsurf-hooks.json` wiring
  `pre_run_command` / `pre_write_code` / `pre_read_code` (+ post events).
  Exit-code contract (2 = block).
- **OpenCode support**: `adapters/opencode-plugin.js` — an OpenCode plugin
  that forwards `tool.execute.before/after` to the governor core; blocks by
  throwing so OpenCode surfaces the reason to the model. Install by copying
  to `.opencode/plugins/`.
- Host adapters now normalize payload detection inside every guard runner
  (not only the CLI), and `runGuard` passes exit codes through for
  exit-code-contract hosts.

### Supported hosts (hard enforcement)

Claude Code · OpenAI Codex CLI · Google Gemini CLI · Cursor · Windsurf
(Cascade) · OpenCode

## [0.6.2] - 2026-09-16

### Docs

- README.md / README_ZH.md rewritten to match v0.6 reality: capability
  comparison table, all 14 CLI commands, honest scope, real perf numbers.
- (later) real terminal demo GIF `docs/demo.gif` (25KB) replaced the
  placeholder svg; recording flow documented in demo/RECORDING.md.

### Docs

- README.md / README_ZH.md rewritten to match v0.6 reality: capability
  comparison table, all 14 CLI commands, honest scope, real perf numbers.

### Fixed

- **`governor test --file X --operation write` never ran source-policy
  checks**: the dry-run payload carried empty content, so every
  source-policy rule silently passed. Content is now seeded from disk when
  the file exists. (Found while verifying the marketing repro script.)

### Added

- `governor test --engine ast-grep` flag for per-invocation engine A/B
  (demo-friendly: same input, regex flags / ast-grep allows).

## [0.6.1] - 2026-09-16

### Changed

- **Package size: 898 kB → 63 kB tarball (−93%), unpacked 5.3 MB → 210 kB (−96%).**
  Removed the unused `dist/` esbuild bundles (5.2 MB; `main`/`exports`/`bin`
  all point to `src/` — nothing referenced `dist/`), excluded stray
  `python/__pycache__/*.pyc`, and added the missing `rulebooks/` directory
  and `CHANGELOG.md` to the published files (official rulebook packs were
  not shipped before).

## [0.6.0] - 2026-09-16

### Added

- **Tree-sitter structural engine (`ast-grep`)**: opt-in
  `"engine": "ast-grep"` in `governor.config.json` upgrades Rust / Go /
  Kotlin / Swift / C / C++ / Dart source checks from line-regex to true
  syntax-tree matching via `@ast-grep/napi` (ast-grep = tree-sitter-based
  structural search, 15.9k★). Strings and comments are structurally
  immune to false positives (`"never write unsafe { }"` no longer trips the
  Rust guard). Kotlin `!!` is detected as a structural postfix operator,
  Swift `try!` as a `try_operator` node, Rust `unsafe` as `unsafe_block`.
- **Optional `@ast-grep/lang-*` packs**: rust / go / kotlin / swift / c /
  cpp / dart ship as `optionalDependencies` (prebuilt binaries — no local
  compiler needed). Missing packs degrade that language to the regex SOP;
  `registerDynamicLanguage` is called exactly once with every installed pack
  (napi requires single-shot registration before first parse).
- Node position API: line numbers derive from `node.range().start.line`.

### Fixed

- Shell-tool normalization (`shell` / `run_shell_command`) no longer runs on
  write-tool payloads (Edit/Write/MultiEdit), which previously suppressed the
  protected-file rule for non-Bash tools.

## [0.5.1] - 2026-09-15

### Fixed

- **Python checks are now a true syntax tree.** The README claimed stdlib
  `ast`, but the implementation was line-regex: it missed aliased calls
  (`e = eval; e(x)`), attribute calls (`builtins.eval(x)`), computed lookups
  (`globals()['eval'](x)`), and produced false positives on strings/comments
  mentioning banned names. Now `python/ast_check.py` walks the real `ast`
  tree (stdlib, zero new dependencies), tracks banned-call aliases through
  assignments, and falls back to line-regex only for syntax-error fragments.
  ~50ms per check (python3 process start dominates; parse is 0.02ms).

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
