/**
 * Host adapters: normalize every supported coding agent's hook payload into
 * agent-governor's internal (Claude Code) shape, and shape decisions back
 * into each host's native contract.
 *
 * Supported hosts
 *   claude-code  Claude Code hooks           (native contract)
 *   codex        OpenAI Codex CLI hooks      (JSON decision stdout)
 *   gemini-cli   Google Gemini CLI hooks     (JSON decision stdout)
 *   cursor       Cursor hooks.json           (JSON permission stdout)
 *   windsurf     Windsurf Cascade hooks      (exit-code contract)
 *   opencode     OpenCode plugin (thin stdin/stdout shim, same as cursor-style)
 *
 * Verified against host sources/docs (2026-09):
 *   Cursor  in:  { hook_event_name: "beforeShellExecution"|"beforeReadFile"|
 *                "beforeEditFile"|"beforeMCPExecution", command?, file_path?,
 *                conversationId, generationId }
 *          out: { permission: "allow" } |
 *               { permission: "deny", agentMessage: "..." }   (exit 0)
 *
 *   Windsurf in:  { agent_action_name: "pre_run_command", tool_info:
 *                { command_line, cwd } } |
 *                { agent_action_name: "pre_write_code", tool_info:
 *                { file_path, edits } } |
 *                { agent_action_name: "pre_read_code", tool_info: { file_path } }
 *          out: exit 0 (allow) | exit 2 (block); reason on stderr
 *
 *   OpenCode in:  shim mode — { tool, args: { command? , file_path?,
 *                content? }, hook_event_name? } (plugin pipes args to the
 *                shim's stdin; block via non-zero exit + stderr, which the
 *                plugin re-throws so OpenCode surfaces it to the model)
 *          out: same contract as the shim input (block = exit 2 + stderr)
 */

export const HOSTS = [
  'claude-code',
  'codex',
  'gemini-cli',
  'cursor',
  'windsurf',
  'opencode',
];

export function isSupportedHost(host) {
  return HOSTS.includes(host);
}

/** Host event → governor (Claude Code) event. */
const EVENT_MAP = {
  'gemini-cli': {
    SessionStart: 'SessionStart',
    PreCompress: 'PreCompact',
    AfterTool: 'PostToolUse',
    BeforeTool: 'PreToolUse',
  },
  codex: {
    PreToolUse: 'PreToolUse',
    PostToolUse: 'PostToolUse',
    SessionStart: 'SessionStart',
    PreCompact: 'PreCompact',
  },
  cursor: {
    beforeShellExecution: 'PreToolUse',
    beforeEditFile: 'PreToolUse',
    beforeReadFile: 'PreToolUse',
    beforeMCPExecution: 'PreToolUse',
    beforeSubmitPrompt: 'PreToolUse',
    afterShellExecution: 'PostToolUse',
    afterFileEdit: 'PostToolUse',
  },
  windsurf: {
    pre_run_command: 'PreToolUse',
    pre_write_code: 'PreToolUse',
    pre_read_code: 'PreToolUse',
    pre_mcp_tool_use: 'PreToolUse',
    post_run_command: 'PostToolUse',
    post_write_code: 'PostToolUse',
    post_read_code: 'PostToolUse',
  },
  opencode: {
    'tool.execute.before': 'PreToolUse',
    'tool.execute.after': 'PostToolUse',
  },
};

/**
 * Detect the host from the inbound payload shape.
 *
 * @param {object} payload raw stdin JSON from the host
 * @returns {'gemini-cli'|'codex'|'cursor'|'windsurf'|'opencode'|'claude-code'|'unknown'}
 */
export function detectHost(payload) {
  if (!payload || typeof payload !== 'object') {
    return 'unknown';
  }

  // Windsurf: agent_action_name + tool_info envelope
  if (payload.agent_action_name && payload.tool_info) {
    return 'windsurf';
  }

  // Cursor: before*/after* event names (not Gemini's BeforeTool style)
  const event = payload.hook_event_name || '';
  if (/^before(Shell|Read|Edit|MCP|Submit)/.test(event) || /^after(Shell|File|MCP)/.test(event)) {
    return 'cursor';
  }

  // OpenCode shim: explicit marker (set by the plugin shim) or bare {tool, args}
  if (payload.host === 'opencode' || (payload.tool && payload.args && !payload.tool_input)) {
    return 'opencode';
  }

  // Gemini: BeforeTool/AfterTool naming or timestamp stamp
  if (event === 'BeforeTool' || event === 'AfterTool' || payload.timestamp !== undefined) {
    return 'gemini-cli';
  }

  // Codex: tool_use_id / permission_mode which Claude Code does not send
  if ((event === 'PreToolUse' || event === 'PostToolUse') &&
      (payload.tool_use_id !== undefined || payload.permission_mode !== undefined)) {
    return 'codex';
  }

  return 'claude-code';
}

