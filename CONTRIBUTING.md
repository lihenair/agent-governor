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
| `src/config.js` | Default rules + `governor.config.json` loader |
| `src/pre-tool-use.js` | Node PreToolUse config shield and bash safety |
| `src/post-tool-use.js` | Node PostToolUse Babel AST inspection |
| `python/pre_tool_use.py` | Zero-dep Python PreToolUse guard |
| `python/post_tool_use.py` | stdlib `ast` inspector (`eval`/`exec`/deprecated imports) |
| `native/governor_guard.sh` | Fast Rust/Go/C++/Flutter/iOS/Android guard |
| `src/init.js` | `.claude/settings.json` + `.agent-governor/` injection |
| `bin/governor.js` | CLI (`init --lang`, `pre-check`, `post-check`) |
| `test/` | Node.js built-in test runner (spawns Python/Bash runtimes) |

## Pull requests

1. Fork the repository
2. Create your feature branch (`git checkout -b feat/amazing-rule`)
3. Add or update tests under `test/`
4. Commit your changes (`git commit -m 'feat: add new AST rule'`)
5. Push to the branch (`git push origin feat/amazing-rule`)
6. Open a Pull Request

Please keep hook evaluation **fail-open on internal errors** (exit 0) so a governor crash cannot freeze the agent loop, and **fail-closed on policy violations** (exit 2 + stderr).
