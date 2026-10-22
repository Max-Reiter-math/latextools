// Export app: convert LaTeX source to Markdown or HTML.
//
// Twin of latextools/apps/export.py. The steps are:
//   1. park verbatim code, drop comments, inline \input files
//   2. take out \newcommand-style definitions and expand them everywhere
//   3. convert math to the target format and park it
//   4. convert environments and commands, then put the parked parts back
import {
  Stash, documentBody, fill, readGroup, replaceAll, replaceCommand,
  replaceEnvironment, stripComments,
} from "./latex.js";
import { expand, takeDefinitions } from "./macros.js";

export const FORMATS = {
  markdown: {
    title: "\n# {0}\n", chapter: "\n# {0}\n", section: "\n## {0}\n",
    subsection: "\n### {0}\n", subsubsection: "\n#### {0}\n",
    paragraph: "\n**{0}** ",
    textbf: "**{0}**", textit: "*{0}*", emph: "*{0}*", texttt: "`{0}`",
    underline: "<u>{0}</u>", url: "<{0}>", href: "[{1}]({0})",
    footnote: " ({0})", cite: "[{0}]", ref: "({0})", eqref: "({0})",
    inline_math: "${0}$", display_math: "$$\n{0}\n$$",
    code: "`{0}`", code_block: "```\n{0}\n```",
    linebreak: "\\\n", nbsp: " ",
  },
  html: {
    title: "\n<h1>{0}</h1>\n", chapter: "\n<h1>{0}</h1>\n", section: "\n<h2>{0}</h2>\n",
    subsection: "\n<h3>{0}</h3>\n", subsubsection: "\n<h4>{0}</h4>\n",
    paragraph: "\n<strong>{0}</strong> ",
    textbf: "<strong>{0}</strong>", textit: "<em>{0}</em>", emph: "<em>{0}</em>",
    texttt: "<code>{0}</code>", underline: "<u>{0}</u>",
    url: '<a href="{0}">{0}</a>', href: '<a href="{0}">{1}</a>',
    footnote: " ({0})", cite: "[{0}]", ref: "({0})", eqref: "({0})",
    inline_math: "\\({0}\\)", display_math: "\\[\n{0}\n\\]",
    code: "<code>{0}</code>", code_block: "<pre><code>{0}</code></pre>",
    linebreak: "<br>\n", nbsp: "&nbsp;",
  },
};

// Math environments and what they become inside display math (null = no wrapper).
const MATH_ENVIRONMENTS = {
  "equation": null, "equation*": null, "displaymath": null,
  "align": "aligned", "align*": "aligned", "eqnarray": "aligned", "eqnarray*": "aligned",
  "gather": "gathered", "gather*": "gathered", "multline": "gathered", "multline*": "gathered",
};
const INCLUDES = ["input", "include", "subfile"];
const DROPPED_ENVIRONMENTS = ["figure", "figure*", "table", "table*", "tabular", "thebibliography"];
const IGNORED_COMMANDS = {  // name: number of arguments thrown away with it
  maketitle: 0, tableofcontents: 0, noindent: 0, newpage: 0, clearpage: 0,
  centering: 0, hfill: 0, smallskip: 0, medskip: 0, bigskip: 0,
  label: 1, vspace: 1, hspace: 1, bibliographystyle: 1, bibliography: 1,
  documentclass: 1, usepackage: 1,
};
const SPECIAL_CHARACTERS = {
  "\\&": "&", "\\%": "%", "\\$": "$", "\\#": "#", "\\_": "_",
  "\\{": "{", "\\}": "}", "\\textbackslash": "\\",
};
const SECTIONS = ["title", "chapter", "section", "subsection", "subsubsection", "paragraph"];
const SIMPLE_COMMANDS = ["textbf", "textit", "emph", "texttt", "underline", "url", "footnote", "ref", "eqref"];

