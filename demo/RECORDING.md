# Demo recording script

Goal: a 30–40s terminal GIF for the README first screen.

## Setup (once)

```bash
brew install asciinema gifski   # or: brew install asciinema && brew install gif-ski
npm run build                    # not needed; skip
npm link                         # make `agent-governor` available globally (optional; npx works too)
```

## Create a throwaway demo project

```bash
mkdir -p /tmp/gov-demo && cd /tmp/gov-demo
git init -q
echo '{"name":"demo-app","version":"1.0.0"}' > package.json
echo '{"compilerOptions":{"strict":true}}' > tsconfig.json
echo 'export function add(a: number, b: number) { return a + b; }' > calc.ts
npm install -D agent-governor
npx agent-governor init
```

## Record

```bash
asciinema rec -O demo.cast --overwrite
```

Then type (or paste) these commands, one at a time, letting each output show:

```bash
# 1. show the policy
npx agent-governor explain --config governor.config.json | head -8

# 2. the agent tries to weaken the compiler (simulated Edit)
npx agent-governor test --file tsconfig.json --operation modify
#    → decision: deny  (protected-file)

# 3. the agent tries to force-push (simulated Bash)
npx agent-governor test --command "git push --force origin main"
#    → decision: deny  (git.push.force)

# 4. the agent tries eval in shipped code (simulated Write)
printf 'export const run = (s: string) => eval(s);\n' > evil.ts
npx agent-governor test --file evil.ts --operation write
#    → decision: deny  (source-policy: eval)

# 5. show the audit trail
npx agent-governor report
```

Exit the recorder with `exit` or Ctrl-D.

## Convert to GIF

```bash
# crop padding + scale to README-friendly width (render as theme=tango if needed)
gifski --fps 10 --width 960 -o docs/demo.gif demo.cast
# (gifski reads asciinema casts via `asciinema gif` in newer versions:
#   asciinema gif -o docs/demo.gif demo.cast )
```

If gifski is unavailable, use <https://dretch.dev/asciinema-to-gif/> or:
`agg demo.cast docs/demo.gif` (github.com/asciinema/agg).

## Wire into README

Replace the demo section at the top of README.md / README_ZH.md:

```markdown
<div align="center">
  <img src="docs/demo.gif" alt="Agent Governor blocking unsafe agent operations" width="800px" />
</div>
```

Commit `docs/demo.gif` (keep it under ~4 MB; re-record at `--width 800` if larger).
