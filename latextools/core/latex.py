"""Small, dependency-free helpers for reading LaTeX source.

Every function here has a twin in docs/backend/latex.js with the same name
and behaviour. When you change one, change the other.
"""
import re


def strip_comments(text):
    """Remove % comments, but keep escaped \\% signs."""
    return re.sub(r"(?<!\\)%.*", "", text)


def skip_spaces(text, i):
    while i < len(text) and text[i] in " \t\n":
        i += 1
    return i


def read_group(text, i, open_char="{", close_char="}"):
    """Read the balanced group that starts at text[i].

    Returns (content, index after the group), or None if there is no group.
    """
    if i >= len(text) or text[i] != open_char:
        return None
    depth = 0
    j = i
    while j < len(text):
        c = text[j]
        if c == "\\":
            j += 2
            continue
        if c == open_char:
            depth += 1
        elif c == close_char:
            depth -= 1
            if depth == 0:
                return text[i + 1:j], j + 1
        j += 1
    return None


def read_argument(text, i):
    """Read one mandatory argument: a {group}, a \\command or a single character."""
    i = skip_spaces(text, i)
    if i >= len(text):
        return None
    group = read_group(text, i)
    if group:
        return group
    m = re.compile(r"\\([A-Za-z]+|.)").match(text, i)
    if m:
        return m.group(0), m.end()
    return text[i], i + 1


def read_arguments(text, i, count, optional=False):
    """Read an optional [argument] (if wanted) followed by `count` mandatory ones.

    Returns (list of arguments, end index), or None if arguments are missing.
    With optional=True the first list entry is the optional argument or None.
    """
    args = []
    if optional:
        group = read_group(text, skip_spaces(text, i), "[", "]")
        if group:
            args.append(group[0])
            i = group[1]
        else:
            args.append(None)
    for _ in range(count):
        arg = read_argument(text, i)
        if arg is None:
            return None
        args.append(arg[0])
        i = arg[1]
    return args, i


def command_pattern(name, star=False):
    """Regex matching \\name (not \\namefoo), optionally followed by a star."""
    tail = r"(?![A-Za-z])" if name[-1].isalpha() else ""
    return re.compile(r"\\" + re.escape(name) + tail + (r"\*?" if star else ""))


def replace_command(text, name, render, count=0, optional=False, star=False):
    """Replace every \\name{arg}... by render(*args).

    Occurrences are handled from the last to the first, so nested
    commands are converted inside-out and the loop always terminates.
    """
    pattern = command_pattern(name, star)
    end = len(text)
    while True:
        matches = list(pattern.finditer(text, 0, end))
        if not matches:
            return text
        m = matches[-1]
        end = m.start()
        parsed = read_arguments(text, m.end(), count, optional)
        if parsed is None:
            continue
        args, stop = parsed
        text = text[:m.start()] + render(*args) + text[stop:]


def replace_environment(text, names, render, count=0, optional=False):
    """Replace \\begin{name}args body \\end{name} by render(name, body, *args).

    `names` is a list, or None for any environment. The innermost
    environment is always handled first, so nesting comes out right.
    """
    alternatives = r"[A-Za-z*]+" if names is None else "|".join(re.escape(n) for n in names)
    begin = re.compile(r"\\begin\{(" + alternatives + r")\}")
    end = len(text)
    while True:
        matches = list(begin.finditer(text, 0, end))
        if not matches:
            return text
        m = matches[-1]
        end = m.start()
        name = m.group(1)
        close = text.find("\\end{" + name + "}", m.end())
        if close < 0:
            continue
        parsed = read_arguments(text, m.end(), count, optional)
        if parsed is None:
            continue
        args, body_start = parsed
        body = text[body_start:close]
        stop = close + len("\\end{" + name + "}")
        text = text[:m.start()] + render(name, body, *args) + text[stop:]


def document_body(text):
    """Return the part between \\begin{document} and \\end{document}, if present."""
    m = re.search(r"\\begin\{document\}(.*?)\\end\{document\}", text, re.S)
    return m.group(1) if m else text


class Stash:
    """Park text that later steps must not touch, and put it back at the end."""

    def __init__(self):
        self.items = []

    def keep(self, text):
        self.items.append(text)
        return "\x00" + str(len(self.items) - 1) + "\x00"

    def keep_block(self, text):
        """Like keep(), but as a paragraph of its own."""
        return "\n\n" + self.keep(text) + "\n\n"

    def restore(self, text):
        return re.sub(r"\x00(\d+)\x00", lambda m: self.items[int(m.group(1))], text)
