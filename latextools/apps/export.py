"""Export app: convert LaTeX source to Markdown or HTML.

Twin of web/backend/export.js. The steps are:
  1. park verbatim code, drop comments, inline \\input files
  2. take out \\newcommand-style definitions and expand them everywhere
  3. convert math to the target format and park it
  4. convert environments and commands, then put the parked parts back
"""
import html
import re

from ..core.latex import (Stash, document_body, read_group, replace_command,
                          replace_environment, strip_comments)
from ..core.macros import expand, take_definitions

FORMATS = {
    "markdown": {
        "title": "\n# {0}\n", "chapter": "\n# {0}\n", "section": "\n## {0}\n",
        "subsection": "\n### {0}\n", "subsubsection": "\n#### {0}\n",
        "paragraph": "\n**{0}** ",
        "textbf": "**{0}**", "textit": "*{0}*", "emph": "*{0}*", "texttt": "`{0}`",
        "underline": "<u>{0}</u>", "url": "<{0}>", "href": "[{1}]({0})",
        "footnote": " ({0})", "cite": "[{0}]", "ref": "({0})", "eqref": "({0})",
        "inline_math": "${0}$", "display_math": "$$\n{0}\n$$",
        "code": "`{0}`", "code_block": "```\n{0}\n```",
        "linebreak": "\\\n", "nbsp": " ",
    },
    "html": {
        "title": "\n<h1>{0}</h1>\n", "chapter": "\n<h1>{0}</h1>\n", "section": "\n<h2>{0}</h2>\n",
        "subsection": "\n<h3>{0}</h3>\n", "subsubsection": "\n<h4>{0}</h4>\n",
        "paragraph": "\n<strong>{0}</strong> ",
        "textbf": "<strong>{0}</strong>", "textit": "<em>{0}</em>", "emph": "<em>{0}</em>",
        "texttt": "<code>{0}</code>", "underline": "<u>{0}</u>",
        "url": '<a href="{0}">{0}</a>', "href": '<a href="{0}">{1}</a>',
        "footnote": " ({0})", "cite": "[{0}]", "ref": "({0})", "eqref": "({0})",
        "inline_math": "\\({0}\\)", "display_math": "\\[\n{0}\n\\]",
        "code": "<code>{0}</code>", "code_block": "<pre><code>{0}</code></pre>",
        "linebreak": "<br>\n", "nbsp": "&nbsp;",
    },
}

# Math environments and what they become inside display math (None = no wrapper).
MATH_ENVIRONMENTS = {
    "equation": None, "equation*": None, "displaymath": None,
    "align": "aligned", "align*": "aligned", "eqnarray": "aligned", "eqnarray*": "aligned",
    "gather": "gathered", "gather*": "gathered", "multline": "gathered", "multline*": "gathered",
}
INCLUDES = ["input", "include", "subfile"]
DROPPED_ENVIRONMENTS = ["figure", "figure*", "table", "table*", "tabular", "thebibliography"]
IGNORED_COMMANDS = {  # name: number of arguments thrown away with it
    "maketitle": 0, "tableofcontents": 0, "noindent": 0, "newpage": 0, "clearpage": 0,
    "centering": 0, "hfill": 0, "smallskip": 0, "medskip": 0, "bigskip": 0,
    "label": 1, "vspace": 1, "hspace": 1, "bibliographystyle": 1, "bibliography": 1,
    "documentclass": 1, "usepackage": 1,
}
SPECIAL_CHARACTERS = {"\\&": "&", "\\%": "%", "\\$": "$", "\\#": "#", "\\_": "_",
                      "\\{": "{", "\\}": "}", "\\textbackslash": "\\"}
SECTIONS = ["title", "chapter", "section", "subsection", "subsubsection", "paragraph"]
SIMPLE_COMMANDS = ["textbf", "textit", "emph", "texttt", "underline", "url", "footnote", "ref", "eqref"]


