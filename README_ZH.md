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

* 🛡️ **零信任配置盾**：覆盖 JS / Python / Rust / Go / Flutter / iOS / Android 的清单文件。
* ⚡ **单一调度器**：默认只挂一条 Pre + 一条 Post Hook，按文件扩展名分发检查。
* 🧠 **`astRules` 真正生效**：JSON 里的开关会驱动拦截，而不是写着好看。
* 📖 **读取侧注入扫描（业界首创）**：PostToolUse 检查 agent *读到*的内容——抓取的网页、文件、搜索结果——在它照做之前拦下「ignore previous instructions」「curl \| sh」、密钥外传等 payload。别家只管写入侧，没人管输入侧。
* 🔄 **SessionStart / PreCompact 规则重注入**：上下文压缩后治理提示自动重建——agent 恰好在记忆被清空的时刻也没法「忘记」护栏。
* 🎒 **预设规则包**：`--preset security-hard\|frontend\|python\|strict`，一个旗标拿到有主见的基线（`.env`、Dockerfile、CI workflow、锁文件、打包器配置）。
* 📊 **`governor report`**：把审计日志聚合成摘要——总拦截数、Top 触发规则、最近一次拦截。贴 README、开复盘会都好用。
* 🪟 **默认 Windows 可用**：主路径是 Node；Bash / Python 运行时是可选的。
* 📎 **Cursor 软适配**：`init` 会写入 `.cursor/rules/agent-governor.mdc`（Cursor 没有 PreToolUse）。

### 语言覆盖

| 语言 | 配置盾 | 源码策略 | 引擎 |
| --- | --- | --- | --- |
| JS / TS | `package.json`、`tsconfig.json` | `eval` / `new Function()` | Babel AST |
| Python | `pyproject.toml` 等 | `eval`/`exec`、废弃导入 | Node 快路径；`--lang python` 用标准库 `ast` |
| Rust | `Cargo.toml` | `unsafe {`（默认开） | 正则 |
| Go | `go.mod` | `panic(`（**默认关**） | 正则 |
| Dart / Flutter | `pubspec.yaml` | `dart:mirrors` | 正则 |
| Swift / iOS | `Podfile`、`Package.swift` | `try!` / `as!` | 正则 |
| Kotlin / Android | Gradle / Manifest | `!!` / `TODO()` | 正则 |
| Java | Gradle | `Runtime.exec()` | 正则 |
| C / C++ | CMake / Makefile | `gets()` / `system()` | 正则 |

### IDE

| 工具 | 强制力 | `init` 做什么 |
| --- | --- | --- |
| Claude Code | 硬拦截，exit 2 | 写 dispatcher Hook |
| Cursor | 软约束 | 写 `.cursor/rules/agent-governor.mdc` |
| OpenCode | 无内置 Hook | 自行把 JSON 管道接到 `npx agent-governor hook` |

---

## 📦 快速开始

```bash
npm install -D agent-governor
npx agent-governor init                 # 一条 dispatcher，覆盖全部语言
npx agent-governor init --lang python   # 可选：只用标准库 ast
```

默认 Hook：

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

也可以只用 `npx agent-governor hook`（读取 `hook_event_name`）。

`--lang python` 仍安装零依赖的 `python3 .agent-governor/python/*.py`。`native/governor_guard.sh` 目前仍调用 `python3`；若 PATH 中没有 python3，native hook **fail-closed**（stderr 报错并 exit 2），不再静默放行。决策见 [ADR 0001](./docs/adr/0001-native-runtime.md)。

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

默认是**并集**：你写的 `protectedFiles` 会加到内置名单上，不能靠省略来拿掉 `tsconfig.json`。

| 字段 | 语义 |
| --- | --- |
| `protectedFiles`（无开关） | 与默认并集 |
| `unprotect` | 从合并后的名单里减去，例如 `["tsconfig.json"]` 之后该文件可写 |
| `override: true` | 完全替换默认名单，只用你提供的数组 |

`unprotect` 是只减不增；`override` 是丢掉默认。

```json
{
  "unprotect": ["tsconfig.json"]
}
```

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
npx agent-governor init
npx agent-governor hook
npx agent-governor pre-check
npx agent-governor post-check
npx agent-governor session-hook --event SessionStart   # 规则重注入（init 自动接线）
npx agent-governor report                              # 审计摘要：拦截数、Top 规则、最近一次拦截
npx agent-governor report --json
npx agent-governor version
```

### 预设规则包

一个旗标拿到有主见的基线，可组合、可独立用：

```bash
npx agent-governor explain --preset security-hard   # 预览会多保护哪些文件
GOVERNOR_PRESET=security-hard npx agent-governor test --command "npm install --force"
```

| 预设 | 在默认盾之上新增 |
| --- | --- |
| `security-hard` | `.env`、`Dockerfile`、`.github/workflows`、`.npmrc`、`npm install --force`、`curl \| sudo sh`、改 git 身份 |
| `frontend` | `vite.config.*`、`next.config.*`、`nuxt.config.*`、`svelte.config.*`、`tailwind.config.*`、`webpack.config.*` |
| `python` | `poetry.lock`、`pdm.lock`、`uv.lock`、`tox.ini`、`conda.yaml` |
| `strict` | 以上全部 + `goForbidPanic`、`requireErrorBoundary` |

也可以写进 `governor.config.json`（文件里的值优先于环境变量 / 旗标）：

```json
{
  "preset": "security-hard"
}
```

### 读取侧注入扫描

别家护栏只看 agent **写**什么。Agent Governor 还看它**读**什么：

- PostToolUse 挂在 `Read` / `WebFetch` / `WebSearch` 上，扫描进入上下文的内容。
- 检测器：指令覆盖（`ignore previous instructions`）、角色劫持、`curl \| sh` payload、env / 密钥外传、零宽字符隐写。
- 评分 ≥ 2 拦截并把原因回传给 agent；`injectionMode: "off"` 关闭；`injectionPatterns` 支持自定义正则检测器。

### 会话 / 压缩重注入

`init` 自动接好 `SessionStart` 和 `PreCompact` Hook。上下文被清空或压缩后，governor 会重新注入一段简短提醒：哪些规则在生效、agent 被拦过几次、护栏不能从会话内部关闭。架构漂移死在它出生的那一刻。

---

## 🤝 贡献

欢迎贡献，请先阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 📜 许可证

MIT，详见 [LICENSE](./LICENSE)。

<div align="center">
<p>为高确定性的 AI 工程而造。</p>
<p>如果它从 AI 熵增里救过你的代码库，请给一个 ⭐ Star。</p>
</div>
