<div align="center">

# 🛡️ Agent Governor

**面向 Claude Code 与 AI 编程 Agent 的确定性运行时护栏**

*用硬件级 Hook 拦截提示注入、架构漂移与配置篡改。*

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
  <p><em>左：无护栏时 Agent 直接改 tsconfig.json 绕过类型错误。<br/>右：Agent Governor 的 PreToolUse Hook 拦截写入，并迫使 Agent 修复源码。</em></p>
</div>

---

## ⚡ 要解决什么问题

现代 AI Agent（Claude Code、Cursor、OpenCode）很快，但存在 **非确定性与上下文漂移**：

* 🚫 **篡改配置**：遇到编译/ lint 错误时，Agent 常常去改 `tsconfig.json`、`biome.json`、`.eslintrc`，而不是修真正的 bug。
* 🌀 **架构漂移**：对话一长，项目约定被忘掉，Brownfield 代码里的设计模式被拆掉。
* 💣 **危险 Bash**：卡住时可能 force push、`--no-verify` 绕过 git hook，或删除关键文件。

**散文式提示（`CLAUDE.md`、系统指令）只是软约束。`agent-governor` 提供零方差、确定性的硬拦截。**

---

## 🏗️ 工作原理

`agent-governor` 挂接 Claude Code 原生 Hook 运行时（`PreToolUse`、`PostToolUse`）。通过 **Exit Code 2** 反馈环阻断不安全操作，并把 AST/安全错误精确写回 LLM 上下文。

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

### Hook 协议

| 结果 | 退出码 | 通道 | 效果 |
| --- | --- | --- | --- |
| 放行 | `0` | stdout（可选） | 工具调用继续 |
| 阻断 | `2` | stderr | Claude Code 把原因喂给 Agent 并强制重试 |
| 内部错误 | `0` | stderr | 失败开放，避免治理进程把 Agent 卡死 |

Claude Code 通过 stdin 以 JSON 传入事件（`tool_name`、`tool_input`、`cwd` 等）。

---

## ✨ 特性

* 🛡️ **零信任配置盾**：锁定 `tsconfig.json`、`package.json`、`pyproject.toml`、`Cargo.toml`、`go.mod`、`pubspec.yaml`、Gradle/Podfile、`governor.config.json` 以及 `.claude/`。
* ⚡ **多语言 AST / 语法门禁**：
  * **Node.js / TS** — `@babel/parser`
  * **Python** — 仅标准库 `ast`（零 pip 依赖，拦截 `eval`/`exec`/废弃导入）
  * **Rust / Go / C++ / Flutter** — 小于 15ms 的 Shell 规则（禁止 `unsafe` / 裸 `panic()`）
* 🚨 **确定性拦截**：用进程退出码 `2` 把阻断原因写回 Agent 上下文。
* 🚀 **启动快**：打包后的 JS 引擎、零依赖 Python、以及轻量 Bash Native 门禁。
* 🧩 **共享策略文件**：所有运行时读取同一份 `governor.config.json`。

---

## 📦 快速开始

```bash
npm install -D agent-governor
npx agent-governor init              # 自动识别 Node / Python / Rust / Go / Flutter
npx agent-governor init --lang python
npx agent-governor init --lang native
npx agent-governor init --lang all
```

`init` 会写入共享的 `governor.config.json`，把零依赖运行时复制到 `.agent-governor/`，并注入对应 Hook。

### Node.js / TypeScript

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|MultiEdit|NotebookEdit|Bash",
        "hooks": [{ "type": "command", "command": "npx agent-governor pre-check" }]
      }
    ]
  }
}
```

### Python（仅标准库 `ast`，无需 pip 包）

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|Bash",
        "hooks": [{ "type": "command", "command": "python3 .agent-governor/python/pre_tool_use.py" }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [{ "type": "command", "command": "python3 .agent-governor/python/post_tool_use.py" }]
      }
    ]
  }
}
```

### Native / 多语言（Rust、Go、C/C++、Flutter、iOS、Android）

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write|Bash",
        "hooks": [{ "type": "command", "command": "bash .agent-governor/native/governor_guard.sh" }]
      }
    ]
  }
}
```

---

## ⚙️ 配置

所有运行时共享仓库根目录的 `governor.config.json`：

```json
{
  "protectedFiles": [
    "tsconfig.json",
    "package.json",
    "pyproject.toml",
    "Cargo.toml",
    "go.mod",
    "pubspec.yaml"
  ],
  "protectedDirectories": [".claude/", ".agent-governor/"],
  "forbiddenBashPatterns": [
    "git commit.*--no-verify",
    "pip install --insecure",
    "cargo publish --no-verify"
  ]
}
```

可复制 [`governor.config.example.json`](./governor.config.example.json)。

---

## 📊 性能

| 检查类型 | 运行时 | 耗时 |
| --- | --- | --- |
| 配置盾（PreToolUse） | Node / Python / Bash | < 8–15ms |
| JS/TS AST | `@babel/parser` | < 28ms（约 1000 LOC） |
| Python AST | 标准库 `ast` | < 10ms |
| Rust `unsafe` / Go `panic` | Bash + 正则 | < 15ms |

---

## 🧪 CLI

```bash
npx agent-governor init --lang auto
npx agent-governor pre-check
npx agent-governor post-check
npx agent-governor version
```

---

## 🤝 贡献

欢迎贡献，请先阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 📜 许可证

MIT，详见 [LICENSE](./LICENSE)。

<div align="center">
<p>为高确定性的 AI 工程而造。</p>
<p>如果它从 AI 熵增里救过你的代码库，请给一个 ⭐ Star。</p>
</div>
