"""Find user-defined macros and environments and expand them in place.

Twin of docs/backend/macros.js.
"""
import re

from .latex import read_group, replace_command, replace_environment, skip_spaces

DEFINITION = re.compile(
    r"\\(newcommand|renewcommand|providecommand|DeclareMathOperator"
    r"|newenvironment|renewenvironment|def)(?![A-Za-z])\*?"
)
MAX_PASSES = 10


def read_name(text, i):
    """Read a macro name given as {\\name}, \\name or {name}."""
    i = skip_spaces(text, i)
    group = read_group(text, i)
    if group:
        return group[0].strip().lstrip("\\"), group[1]
    m = re.compile(r"\\([A-Za-z]+|.)").match(text, i)
    return (m.group(1), m.end()) if m else None


def read_definition(text, m):
    """Parse one definition starting at match m. Returns (kind, name, info, end) or None."""
    kind = m.group(1)
    star = text[m.end() - 1] == "*"
    named = read_name(text, m.end())
    if named is None:
        return None
    name, i = named

    count, default = 0, None
    if kind in ("def", "DeclareMathOperator"):
        if kind == "def":  # \def\name#1#2{body}: count the parameters
            params = re.compile(r"(#\d)*").match(text, i)
            count, i = len(params.group(0)) // 2, params.end()
        body = read_group(text, skip_spaces(text, i))
        if body is None:
            return None
        content, end = body
        if kind == "DeclareMathOperator":
            content = ("\\operatorname*{" if star else "\\operatorname{") + content + "}"
        return "macro", name, {"count": count, "default": None, "body": content}, end

    group = read_group(text, skip_spaces(text, i), "[", "]")
    if group:
        count, i = int(group[0]) if group[0].strip().isdigit() else 0, group[1]
        group = read_group(text, skip_spaces(text, i), "[", "]")
        if group:
            default, i = group
    body = read_group(text, skip_spaces(text, i))
    if body is None:
        return None
    info = {"count": count, "default": default, "body": body[0]}
    if kind.endswith("command"):
        return "macro", name, info, body[1]
    end_body = read_group(text, skip_spaces(text, body[1]))
    if end_body is None:
        return None
    info["end"] = end_body[0]
    return "environment", name, info, end_body[1]


def take_definitions(text):
    """Remove all definitions from the text.

    Returns (macros, environments, remaining text). A later definition of
    the same name wins, just like \\renewcommand in LaTeX.
    """
    found = {"macro": {}, "environment": {}}
    pieces, pos = [], 0
    for m in DEFINITION.finditer(text):
        if m.start() < pos:
            continue  # inside a definition we already consumed
        parsed = read_definition(text, m)
        if parsed is None:
            continue
        kind, name, info, end = parsed
        found[kind][name] = info
        pieces.append(text[pos:m.start()])
        pos = end
    pieces.append(text[pos:])
    return found["macro"], found["environment"], "".join(pieces)


def fill_parameters(body, args):
    """Put arguments into #1 ... #9."""
    def argument(m):
        n = int(m.group(1)) - 1
        return args[n] if n < len(args) and args[n] is not None else ""
    return re.sub(r"#(\d)", argument, body)


def expand(text, macros, environments):
    """Replace user macros and environments until nothing changes."""
    for _ in range(MAX_PASSES):
        before = text
        for name, d in environments.items():
            def render(_name, body, *args, d=d):
                args = [d["default"] if a is None else a for a in args]
                return fill_parameters(d["body"], args) + body + d["end"]
            text = replace_environment(text, [name], render, *arg_layout(d))
        for name, d in macros.items():
            def render(*args, d=d):
                args = [d["default"] if a is None else a for a in args]
                return fill_parameters(d["body"], args)
            text = replace_command(text, name, render, *arg_layout(d))
        if text == before:
            break
    return text


def arg_layout(d):
    """(count of mandatory arguments, has optional argument) for a definition."""
    has_default = d["default"] is not None
    return d["count"] - (1 if has_default else 0), has_default
