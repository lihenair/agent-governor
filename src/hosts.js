/**
 * Host adapters: translate agent-governor's Claude Code hook contract to other
 * coding-agent CLIs.
 *
 * Currently supported hosts:
 *   - claude-code (native, this package's home)
 *   - gemini-cli  (Google Gemini CLI hooks system — BeforeTool/AfterTool +
 *                  SessionStart/PreCompress, settings.json `hooks` field)
 *   - codex       (OpenAI Codex CLI hooks — PreToolUse/PostToolUse +
 *                  SessionStart/PreCompact, hooks.json via plugin or config.toml)
 *
 * Protocol notes (verified against host sources as of 2026-09):
 *
 * Gemini CLI input (stdin JSON):  { session_id, transcript_path, cwd,
 *   hook_event_name, timestamp, tool_name?, tool_input? }
 * Gemini CLI output (stdout JSON): { decision: 'deny'|'block'|'ask'|'allow'|'approve',
 *   reason, systemMessage?, hookSpecificOutput? }
 *
 * Codex input (stdin JSON): { hook_event_name: 'PreToolUse', tool_name,
 *   tool_input, cwd, session_id, ... }
 * Codex output (stdout JSON): { decision: 'approve'|'block',
 *   hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision:
 *   'allow'|'deny'|'ask', permissionDecisionReason } }
 *
 * Governor's internal representation stays the Claude Code shape; the adapter
 * normalizes inbound payloads on the way in and re-shapes decisions on the way
 * out. Exit codes: Claude Code blocks via exit 2; Gemini CLI and Codex decide
 * from the JSON decision field, so adapters emit exit 0 + JSON.
 */

export const HOSTS = ['claude-code', 'gemini-cli', 'codex'];

export function isSupportedHost(host) {
  return HOSTS.includes(host);
}

// Host event -> governor (Claude Code) event
const GEMINI_EVENT_MAP = {
  SessionStart: 'SessionStart',
  PreCompress: 'PreCompact',
  AfterTool: 'PostToolUse',
  BeforeTool: 'PreToolUse',
};

const CODEX_EVENT_MAP = {
  SessionStart: 'SessionStart',
  PreCompact: 'PreCompact',
  PostToolUse: 'PostToolUse',
  PreToolUse: 'PreToolUse',
};

/**
 * Detect the host from the inbound payload shape.
 *
 * @param {object} payload raw stdin JSON from the host
 * @returns {'gemini-cli'|'codex'|'claude-code'|'unknown'}
 */
export function detectHost(payload) {
  if (!payload || typeof payload !== 'object') {
    return 'unknown';
  }
  const event = payload.hook_event_name || '';
  if (event === 'BeforeTool' || event === 'AfterTool' || payload.timestamp !== undefined) {
    // Gemini stamps every payload with `timestamp` and uses Before/After naming.
    return 'gemini-cli';
  }
  if (event === 'PreToolUse' || event === 'PostToolUse') {
    // Codex emits tool_use_id / permission_mode which Claude Code does not.
    if (payload.tool_use_id !== undefined || payload.permission_mode !== undefined) {
      return 'codex';
    }
    return 'claude-code';
  }
  return 'claude-code';
}

/**
 * Normalize any supported host's payload into the Claude Code shape.
 *
 * @param {object} payload raw stdin payload
 * @param {'auto'|string} [hostHint]
 */
export function normalizeInput(payload, hostHint = 'auto') {
  if (!payload) {
    return { payload: null, host: 'unknown' };
  }
  const host = hostHint !== 'auto' ? hostHint : detectHost(payload);
  if (host === 'claude-code' || host === 'unknown') {
    return { payload, host: 'claude-code' };
  }

  const eventMap = host === 'gemini-cli' ? GEMINI_EVENT_MAP : CODEX_EVENT_MAP;
  const normalized = {
    ...payload,
    hook_event_name: eventMap[payload.hook_event_name] || payload.hook_event_name,
  };

  // Codex shell tools expose { command } exactly like Claude Code; MCP tools
  // pass their JSON args through — same convention Gemini uses. No field
  // mapping needed today, but keep the seam explicit for future divergence.
  return { payload: normalized, host };
}

/**
 * Shape a governor decision back into the host's expected output contract.
 *
 * @param {{exitCode:number, stderr?:string, action?:string, reason?:string}} result governor result
 * @param {{host:string, event?:string}} hostInfo
 */
export function formatOutput(result, hostInfo) {
  const { host } = hostInfo;
  const blocked = result.exitCode === 2;
  const reason = result.reason || result.stderr || '';

  if (host === 'gemini-cli') {
    if (!blocked) {
      // Warn-style results ride on systemMessage without blocking.
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          decision: 'allow',
          ...(reason ? { systemMessage: reason } : {}),
        }),
      };
    }
    return {
      exitCode: 0,
      stdout: JSON.stringify({ decision: 'deny', reason }),
    };
  }

  if (host === 'codex') {
    const event = hostInfo.event || 'PreToolUse';
    return {
      exitCode: 0,
      stdout: JSON.stringify({
        decision: blocked ? 'block' : 'approve',
        ...(blocked ? {} : { hookSpecificOutput: { hookEventName: event } }),
        ...(blocked
          ? {
              hookSpecificOutput: {
                hookEventName: event,
                permissionDecision: 'deny',
                permissionDecisionReason: reason,
              },
            }
          : {}),
      }),
    };
  }

  // claude-code: native contract — stderr + exit code.
  return {
    exitCode: result.exitCode || 0,
    stderr: blocked ? reason : undefined,
  };
}