// Convert LaTeX source. Returns [converted text, list of console messages].
// readFile(name) may return the content of an \input file, or null.
// Without it (as in the browser) included files are removed and reported.
export function convert(tex, fmt = "markdown", readFile = null) {
  const out = FORMATS[fmt];
  const log = [];
  const stash = new Stash();

  let text = parkVerbatim(replaceAll(tex, "\r\n", "\n"), out, stash, fmt);
  text = stripComments(text);
  text = inlineFiles(text, readFile, log);
  const [macros, environments, rest] = takeDefinitions(text);
  const counts = [Object.keys(macros).length, Object.keys(environments).length];
  if (counts[0] || counts[1]) {
    log.push(`Expanded ${counts[0]} macro(s) and ${counts[1]} environment(s).`);
  }
  text = moveTitleIntoBody(rest);
  text = expand(text, macros, environments);

  text = parkMath(text, out, stash, fmt);
  for (const [latex, plain] of Object.entries(SPECIAL_CHARACTERS)) {
    // Markdown understands these escapes itself
    const char = fmt === "markdown" && "_#$".includes(plain) ? latex : plain;
    text = replaceAll(text, latex, stash.keep(escape(char, fmt)));
  }
  text = escape(text, fmt);

  text = convertEnvironments(text, out, fmt, log);
  text = convertCommands(text, out, log);
  text = text.replace(/(?<!\\)[{}]/g, "");  // leftover grouping braces
  text = text.replace(/(?<=\S) {2,}(?=\S)/g, " ");
  if (fmt === "html") text = wrapParagraphs(text, stash);
  text = stash.restore(text);
  text = text.replace(/[ \t]+\n/g, "\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  return [text.trim() + "\n", log];
}

// Escape <, > and & for HTML output. Markdown needs nothing.
function escape(text, fmt) {
  if (fmt !== "html") return text;
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Protect verbatim code from every later step.
function parkVerbatim(text, out, stash, fmt) {
  const block = (_name, body) =>
    stash.keepBlock(fill(out.code_block, escape(body.replace(/^\n+|\n+$/g, ""), fmt)));
  text = replaceEnvironment(text, ["verbatim", "lstlisting"], block);
  return text.replace(/\\verb(.)(.*?)\1/g, (_, _delimiter, code) =>
    stash.keep(fill(out.code, escape(code, fmt))));
}

// Replace \input{name} and friends by the file content, or remove them.
function inlineFiles(text, readFile, log, depth = 0) {
  const include = command => name => {
    const content = readFile && depth < 10 ? readFile(name) : null;
    if (content === null || content === undefined) {
      log.push(`Removed \\${command}{${name}}: the file cannot be read here.`);
      return "";
    }
    log.push(`Included ${name}.`);
    return inlineFiles(documentBody(stripComments(content)), readFile, log, depth + 1);
  };
  for (const command of INCLUDES) {
    text = replaceCommand(text, command, include(command), 1);
  }
  return text;
}

// Keep only the document body; \maketitle becomes the preamble's \title.
function moveTitleIntoBody(text) {
  const m = /\\title\s*/.exec(text);
  const title = m ? readGroup(text, m.index + m[0].length) : null;
  text = documentBody(text);
  if (title) text = replaceAll(text, "\\maketitle", "\\title{" + title[0] + "}");
  return text;
}

// Convert every kind of math to the target delimiters and park it.
function parkMath(text, out, stash, fmt) {
  const clean = math =>
    escape(math.replace(/\\label\{[^}]*\}|\\nonumber|\\notag/g, "").trim(), fmt);

  const environment = (name, body) => {
    const inner = MATH_ENVIRONMENTS[name];
    if (inner) body = `\\begin{${inner}}\n${body.trim()}\n\\end{${inner}}`;
    return stash.keepBlock(fill(out.display_math, clean(body)));
  };
  text = replaceEnvironment(text, Object.keys(MATH_ENVIRONMENTS), environment);

  const display = (_, math) => stash.keepBlock(fill(out.display_math, clean(math)));
  const inline = (_, math) => stash.keep(fill(out.inline_math, clean(math)));
  text = text.replace(/\$\$(.+?)\$\$/gs, display);
  text = text.replace(/\\\[(.+?)\\\]/gs, display);
  text = text.replace(/\\\((.+?)\\\)/gs, inline);
  return text.replace(/(?<!\\)\$(.+?)(?<!\\)\$/gs, inline);
}

function convertEnvironments(text, out, fmt, log) {
  const drop = name => {
    log.push(`Removed a ${name} environment (not supported yet).`);
    return "";
  };
  text = replaceEnvironment(text, DROPPED_ENVIRONMENTS, drop);

  const quote = (_name, body) => {
    if (fmt === "html") return `\n<blockquote>${body.trim()}</blockquote>\n`;
    return "\n" + body.trim().split("\n").map(line => "> " + line).join("\n") + "\n";
  };
  text = replaceEnvironment(text, ["quote", "quotation"], quote);

  const abstract = (_name, body) => fill(out.section, "Abstract") + body;
  text = replaceEnvironment(text, ["abstract"], abstract);

  const lists = (name, body) => renderList(name, body, fmt);
  text = replaceEnvironment(text, ["itemize", "enumerate", "description"], lists);

  const unknown = new Set();
  const keepBody = (name, body) => {
    unknown.add(name);
    return body;
  };
  text = replaceEnvironment(text, null, keepBody);
  for (const name of [...unknown].sort()) {
    log.push(`Unknown environment '${name}': kept its content as plain text.`);
  }
  return text;
}

function renderList(name, body, fmt) {
  const lines = [];
  for (let item of body.split(/\\item(?![A-Za-z])/).slice(1)) {
    let label = null;
    const group = readGroup(item, item.length - item.trimStart().length, "[", "]");
    if (group) {
      label = group[0];
      item = item.slice(group[1]);
    }
    item = item.trim().replace(/\n\s*\n/g, "\n");
    if (fmt === "html") {
      lines.push(name === "description" ? `<dt>${label || ""}</dt><dd>${item}</dd>` : `<li>${item}</li>`);
      continue;
    }
    const marker = name === "enumerate" ? "1. " : "- ";
    if (label) item = `**${label}** ${item}`;
    lines.push(marker + replaceAll(item, "\n", "\n" + " ".repeat(marker.length)));
  }
  if (fmt === "html") {
    const tag = { itemize: "ul", enumerate: "ol", description: "dl" }[name];
    return `\n<${tag}>\n` + lines.join("\n") + `\n</${tag}>\n`;
  }
  return "\n" + lines.join("\n") + "\n";
}

function convertCommands(text, out, log) {
  for (const [name, count] of Object.entries(IGNORED_COMMANDS)) {
    text = replaceCommand(text, name, () => "", count, count > 0, true);
  }
  for (const name of SECTIONS) {
    text = replaceCommand(text, name, arg => fill(out[name], arg), 1, false, true);
  }
  for (const name of SIMPLE_COMMANDS) {
    text = replaceCommand(text, name, arg => fill(out[name], arg), 1);
  }
  text = replaceCommand(text, "href", (url, label) => fill(out.href, url, label), 2);
  text = replaceCommand(text, "cite", (_opt, keys) => fill(out.cite, keys), 1, true);
  text = text.replace(/\\\\[ \t]*\n?/g, () => out.linebreak);
  text = text.replace(/(?<!\\)~/g, out.nbsp);

  const unknown = [...new Set(text.match(/\\[A-Za-z]+/g) || [])].sort();
  if (unknown.length) {
    log.push("Unknown commands removed (their arguments were kept): " + unknown.join(", "));
  }
  return text.replace(/\\[A-Za-z]+\*?/g, "");
}

// Put <p> around blocks of text separated by blank lines.
function wrapParagraphs(text, stash) {
  const isBlock = b => /^(<(h\d|ul|ol|dl|pre|blockquote)\b|\\\[)/.test(stash.restore(b));
  const blocks = text.split(/\n\s*\n/).map(b => b.trim()).filter(b => b);
  return blocks.map(b => (isBlock(b) ? b : `<p>${b}</p>`)).join("\n\n");
}
