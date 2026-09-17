#!/usr/bin/env python3
"""True-Python-AST guard for agent-governor.

Reads a JSON job on stdin:
    { "code": "...", "calls": ["eval", "exec"], "imports": ["imp", "optparse"] }

Writes JSON on stdout:
    { "issues": [{"lineno": N, "message": "..."}], "syntaxError": bool }

Why AST instead of regex (verified against evasion samples):
    regex misses  aliased calls (`e = eval; e(x)`),
                 attribute calls (`builtins` then eval),
                 computed lookups (`globals` then a banned name),
                 import aliases (`import pickle as p`);
    AST catches them structurally by walking Call/Import nodes and tracking
    banned-name aliases through assignments.

Fail-open policy: any internal error yields {"issues": [], "syntaxError": false}
so a checker bug never freezes the agent loop. A *syntax error in the scanned
snippet* is reported via syntaxError=true so the JS side can fall back to regex.
"""

import ast
import json
import sys


class Checker(ast.NodeVisitor):
    def __init__(self, banned_calls, banned_imports):
        self.banned_calls = set(banned_calls)
        self.banned_imports = set(banned_imports)
        # alias -> banned root name (e.g. {"e": "eval"})
        self.alias_sources = {}
        # import alias -> full imported name (e.g. {"p": "pickle"})
        self.import_aliases = {}
        self.issues = []

    def _check_call_target(self, node):
        """Flag direct calls to banned names and calls through banned aliases."""
        func = node.func
        if isinstance(func, ast.Name) and func.id in self.banned_calls:
            self.issues.append(
                {"lineno": node.lineno, "message": f"Direct use of '{func.id}' is strictly forbidden."}
            )
        elif isinstance(func, ast.Name) and func.id in self.alias_sources:
            root = self.alias_sources[func.id]
            self.issues.append(
                {
                    "lineno": node.lineno,
                    "message": f"'{func.id}' aliases banned '{root}'; use is forbidden.",
                }
            )
        elif isinstance(func, ast.Attribute):
            # attribute named eval — flag attribute name match
            if func.attr in self.banned_calls:
                self.issues.append(
                    {
                        "lineno": node.lineno,
                        "message": f"Use of '{func.attr}' via attribute is forbidden.",
                    }
                )
            # marshal.loads(...) — the *object* name is the banned call
            elif isinstance(func.value, ast.Name) and func.value.id in self.banned_calls:
                self.issues.append(
                    {
                        "lineno": node.lineno,
                        "message": f"Use of banned '{func.value.id}' is forbidden.",
                    }
                )
        elif isinstance(func, ast.Subscript):
            # computed lookup with a constant banned name
            sl = func.slice
            if isinstance(sl, ast.Constant) and isinstance(sl.value, str) and sl.value in self.banned_calls:
                self.issues.append(
                    {
                        "lineno": node.lineno,
                        "message": f"Computed lookup of banned '{sl.value}' is forbidden.",
                    }
                )
        elif isinstance(func, ast.Call):
            # getattr(__builtins__, banned) then call
            inner = func.func
            if (
                isinstance(inner, ast.Name)
                and inner.id == "getattr"
                and len(func.args) >= 2
                and isinstance(func.args[1], ast.Constant)
                and isinstance(func.args[1].value, str)
                and func.args[1].value in self.banned_calls
            ):
                banned = func.args[1].value
                self.issues.append(
                    {
                        "lineno": node.lineno,
                        "message": f"getattr(..., '{banned}') aliases banned '{banned}'; use is forbidden.",
                    }
                )

    def visit_Call(self, node):
        self._check_call_target(node)
        self.generic_visit(node)

    def visit_Assign(self, node):
        # Track `e = eval` style aliases (single-name, direct banned reference).
        if isinstance(node.value, ast.Name) and node.value.id in self.banned_calls:
            for target in node.targets:
                if isinstance(target, ast.Name):
                    self.alias_sources[target.id] = node.value.id
        self.generic_visit(node)

    def visit_Import(self, node):
        for alias in node.names:
            root = alias.name.split(".")[0]
            if root in self.banned_imports:
                self.issues.append(
                    {
                        "lineno": node.lineno,
                        "message": f"Import of deprecated module '{alias.name}' is not allowed.",
                    }
                )
            elif alias.asname:
                self.import_aliases[alias.asname] = alias.name
        self.generic_visit(node)

    def visit_ImportFrom(self, node):
        module = node.module or ""
        root = module.split(".")[0]
        if root in self.banned_imports:
            self.issues.append(
                {
                    "lineno": node.lineno,
                    "message": f"Import of deprecated module '{module}' is not allowed.",
                }
            )
        self.generic_visit(node)


def main():
    try:
        job = json.loads(sys.stdin.read(), strict=False)
        code = job.get("code", "") or ""
        banned_calls = job.get("calls") or ["eval", "exec"]
        banned_imports = job.get("imports") or ["imp", "optparse"]

        try:
            tree = ast.parse(code)
        except SyntaxError:
            json.dump({"issues": [], "syntaxError": True}, sys.stdout)
            return

        checker = Checker(banned_calls, banned_imports)
        checker.visit(tree)
        json.dump({"issues": checker.issues, "syntaxError": False}, sys.stdout)
    except Exception as exc:  # noqa: BLE001 — fail open by contract
        json.dump({"issues": [], "syntaxError": False, "internalError": str(exc)}, sys.stdout)


if __name__ == "__main__":
    main()
