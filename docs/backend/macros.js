// Find user-defined macros and environments and expand them in place.
//
// Twin of latextools/core/macros.py.
import { matchAt, readGroup, replaceCommand, replaceEnvironment, skipSpaces } from "./latex.js";

const DEFINITION = new RegExp(
  "\\\\(newcommand|renewcommand|providecommand|DeclareMathOperator" +
  "|newenvironment|renewenvironment|def)(?![A-Za-z])\\*?", "g");
const MAX_PASSES = 10;

// Read a macro name given as {\name}, \name or {name}.
function readName(text, i) {
  i = skipSpaces(text, i);
  const group = readGroup(text, i);
  if (group) return [group[0].trim().replace(/^\\+/, ""), group[1]];
  const m = matchAt(/\\([A-Za-z]+|.)/, text, i);
  return m ? [m[1], i + m[0].length] : null;
}

// Parse one definition starting at match m. Returns [kind, name, info, end] or null.
function readDefinition(text, m) {
  const kind = m[1];
  const mEnd = m.index + m[0].length;
  const star = text[mEnd - 1] === "*";
  const named = readName(text, mEnd);
  if (named === null) return null;
  let [name, i] = named;

  let count = 0, defaultValue = null;
  if (kind === "def" || kind === "DeclareMathOperator") {
    if (kind === "def") {  // \def\name#1#2{body}: count the parameters
      const params = matchAt(/(#\d)*/, text, i);
      count = params[0].length / 2;
      i += params[0].length;
    }
    const body = readGroup(text, skipSpaces(text, i));
    if (body === null) return null;
    let [content, end] = body;
    if (kind === "DeclareMathOperator") {
      content = (star ? "\\operatorname*{" : "\\operatorname{") + content + "}";
    }
    return ["macro", name, { count, default: null, body: content }, end];
  }

  let group = readGroup(text, skipSpaces(text, i), "[", "]");
  if (group) {
    count = /^\s*\d+\s*$/.test(group[0]) ? Number(group[0]) : 0;
    i = group[1];
    group = readGroup(text, skipSpaces(text, i), "[", "]");
    if (group) [defaultValue, i] = group;
  }
  const body = readGroup(text, skipSpaces(text, i));
  if (body === null) return null;
  const info = { count, default: defaultValue, body: body[0] };
  if (kind.endsWith("command")) return ["macro", name, info, body[1]];
  const endBody = readGroup(text, skipSpaces(text, body[1]));
  if (endBody === null) return null;
  info.end = endBody[0];
  return ["environment", name, info, endBody[1]];
}

// Remove all definitions from the text.
// Returns [macros, environments, remaining text]. A later definition of
// the same name wins, just like \renewcommand in LaTeX.
export function takeDefinitions(text) {
  const found = { macro: {}, environment: {} };
  const pieces = [];
  let pos = 0;
  for (const m of text.matchAll(DEFINITION)) {
    if (m.index < pos) continue;  // inside a definition we already consumed
    const parsed = readDefinition(text, m);
    if (parsed === null) continue;
    const [kind, name, info, end] = parsed;
    found[kind][name] = info;
    pieces.push(text.slice(pos, m.index));
    pos = end;
  }
  pieces.push(text.slice(pos));
  return [found.macro, found.environment, pieces.join("")];
}

// Put arguments into #1 ... #9.
function fillParameters(body, args) {
  return body.replace(/#(\d)/g, (_, n) => args[Number(n) - 1] ?? "");
}

// [count of mandatory arguments, has optional argument] for a definition.
function argLayout(d) {
  const hasDefault = d.default !== null;
  return [d.count - (hasDefault ? 1 : 0), hasDefault];
}

// Replace user macros and environments until nothing changes.
export function expand(text, macros, environments) {
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const before = text;
    for (const [name, d] of Object.entries(environments)) {
      const render = (_name, body, ...args) => {
        args = args.map(a => (a === null ? d.default : a));
        return fillParameters(d.body, args) + body + d.end;
      };
      text = replaceEnvironment(text, [name], render, ...argLayout(d));
    }
    for (const [name, d] of Object.entries(macros)) {
      const render = (...args) => {
        args = args.map(a => (a === null ? d.default : a));
        return fillParameters(d.body, args);
      };
      text = replaceCommand(text, name, render, ...argLayout(d));
    }
    if (text === before) break;
  }
  return text;
}
