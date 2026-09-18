---
description: Set up Agent Governor for the current project: verify the hook runtime, generate a starter governor.config.json, run a doctor check, and demo a live block.
---

# Agent Governor Setup

Set up Agent Governor for the current project. Your goal is to:

1. Verify the runtime works
2. Generate a starter config and wire hosts the user actually uses
3. Run the doctor self-check
4. Prove enforcement works with a live dry-run

## Steps

### 1. Verify runtime

Run:

```bash
npx agent-governor version
```

If this fails, tell the user to install Node.js 18+.

### 2. Generate starter config and pick hosts

Ask which coding agents this project should protect (`claude-code`, `cursor`, `codex`, `gemini-cli`, `windsurf`, `opencode`). Then run `init` with those hosts so hooks are not guessed:

```bash
npx agent-governor init --hosts claude-code,cursor
```

If `governor.config.json` already exists, `init` will leave it alone and only merge hooks for the selected hosts.

`npx agent-governor init` with no `--hosts` is interactive in a TTY (prints a detection table, then asks). In CI it writes policy only unless `--hosts` is passed.

### 3. Ask about presets

Ask the user (unless already known):

> Which policy pack do you want? `security-hard` (recommended for OSS/production), `frontend`, `python`, `strict`, or `default`?

If they choose one, wire it by adding `"preset": "<name>"` to `governor.config.json` (or setting `GOVERNOR_PRESET` in their shell profile).

### 4. Doctor check

Run:

```bash
npx agent-governor doctor
```

Report every failing check to the user with the suggested fix from the doctor output.

### 5. Live demo

Run two dry-runs to show enforcement works:

```bash
npx agent-governor test --command "git push --force origin main"
npx agent-governor test --file tsconfig.json --operation modify
```

Both should show `decision: deny`. If they do not, run `npx agent-governor doctor` again and investigate.

## Report

Summarize: version, config in place, preset chosen, doctor results, and demo outcome. Remind the user that `governor report` shows the running block statistics any time.
