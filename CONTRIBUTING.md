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
| `src/detect-hosts.js` | Discover installed coding agents for `init` / `doctor` |
| `python/` | Optional stdlib-`ast` runtime (`--lang python`) |
| `native/` | Optional Bash fallback |
| `adapters/` | Per-host hook snippets (`init --hosts` merges these) |
| `bin/governor.js` | CLI |

## Pull requests

1. Fork the repository
2. Create your feature branch (`git checkout -b feat/amazing-rule`)
3. Add or update tests under `test/`
4. Commit your changes (`git commit -m 'feat: add new AST rule'`)
5. Push to the branch (`git push origin feat/amazing-rule`)
6. Open a Pull Request

Please keep hook evaluation **fail-open on internal errors** (exit 0) so a governor crash cannot freeze the agent loop, and **fail-closed on policy violations** (exit 2 + stderr).

## Releasing to npm

Publishes are **not** done with a long-lived npm token. `.github/workflows/publish.yml` uses GitHub Actions OIDC (trusted publishing). Provenance attestations are generated automatically. There is no `postinstall` / `preinstall` script; `prepublishOnly` runs only on the publisher.

One-time setup on [npmjs.com/package/agent-governor](https://www.npmjs.com/package/agent-governor) → **Settings → Trusted Publisher**:

| Field | Value |
| --- | --- |
| Organization or user | `lihenair` |
| Repository | `agent-governor` |
| Workflow filename | `publish.yml` |
| Environment name | leave empty |
| Allowed actions | `npm publish` |

Then for each release:

```bash
# on main, after the version bump is merged
git tag v0.8.0
git push origin v0.8.0
```

The tag must match `package.json` `version`. Do not `npm publish` from a laptop if you want provenance.
