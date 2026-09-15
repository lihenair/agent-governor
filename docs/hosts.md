# Multi-host support

Agent Governor's policy engine is host-agnostic. The npm package ships adapters
that translate each host's hook protocol into one shared evaluation pipeline,
so the same `governor.config.json` protects every coding agent you use.

## Supported hosts

| Host | Hook events used | Setup |
| --- | --- | --- |
| **Claude Code** | PreToolUse, PostToolUse, SessionStart, PreCompact | `npx agent-governor init` or the Claude Code plugin |
| **OpenAI Codex CLI** | PreToolUse, PostToolUse, SessionStart, PreCompact | see below |
| **Google Gemini CLI** | BeforeTool, AfterTool, SessionStart, PreCompress | see below |

## How it works

The `pre-check` / `post-check` / `session-hook` commands auto-detect which host
is calling (from the payload shape) and normalize it before policy evaluation:

- Gemini's `BeforeTool` → `PreToolUse`, `AfterTool` → `PostToolUse`, `PreCompress` → `PreCompact`
- Codex payloads (`tool_use_id` / `permission_mode` present) normalize 1:1
- Shell tools named `shell` (Codex) or `run_shell_command` (Gemini) are treated
  as `Bash` by the capability analyzer

Decisions are emitted in each host's native contract:

- Claude Code: exit `2` + stderr reason (fail-closed feedback loop)
- Codex CLI: stdout JSON `{ decision: "block", hookSpecificOutput: { permissionDecision: "deny", permissionDecisionReason } }`
- Gemini CLI: stdout JSON `{ decision: "deny", reason }`

## Codex CLI setup

Codex loads hooks from `hooks.json` (via a plugin) or inline in `config.toml`.

1. Copy the packaged snippet:

```bash
cp node_modules/agent-governor/adapters/codex-hooks.json ~/.codex/hooks.json
```

2. Or inline it in `~/.codex/config.toml` under `[hooks]` (same event keys:
   `PreToolUse`, `PostToolUse`, `SessionStart`, `PreCompact`, each an array of
   `{ matcher, hooks: [{ type = "command", command = "..." }] }`).

## Gemini CLI setup

Gemini reads hooks from `settings.json` (`~/.gemini/settings.json` or
`.gemini/settings.json` in the repo):

```bash
# merge the hooks key into your settings.json
npx -y json -I -f ~/.gemini/settings.json \
  -e 'this.hooks=require("agent-governor/adapters/gemini-settings-hooks.json").hooks'
```

Or copy the `hooks` object from
`node_modules/agent-governor/adapters/gemini-settings-hooks.json` manually.

## Verifying

Run `npx agent-governor doctor` inside any project — it dry-runs a deny and
reports whether hooks are reachable. Then try a live check through each host
and confirm the block surfaces in that host's UI.
