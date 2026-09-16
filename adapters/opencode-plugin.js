/**
 * Agent Governor shim for OpenCode.
 *
 * OpenCode plugins are in-process TypeScript modules; this file is the
 * governor's plugin entry. It forwards `tool.execute.before` payloads to the
 * governor core (`pre-check`) and blocks by throwing, which OpenCode surfaces
 * to the model.
 *
 * Install: copy to `.opencode/plugins/agent-governor.js` (project) or
 * `~/.config/opencode/plugins/agent-governor.js` (global), with
 * `agent-governor` installed (`npm install -D agent-governor`).
 */

/** Tools whose args carry a shell command. */
const SHELL_TOOLS = new Set(['bash', 'shell', 'run_shell_command', 'shell_command']);

/** Tools that read file content. */
const READ_TOOLS = new Set(['read', 'cat', 'view']);

/** Tools that write files. */
const WRITE_TOOLS = new Set(['write', 'edit', 'patch', 'multiedit', 'apply_patch', 'write_file', 'edit_file']);

/** Tools that fetch external content (read-side injection scanning). */
const FETCH_TOOLS = new Set(['webfetch', 'fetch', 'web_search']);

function normalizeForGovernor(tool, args) {
  const name = (tool || '').toLowerCase();
  if (SHELL_TOOLS.has(name)) {
    return { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: args || {} };
  }
  if (WRITE_TOOLS.has(name)) {
    return { hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: args || {} };
  }
  if (READ_TOOLS.has(name) || FETCH_TOOLS.has(name)) {
    return {
      hook_event_name: 'PostToolUse',
      tool_name: FETCH_TOOLS.has(name) ? 'WebFetch' : 'Read',
      tool_input: args || {},
    };
  }
  return null;
}

export const AgentGovernorPlugin = async ({ project, client, $ }) => {
  return {
    'tool.execute.before': async (input, output) => {
      const { tool } = input;
      const args = output.args || {};
      const normalized = normalizeForGovernor(tool, args);
      if (!normalized) {
        return;
      }

      const { spawnSync } = await import('node:child_process');
      const proc = spawnSync('npx', ['agent-governor@latest', 'pre-check'], {
        input: JSON.stringify(normalized),
        encoding: 'utf8',
        cwd: process.cwd(),
        timeout: 30000,
      });

      if (proc.status === 2) {
        const reason = (proc.stderr || 'blocked by agent-governor').trim();
        throw new Error(`[Agent Governor] ${reason}`);
      }
      // status 0 (allow) and anything else (fail-open) proceed.
    },

    'tool.execute.after': async (input, output) => {
      const { tool } = input;
      const name = (tool || '').toLowerCase();
      if (!FETCH_TOOLS.has(name) && !READ_TOOLS.has(name)) {
        return;
      }
      const content =
        typeof output.output === 'string'
          ? output.output
          : JSON.stringify(output.output ?? '');
      const normalized = {
        hook_event_name: 'PostToolUse',
        tool_name: FETCH_TOOLS.has(name) ? 'WebFetch' : 'Read',
        tool_input: { ...(input.args || {}), content },
      };

      const { spawnSync } = await import('node:child_process');
      const proc = spawnSync('npx', ['agent-governor@latest', 'post-check'], {
        input: JSON.stringify(normalized),
        encoding: 'utf8',
        cwd: process.cwd(),
        timeout: 30000,
      });
      if (proc.status === 2 && proc.stderr) {
        // Surface injection warnings into the tool output without blocking reads.
        output.output = `${output.output ?? ''}\n\n${proc.stderr.trim()}`;
      }
    },
  };
};
