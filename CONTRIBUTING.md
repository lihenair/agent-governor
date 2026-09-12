# Contributing to Agent Governor

Thanks for helping make agent governance deterministic.

## Development

```bash
git clone https://github.com/lihenair/agent-governor.git
cd agent-governor
npm install
npm test
```

## Project layout

| Path | Role |
| --- | --- |
| `src/inspect.js` | Extension → language inspector dispatcher |
| `src/dispatch.js` | `hook` command (Pre vs Post via `hook_event_name`) |
| `src/pre-tool-use.js` | Config shield, bash safety, pre-write source policy |
| `src/post-tool-use.js` | On-disk source policy after Write/Edit |
| `python/` | Optional stdlib-`ast` runtime (`--lang python`) |
| `native/` | Optional Bash fallback |
| `adapters/cursor-rule.mdc` | Soft Cursor rule copied by `init` |
| `bin/governor.js` | CLI |

## Pull requests

1. Fork the repository
2. Create your feature branch (`git checkout -b feat/amazing-rule`)
3. Add or update tests under `test/`
4. Commit your changes (`git commit -m 'feat: add new AST rule'`)
5. Push to the branch (`git push origin feat/amazing-rule`)
6. Open a Pull Request

Please keep hook evaluation **fail-open on internal errors** (exit 0) so a governor crash cannot freeze the agent loop, and **fail-closed on policy violations** (exit 2 + stderr).
