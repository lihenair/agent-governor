<div align="center">

# 🛡️ Agent Governor

**Deterministic Runtime Guardrails for Claude Code & AI Coding Agents**

*Stop prompt injection, architecture drift, and configuration tampering with hardware-grade hooks.*

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

* 🛡️ **Zero-Trust Config Shield**: Locks `tsconfig.json`, `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pubspec.yaml`, Gradle/Podfile, `governor.config.json`, and `.claude/` from agent edits.
* ⚡ **Polyglot AST / syntax gates**:
  * **Node.js / TS** — `@babel/parser` (`eval`, `new Function`, custom visitors)
  * **Python** — stdlib `ast` only (zero pip deps, `eval`/`exec`/deprecated imports)
  * **Rust / Go / C++ / Flutter** — sub-15ms shell + regex/`cargo`/`panic` SOP checks
* 🚨 **Deterministic Interception**: Uses native process exit signals (`Exit 2`) to feed exact block reasons back into the agent's context loop.
* 🚀 **Blazing Fast**: Bundled JS engine, zero-dep Python, and a tiny Bash native guard.
* 🧩 **Shared policy file**: All runtimes read the same `governor.config.json`.

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
npx agent-governor init              # auto-detect Node / Python / Rust / Go / Flutter
npx agent-governor init --lang python
npx agent-governor init --lang native
npx agent-governor init --lang all
```

`init` writes a shared `governor.config.json`, copies zero-dep runtimes into `.agent-governor/`, and injects the matching Claude Code hooks.

### Node.js / TypeScript

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

### Python (stdlib `ast`, no pip packages)

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|Bash",
        "hooks": [
          {
            "type": "command",
            "command": "python3 .agent-governor/python/pre_tool_use.py"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "python3 .agent-governor/python/post_tool_use.py"
          }
        ]
      }
    ]
  }
}
```

### Native / Polyglot (Rust, Go, C/C++, Flutter, iOS, Android)

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|Bash",
        "hooks": [
          {
            "type": "command",
            "command": "bash .agent-governor/native/governor_guard.sh"
          }
        ]
      }
    ]
  }
}
```

You can also point Node hooks at the bundled files for slightly faster startup:

```bash
node ./node_modules/agent-governor/dist/pre-tool-use.js
node ./node_modules/agent-governor/dist/post-tool-use.js
```

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
    "goForbidPanic": true
  }
}
```

Copy [`governor.config.example.json`](./governor.config.example.json) to get started. `governor.config.cjs` is still accepted as a Node-only overlay.

---

## 📊 Benchmark & Performance

`agent-governor` is built with execution speed as a top priority so it does not slow down your AI workflow:

| Check Type | Runtime | Execution Time |
| --- | --- | --- |
| Config Shield (PreToolUse) | Node / Python / Bash | < 8–15ms |
| JS/TS AST (PostToolUse) | `@babel/parser` | < 28ms (1000 LOC) |
| Python AST (PostToolUse) | stdlib `ast` | < 10ms |
| Rust `unsafe` / Go `panic` scan | Bash + regex | < 15ms |

Run `npm run build` to emit zero-walk `dist/*.js` bundles (parser + traverse inlined).

---

## 🧪 CLI

```bash
npx agent-governor init --lang auto
npx agent-governor pre-check
npx agent-governor post-check
npx agent-governor version
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
