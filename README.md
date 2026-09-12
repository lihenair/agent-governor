<div align="center">

# 🛡️ Agent Governor

**Deterministic Runtime Guardrails for Claude Code & AI Coding Agents**

*Stop prompt injection, architecture drift, and configuration tampering with hardware-grade hooks.*

[English](./README.md) | [简体中文](./README_ZH.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Claude Code Support](https://img.shields.io/badge/Claude%20Code-v1.0%2B-brightgreen.svg)](#)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/lihenair/agent-governor/pulls)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](#)

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

* 🛡️ **Zero-Trust Config Shield**: Locks `tsconfig.json`, `package.json`, `.eslintrc`, `governor.config.*`, and `.claude/` from agent edits.
* ⚡ **AST-Based Micro-Surgery**: Inspects modified source (`.ts`, `.tsx`, `.js`, `.jsx`) post-execution via `@babel/parser` to catch illegal patterns before the agent continues.
* 🚨 **Deterministic Interception**: Uses native process exit signals (`Exit 2`) to feed exact block reasons back into the agent's context loop.
* 🚀 **Blazing Fast**: Bundled single-file engine (esbuild) designed for sub-50ms hook startup.
* 🧩 **Project-local policy**: Extend rules with `governor.config.cjs` — extra protected files, regex fences, and AST visitors.

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
npx agent-governor init
```

This injects the required Hook bindings:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit|NotebookEdit|Bash",
        "hooks": [
          {
            "type": "command",
            "command": "npx agent-governor pre-check"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit|NotebookEdit",
        "hooks": [
          {
            "type": "command",
            "command": "npx agent-governor post-check"
          }
        ]
      }
    ]
  }
}
```

You can also point hooks at the bundled files for slightly faster startup:

```bash
node ./node_modules/agent-governor/dist/pre-tool-use.js
node ./node_modules/agent-governor/dist/post-tool-use.js
```

---

## ⚙️ Configuration (`governor.config.cjs`)

Create a `governor.config.cjs` (or `.js` / `.mjs` / `.json`) file in your repository root to customize governance rules:

```js
module.exports = {
  // Config files that Agents are NEVER allowed to edit
  protectedFiles: [
    'tsconfig.json',
    'biome.json',
    'package.json',
    'pnpm-lock.yaml',
  ],

  // Dangerous bash commands to block
  forbiddenBashPatterns: [
    /git commit.*--no-verify/i,
    /npm set strict-ssl false/i,
    /rm -rf \.git/i,
  ],

  // Custom AST checks
  astRules: {
    noDirectEval: true,
    noNewFunction: true,
    requireErrorBoundary: true,
    forbiddenCallNames: [],
    forbiddenIdentifiers: [],
  },
};
```

User config is **merged** with built-in defaults (arrays are concatenated, AST flags are overridden).

Copy [`governor.config.example.cjs`](./governor.config.example.cjs) to get started.

---

## 📊 Benchmark & Performance

`agent-governor` is built with execution speed as a top priority so it does not slow down your AI workflow:

| Check Type | Execution Time | Memory Overhead |
| --- | --- | --- |
| Config Shield (PreToolUse) | < 8ms | ~12 MB |
| AST Rule Scan (PostToolUse) | < 28ms (for 1000 LOC) | ~24 MB |

Run `npm run build` to emit zero-walk `dist/*.js` bundles (parser + traverse inlined).

---

## 🧪 CLI

```bash
npx agent-governor init         # wire Claude Code hooks
npx agent-governor pre-check    # stdin JSON → allow / block
npx agent-governor post-check   # stdin JSON → AST scan
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
