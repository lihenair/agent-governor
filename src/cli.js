import fs from 'node:fs';
import path from 'node:path';
import { CONFIG, loadConfig, mergeConfig } from './config.js';
import { explainConfig, formatTestReport, runDryTest } from './dry-run.js';
import { initProject, parseLangFlag } from './init.js';
import { runHookGuard } from './dispatch.js';
import { runPostToolUseGuard } from './post-tool-use.js';
import { runPreToolUseGuard } from './pre-tool-use.js';
import { runSessionHook } from './session-context.js';
import { buildReport, formatReport } from './report.js';
import { formatDoctorReport, runDoctor } from './doctor.js';
import { buildStatus, formatStatus } from './status.js';
import { explainTarget } from './explain.js';
import { formatOutput, normalizeInput } from './hosts.js';
import { getPreset } from './presets.js';
import { emitBlock, exitAllow, exitBlock, readStdin } from './stdin.js';

function readVersion() {
  const here = path.dirname(path.resolve(process.argv[1] || process.cwd()));
  const guesses = [
    path.join(here, '../package.json'),
    path.join(here, '../../package.json'),
    path.join(process.cwd(), 'package.json'),
  ];
  for (const file of guesses) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (parsed.name === 'agent-governor' && parsed.version) {
        return parsed.version;
      }
    } catch {
      // try the next candidate
    }
  }
  return '0.1.0';
}

const HELP = `Agent Governor — deterministic runtime guardrails for Claude Code

Usage:
  npx agent-governor <command>

Commands:
  init [--lang auto|all|node|python|native]
               Detect the stack and inject a single dispatcher hook
  hook         Auto Pre/Post dispatcher (reads hook_event_name from stdin)
  pre-check    Run the PreToolUse guard (stdin JSON)
  post-check   Run the PostToolUse source guard (stdin JSON)
  session-hook --event SessionStart|PreCompact
               Emit rule re-injection context (stdout) after session start
               or context compaction
  test --command "git push --force"
               Dry-run a Bash command against evaluatePreToolUse
  test --file tsconfig.json [--operation modify|write]
               Dry-run an Edit/Write against evaluatePreToolUse
  explain [--config governor.config.json]
               Print compiled rule ids and counts
  explain "git reset --hard" | explain path/to/file
               Explain what the governor would do with one target, and why
  report       Summarize the audit log: blocks, top rules, last intervention
  doctor       Self-check runtime, config, hooks, audit state; exit 1 on failure
  status       Show active policy and local-vs-committed drift; exit 1 on drift
  rule list    List installed rulebooks (additive policy packs)
  rule add <name...>
               Activate rulebooks in governor.config.json
  version      Print the package version
  help         Show this message

Options:
  --json       Machine-readable output for test
  --preset <name|a,b>
               Apply a policy pack: security-hard | frontend | python | strict
`;


async function runGuard(kind) {
  const runner =
    kind === 'post'
      ? runPostToolUseGuard
      : kind === 'hook'
        ? runHookGuard
        : runPreToolUseGuard;
  try {
    const rawPayload = await readStdin(process.stdin);
    const { host, payload } = normalizeInput(rawPayload);
    const event = payload?.hook_event_name || '';
    const result = await runner({ stdin: null, payloadOverride: payload });
    if (host === 'claude-code') {
      if (result.stderr) {
        emitBlock(result.stderr);
      }
      if (result.exitCode === 2) {
        exitBlock();
      }
      exitAllow();
    }
    // Non-Claude hosts:
    //   codex / gemini-cli → JSON decision on stdout, exit 0
    //   windsurf / opencode → exit-code contract (2 = block), reason on stderr
    const out = formatOutput(result, { host, event });
    if (out.stdout) {
      process.stdout.write(`${out.stdout}\n`);
    }
    if (out.stderr) {
      emitBlock(out.stderr);
    }
    if (out.exitCode === 2) {
      exitBlock();
    }
    exitAllow();
  } catch (err) {
    const prefix =
      kind === 'pre' ? '[Agent Governor Error]' : '[Agent Governor Post-Hook Error]';
    emitBlock(`${prefix}: ${err.message}`);
    exitAllow();
  }
}

function parseFlags(argv) {
  const flags = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--json') {
      flags.json = true;
    } else if (arg === '--command' || arg === '--file' || arg === '--operation' || arg === '--config' || arg === '--event' || arg === '--tail' || arg === '--engine' || arg === '--preset') {
      flags[arg.slice(2)] = argv[index + 1];
      index += 1;
    } else {
      flags._.push(arg);
    }
  }
  return flags;
}

async function loadExplainConfig(configPath, cwd = process.cwd()) {
  if (!configPath) {
    return loadConfig(cwd);
  }
  const abs = path.resolve(cwd, configPath);
  const parsed = JSON.parse(fs.readFileSync(abs, 'utf8'));
  return mergeConfig(CONFIG, parsed);
}

