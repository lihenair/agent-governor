#!/usr/bin/env python3
"""PreToolUse guard — zero third-party deps, millisecond startup."""

from __future__ import annotations

import json
import os
import re
import sys

WRITE_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}

DEFAULT_CONFIG = {
    "protectedFiles": [
        "pyproject.toml",
        "requirements.txt",
        "setup.py",
        "setup.cfg",
        "Pipfile",
        "Pipfile.lock",
        "tsconfig.json",
        "package.json",
        "Cargo.toml",
        "go.mod",
        "CMakeLists.txt",
        "governor.config.json",
    ],
    "protectedDirectories": [".claude/", ".agent-governor/"],
    # Keep in sync with src/config.js forbiddenBashPatterns (Node defaults).
    "forbiddenBashPatterns": [
        r"git\s+commit[\s\S]*--no-verify",
        r"git\s+push[\s\S]*--no-verify",
        r"rm\s+-rf\s+\.git\b",
        r"npm\s+set\s+strict-ssl\s+false",
        r"pip(?:3)?\s+install[\s\S]*--insecure",
        r"cargo\s+publish[\s\S]*--no-verify",
        r"git\s+push[\s\S]*--force(?:-with-lease)?",
        r"git\s+push[\s\S]*\s-f\s+(?:origin\s+)?(?:main|master)\b",
    ],
}

# Lightweight capability subset — not a copy of the Node engine.
CAPABILITY_PATTERNS = (
    ("git.push.force", re.compile(r"git[\s'\",\]]+push[\s\S]{0,80}(?:--force(?:-with-lease)?|\s-f\b)", re.I | re.DOTALL)),
    ("git.hook.bypass", re.compile(r"--no-verify", re.I)),
    ("fs.delete", re.compile(r"(?:^|[\s;|&/])rm\s+-r?f|shutil\.rmtree", re.I)),
    ("fs.write", re.compile(r"(?:^|[\s;|&])(?:tee|sed\s+-i|sed\s+--in-place)|(?:^|[\s])>{1,2}", re.I)),
)


def project_root() -> str:
    return os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()


def load_config() -> dict:
    config_path = os.path.join(project_root(), "governor.config.json")
    if os.path.exists(config_path):
        with open(config_path, "r", encoding="utf-8") as handle:
            loaded = json.load(handle)
        merged = {**DEFAULT_CONFIG, **loaded}
        merged["protectedFiles"] = list(
            dict.fromkeys(
                DEFAULT_CONFIG["protectedFiles"] + loaded.get("protectedFiles", [])
            )
        )
        merged["protectedDirectories"] = list(
            dict.fromkeys(
                DEFAULT_CONFIG["protectedDirectories"]
                + loaded.get("protectedDirectories", [])
            )
        )
        merged["forbiddenBashPatterns"] = (
            DEFAULT_CONFIG["forbiddenBashPatterns"]
            + loaded.get("forbiddenBashPatterns", [])
        )
        return merged
    return DEFAULT_CONFIG


def extract_paths(tool_input: dict) -> list[str]:
    paths: list[str] = []
    for key in ("file_path", "filePath", "path", "notebook_path"):
        value = tool_input.get(key)
        if isinstance(value, str) and value:
            paths.append(value)
    for edit in tool_input.get("edits") or []:
        value = edit.get("file_path")
        if isinstance(value, str) and value:
            paths.append(value)
    return list(dict.fromkeys(paths))


def is_protected_dir(file_path: str, directories: list[str]) -> bool:
    normalized = file_path.replace("\\", "/")
    for directory in directories:
        trimmed = directory.strip("/").replace("\\", "/")
        if not trimmed:
            continue
        if (
            f"/{trimmed}/" in f"/{normalized}/"
            or normalized.endswith(f"/{trimmed}")
            or normalized.startswith(f"{trimmed}/")
        ):
            return True
    return False


def main() -> int:
    try:
        raw_input = sys.stdin.read()
        if not raw_input.strip():
            return 0
        payload = json.loads(raw_input)
    except Exception:
        return 0

    tool_name = payload.get("tool_name")
    tool_input = payload.get("tool_input") or {}
    config = load_config()

    if tool_name in WRITE_TOOLS:
        for file_path in extract_paths(tool_input):
            file_name = os.path.basename(file_path)
            if file_name in config.get("protectedFiles", []):
                sys.stderr.write(
                    "[Agent Governor Security Alert] 🛑 GOVERNOR BLOCK: Editing protected configuration "
                    f"file '{file_name}' is forbidden. Please fix the underlying Python code instead.\n"
                )
                return 2

            if is_protected_dir(file_path, config.get("protectedDirectories", [])):
                sys.stderr.write(
                    "[Agent Governor Security Alert] 🛑 GOVERNOR BLOCK: "
                    f"Access denied to path '{file_path}'.\n"
                )
                return 2

    elif tool_name == "Bash":
        command = tool_input.get("command", "")
        for cap, pattern in CAPABILITY_PATTERNS:
            if pattern.search(command):
                sys.stderr.write(
                    "[Agent Governor Security Alert] 🛑 GOVERNOR BLOCK: "
                    f"The bash command '{command}' violates security rules ({cap}).\n"
                )
                return 2
        for pattern in config.get("forbiddenBashPatterns", []):
            if re.search(pattern, command, re.IGNORECASE | re.DOTALL):
                sys.stderr.write(
                    "[Agent Governor Security Alert] 🛑 GOVERNOR BLOCK: "
                    f"The bash command '{command}' violates security rules.\n"
                )
                return 2

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as err:
        sys.stderr.write(f"[Agent Governor Error]: {err}\n")
        sys.exit(0)
