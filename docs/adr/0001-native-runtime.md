# ADR 0001: Native hook runtime (python3)

- Status: Accepted
- Date: 2026-09-12
- Task: T0.1
- Deciders: agent-governor maintainers

## Context

`native/governor_guard.sh` is the optional Bash fallback for Claude Code hooks
(`--lang native` / polyglot init). It currently shells out to `python3` for JSON
and policy work. If `python3` is missing, those calls were wrapped in `|| true`
and empty parse output exited `0` — the hook **silently allowed every tool call**.

That contradicts the native path's job: fail closed when it cannot evaluate policy.

### python3 call sites (as of v0.2.0)

| Location | Invocation | Purpose |
| --- | --- | --- |
| `native/governor_guard.sh` L6 | `command -v python3` | Fail-closed gate (this ADR) |
| `native/governor_guard.sh` L19 | `python3 -c '…'` stdin JSON | Parse hook payload → `EVENT`, `TOOL_NAME`, `FILE_PATH`, `COMMAND`, `SNIPPET_B64` |
| `native/governor_guard.sh` L66 | `python3 -c 'import base64…'` | Decode `SNIPPET_B64` for Write/Edit body inspection |
| `native/governor_guard.sh` L81 | `python3 - <<'PY'` | Read `governor.config.json` `protectedFiles` extras |
| `native/governor_guard.sh` L121 | `python3 - <<'PY'` | Source-policy regex (`astRules`) against file body |
| `native/governor_guard.sh` L174 | `python3 - <<'PY'` | Match `forbiddenBashPatterns` from config |

Node (`src/pre-tool-use.js`) and the dedicated Python runtime (`python/pre_tool_use.py`)
do **not** share this dependency: Node uses Babel; the Python runtime *is* python3.

## Decision

**Scheme A** — native stays a thin Bash wrapper, and a missing interpreter must not fail open.

1. **Now:** if `python3` is not on `PATH`, print
   `agent-governor: python3 not found, failing closed` to stderr and `exit 2`.
2. **Next (tracked, not this change):** replace the five python3 heredocs with
   `awk` / `grep` (and Bash JSON-ish scanning where enough) so the native hook
   has **no python3 runtime requirement**. After that rewrite, drop the python3
   existence check.

Scheme B (document “native requires python3 ≥ 3.8”) is rejected: it keeps a
hidden second language runtime in a path advertised as Bash/native, and still
needs the same fail-closed gate.

## Consequences

- Environments without python3 no longer silently allow `git push --force`,
  config writes, or source-policy violations through the native hook.
- Native init is temporarily **fail-closed on missing python3** even for
  benign tool calls. That is intentional: an unevaluable guard is not a guard.
- This is an exception to the Node/Python “internal errors fail-open (exit 0)”
  rule. Missing python3 is a **missing evaluator**, not an unexpected exception
  inside an evaluator that already started.
- Follow-up work to delete python3 from `native/` is required before native can
  claim a zero-Python footprint.

## Rejected alternative

**Scheme B — native = python3 ≥ 3.8 prerequisite.** Clearer docs, no awk port,
but the “native” extra then duplicates `python/pre_tool_use.py` with weaker AST
coverage. Users who already have python3 should use `--lang python`.
