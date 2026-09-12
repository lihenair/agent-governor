<div align="center">

# 🛡️ Agent Governor

**面向 Claude Code 与 AI 编程 Agent 的确定性运行时护栏**

*用硬件级 Hook 拦截提示注入、架构漂移与配置篡改。*

[English](./README.md) | [简体中文](./README_ZH.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Claude Code Support](https://img.shields.io/badge/Claude%20Code-v1.0%2B-brightgreen.svg)](#)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/lihenair/agent-governor/pulls)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](#)

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

* 🛡️ **零信任配置盾**：锁定 `tsconfig.json`、`package.json`、`.eslintrc`、`governor.config.*` 以及 `.claude/`。
* ⚡ **AST 显微手术**：用 `@babel/parser` 在 Write/Edit 之后扫描 `.ts` / `.tsx` / `.js` / `.jsx`，在 Agent 继续之前抓住非法模式。
* 🚨 **确定性拦截**：用进程退出码 `2` 把阻断原因写回 Agent 上下文。
* 🚀 **启动快**：esbuild 打成单文件，目标是 Hook 启动 < 50ms。
* 🧩 **项目级策略**：用 `governor.config.cjs` 追加保护文件、正则防线和 AST 规则。

---

## 📦 快速开始

```bash
npm install -D agent-governor
npx agent-governor init
```

`init` 会向 `.claude/settings.json` 注入：

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

追求极致启动速度时，可直接指向打包文件：

```bash
node ./node_modules/agent-governor/dist/pre-tool-use.js
node ./node_modules/agent-governor/dist/post-tool-use.js
```

---

## ⚙️ 配置

仓库根目录放置 `governor.config.cjs`（也支持 `.js` / `.mjs` / `.json`）：

```js
module.exports = {
  protectedFiles: [
    'tsconfig.json',
    'biome.json',
    'package.json',
    'pnpm-lock.yaml',
  ],
  forbiddenBashPatterns: [
    /git commit.*--no-verify/i,
    /npm set strict-ssl false/i,
    /rm -rf \.git/i,
  ],
  astRules: {
    noDirectEval: true,
    noNewFunction: true,
    requireErrorBoundary: true,
  },
};
```

用户配置与内置默认规则 **合并**（数组拼接，AST 开关覆盖）。可复制 [`governor.config.example.cjs`](./governor.config.example.cjs)。

---

## 📊 性能

| 检查类型 | 耗时 | 内存 |
| --- | --- | --- |
| 配置盾（PreToolUse） | < 8ms | ~12 MB |
| AST 扫描（PostToolUse） | < 28ms（约 1000 LOC） | ~24 MB |

`npm run build` 会生成内联 parser 的 `dist/*.js` 单文件。

---

## 🧪 CLI

```bash
npx agent-governor init
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
