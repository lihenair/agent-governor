import fs from 'node:fs';
import path from 'node:path';
import { CONFIG, loadConfig, mergeConfig } from './config.js';
import { explainConfig, formatTestReport, runDryTest } from './dry-run.js';
import { initProject, parseLangFlag } from './init.js';
import { runHookGuard } from './dispatch.js';
import { runPostToolUseGuard } from './post-tool-use.js';
import { runPreToolUseGuard } from './pre-tool-use.js';
import { emitBlock, exitAllow, exitBlock } from './stdin.js';

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
  test --command "git push --force"
               Dry-run a Bash command against evaluatePreToolUse
  test --file tsconfig.json [--operation modify|write]
               Dry-run an Edit/Write against evaluatePreToolUse
  explain [--config governor.config.json]
               Print compiled rule ids and counts
  version      Print the package version
  help         Show this message

Options:
  --json       Machine-readable output for test
`;


async function runGuard(kind) {
  const runner =
    kind === 'post'
      ? runPostToolUseGuard
      : kind === 'hook'
        ? runHookGuard
        : runPreToolUseGuard;
  try {
    const result = await runner();
    if (result.stderr) {
      emitBlock(result.stderr);
    }
    if (result.exitCode === 2) {
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
    } else if (arg === '--command' || arg === '--file' || arg === '--operation' || arg === '--config') {
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
  const command = argv[0] || 'help';

  switch (command) {
    case 'init': {
      const lang = parseLangFlag(argv.slice(1));
      const result = initProject(process.cwd(), { lang });
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
    case 'test': {
      const flags = parseFlags(argv.slice(1));
      const projectRoot = process.env.CLAUDE_PROJECT_DIR || process.cwd();
      const config = await loadConfig(projectRoot);
      const report = runDryTest(flags, { config, projectRoot });
      process.stdout.write(formatTestReport(report, { json: Boolean(flags.json) }));
      exitAllow();
      break;
    }
    case 'explain': {
      const flags = parseFlags(argv.slice(1));
      const config = await loadExplainConfig(flags.config);
      process.stdout.write(explainConfig(config));
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
