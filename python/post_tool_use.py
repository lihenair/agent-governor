#!/usr/bin/env python3
"""PostToolUse Python AST inspector — stdlib only."""

from __future__ import annotations

import ast
import json
import os
import sys

WRITE_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}

DEFAULT_FORBIDDEN_CALLS = ["eval", "exec"]
DEFAULT_DEPRECATED_IMPORTS = ["imp", "optparse"]


def project_root() -> str:
    return os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()


def load_ast_rules() -> dict:
    config_path = os.path.join(project_root(), "governor.config.json")
    rules = {
        "pythonForbiddenCalls": DEFAULT_FORBIDDEN_CALLS,
        "pythonDeprecatedImports": DEFAULT_DEPRECATED_IMPORTS,
    }
    if os.path.exists(config_path):
        with open(config_path, "r", encoding="utf-8") as handle:
            loaded = json.load(handle)
        user_rules = loaded.get("astRules") or {}
        rules.update({key: value for key, value in user_rules.items() if value is not None})
    return rules


class SecurityASTVisitor(ast.NodeVisitor):
    def __init__(self, rules: dict):
        self.errors: list[str] = []
        self.forbidden_calls = set(rules.get("pythonForbiddenCalls") or DEFAULT_FORBIDDEN_CALLS)
        self.deprecated_imports = set(
            rules.get("pythonDeprecatedImports") or DEFAULT_DEPRECATED_IMPORTS
        )

    def visit_Call(self, node: ast.Call) -> None:
        if isinstance(node.func, ast.Name) and node.func.id in self.forbidden_calls:
            self.errors.append(
                f"Line {node.lineno}: Direct use of '{node.func.id}()' is strictly forbidden."
            )
        self.generic_visit(node)

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            if alias.name in self.deprecated_imports:
                self.errors.append(
                    f"Line {node.lineno}: Import of deprecated module '{alias.name}' is not allowed."
                )
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        if node.module in self.deprecated_imports:
            self.errors.append(
                f"Line {node.lineno}: Import of deprecated module '{node.module}' is not allowed."
            )
        self.generic_visit(node)


def inspect_python_ast(file_path: str, content: str, rules: dict | None = None) -> list[str]:
    errors: list[str] = []
    try:
        tree = ast.parse(content, filename=file_path)
        visitor = SecurityASTVisitor(rules or load_ast_rules())
        visitor.visit(tree)
        errors.extend(visitor.errors)
    except SyntaxError as exc:
        errors.append(f"SyntaxError on line {exc.lineno}: {exc.msg}")
    return errors


def extract_paths(tool_input: dict) -> list[str]:
    paths: list[str] = []
    for key in ("file_path", "filePath", "path"):
        value = tool_input.get(key)
        if isinstance(value, str) and value:
            paths.append(value)
    for edit in tool_input.get("edits") or []:
        value = edit.get("file_path")
        if isinstance(value, str) and value:
            paths.append(value)
    return list(dict.fromkeys(paths))


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
    if tool_name not in WRITE_TOOLS:
        return 0

    rules = load_ast_rules()
    all_errors: list[str] = []

    for file_path in extract_paths(tool_input):
        if not file_path.endswith(".py") or not os.path.exists(file_path):
            continue
        with open(file_path, "r", encoding="utf-8") as handle:
            content = handle.read()
        ast_errors = inspect_python_ast(file_path, content, rules)
        if ast_errors:
            all_errors.append(
                f"AST Violations in '{file_path}':\n"
                + "\n".join(f" - {err}" for err in ast_errors)
            )

    if all_errors:
        sys.stderr.write(
            "[Agent Governor AST Check Failed] ❌ "
            + "\n\n".join(all_errors)
            + "\n\nPlease fix these issues immediately.\n"
        )
        return 2

    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as err:
        sys.stderr.write(f"[Agent Governor Post-Hook Error]: {err}\n")
        sys.exit(0)
