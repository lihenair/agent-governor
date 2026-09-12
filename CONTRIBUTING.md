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
| `src/config.js` | Default rules + `governor.config.*` loader |
| `src/pre-tool-use.js` | PreToolUse config shield and bash safety |
| `src/post-tool-use.js` | PostToolUse AST / syntax inspection |
| `src/init.js` | `.claude/settings.json` hook injection |
| `bin/governor.js` | CLI (`init`, `pre-check`, `post-check`) |
| `test/` | Node.js built-in test runner |

## Pull requests

1. Fork the repository
2. Create your feature branch (`git checkout -b feat/amazing-rule`)
3. Add or update tests under `test/`
4. Commit your changes (`git commit -m 'feat: add new AST rule'`)
5. Push to the branch (`git push origin feat/amazing-rule`)
6. Open a Pull Request

Please keep hook evaluation **fail-open on internal errors** (exit 0) so a governor crash cannot freeze the agent loop, and **fail-closed on policy violations** (exit 2 + stderr).
