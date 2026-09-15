---
description: Set up Agent Governor for the current project: verify the hook runtime, generate a starter governor.config.json, run a doctor check, and demo a live block.
---

# Agent Governor Setup

Set up Agent Governor for the current project. Your goal is to:

1. Verify the runtime works
2. Generate a starter config if none exists
3. Run the doctor self-check
4. Prove enforcement works with a live dry-run

## Steps

### 1. Verify runtime

Run:

```bash
npx agent-governor version
```

If this fails, tell the user to install Node.js 18+.

### 2. Generate starter config

If `governor.config.json` does not exist in the project root, create it:

```bash
npx agent-governor init
```

If it exists, leave it alone and note that the user's config is preserved.

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
