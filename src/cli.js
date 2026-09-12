import fs from 'node:fs';
import path from 'node:path';
import { initProject, parseLangFlag } from './init.js';
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
               Detect the stack and inject Claude Code hooks
  pre-check    Run the Node PreToolUse guard (stdin JSON)
  post-check   Run the Node PostToolUse AST guard (stdin JSON)
  version      Print the package version
  help         Show this message
`;


async function runGuard(kind) {
  const runner = kind === 'pre' ? runPreToolUseGuard : runPostToolUseGuard;
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
    case 'pre-check':
    case 'pre':
      await runGuard('pre');
      break;
    case 'post-check':
    case 'post':
      await runGuard('post');
      break;
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