export async function runCli(argv = process.argv.slice(2)) {
  // Global --preset flag: apply preset for the lifetime of this invocation.
  const presetIndex = argv.findIndex((arg) => arg === '--preset' || arg.startsWith('--preset='));
  if (presetIndex !== -1) {
    const value = argv[presetIndex].startsWith('--preset=')
      ? argv[presetIndex].slice('--preset='.length)
      : argv[presetIndex + 1];
    if (value && value !== 'undefined') {
      // Validate early so typos fail fast with a clear message.
      getPreset(value);
      process.env.GOVERNOR_PRESET = value;
    }
  }

  const command = argv[0] === '--preset' || argv[0]?.startsWith('--preset=') ? argv[1] || 'help' : argv[0] || 'help';

  switch (command) {
    case 'init': {
      const lang = parseLangFlag(argv.slice(1));
      const preset = parseFlags(argv.slice(1)).preset;
      const result = initProject(process.cwd(), { lang, preset });
      process.stdout.write(
        `[Agent Governor] Initialized for: ${result.langs.join(', ')}\n` +
          result.created.map((file) => `  + ${file}`).join('\n') +
          `\nShared policy: governor.config.json\n`
      );
      exitAllow();
      break;
    }
    case 'hook':
      await runGuard('hook');
      break;
    case 'pre-check':
    case 'pre':
      await runGuard('pre');
      break;
    case 'post-check':
    case 'post':
      await runGuard('post');
      break;
    case 'session-hook': {
      const flags = parseFlags(argv.slice(1));
      const event = flags.event || 'SessionStart';
      const result = await runSessionHook({ event, projectRoot: process.env.CLAUDE_PROJECT_DIR || process.cwd() });
      if (result.stdout) {
        process.stdout.write(`${result.stdout}\n`);
      }
      exitAllow();
      break;
    }
    case 'test': {
      const flags = parseFlags(argv.slice(1));
      const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
      const config = await loadConfig(projectRoot);
      if (flags.engine) {
        config.engine = flags.engine; // per-invocation override for A/B demos
      }
      const report = runDryTest(flags, { config, projectRoot });
      process.stdout.write(formatTestReport(report, { json: Boolean(flags.json) }));
      exitAllow();
      break;
    }
    case 'explain': {
      const flags = parseFlags(argv.slice(1));
      // explain <command|file> — explain one specific target.
      if (flags._ && flags._.length > 0) {
        const target = flags._.join(' ');
        const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
        const config = await loadConfig(projectRoot);
        const looksLikeFile = !target.includes(' ') && (target.includes('/') || target.includes('.') );
        const dryFlags = looksLikeFile
          ? { file: target }
          : { command: target };
        const evaluation = runDryTest(dryFlags, { config, projectRoot });
        process.stdout.write(`${explainTarget({ command: dryFlags.command, file: dryFlags.file, operation: dryFlags.operation }, config, evaluation)}\n`);
        exitAllow();
        break;
      }
      // explain --config — dump the compiled rule set (original behavior).
      const config = await loadExplainConfig(flags.config);
      process.stdout.write(explainConfig(config));
      exitAllow();
      break;
    }
    case 'report': {
      const flags = parseFlags(argv.slice(1));
      const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
      const report = buildReport(projectRoot, { tail: flags.tail ? Number(flags.tail) : undefined });
      process.stdout.write(
        flags.json
          ? `${JSON.stringify(report, null, 2)}\n`
          : formatReport(report)
      );
      exitAllow();
      break;
    }
    case 'doctor': {
      const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
      const report = await runDoctor(projectRoot);
      process.stdout.write(formatDoctorReport(report));
      process.exit(report.ok ? 0 : 1);
      break;
    }
    case 'status': {
      const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
      const report = await buildStatus(projectRoot);
      process.stdout.write(formatStatus(report));
      const drift = report.checks.find((c) => c.id === 'policy-drift');
      process.exit(drift && !drift.ok ? 1 : 0);
      break;
    }
    case 'rule': {
      const sub = argv[1] || 'help';
      const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
      if (sub === 'list') {
        const dir = path.join(projectRoot, 'rulebooks');
        const local = path.join(projectRoot, '.agent-governor', 'rulebooks');
        const found = [dir, local]
          .filter((d) => fs.existsSync(d))
          .flatMap((d) => fs.readdirSync(d).filter((f) => f.endsWith('.json')))
          .map((f) => f.replace(/\.json$/, ''));
        process.stdout.write(`available rulebooks: ${found.length > 0 ? found.join(', ') : '(none installed)'}\n`);
        process.stdout.write(`place JSON packs in rulebooks/ or .agent-governor/rulebooks/, then reference them in governor.config.json:\n  { "rulebooks": ["terraform", "aws"] }\n`);
        exitAllow();
        break;
      }
      if (sub === 'add') {
        const names = argv.slice(2).filter((a) => !a.startsWith('--'));
        if (names.length === 0) {
          emitBlock('usage: agent-governor rule add <name...>   (JSON files from rulebooks/)');
          process.exit(1);
        }
        const configPath = path.join(projectRoot, 'governor.config.json');
        const config = fs.existsSync(configPath)
          ? JSON.parse(fs.readFileSync(configPath, 'utf8'))
          : {};
        const existing = new Set(config.rulebooks || []);
        for (const name of names) {
          existing.add(name);
        }
        config.rulebooks = [...existing].sort();
        fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
        process.stdout.write(`rulebooks active: ${config.rulebooks.join(', ')}\nRun 'npx agent-governor explain --config governor.config.json' to see the merged policy.\n`);
        exitAllow();
        break;
      }
      process.stdout.write('usage: agent-governor rule <list|add>\n');
      exitAllow();
      break;
    }
    case 'version':
    case '--version':
    case '-v':
      process.stdout.write(`${readVersion()}\n`);
      exitAllow();
      break;
    case 'help':
    case '--help':
    case '-h':
    default:
      process.stdout.write(HELP);
      process.exit(command === 'help' || command === '--help' || command === '-h' ? 0 : 1);
  }
}
