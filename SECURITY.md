# Security Policy

## Threat model

Agent Governor protects **helpful, non-adversarial coding agents** (Claude Code,
Cursor, Codex CLI...) from their own three failure modes:

1. **Config tampering** — weakening `tsconfig.json`, eslint, or lockfiles to
   "make errors go away".
2. **Architecture drift** — forgetting project rules as context grows.
3. **Dangerous operations** — force-pushes, hook bypasses, secret access,
   destructive deletes, and obeying injected instructions from fetched content.

### What standard mode IS

- A deterministic, zero-variance policy layer: the same input always produces
  the same decision.
- Effective against the *plausible accidental* mistakes agents really make:
  `git push --force`, `--no-verify`, `eval()`, editing lockfiles, `rm -rf` on
  the repo, following "ignore previous instructions" from a web page.
- Fail-open on internal errors (a governor bug must not freeze the agent
  loop), fail-closed on policy violations (exit 2 + reason fed back).

### What standard mode is NOT

- **Not bypass-proof against deliberately crafted shell syntax.** A determined
  adversary can obfuscate commands (encodings, placeholder expansion, runtime
  mutation) in ways that evade regex/argv parsing. Governor is a guardrail,
  not a sandbox or an antivirus.
- **Not an OS-level isolation.** It cannot stop what the shell can do beyond
  the patterns it knows. For adversarial tenants use OS sandboxes, containers,
  or VM-level isolation *in addition to* this hook.
- **Not a substitute for code review.** Blocks are advisories with reasons;
  humans still own the repo.

### Read-side injection scanning: honest scope

The read guard detects *recognizable* injection payloads in content the agent
reads (explicit instruction-override phrasing, `curl | sh`, exfiltration
patterns, hidden Unicode). It cannot catch novel phrasings, steganographic
content, or attacks that need semantic understanding. It raises the cost of
the lazy attack; it does not eliminate the class.

## Reporting a vulnerability

Open a [GitHub Security Advisory](https://github.com/lihenair/agent-governor/security/advisories/new)
(private) rather than a public issue. Include: the bypass command/payload, the
expected vs actual decision, and platform details (OS, Node, agent CLI).

Please do not test bypasses against repositories you do not own.

## Hardening recommendations

| Threat | Mitigation beyond agent-governor |
| --- | --- |
| Deliberately adversarial agent | Run inside a container / devcontainer with least-privilege FS and network policy |
| Prompt injection from dependencies | Pin dependencies, review lockfile diffs, use `--preset security-hard` |
| Config self-tampering | `governor doctor` in CI; commit `governor.config.json`; treat `.agent-governor/` hash changes as review-blocking |
| Silent hook removal | Run `governor doctor` as a CI step; alert on missing hook in `.claude/settings.json` |

## CI enforcement

Add doctor to CI so a PR cannot silently remove protection:

```yaml
- run: npx agent-governor doctor
```

## Known limitations

- Standard-mode parsers intentionally avoid emulating every shell/interpreter
  (see our ADR and the cc-safety-net review model for why). Crafted bypass
  families are accepted residual risk in standard mode by design.
- `astRules` for non-JS/Python languages are regex-based SOP checks, not full
  parsers: formatting tricks that keep semantics may evade them, and they may
  rarely over-match comments/strings.
- Windows is supported through the Node dispatcher; the native Bash fallback
  requires `python3` and fails closed without it (see ADR 0001).
