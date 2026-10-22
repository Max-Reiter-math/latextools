// Small, dependency-free helpers for reading LaTeX source.
//
// Twin of latextools/core/latex.py: same function names (in camelCase) and
// the same behaviour. When you change one, change the other.

export function stripComments(text) {
  return text.replace(/(?<!\\)%.*/g, "");
}

export function skipSpaces(text, i) {
  while (i < text.length && " \t\n".includes(text[i])) i++;
  return i;
}

// Read the balanced group that starts at text[i].
// Returns [content, index after the group], or null if there is no group.
export function readGroup(text, i, open = "{", close = "}") {
  if (i >= text.length || text[i] !== open) return null;
  let depth = 0;
  let j = i;
  while (j < text.length) {
    const c = text[j];
    if (c === "\\") { j += 2; continue; }
    if (c === open) depth++;
    else if (c === close) {
      depth--;
      if (depth === 0) return [text.slice(i + 1, j), j + 1];
    }
    j++;
  }
  return null;
}

// Match `regex` exactly at position i (like Python's pattern.match(text, i)).
export function matchAt(regex, text, i) {
  const sticky = new RegExp(regex.source, regex.flags.replace("g", "") + "y");
  sticky.lastIndex = i;
  return sticky.exec(text);
}

// Read one mandatory argument: a {group}, a \command or a single character.
export function readArgument(text, i) {
  i = skipSpaces(text, i);
  if (i >= text.length) return null;
  const group = readGroup(text, i);
  if (group) return group;
  const m = matchAt(/\\([A-Za-z]+|.)/, text, i);
  if (m) return [m[0], i + m[0].length];
  return [text[i], i + 1];
}

// Read an optional [argument] (if wanted) followed by `count` mandatory ones.
// Returns [list of arguments, end index], or null if arguments are missing.
// With optional=true the first list entry is the optional argument or null.
export function readArguments(text, i, count, optional = false) {
  const args = [];
  if (optional) {
    const group = readGroup(text, skipSpaces(text, i), "[", "]");
    if (group) { args.push(group[0]); i = group[1]; } else args.push(null);
  }
  for (let k = 0; k < count; k++) {
    const arg = readArgument(text, i);
    if (arg === null) return null;
    args.push(arg[0]);
    i = arg[1];
  }
  return [args, i];
}

export function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Regex matching \name (not \namefoo), optionally followed by a star.
export function commandPattern(name, star = false) {
  const tail = /[A-Za-z]$/.test(name) ? "(?![A-Za-z])" : "";
  return new RegExp("\\\\" + escapeRegex(name) + tail + (star ? "\\*?" : ""), "g");
}

function lastMatch(regex, text, end) {
  const matches = [...text.slice(0, end).matchAll(regex)];
  return matches.length ? matches[matches.length - 1] : null;
}

// Replace every \name{arg}... by render(...args).
// Occurrences are handled from the last to the first, so nested
// commands are converted inside-out and the loop always terminates.
export function replaceCommand(text, name, render, count = 0, optional = false, star = false) {
  const pattern = commandPattern(name, star);
  let end = text.length;
  for (;;) {
    const m = lastMatch(pattern, text, end);
    if (!m) return text;
    end = m.index;
    const parsed = readArguments(text, m.index + m[0].length, count, optional);
    if (parsed === null) continue;
    const [args, stop] = parsed;
    text = text.slice(0, m.index) + render(...args) + text.slice(stop);
  }
}

// Replace \begin{name}args body \end{name} by render(name, body, ...args).
// `names` is a list, or null for any environment. The innermost
// environment is always handled first, so nesting comes out right.
export function replaceEnvironment(text, names, render, count = 0, optional = false) {
  const alternatives = names === null ? "[A-Za-z*]+" : names.map(escapeRegex).join("|");
  const begin = new RegExp("\\\\begin\\{(" + alternatives + ")\\}", "g");
  let end = text.length;
  for (;;) {
    const m = lastMatch(begin, text, end);
    if (!m) return text;
    end = m.index;
    const name = m[1];
    const closing = "\\end{" + name + "}";
    const close = text.indexOf(closing, m.index + m[0].length);
    if (close < 0) continue;
    const parsed = readArguments(text, m.index + m[0].length, count, optional);
    if (parsed === null) continue;
    const [args, bodyStart] = parsed;
    const body = text.slice(bodyStart, close);
    text = text.slice(0, m.index) + render(name, body, ...args) + text.slice(close + closing.length);
  }
}

// Return the part between \begin{document} and \end{document}, if present.
export function documentBody(text) {
  const m = /\\begin\{document\}([\s\S]*?)\\end\{document\}/.exec(text);
  return m ? m[1] : text;
}

// Replace every occurrence of a plain string (no $-patterns, unlike String.replaceAll).
export function replaceAll(text, search, replacement) {
  return text.split(search).join(replacement);
}

// Fill {0}, {1}, ... in a template (like Python's str.format).
export function fill(template, ...args) {
  return template.replace(/\{(\d)\}/g, (_, i) => args[Number(i)]);
}

// Park text that later steps must not touch, and put it back at the end.
export class Stash {
  constructor() { this.items = []; }

  keep(text) {
    this.items.push(text);
    return "\x00" + (this.items.length - 1) + "\x00";
  }

  // Like keep(), but as a paragraph of its own.
  keepBlock(text) {
    return "\n\n" + this.keep(text) + "\n\n";
  }

  restore(text) {
    return text.replace(/\x00(\d+)\x00/g, (_, i) => this.items[Number(i)]);
  }
}