def convert(tex, fmt="markdown", read_file=None):
    """Convert LaTeX source. Returns (converted text, list of console messages).

    read_file(name) may return the content of an \\input file, or None.
    Without it (as in the browser) included files are removed and reported.
    """
    out = FORMATS[fmt]
    log = []
    stash = Stash()

    text = park_verbatim(tex.replace("\r\n", "\n"), out, stash, fmt)
    text = strip_comments(text)
    text = inline_files(text, read_file, log)
    macros, environments, text = take_definitions(text)
    if macros or environments:
        log.append(f"Expanded {len(macros)} macro(s) and {len(environments)} environment(s).")
    text = move_title_into_body(text)
    text = expand(text, macros, environments)

    text = park_math(text, out, stash, fmt)
    for latex, char in SPECIAL_CHARACTERS.items():
        if fmt == "markdown" and char in "_#$":
            char = latex  # Markdown understands these escapes itself
        text = text.replace(latex, stash.keep(escape(char, fmt)))
    text = escape(text, fmt)

    text = convert_environments(text, out, fmt, log)
    text = convert_commands(text, out, log)
    text = re.sub(r"(?<!\\)[{}]", "", text)  # leftover grouping braces
    text = re.sub(r"(?<=\S) {2,}(?=\S)", " ", text)
    if fmt == "html":
        text = wrap_paragraphs(text, stash)
    text = stash.restore(text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip() + "\n", log


def escape(text, fmt):
    """Escape <, > and & for HTML output. Markdown needs nothing."""
    return html.escape(text, quote=False) if fmt == "html" else text


def park_verbatim(text, out, stash, fmt):
    """Protect verbatim code from every later step."""
    def block(_name, body):
        return stash.keep_block(out["code_block"].format(escape(body.strip("\n"), fmt)))
    text = replace_environment(text, ["verbatim", "lstlisting"], block)

    def inline(m):
        return stash.keep(out["code"].format(escape(m.group(2), fmt)))
    return re.sub(r"\\verb(.)(.*?)\1", inline, text)


def inline_files(text, read_file, log, depth=0):
    """Replace \\input{name} and friends by the file content, or remove them."""
    def include(command):
        def render(name):
            content = read_file(name) if read_file and depth < 10 else None
            if content is None:
                log.append(f"Removed \\{command}{{{name}}}: the file cannot be read here.")
                return ""
            log.append(f"Included {name}.")
            content = document_body(strip_comments(content))
            return inline_files(content, read_file, log, depth + 1)
        return render

    for command in INCLUDES:
        text = replace_command(text, command, include(command), 1)
    return text


def move_title_into_body(text):
    """Keep only the document body; \\maketitle becomes the preamble's \\title."""
    m = re.search(r"\\title\s*", text)
    title = read_group(text, m.end()) if m else None
    text = document_body(text)
    if title:
        text = text.replace("\\maketitle", "\\title{" + title[0] + "}")
    return text


def park_math(text, out, stash, fmt):
    """Convert every kind of math to the target delimiters and park it."""
    def clean(math):
        math = re.sub(r"\\label\{[^}]*\}|\\nonumber|\\notag", "", math)
        return escape(math.strip(), fmt)

    def environment(name, body):
        inner = MATH_ENVIRONMENTS[name]
        if inner:
            body = f"\\begin{{{inner}}}\n{body.strip()}\n\\end{{{inner}}}"
        return stash.keep_block(out["display_math"].format(clean(body)))
    text = replace_environment(text, list(MATH_ENVIRONMENTS), environment)

    def display(m):
        return stash.keep_block(out["display_math"].format(clean(m.group(1))))

    def inline(m):
        return stash.keep(out["inline_math"].format(clean(m.group(1))))
    text = re.sub(r"\$\$(.+?)\$\$", display, text, flags=re.S)
    text = re.sub(r"\\\[(.+?)\\\]", display, text, flags=re.S)
    text = re.sub(r"\\\((.+?)\\\)", inline, text, flags=re.S)
    return re.sub(r"(?<!\\)\$(.+?)(?<!\\)\$", inline, text, flags=re.S)


def convert_environments(text, out, fmt, log):
    def drop(name, _body):
        log.append(f"Removed a {name} environment (not supported yet).")
        return ""
    text = replace_environment(text, DROPPED_ENVIRONMENTS, drop)

    def quote(_name, body):
        if fmt == "html":
            return f"\n<blockquote>{body.strip()}</blockquote>\n"
        return "\n" + "\n".join("> " + line for line in body.strip().split("\n")) + "\n"
    text = replace_environment(text, ["quote", "quotation"], quote)

    def abstract(_name, body):
        return out["section"].format("Abstract") + body
    text = replace_environment(text, ["abstract"], abstract)

    def lists(name, body):
        return render_list(name, body, fmt)
    text = replace_environment(text, ["itemize", "enumerate", "description"], lists)

    unknown = set()

    def keep_body(name, body):
        unknown.add(name)
        return body
    text = replace_environment(text, None, keep_body)
    for name in sorted(unknown):
        log.append(f"Unknown environment '{name}': kept its content as plain text.")
    return text


def render_list(name, body, fmt):
    lines = []
    for item in re.split(r"\\item(?![A-Za-z])", body)[1:]:
        label = None
        group = read_group(item, len(item) - len(item.lstrip()), "[", "]")
        if group:
            label, item = group[0], item[group[1]:]
        item = re.sub(r"\n\s*\n", "\n", item.strip())
        if fmt == "html":
            lines.append(f"<dt>{label or ''}</dt><dd>{item}</dd>" if name == "description"
                         else f"<li>{item}</li>")
            continue
        marker = "1. " if name == "enumerate" else "- "
        if label:
            item = f"**{label}** {item}"
        lines.append(marker + item.replace("\n", "\n" + " " * len(marker)))
    if fmt == "html":
        tag = {"itemize": "ul", "enumerate": "ol", "description": "dl"}[name]
        return f"\n<{tag}>\n" + "\n".join(lines) + f"\n</{tag}>\n"
    return "\n" + "\n".join(lines) + "\n"


def convert_commands(text, out, log):
    for name, count in IGNORED_COMMANDS.items():
        text = replace_command(text, name, lambda *args: "", count, optional=count > 0, star=True)
    for name in SECTIONS:
        text = replace_command(text, name, out[name].format, 1, star=True)
    for name in SIMPLE_COMMANDS:
        text = replace_command(text, name, out[name].format, 1)
    text = replace_command(text, "href", out["href"].format, 2)
    text = replace_command(text, "cite", lambda _opt, keys: out["cite"].format(keys), 1, optional=True)
    text = re.sub(r"\\\\[ \t]*\n?", lambda m: out["linebreak"], text)
    text = re.sub(r"(?<!\\)~", out["nbsp"], text)

    unknown = sorted(set(re.findall(r"\\[A-Za-z]+", text)))
    if unknown:
        log.append("Unknown commands removed (their arguments were kept): " + ", ".join(unknown))
    return re.sub(r"\\[A-Za-z]+\*?", "", text)


def wrap_paragraphs(text, stash):
    """Put <p> around blocks of text separated by blank lines."""
    def is_block(b):
        return re.match(r"<(h\d|ul|ol|dl|pre|blockquote)\b|\\\[", stash.restore(b))
    blocks = [b.strip() for b in re.split(r"\n\s*\n", text) if b.strip()]
    return "\n\n".join(b if is_block(b) else f"<p>{b}</p>" for b in blocks)