function windsurfToGovernor(payload) {
  const info = payload.tool_info || {};
  const eventName = payload.agent_action_name || '';
  const governorEvent = (EVENT_MAP.windsurf[eventName] || eventName);
  const base = {
    hook_event_name: governorEvent,
    tool_input: {},
    cwd: info.cwd || process.cwd?.() || undefined,
  };
  if (eventName === 'pre_run_command' || eventName === 'post_run_command') {
    base.tool_name = 'Bash';
    base.tool_input = { command: info.command_line || '' };
  } else if (eventName === 'pre_write_code' || eventName === 'post_write_code') {
    base.tool_name = 'Write';
    base.tool_input = { file_path: info.file_path || '', content: '' };
    // Windsurf gives edits — reconstruct approximate content markers.
    if (Array.isArray(info.edits) && info.edits.length > 0) {
      base.tool_input.content = info.edits.map((e) => e.new_string || '').join('\n');
    }
  } else if (eventName === 'pre_read_code' || eventName === 'post_read_code') {
    base.tool_name = 'Read';
    base.tool_input = { file_path: info.file_path || '' };
  } else if (eventName === 'pre_mcp_tool_use') {
    base.tool_name = 'mcp:' + (info.mcp_server_name || 'unknown');
    base.tool_input = info.mcp_tool_arguments || {};
  }
  return base;
}

function cursorToGovernor(payload) {
  const event = payload.hook_event_name || '';
  const governorEvent = (EVENT_MAP.cursor[event] || event);
  const base = {
    hook_event_name: governorEvent,
    tool_input: {},
    cwd: process.cwd?.() || undefined,
  };
  if (event === 'beforeShellExecution' || event === 'afterShellExecution') {
    base.tool_name = 'Bash';
    base.tool_input = { command: payload.command || '' };
  } else if (event === 'beforeEditFile' || event === 'afterFileEdit') {
    base.tool_name = 'Edit';
    base.tool_input = { file_path: payload.file_path || '', content: payload.content || '' };
  } else if (event === 'beforeReadFile') {
    base.tool_name = 'Read';
    base.tool_input = { file_path: payload.file_path || '', content: payload.content || '' };
  } else if (event === 'beforeMCPExecution') {
    base.tool_name = 'mcp:' + (payload.tool_name || 'unknown');
    base.tool_input = payload.args || {};
  } else {
    base.tool_name = payload.tool_name || 'unknown';
    base.tool_input = payload.tool_input || payload.args || {};
  }
  return base;
}

function opencodeToGovernor(payload) {
  return {
    hook_event_name: payload.hook_event_name || 'PreToolUse',
    tool_name: payload.tool || 'unknown',
    tool_input: payload.args || {},
    cwd: payload.cwd || process.cwd?.() || undefined,
  };
}

/**
 * Normalize any supported host's payload into the Claude Code shape.
 *
 * @param {object} payload raw stdin payload
 * @param {'auto'|string} [hostHint]
 * @returns {{payload: object|null, host: string}}
 */
export function normalizeInput(payload, hostHint = 'auto') {
  if (!payload) {
    return { payload: null, host: 'unknown' };
  }
  const host = hostHint !== 'auto' && isSupportedHost(hostHint) ? hostHint : detectHost(payload);

  if (host === 'claude-code' || host === 'unknown') {
    return { payload, host: 'claude-code' };
  }
  if (host === 'windsurf') {
    return { payload: windsurfToGovernor(payload), host };
  }
  if (host === 'cursor') {
    return { payload: cursorToGovernor(payload), host };
  }
  if (host === 'opencode') {
    return { payload: opencodeToGovernor(payload), host };
  }

  // codex / gemini-cli: event-name remap only
  const eventMap = EVENT_MAP[host] || {};
  const normalized = {
    ...payload,
    hook_event_name: eventMap[payload.hook_event_name] || payload.hook_event_name,
  };
  return { payload: normalized, host };
}

/**
 * Shape a governor decision back into the host's expected output contract.
 *
 * @param {{exitCode:number, stderr?:string, action?:string, reason?:string}} result
 * @param {{host:string, event?:string}} hostInfo
 * @returns {{exitCode:number, stdout?:string, stderr?:string}}
 */
export function formatOutput(result, hostInfo) {
  const { host } = hostInfo;
  const event = hostInfo.event || '';
  const blocked = result.exitCode === 2;
  const reason = result.reason || result.stderr || '';

  if (host === 'cursor') {
    if (!blocked) {
      return { exitCode: 0, stdout: JSON.stringify({ permission: 'allow' }) };
    }
    return {
      exitCode: 0,
      stdout: JSON.stringify({ permission: 'deny', agentMessage: reason }),
    };
  }

  if (host === 'codex') {
    return {
      exitCode: 0,
      stdout: JSON.stringify({
        decision: blocked ? 'block' : 'approve',
        hookSpecificOutput: {
          hookEventName: event || 'PreToolUse',
          ...(blocked
            ? { permissionDecision: 'deny', permissionDecisionReason: reason }
            : {}),
        },
      }),
    };
  }

  if (host === 'gemini-cli') {
    if (!blocked) {
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          decision: 'allow',
          ...(reason ? { systemMessage: reason } : {}),
        }),
      };
    }
    return { exitCode: 0, stdout: JSON.stringify({ decision: 'deny', reason }) };
  }

  if (host === 'windsurf' || host === 'opencode') {
    // Exit-code contract: 0 allow / 2 block, reason on stderr.
    return {
      exitCode: blocked ? 2 : 0,
      stderr: blocked ? reason : undefined,
    };
  }

  // claude-code native
  return {
    exitCode: result.exitCode || 0,
    stderr: blocked ? reason : undefined,
  };
}
