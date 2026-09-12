#!/usr/bin/env bash
# agent-governor — fast native / polyglot hook guard for Claude Code
# Covers Rust, Go, C/C++, Flutter, and other non-JS stacks in < 15ms.
set -eu

PAYLOAD="$(cat || true)"
if [ -z "${PAYLOAD}" ]; then
  exit 0
fi

ROOT="${CLAUDE_PROJECT_DIR:-$(pwd)}"
CONFIG_FILE="${ROOT}/governor.config.json"

PARSE_OUT="$(python3 -c '
import json, os, sys, base64

raw = sys.stdin.read()
try:
    payload = json.loads(raw)
except Exception:
    print("EVENT=")
    print("TOOL_NAME=")
    print("FILE_PATH=")
    print("COMMAND=")
    print("SNIPPET_B64=")
    raise SystemExit(0)

tool = payload.get("tool_name") or ""
tool_input = payload.get("tool_input") or {}
file_path = (
    tool_input.get("file_path")
    or tool_input.get("filePath")
    or tool_input.get("path")
    or ""
)
command = tool_input.get("command") or ""
snippet = tool_input.get("content") or tool_input.get("new_string") or ""
event = payload.get("hook_event_name") or ""
print(f"EVENT={event}")
print(f"TOOL_NAME={tool}")
print(f"FILE_PATH={file_path}")
print(f"COMMAND={command}")
print("SNIPPET_B64=" + base64.b64encode(snippet.encode("utf-8", "replace")).decode("ascii"))
' <<<"${PAYLOAD}")" || true

if [ -z "${PARSE_OUT}" ]; then
  exit 0
fi

TOOL_NAME=""
FILE_PATH=""
COMMAND=""
SNIPPET=""
EVENT=""
while IFS= read -r line; do
  case "${line}" in
    EVENT=*) EVENT="${line#EVENT=}" ;;
    TOOL_NAME=*) TOOL_NAME="${line#TOOL_NAME=}" ;;
    FILE_PATH=*) FILE_PATH="${line#FILE_PATH=}" ;;
    COMMAND=*) COMMAND="${line#COMMAND=}" ;;
    SNIPPET_B64=*) SNIPPET="$(printf '%s' "${line#SNIPPET_B64=}" | python3 -c 'import sys,base64; print(base64.b64decode(sys.stdin.read() or b"").decode("utf-8","replace"))')" ;;
  esac
done <<EOF
${PARSE_OUT}
EOF

is_protected_file() {
  local name="$1"
  case "${name}" in
    Cargo.toml|Cargo.lock|go.mod|go.sum|CMakeLists.txt|Makefile|pyproject.toml|requirements.txt|setup.py|pubspec.yaml|pubspec.lock|Podfile|Podfile.lock|Package.swift|build.gradle|build.gradle.kts|tsconfig.json|package.json|governor.config.json)
      return 0
      ;;
  esac

  if [ -f "${CONFIG_FILE}" ]; then
    python3 - "${CONFIG_FILE}" "${name}" <<'PY'
import json, sys
config = json.load(open(sys.argv[1], encoding="utf-8"))
name = sys.argv[2]
raise SystemExit(0 if name in config.get("protectedFiles", []) else 1)
PY
    return $?
  fi
  return 1
}

block() {
  printf '%s\n' "$1" >&2
  exit 2
}

if [ "${TOOL_NAME}" = "Edit" ] || [ "${TOOL_NAME}" = "Write" ] || [ "${TOOL_NAME}" = "MultiEdit" ] || [ "${TOOL_NAME}" = "NotebookEdit" ]; then
  FILENAME="$(basename -- "${FILE_PATH}")"

  case "${FILE_PATH}" in
    */.claude/*|*/.agent-governor/*|.claude/*|.agent-governor/*)
      block "[Agent Governor Alert] 🛑 GOVERNOR BLOCK: Access denied to path '${FILE_PATH}'."
      ;;
  esac

  if is_protected_file "${FILENAME}"; then
    block "[Agent Governor Alert] 🛑 GOVERNOR BLOCK: Modifying build configuration '${FILENAME}' is prohibited!"
  fi

  BODY="${SNIPPET}"
  if [ "${EVENT}" = "PostToolUse" ] && [ -n "${FILE_PATH}" ] && [ -f "${FILE_PATH}" ]; then
    BODY="$(cat -- "${FILE_PATH}")"
  elif [ -z "${BODY}" ] && [ -n "${FILE_PATH}" ] && [ -f "${FILE_PATH}" ]; then
    BODY="$(cat -- "${FILE_PATH}")"
  fi

  case "${FILE_PATH}" in
    *.rs)
      if printf '%s\n' "${BODY}" | grep -q 'unsafe[[:space:]]*{'; then
        block "[Agent Governor Rules] ❌ GOVERNOR BLOCK: Injection of 'unsafe' blocks in Rust source code is strictly forbidden."
      fi
      ;;
    *.go)
      if printf '%s\n' "${BODY}" | grep -q 'panic('; then
        block "[Agent Governor Rules] ❌ GOVERNOR BLOCK: Unhandled 'panic()' found. Use proper error returning instead."
      fi
      ;;
  esac
fi

if [ "${TOOL_NAME}" = "Bash" ]; then
  if [ -f "${CONFIG_FILE}" ]; then
    MATCHED="$(COMMAND="${COMMAND}" CONFIG_FILE="${CONFIG_FILE}" python3 - <<'PY'
import json, os, re, sys
command = os.environ.get("COMMAND") or ""
config = json.load(open(os.environ["CONFIG_FILE"], encoding="utf-8"))
for pattern in config.get("forbiddenBashPatterns", []):
    if re.search(pattern, command, re.IGNORECASE):
        print("yes")
        break
PY
)"
    if [ "${MATCHED}" = "yes" ]; then
      block "[Agent Governor Alert] 🛑 GOVERNOR BLOCK: Dangerous command '${COMMAND}' intercepted."
    fi
  fi

  if [[ "${COMMAND}" =~ cargo[[:space:]]+publish[[:space:]].*--no-verify ]] || \
     [[ "${COMMAND}" =~ git[[:space:]]+push[[:space:]].*--force ]] || \
     [[ "${COMMAND}" =~ git[[:space:]]+commit[[:space:]].*--no-verify ]] || \
     [[ "${COMMAND}" =~ pip[[:space:]].*--insecure ]]; then
    block "[Agent Governor Alert] 🛑 GOVERNOR BLOCK: Dangerous command '${COMMAND}' intercepted."
  fi
fi

exit 0
