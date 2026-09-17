/**
 * Spawn a binary with an argv array. Never `/bin/sh -c`.
 *
 * Socket's "shell access" alert is `child_process.exec` / `execSync`, which
 * always go through a shell. `execFileSync` + `shell: false` does not.
 */
import { execFileSync } from 'node:child_process';

/**
 * @param {string} file
 * @param {string[]} [args]
 * @param {import('node:child_process').ExecFileSyncOptions} [options]
 */
export function runFile(file, args = [], options = {}) {
  return execFileSync(file, args, { ...options, shell: false });
}
