<div align="center">

# 🛡️ Agent Governor

**面向 Claude Code、Codex CLI 与 Gemini CLI 的确定性运行时护栏**

*语法树级代码检查、读取侧提示注入扫描、硬件级 Hook——一份配置，守护三个编程 Agent。*

[English](./README.md) | [简体中文](./README_ZH.md)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![CI](https://github.com/lihenair/agent-governor/actions/workflows/ci.yml/badge.svg)](https://github.com/lihenair/agent-governor/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/agent-governor.svg)](https://www.npmjs.com/package/agent-governor)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/lihenair/agent-governor/pulls)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-green.svg)](#)

</div>

<br />

---

## ⚡ 要解决什么问题

AI 编程 Agent 很快，但存在**非确定性与上下文漂移**：

* 🚫 **篡改配置**——遇到编译/lint 错误时去改 `tsconfig.json`、`biome.json`、`.eslintrc`，而不是修真正的 bug。
* 💣 **危险操作**——force push、`--no-verify` 绕过 git hook、删关键文件、往代码里塞 `eval()`、把密钥文件读进上下文。
* 🌀 **架构漂移**——上下文增长（又被压缩掉）之后，项目约定被忘光。
* 📖 **注入指令**——抓来的网页、README、搜索结果里藏着 `ignore previous instructions` / `curl | sh`，Agent 照做。

**散文式提示（`CLAUDE.md`、系统指令）只是软约束。Agent Governor 是确定性的硬拦截：同样的输入，永远同样的决定。**

---

## ✨ 和其他护栏的差异

| 能力 | Agent Governor | 常见护栏 |
| --- | --- | --- |
| Bash 命令分析 | ✅ argv 级解析 + 能力标签 | shell 字符串匹配 |
| 源码检查 | ✅ **真语法树**（Babel / Python `ast` / tree-sitter）| 常为正则或没有 |
| **读取侧注入扫描** | ✅ **Agent 读到什么也检查** | ❌ 只管写入侧 |
| 压缩后规则重注入 | ✅ SessionStart / PreCompact 钩子 | ❌ 规则跟着上下文一起被压掉 |
| 团队策略漂移检测 | ✅ `governor status` 对比提交基线 | ❌ |
| 自审计（脱敏） | ✅ `.agent-governor/audit.log` | 各不相同 |

### 护栏检查项

* 🛡️ **零信任配置盾**——锁定 JS、Python、Rust、Go、Flutter、iOS、Android 生态的工具链清单（`tsconfig.json`、`package.json`、锁文件、`Cargo.toml`、`go.mod`、`pubspec.yaml`、`Podfile`、Gradle、`AndroidManifest.xml` 等）。
* 🧬 **语法树级源码策略**——JS/TS 用 Babel AST；Python 用标准库 `ast`（接得住别名调用、属性调用、计算属性查找，不只是搜 `eval(`）；Rust/Go/Kotlin/Swift/C/C++/Dart 用 tree-sitter 结构检查。字符串和注释在语法树上不是语句，**天然零误报**。
* 💣 **Bash 能力分析**——把命令解析成程序 + argv，打上能力标签（`git.push.force`、`hooks.bypass`、`secret.path.read`、`ci.path.write`），命令包在 `sh -c` 里、写入走 `tee` / `sed -i` / 重定向，一样拦得住。
* 📖 **读取侧注入扫描（业界首创）**——PostToolUse 检查 Agent *读到*的内容：抓取的网页、文件、搜索结果。检测指令覆盖、角色劫持、`curl | sh`、env/密钥外传、零宽字符隐写。加权评分；`injectionPatterns` 支持自定义检测器。
* 🔄 **SessionStart / PreCompact 规则重注入**——上下文被清空或压缩后，governor 重新注入当前生效的规则和 Agent 被拦过的次数。架构漂移死在它出生的地方。
* 🎒 **预设规则包与 Rulebook**——`--preset security-hard|frontend|python|strict` 一键拿到有主见的基线；rulebook 是只加不减的策略包（官方随附 terraform / aws / k8s）。
* 📊 **`governor report`**——审计摘要：总拦截、拦截率、Top 触发规则、最近一次拦截。`--json` 给机器。
* 🩺 **`governor doctor` 与 `governor status`**——自检一切（运行时、配置、Hook、实弹拦截演练），检测本地策略相对提交基线的削弱。都可以接进 CI。
* 🪟 **Windows 可用**——分发器是 Node；Bash / Python 运行时可选。

---

## 🏗️ 工作原理

Agent Governor 挂接各宿主的原生 Hook 运行时（Claude Code 的 `PreToolUse`/`PostToolUse`/`SessionStart`/`PreCompact`；Codex CLI 与 Gemini CLI 的对应事件）。载荷自动识别、归一化，决定按宿主原生协议输出。

```
┌─────────────────┐      Tool Request       ┌──────────────────────────┐
│                 │ ── (Edit/Write/Bash) ─► │  Agent Governor          │
│  Coding Agent   │                         │                          │
│ (CC/Codex/      │ ◄── block + reason ──── │  1. 配置盾               │
│  Gemini)        │                         │  2. Bash 能力分析        │
│                 │ ── (Read/WebFetch) ───► │  3. 语法树源码策略       │
│                 │      注入扫描           │  4. 注入扫描器           │
└─────────────────┘                         └────────────┬─────────────┘
                                                         │
                                              audit.log（脱敏+哈希）
```

宿主支持与协议细节：[docs/hosts.md](./docs/hosts.md)。

| 宿主 | 事件 | 决定通道 |
| --- | --- | --- |
| **Claude Code** | PreToolUse, PostToolUse, SessionStart, PreCompact | exit `2` + stderr 原因 |
| **OpenAI Codex CLI** | PreToolUse, PostToolUse, SessionStart, PreCompact | stdout JSON `decision: "block"` + `permissionDecision` |
| **Google Gemini CLI** | BeforeTool, AfterTool, SessionStart, PreCompress | stdout JSON `{ decision: "deny" }` |

内部错误 fail-open（governor 崩了不能卡死 Agent 循环），策略违规 fail-closed。诚实边界：护栏拦的是*意外事故*，不是蓄意对抗——对抗场景请叠加 OS 级沙箱（见 [SECURITY.md](./SECURITY.md)）。

---

## 📦 快速开始

**方式 A——Claude Code 插件（零配置）：**

```bash
# 在 Claude Code 里：
/plugin marketplace add lihenair/agent-governor
/plugin install agent-governor@agent-governor
```

**方式 B——npm：**

```bash
npm install -D agent-governor
npx agent-governor init
```

`init` 会写入每个事件一条的分发 Hook（覆盖 JS/TS、Python、Rust、Go、Dart、Swift、Kotlin、Java、C/C++），外加读取扫描与会话重注入 Hook，生成 `governor.config.json`，并给 Cursor 写 `.cursor/rules/agent-governor.mdc` 软适配。生成的 Claude Code Hook：

```json
{
  "hooks": {
    "PreToolUse": [
      { "matcher": "Edit|Write|MultiEdit|NotebookEdit|Bash", "hooks": [{ "type": "command", "command": "npx agent-governor pre-check" }] }
    ],
    "PostToolUse": [
      { "matcher": "Edit|Write|MultiEdit|NotebookEdit", "hooks": [{ "type": "command", "command": "npx agent-governor post-check" }] },
      { "matcher": "Read|WebFetch|WebSearch", "hooks": [{ "type": "command", "command": "npx agent-governor post-check" }] }
    ],
    "SessionStart": [
      { "hooks": [{ "type": "command", "command": "npx agent-governor session-hook --event SessionStart" }] }
    ],
    "PreCompact": [
      { "hooks": [{ "type": "command", "command": "npx agent-governor session-hook --event PreCompact" }] }
    ]
  }
}
```

**3. 验证拦截真的生效：**

```bash
npx agent-governor test --command "git push --force origin main"
# → decision: deny  (ruleId: git.push.force)

npx agent-governor doctor
# → all checks passed（运行时、配置、Hook、审计、实弹拦截演练）
```

**Codex CLI / Gemini CLI 配置：** 见 [docs/hosts.md](./docs/hosts.md)——适配器 Hook 配置随 npm 包分发（`adapters/` 目录）。

---

## 🧪 CLI

```bash
npx agent-governor init [--lang auto|all|node|python|native] [--preset <name>]
npx agent-governor hook                  # 自动 Pre/Post 分发（读 hook_event_name）
npx agent-governor pre-check             # PreToolUse 护栏（stdin JSON）
npx agent-governor post-check            # PostToolUse 源码 + 注入护栏（stdin JSON）
npx agent-governor session-hook --event SessionStart|PreCompact
npx agent-governor test --command "git push --force" [--json]
npx agent-governor test --file tsconfig.json [--operation modify|write] [--json]
npx agent-governor explain "git reset --hard"   # 这条命令会怎样、为什么
npx agent-governor explain path/to/tsconfig.json
npx agent-governor explain --config governor.config.json   # 输出编译后的规则
npx agent-governor doctor                # 自检（失败 exit 1）
npx agent-governor status                # 当前策略 + 与提交基线的漂移（漂移 exit 1）
npx agent-governor report [--json]       # 审计摘要
npx agent-governor rule list | rule add <name...>   # 叠加式规则包
npx agent-governor version
```

### 预设规则包

```bash
npx agent-governor explain --preset security-hard   # 预览会多保护哪些文件
```

| 预设 | 在默认盾之上新增 |
| --- | --- |
| `security-hard` | `.env`、`Dockerfile`、`.github/workflows`、`.npmrc`、`npm install --force`、`curl \| sudo sh`、改 git 身份 |
| `frontend` | `vite.config.*`、`next.config.*`、`nuxt.config.*`、`svelte.config.*`、`tailwind.config.*`、`webpack.config.*` |
| `python` | `poetry.lock`、`pdm.lock`、`uv.lock`、`tox.ini`、`conda.yaml` |
| `strict` | 以上全部 + `goForbidPanic`、`requireErrorBoundary` |

写进 `governor.config.json` 持久化（`"preset": "security-hard"`，文件里的值优先于环境变量/旗标）。

---

## ⚙️ 配置（`governor.config.json`）

```json
{
  "preset": "security-hard",
  "engine": "ast-grep",
  "protectedFiles": ["tsconfig.json", "package.json", "my.config.json"],
  "protectedDirectories": [".claude/", ".agent-governor/"],
  "forbiddenBashPatterns": ["terraform\\s+destroy"],
  "unprotect": ["tsconfig.json"],
  "injectionMode": "scan",
  "injectionPatterns": [
    { "id": "custom.publish-bait", "weight": 3, "pattern": "run\\s+npm\\s+publish" }
  ],
  "astRules": {
    "noDirectEval": true,
    "noNewFunction": true,
    "pythonForbiddenCalls": ["eval", "exec"],
    "rustForbidUnsafe": true,
    "goForbidPanic": false,
    "swiftForbidForceTry": true,
    "kotlinForbidBangBang": true,
    "cppForbidUnsafeC": true,
    "javaForbidRuntimeExec": true
  }
}
```

### 源码检查引擎

| 引擎 | 语言 | 说明 |
| --- | --- | --- |
| **Babel AST**（默认） | JS/TS | 结构化识别 `eval` / `new Function` / 自定义禁用调用 |
| **Python 标准库 `ast`**（默认） | Python | 别名、属性与计算属性查找；语法错误片段降级正则兜底 |
| **tree-sitter via ast-grep**（可选） | Rust, Go, Kotlin, Swift, C, C++, Dart | 字符串/注释结构性免疫误报；需要 `@ast-grep/lang-*` 包（随包 optionalDependencies，预编译） |
| **正则 SOP**（默认兜底） | 以上全部 | 零依赖启发式；非代码文本有少量误报风险 |

`"engine": "ast-grep"` 即可启用；语言包缺失时该语言自动降级回正则 SOP。

### 字段语义

| 字段 | 含义 |
| --- | --- |
| `protectedFiles`（无旗标） | 与默认并集——你的条目加进去，默认保留 |
| `unprotect` | 从合并后的名单里减去（`["tsconfig.json"]` 让它可写） |
| `override: true` | 完全用你的列表替换默认 |
| `injectionMode` | `"scan"`（默认）或 `"off"` |
| `injectionPatterns` | 自定义注入检测器：`[{ id, weight, pattern }]` |
| `preset` | `security-hard` / `frontend` / `python` / `strict`（优先于 env/旗标） |
| `rulebooks` | 叠加式规则包名，如 `["terraform", "aws"]` |
| `failureMode` | `open`（默认）/ `closed` |

从 [`governor.config.example.json`](./governor.config.example.json) 起步。`governor.config.cjs/.js/.mjs` 覆盖层也支持。

---

## 📊 性能

| 检查类型 | 运行时 | 耗时 |
| --- | --- | --- |
| 配置盾（PreToolUse） | Node 分发器 | < 8ms |
| JS/TS AST | Babel | < 28ms（1000 行） |
| Python 标准库 `ast` | `python3` | ~50ms（进程启动为主；解析仅 0.02ms） |
| Rust/Go/Kotlin/Swift/C/C++/Dart | ast-grep（tree-sitter） | < 7ms（500 行） |
| 正则 SOP（兜底） | Node | < 5ms |

`npm run build` 产出 `dist/*.js` 打包。

---

## 🤝 贡献

欢迎贡献，请先阅读 [CONTRIBUTING.md](./CONTRIBUTING.md)。

1. Fork 仓库
2. 建特性分支（`git checkout -b feat/amazing-rule`）
3. 提交改动
4. 推送并开 Pull Request

安全问题请走 [GitHub Security Advisories](https://github.com/lihenair/agent-governor/security/advisories/new)，不要开公开 issue。威胁模型见 [SECURITY.md](./SECURITY.md)。

---

## 📜 许可证

MIT，详见 [LICENSE](./LICENSE)。

<div align="center">
<p>为高确定性的 AI 工程而造。</p>
<p>如果它从 AI 熵增里救过你的代码库，请给一个 ⭐ Star。</p>
</div>
