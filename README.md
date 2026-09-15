<div align="center">

# 🛡️ Agent Governor

**Deterministic Runtime Guardrails for Claude Code, Codex CLI & Gemini CLI**

*Syntax-tree-level code checks (tree-sitter), read-side injection scanning, and hardware-grade hooks.*

*Stop prompt injection, architecture drift, and configuration tampering with hardware-grade hooks.*

One config, three coding agents. See [docs/hosts.md](./docs/hosts.md).

[English](./README.md) | [简体中文](./README_ZH.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Claude Code Support](https://img.shields.io/badge/Claude%20Code-v1.0%2B-brightgreen.svg)](#)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/lihenair/agent-governor/pulls)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](#)
[![Python](https://img.shields.io/badge/Python-3.9%2B%20zero--dep-3776AB.svg)](#)
[![Rust / Go / C++](https://img.shields.io/badge/Rust%20%7C%20Go%20%7C%20C%2B%2B-native-orange.svg)](#)
[![Flutter / Mobile](https://img.shields.io/badge/Flutter%20%7C%20iOS%20%7C%20Android-polyglot-blue.svg)](#)

</div>

<br />

<div align="center">
  <img src="docs/demo.svg" alt="Agent Governor Demo" width="800px" />
  <p><em>Left: Without Guard (Agent modifies tsconfig.json to bypass TS errors).<br/>Right: With Agent Governor (PreToolUse Hook intercepts and forces Agent to fix TypeScript code).</em></p>
</div>

---

## ⚡ The Problem

Modern AI agents (Claude Code, Cursor, OpenCode) are incredibly fast, but they suffer from **non-determinism and context drift**:

* 🚫 **Configuration Tampering**: Agents often edit `tsconfig.json`, `biome.json`, or `.eslintrc` to "fix" compilation or linting errors instead of resolving the actual bugs.
* 🌀 **Architecture Drift**: As conversation contexts grow, agents forget project rules, breaking design patterns in Brownfield codebases.
* 💣 **Dangerous Bash Operations**: Agents might run force pushes, bypass git hooks (`--no-verify`), or delete critical files when struggling with errors.

**Prose prompts (like `CLAUDE.md` or system instructions) are soft guidelines. `agent-governor` provides deterministic, zero-variance hardware-grade enforcement.**

---

## 🏗️ How It Works (Architecture)

`agent-governor` taps directly into Claude Code's native Hook runtime (`PreToolUse`, `PostToolUse`). It uses **Exit Code 2** feedback loops to block unsafe operations and inject actionable AST/security errors back into the LLM's context.

```
┌─────────────────┐       Tool Request        ┌───────────────────────┐
│                 │ ──── (Edit/Write/Bash) ─► │                       │
│   Claude Code   │                           │     Agent Governor    │
│     Agent       │ ◄─── Exit 2 (Blocked) ─── │    Security Engine    │
│                 │      + Error Reason       └───────────┬───────────┘
└─────────────────┘                                       │
          ▲                                               │
          │                                      ┌────────┴─────────┐
          │                                      │ Guardrail Checks │
          │                                      ├──────────────────┤
          │                                      │ 1. Anti-Tamper   │
          │                                      │ 2. AST Integrity │
          │                                      │ 3. Bash Safety   │
          └────── Exit 0 (Approved) ─────────────┤ 4. SOP Verifier  │
                                                 └──────────────────┘
```

### Hook protocol

| Result | Exit code | Channel | Effect |
| --- | --- | --- | --- |
| Allow | `0` | stdout (optional) | Tool call proceeds |
| Block | `2` | stderr | Claude Code feeds the reason back to the agent and forces a retry |
| Internal error | `0` | stderr | Fail-open so a governor crash cannot freeze the agent loop |

Claude Code sends each event as JSON on stdin (`tool_name`, `tool_input`, `cwd`, ...).

---

## ✨ Key Features

* 🛡️ **Zero-Trust Config Shield**: Locks toolchain manifests across JS, Python, Rust, Go, Flutter, iOS, and Android.
* ⚡ **Single dispatcher**: one PreToolUse + one PostToolUse hook. File extension picks the inspector (no triple-hook lag).
* 🧠 **Polyglot source policy** driven by `governor.config.json` `astRules` (flags are real, not docs-only).
* 📖 **Read-side injection scanning (industry first)**: PostToolUse guard inspects what agents *read* — fetched web pages, files, search results — and blocks `ignore previous instructions`, `curl | sh`, and secret-exfiltration payloads before the agent obeys them. Nobody else checks the input side.
* 🔄 **Rule re-injection on SessionStart / PreCompact**: governance context survives context compaction — the agent cannot "forget" the guardrails exactly when its memory gets wiped.
* 🎒 **Preset policy packs**: `--preset security-hard|frontend|python|strict` — one flag for an opinionated baseline (`.env`, Dockerfile, CI workflows, lockfiles, bundler configs).
* 📊 **`governor report`**: turns the audit log into a digest — total blocks, top triggered rules, last intervention. Perfect for your README and retro meetings.
* 🪟 **Windows-safe default**: the dispatcher is Node. Bash/Python runtimes stay optional.
* 📎 **Cursor soft adapter**: `init` writes `.cursor/rules/agent-governor.mdc` because Cursor has no PreToolUse hooks.

### Language coverage

| Language | Config shield | Source policy (dispatcher) | Engine |
| --- | --- | --- | --- |
| JavaScript / TypeScript | `package.json`, `tsconfig.json`, lockfiles, eslint/biome | `eval`, `new Function()`, custom forbidden calls | Babel AST |
| Python | `pyproject.toml`, `requirements.txt`, `setup.py`, Pipfile | `eval`/`exec` (incl. aliases, attribute & computed lookups), `imp`/`optparse` | stdlib `ast` (true syntax tree, zero deps) with regex fallback for partial snippets |
| Rust | `Cargo.toml`, `Cargo.lock` | `unsafe {` blocks (`rustForbidUnsafe`, default on) | tree-sitter (ast-grep) or regex SOP |
| Go | `go.mod`, `go.sum` | `panic(` calls (`goForbidPanic`, **default off**) | tree-sitter (ast-grep) or regex SOP |
| Dart / Flutter | `pubspec.yaml` | `dart:mirrors` imports | tree-sitter (ast-grep) or regex SOP |
| Swift / iOS | `Podfile`, `Package.swift` | `try!` (structural `try_operator`) | tree-sitter (ast-grep) or regex SOP |
| Kotlin / Android | `build.gradle(.kts)`, `settings.gradle`, `AndroidManifest.xml` | `!!` force unwrap (structural postfix) | tree-sitter (ast-grep) or regex SOP |
| Java | Gradle / manifest | `Runtime.getRuntime().exec()` | Regex SOP |
| C / C++ | `CMakeLists.txt`, `Makefile` | `gets()`, `system()` calls | tree-sitter (ast-grep) or regex SOP |

> **Why syntax trees beat regex for code checks:** line-regex cannot tell
> `unsafe { x() }` (real code) from `"never write unsafe { }"` (a string
> literal) — it flags both. Tree-sitter grammars know strings and comments are
> not statements, so structural rules have **zero false positives** on
> non-code text. Enable with `"engine": "ast-grep"` in `governor.config.json`
> (auto-detects installed `@ast-grep/lang-*` packs; graceful regex fallback
> when missing).

### IDE / agent support

| Tool | Enforcement | What `init` does |
| --- | --- | --- |
| **Claude Code** | Hard. `PreToolUse` / `PostToolUse`, exit 2 | Writes `.claude/settings.json` dispatcher hooks |
| **Cursor** | Soft. No tool hooks | Writes `.cursor/rules/agent-governor.mdc` |
| **OpenCode** | None built-in | Use Claude Code, or pipe tool JSON through `npx agent-governor hook` in your own wrapper |

---

## 📦 Quick Start

### 1. Install via Package Manager

```bash
npm install -D agent-governor
# or
pnpm add -D agent-governor
```

### 2. Initialize in Your Project

Run the setup wizard to automatically configure `.claude/settings.json`:

```bash
npx agent-governor init              # one dispatcher hook, all languages
npx agent-governor init --lang python  # optional: stdlib ast only, no Babel
```

Default hooks (covers JS/TS, Python, Rust, Go, Dart, Swift, Kotlin, Java, C/C++):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit|NotebookEdit|Bash",
        "hooks": [{ "type": "command", "command": "npx agent-governor pre-check" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit|NotebookEdit",
        "hooks": [{ "type": "command", "command": "npx agent-governor post-check" }]
      }
    ]
  }
}
```

Or a single command that reads `hook_event_name`:

```bash
npx agent-governor hook
```

`--lang python` still installs zero-dep `python3 .agent-governor/python/*.py` hooks. The Bash native guard remains in the package for air-gapped Unix boxes, but the default path is Node so Windows works without `bash`/`python3`. `native/governor_guard.sh` still shells out to `python3` today; if it is missing the hook **fails closed** (exit 2) instead of silently allowing every tool call. See [ADR 0001](./docs/adr/0001-native-runtime.md).

---

## ⚙️ Configuration (`governor.config.json`)

One JSON file is shared by the Node, Python, and native runtimes:

```json
{
  "protectedFiles": [
    "tsconfig.json",
    "package.json",
    "pyproject.toml",
    "requirements.txt",
    "Cargo.toml",
    "Cargo.lock",
    "go.mod",
    "go.sum",
    "CMakeLists.txt",
    "pubspec.yaml",
    ".eslintrc",
    "biome.json"
  ],
  "protectedDirectories": [".claude/", ".agent-governor/"],
  "forbiddenBashPatterns": [
    "git commit.*--no-verify",
    "rm -rf \\.git",
    "pip install --insecure",
    "cargo publish --no-verify"
  ],
  "astRules": {
    "noDirectEval": true,
    "pythonForbiddenCalls": ["eval", "exec"],
    "pythonDeprecatedImports": ["imp", "optparse"],
    "rustForbidUnsafe": true,
    "goForbidPanic": false,
    "dartForbidMirrors": true,
    "swiftForbidForceTry": true,
    "kotlinForbidBangBang": true,
    "cppForbidUnsafeC": true,
    "javaForbidRuntimeExec": true
  }
}
```

List fields **union** with built-in defaults unless you opt out:

| Field | Meaning |
| --- | --- |
| `protectedFiles` (no flags) | Union with defaults. User entries are added; defaults stay. |
| `unprotect` | Subtract names from the merged `protectedFiles` list (`["tsconfig.json"]` makes that file writable). |
| `override: true` | Replace default lists entirely with whatever you set (`protectedFiles` becomes only your array). |

`unprotect` is “subtract from defaults”. `override` is “ignore defaults”. Do not combine them unless you want both: replace, then subtract.

```json
{
  "unprotect": ["tsconfig.json"]
}
```

Copy [`governor.config.example.json`](./governor.config.example.json) to get started. `governor.config.cjs` is still accepted as a Node-only overlay.

---

## 📊 Benchmark & Performance

`agent-governor` is built with execution speed as a top priority so it does not slow down your AI workflow:

| Check Type | Runtime | Execution Time |
| --- | --- | --- |
| Config shield | Node dispatcher | < 8ms |
| JS/TS AST | Babel | < 28ms (1000 LOC) |
| Python / Rust / Go / Dart / Swift / Kotlin / Java / C | Node regex SOP | < 5ms |
| Python stdlib `ast` | `python3` | ~50ms (process start dominates; parse is 0.02ms) |

Run `npm run build` to emit zero-walk `dist/*.js` bundles (parser + traverse inlined).

---

## 🧪 CLI

```bash
npx agent-governor init
npx agent-governor hook
npx agent-governor pre-check
npx agent-governor post-check
npx agent-governor session-hook --event SessionStart   # rule re-injection (auto-wired by init)
npx agent-governor doctor                              # self-check: runtime, config, hooks, audit state
npx agent-governor status                              # active policy + local-vs-committed drift
npx agent-governor explain "git reset --hard"          # why would this be blocked?
npx agent-governor explain path/to/tsconfig.json
npx agent-governor report                              # audit digest: blocks, top rules, last intervention
npx agent-governor report --json
npx agent-governor rule list                           # installed rulebooks
npx agent-governor rule add terraform aws              # activate additive policy packs
npx agent-governor version
```

### Install as a Claude Code plugin

No `init` needed — the plugin wires every hook for you:

```bash
# inside Claude Code:
/plugin marketplace add lihenair/agent-governor
/plugin install agent-governor@agent-governor
```

Or keep the npm flow: `npm install -D agent-governor && npx agent-governor init`.

### Preset policy packs

One flag, an opinionated baseline — compose presets or use them standalone:

```bash
npx agent-governor explain --preset security-hard   # preview what gets protected
GOVERNOR_PRESET=security-hard npx agent-governor test --command "npm install --force"
```

| Preset | Adds to the default shield |
| --- | --- |
| `security-hard` | `.env`, `Dockerfile`, `.github/workflows`, `.npmrc`, `npm install --force`, `curl \| sudo sh`, git identity tampering |
| `frontend` | `vite.config.*`, `next.config.*`, `nuxt.config.*`, `svelte.config.*`, `tailwind.config.*`, `webpack.config.*` |
| `python` | `poetry.lock`, `pdm.lock`, `uv.lock`, `tox.ini`, `conda.yaml` |
| `strict` | all of the above + `goForbidPanic`, `requireErrorBoundary` |

Or persist it in `governor.config.json` (file value wins over the env/flag):

```json
{
  "preset": "security-hard"
}
```

### Read-side injection scanning

Every other guardrail watches what the agent **writes**. Agent Governor also watches what it **reads**:

- PostToolUse hooks on `Read` / `WebFetch` / `WebSearch` scan incoming content.
- Detectors: instruction override (`ignore previous instructions`), role hijack, `curl | sh` payloads, env/secret exfiltration, hidden zero-width Unicode smuggling.
- Score ≥ 2 blocks and feeds the reason back to the agent; `injectionMode: "off"` disables it; `injectionPatterns` accepts your own regex detectors.

### Rulebooks: additive policy packs

Beyond built-in presets, install **rulebooks** — community policy packs that can only *add* protection, never subtract (a rulebook cannot touch `unprotect`, `override`, or turn injection scanning off):

```bash
npx agent-governor rule add terraform aws k8s   # activate packs in governor.config.json
npx agent-governor rule list
```

Official packs ship in [`rulebooks/`](./rulebooks): `terraform` (state/lock/manifests + `apply -auto-approve`, `destroy`), `aws` (destructive IAM/EC2/CloudFormation ops), `k8s` (namespace deletion, `helm uninstall`, force apply). Write your own as JSON and drop it in `.agent-governor/rulebooks/`.

### Team policy sharing & drift detection

Commit `governor.config.json`. `governor status` compares the working copy against the committed baseline and flags every local weakening — removed protected files, deleted bash patterns, disabled AST flags, turned-off injection scanning — so policy drift shows up in review, not in production:

```bash
npx agent-governor status   # exit 1 if local policy is weaker than committed
```

Wire it into CI so a PR cannot silently loosen protection:

```yaml
- run: npx agent-governor doctor   # hooks installed? config valid? deny works?
- run: npx agent-governor status   # policy weakened vs committed?
```

---

## 🤝 Contributing

Contributions are very welcome! Please read [CONTRIBUTING.md](./CONTRIBUTING.md) to get started.

1. Fork the Repository
2. Create your Feature Branch (`git checkout -b feat/amazing-rule`)
3. Commit your Changes (`git commit -m 'feat: add new AST rule'`)
4. Push to the Branch (`git push origin feat/amazing-rule`)
5. Open a Pull Request

---

## 📜 License

Distributed under the MIT License. See [LICENSE](./LICENSE) for more information.

<div align="center">
<p>Crafted for high-determinism AI engineering.</p>
<p>If this project saved your codebase from AI entropy, give it a ⭐ Star!</p>
</div>
