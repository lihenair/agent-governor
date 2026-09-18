# Multi-host support

Agent Governor's policy engine is host-agnostic. The npm package ships adapters
that translate each host's hook protocol into one shared evaluation pipeline,
so the same `governor.config.json` protects every coding agent you use.

## Supported hosts (6, all with hard enforcement)

| Host | Hook events used | Decision channel | Setup |
| --- | --- | --- | --- |
| **Claude Code** | PreToolUse, PostToolUse, SessionStart, PreCompact | exit `2` + stderr | `npx agent-governor init` or the Claude Code plugin |
| **OpenAI Codex CLI** | PreToolUse, PostToolUse, SessionStart, PreCompact | stdout JSON `decision` | see below |
| **Google Gemini CLI** | BeforeTool, AfterTool, SessionStart, PreCompress | stdout JSON `decision` | see below |
| **Cursor** | beforeShellExecution, beforeEditFile, beforeReadFile, beforeMCPExecution, afterFileEdit, afterShellExecution | stdout JSON `permission` | see below |
| **Windsurf (Cascade)** | pre_run_command, pre_write_code, pre_read_code, pre_mcp_tool_use, post_run_command, post_write_code, post_read_code | exit `2` + stderr | see below |
| **OpenCode** | tool.execute.before, tool.execute.after (plugin) | plugin throws → surfaced to model | see below |

## How it works

Every guard entry point (`pre-check` / `post-check` / `hook` / `session-hook`)
auto-detects which host is calling from the payload shape and normalizes it
before policy evaluation:

- **Cursor** `beforeShellExecution` → `PreToolUse` (tool: Bash),
  `beforeEditFile` → `PreToolUse` (tool: Edit), `beforeReadFile` → `PreToolUse`
  (tool: Read)
- **Windsurf** `pre_run_command` → `PreToolUse` (tool: Bash, from
  `tool_info.command_line`), `pre_write_code` → `PreToolUse` (tool: Write,
  content seeded from `tool_info.edits`), `pre_read_code` → `PreToolUse`
- **Gemini** `BeforeTool` → `PreToolUse`, `AfterTool` → `PostToolUse`,
  `PreCompress` → `PreCompact`
- **Codex** payloads (`tool_use_id` / `permission_mode` present) normalize 1:1
- Shell tools named `shell` (Codex) or `run_shell_command` (Gemini) are treated
  as `Bash` by the capability analyzer

Decisions are emitted in each host's native contract:

- **Claude Code**: exit `2` + stderr reason (fail-closed feedback loop)
- **Codex CLI**: stdout JSON `{ decision: "block", hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason } }`
- **Gemini CLI**: stdout JSON `{ decision: "deny", reason }`
- **Cursor**: stdout JSON `{ permission: "deny", agentMessage }` (exit `0`)
- **Windsurf**: exit `2` + stderr reason (no JSON response contract)
- **OpenCode**: the plugin shim exits non-zero and the plugin re-throws the
  reason, which OpenCode surfaces to the model

`npx agent-governor init` prints a detection table and wires **only hosts you
select**. There is no default host (including Claude Code).

- Interactive TTY: pick comma-separated ids, `all` (detected/present only), or empty.
- Non-interactive: pass `--hosts claude-code,cursor` (or `--hosts all`).
  `--yes` alone does not wire anything.
- `--dry-run` prints the plan without writing.

Manual adapter copies below remain valid if you prefer to edit files yourself.

## Claude Code

```bash
npx agent-governor init
# or the plugin:
/plugin marketplace add lihenair/agent-governor
/plugin install agent-governor@agent-governor
```

## OpenAI Codex CLI

Codex loads hooks from `hooks.json` (via a plugin) or inline in `config.toml`.

1. Copy the packaged snippet:

```bash
cp node_modules/agent-governor/adapters/codex-hooks.json ~/.codex/hooks.json
```

2. Or inline it in `~/.codex/config.toml` under `[hooks]` (same event keys:
   `PreToolUse`, `PostToolUse`, `SessionStart`, `PreCompact`, each an array of
   `{ matcher, hooks: [{ type = "command", command = "..." }] }`).

## Google Gemini CLI

Gemini reads hooks from `settings.json` (`~/.gemini/settings.json` or
`.gemini/settings.json` in the repo):

```bash
# merge the hooks key into your settings.json
npx -y json -I -f ~/.gemini/settings.json \
  -e 'this.hooks=require("agent-governor/adapters/gemini-settings-hooks.json").hooks'
```

Or copy the `hooks` object from
`node_modules/agent-governor/adapters/gemini-settings-hooks.json` manually.

## Cursor

Cursor reads project hooks from `.cursor/hooks.json`:

```bash
mkdir -p .cursor
cp node_modules/agent-governor/adapters/cursor-hooks.json .cursor/hooks.json
```

The adapter wires:

- `beforeShellExecution` → pre-check (blocks dangerous commands)
- `beforeEditFile` → pre-check (blocks config tampering)
- `beforeReadFile` → post-check (read-side injection scanning)
- `beforeMCPExecution` → pre-check
- `afterFileEdit` / `afterShellExecution` → post-check (source policy + audit)

Enable the hooks in Cursor settings if prompted (Cursor → Settings → Hooks).
Denied operations appear to the agent as `permission: "deny"` with the
governor's reason, so the model self-corrects.

## Windsurf (Cascade)

Windsurf reads hooks from `.windsurf/hooks.json` (workspace),
`~/.codeium/windsurf/hooks.json` (user), or the system-level path:

```bash
mkdir -p .windsurf
cp node_modules/agent-governor/adapters/windsurf-hooks.json .windsurf/hooks.json
```

The adapter wires `pre_run_command`, `pre_write_code`, `pre_read_code`, and
`post_run_command` / `post_write_code`. Windsurf's contract is exit-code
based: `2` blocks the action and the stderr reason is shown to the agent.

## OpenCode

OpenCode plugins are TypeScript modules. Copy the governor plugin:

```bash
mkdir -p .opencode/plugins
cp node_modules/agent-governor/adapters/opencode-plugin.js .opencode/plugins/agent-governor.js
```

The plugin forwards `tool.execute.before` payloads to the governor core and
**blocks by throwing**, so OpenCode surfaces the reason to the model.
`tool.execute.after` runs the read-side injection scan on fetched/read
content and appends warnings to the tool output.

## Verifying

Run `npx agent-governor doctor` inside any project — it dry-runs a deny and
reports whether hooks are reachable. Then try a live check through each host:

```bash
npx agent-governor test --command "git push --force origin main" --json
# → decision: deny (ruleId: git.push.force)
```

and confirm the block surfaces in that host's UI.
