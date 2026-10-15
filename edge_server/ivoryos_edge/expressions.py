"""The expression a Set variable step computes: a value, or a little Python over earlier variables.

`a = 1`, `ratio = absorbance / 2`, `i = i + 1`, `label = f"vial_{i}"`. Read with Python's own
parser and walked node by node here, never handed to `eval`: a workflow is shared, imported and
written by an assistant, and `eval` with no builtins is still a door out (`().__class__...`).
What is allowed is what arithmetic, comparisons and building a value need, and nothing that
reaches an object's attributes.

Variables are read by bare name, as in an If condition. A `#name` is accepted too (the original
IvoryOS wrote `#x + 5 * (#y - 2)`) and means the same name; the Designer writes it without the
`#`, because a value starting with `#` is a reference everywhere else in the app.

`FUNCTIONS` and `CONSTANTS` are mirrored in `packages/shared-ui/src/flowControl.ts`
(`EXPRESSION_WORDS`), which finds the names an expression reads for the Designer's warnings.
"""
from __future__ import annotations

import ast
import math
import operator
import re
from typing import Any, Dict, List

FUNCTIONS = {
    "abs": abs, "round": round, "min": min, "max": max, "sum": sum, "len": len,
    "int": int, "float": float, "str": str, "bool": bool,
    "sqrt": math.sqrt, "exp": math.exp, "log": math.log, "log10": math.log10,
    "sin": math.sin, "cos": math.cos, "tan": math.tan, "floor": math.floor, "ceil": math.ceil,
}
CONSTANTS = {"pi": math.pi, "True": True, "False": False, "None": None}

# A Set variable's type: `auto` keeps what the value is (1 an int, 2.5 a float, "a" text).
TYPES = ("auto", "str", "int", "float", "bool")

MAX_LENGTH = 2000
# `10 ** 10 ** 10` or `"a" * 10 ** 9` would hold the run (and the memory) for as long as it took.
MAX_EXPONENT = 10_000
MAX_REPEAT = 100_000

_BINARY = {
    ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv, ast.Mod: operator.mod, ast.Pow: operator.pow,
}
_UNARY = {ast.UAdd: operator.pos, ast.USub: operator.neg, ast.Not: operator.not_}
_COMPARE = {
    ast.Eq: operator.eq, ast.NotEq: operator.ne, ast.Lt: operator.lt, ast.LtE: operator.le,
    ast.Gt: operator.gt, ast.GtE: operator.ge, ast.In: lambda a, b: a in b,
    ast.NotIn: lambda a, b: a not in b, ast.Is: operator.is_, ast.IsNot: operator.is_not,
}

REFERENCE = re.compile(r"\s*#\s*([A-Za-z_]\w*)\s*")


class ExpressionError(Exception):
    """An expression that cannot be read or computed. The message is shown to a person as is."""


def strip_references(text: str) -> str:
    """`#x + 5` -> `x + 5`: a '#' before a name means that name, outside quoted text."""
    out, quote, i = [], None, 0
    while i < len(text):
        ch = text[i]
        if quote:
            out.append(ch)
            if ch == "\\" and i + 1 < len(text):
                out.append(text[i + 1])
                i += 1
            elif ch == quote:
                quote = None
        elif ch in "'\"":
            quote = ch
            out.append(ch)
        elif ch == "#" and re.match(r"\s*[A-Za-z_]", text[i + 1:]):
            pass  # the name follows; the '#' goes
        else:
            out.append(ch)
        i += 1
    return "".join(out)


def _parse(text: str) -> ast.Expression:
    source = strip_references(str(text)).strip()
    if not source:
        raise ExpressionError("There is no value to compute.")
    if len(source) > MAX_LENGTH:
        raise ExpressionError(f"The expression is longer than {MAX_LENGTH} characters.")
    try:
        return ast.parse(source, mode="eval")
    except (SyntaxError, RecursionError, ValueError) as e:
        detail = getattr(e, "msg", None) or str(e)
        raise ExpressionError(f"'{text}' is not a value or an expression Python can read ({detail}).")


def expression_names(text: str) -> List[str]:
    """The variables an expression reads, in order: every bare name that is not a function it
    calls or a constant. [] for text that does not parse (`evaluate` says why)."""
    try:
        tree = _parse(text)
    except ExpressionError:
        return []
    called = {id(n.func) for n in ast.walk(tree) if isinstance(n, ast.Call) and isinstance(n.func, ast.Name)}
    found = sorted((n for n in ast.walk(tree) if isinstance(n, ast.Name)), key=lambda n: (n.lineno, n.col_offset))
    names: List[str] = []
    for node in found:
        if id(node) not in called and node.id not in CONSTANTS and node.id not in names:
            names.append(node.id)
    return names


def check(text: str) -> None:
    """Raise ExpressionError if `text` is not something `evaluate` would accept, whatever the
    variables hold: its shape only (parses, uses only what is allowed), nothing computed."""
    tree = _parse(text)
    for node in ast.walk(tree):
        if isinstance(node, ast.operator) and type(node) not in _BINARY \
                or isinstance(node, ast.unaryop) and type(node) not in _UNARY:
            raise ExpressionError(f"'{type(node).__name__}' is not allowed in an expression.")
        if isinstance(node, (ast.Expression, ast.expr_context, ast.operator, ast.unaryop, ast.boolop,
                             ast.cmpop, ast.keyword)):
            continue
        if not hasattr(_Evaluator, f"visit_{type(node).__name__}"):
            raise ExpressionError(f"'{type(node).__name__}' is not allowed in an expression.")
        if isinstance(node, ast.Constant):
            _Evaluator({}).visit_Constant(node)
        elif isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name) or node.func.id not in FUNCTIONS:
                name = node.func.id if isinstance(node.func, ast.Name) else "that"
                raise ExpressionError(
                    f"'{name}' is not a function an expression can call. Available: {', '.join(sorted(FUNCTIONS))}.")
            if any(k.arg is None for k in node.keywords):
                raise ExpressionError("*args and **kwargs are not allowed in an expression.")
        elif isinstance(node, ast.Dict) and any(k is None for k in node.keys):
            raise ExpressionError("**mapping is not allowed in an expression.")


def evaluate(text: str, names: Dict[str, Any]) -> Any:
    """The value of `text`, reading variables from `names`. Raises ExpressionError."""
    tree = _parse(text)
    try:
        return _Evaluator(names).visit(tree.body)
    except ExpressionError:
        raise
    except RecursionError:
        raise ExpressionError("The expression is nested too deeply.")
    except Exception as e:  # ZeroDivisionError, TypeError from mixing text and numbers, ...
        raise ExpressionError(f"Could not compute '{text}': {e}")


class _Evaluator:
    def __init__(self, names: Dict[str, Any]):
        self.names = names

    def visit(self, node: ast.AST) -> Any:
        handler = getattr(self, f"visit_{type(node).__name__}", None)
        if handler is None:
            raise ExpressionError(f"'{type(node).__name__}' is not allowed in an expression.")
        return handler(node)

    def visit_Constant(self, node):
        if isinstance(node.value, (int, float, str, bool, type(None))):
            return node.value
        raise ExpressionError(f"{node.value!r} is not allowed in an expression.")

    def visit_Name(self, node):
        if node.id in self.names:
            return self.names[node.id]
        if node.id in CONSTANTS:
            return CONSTANTS[node.id]
        if node.id in FUNCTIONS:
            raise ExpressionError(f"'{node.id}' is a function: call it, as in {node.id}(x).")
        raise ExpressionError(f"'{node.id}' is not set: no earlier step saves a variable by that name.")

    def visit_BinOp(self, node):
        op = _BINARY.get(type(node.op))
        if op is None:
            raise ExpressionError(f"'{type(node.op).__name__}' is not allowed in an expression.")
        left, right = self.visit(node.left), self.visit(node.right)
        if isinstance(node.op, ast.Pow) and isinstance(right, (int, float)) and abs(right) > MAX_EXPONENT \
                and isinstance(left, (int, float)) and abs(left) > 1:
            raise ExpressionError("That power is too large to compute.")
        if isinstance(node.op, ast.Mult):
            for seq, count in ((left, right), (right, left)):
                if isinstance(seq, (str, list, tuple)) and isinstance(count, int) and count * max(len(seq), 1) > MAX_REPEAT:
                    raise ExpressionError("That repetition is too long.")
        return op(left, right)

    def visit_UnaryOp(self, node):
        op = _UNARY.get(type(node.op))
        if op is None:
            raise ExpressionError(f"'{type(node.op).__name__}' is not allowed in an expression.")
        return op(self.visit(node.operand))

    def visit_BoolOp(self, node):
        value = None
        for item in node.values:
            value = self.visit(item)
            if isinstance(node.op, ast.And) and not value:
                return value
            if isinstance(node.op, ast.Or) and value:
                return value
        return value

    def visit_Compare(self, node):
        left = self.visit(node.left)
        for op, comparator in zip(node.ops, node.comparators):
            right = self.visit(comparator)
            if not _COMPARE[type(op)](left, right):
                return False
            left = right
        return True

    def visit_IfExp(self, node):
        return self.visit(node.body) if self.visit(node.test) else self.visit(node.orelse)

    def visit_Call(self, node):
        if not isinstance(node.func, ast.Name) or node.func.id not in FUNCTIONS:
            name = node.func.id if isinstance(node.func, ast.Name) else "that"
            raise ExpressionError(
                f"'{name}' is not a function an expression can call. Available: {', '.join(sorted(FUNCTIONS))}.")
        if any(isinstance(a, ast.Starred) for a in node.args) or any(k.arg is None for k in node.keywords):
            raise ExpressionError("*args and **kwargs are not allowed in an expression.")
        args = [self.visit(a) for a in node.args]
        kwargs = {k.arg: self.visit(k.value) for k in node.keywords}
        return FUNCTIONS[node.func.id](*args, **kwargs)

    def visit_List(self, node):
        return [self.visit(e) for e in node.elts]

    def visit_Tuple(self, node):
        return tuple(self.visit(e) for e in node.elts)

    def visit_Dict(self, node):
        if any(k is None for k in node.keys):
            raise ExpressionError("**mapping is not allowed in an expression.")
        return {self.visit(k): self.visit(v) for k, v in zip(node.keys, node.values)}

    def visit_Subscript(self, node):
        return self.visit(node.value)[self.visit(node.slice)]

    def visit_Slice(self, node):
        part = lambda n: None if n is None else self.visit(n)  # noqa: E731
        return slice(part(node.lower), part(node.upper), part(node.step))

    def visit_Index(self, node):  # Python 3.8's wrapper around a subscript
        return self.visit(node.value)

    def visit_JoinedStr(self, node):
        return "".join(str(self.visit(v)) for v in node.values)

    def visit_FormattedValue(self, node):
        value = self.visit(node.value)
        if node.conversion == ord("r"):
            value = repr(value)
        elif node.conversion == ord("a"):
            value = ascii(value)
        elif node.conversion == ord("s"):
            value = str(value)
        spec = self.visit(node.format_spec) if node.format_spec is not None else ""
        return format(value, spec)
