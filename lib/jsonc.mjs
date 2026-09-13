// JSONC-aware config editing for OpenCode/Kilo-style config files.
//
// parse:   tolerant of // and /* */ comments and trailing commas.
// setKey:  replaces or inserts a TOP-LEVEL key while preserving comments that
//          live outside the replaced subtree (comments inside the replaced
//          subtree are dropped — documented limitation; "soweit möglich").

export function parseJsonc(text) {
  // State machine strip: strings stay intact, comments removed. Trailing
  // commas removed in a second pass over the stripped text (safe: no strings).
  let out = "";
  let i = 0;
  let mode = "code";
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (mode === "code") {
      if (c === '"') { mode = "string"; out += c; i += 1; continue; }
      if (c === "/" && next === "/") { mode = "line"; i += 2; continue; }
      if (c === "/" && next === "*") { mode = "block"; i += 2; continue; }
      out += c; i += 1; continue;
    }
    if (mode === "string") {
      if (c === "\\") { out += text.slice(i, i + 2); i += 2; continue; }
      if (c === '"') mode = "code";
      out += c; i += 1; continue;
    }
    if (mode === "line") {
      if (c === "\n") { mode = "code"; out += c; }
      i += 1; continue;
    }
    // block comment
    if (c === "*" && next === "/") { mode = "code"; i += 2; continue; }
    i += 1;
  }
  const noTrailing = out.replace(/,(\s*[}\]])/g, "$1");
  return JSON.parse(noTrailing);
}

/** Sanity helper: returns the indexes of the top-level key's value span. */
function findTopLevelValueSpan(text, key) {
  // Scan the top level (brace depth 1) for `"key"` followed by `:`.
  let depth = 0;
  let i = 0;
  let mode = "code";
  while (i < text.length) {
    const c = text[i];
    const next = text[i + 1];
    if (mode === "code") {
      if (c === '"') { mode = "string"; i += 1; continue; }
      if (c === "/" && next === "/") { mode = "line"; i += 2; continue; }
      if (c === "/" && next === "*") { mode = "block"; i += 2; continue; }
      if (c === "{") depth += 1;
      if (c === "}") { depth -= 1; }
      if (depth === 1 && c === '"') {
        // read the whole string
        let j = i + 1;
        let str = "";
        while (j < text.length && text[j] !== '"') {
          if (text[j] === "\\") j += 1;
          str += text[j];
          j += 1;
        }
        let k = j + 1;
        while (k < text.length && /\s/.test(text[k])) k += 1;
        if (str === key && text[k] === ":") {
          // find value span start/end
          let vStart = k + 1;
          while (vStart < text.length && /\s/.test(text[vStart])) vStart += 1;
          let vDepth = 0;
          let m = vStart;
          let vMode = "code";
          if (text[vStart] === "{" || text[vStart] === "[") {
            while (m < text.length) {
              const vc = text[m];
              const vn = text[m + 1];
              if (vMode === "code") {
                if (vc === '"') { vMode = "string"; m += 1; continue; }
                if (vc === "/" && vn === "/") { vMode = "line"; m += 2; continue; }
                if (vc === "/" && vn === "*") { vMode = "block"; m += 2; continue; }
                if (vc === "{" || vc === "[") vDepth += 1;
                if (vc === "}" || vc === "]") {
                  vDepth -= 1;
                  if (vDepth === 0) return { start: vStart, end: m + 1 };
                }
              } else if (vMode === "string") {
                if (vc === "\\") { m += 2; continue; }
                if (vc === '"') vMode = "code";
              } else if (vMode === "line") {
                if (vc === "\n") vMode = "code";
              } else {
                if (vc === "*" && vn === "/") { vMode = "code"; m += 2; continue; }
              }
              m += 1;
            }
            throw new Error("unterminated value while editing JSONC");
          }
          // primitive value: ends at the first top-level comma/brace at depth 1
          m = vStart;
          while (m < text.length && !",}\n".includes(text[m])) m += 1;
          return { start: vStart, end: m };
        }
        i = j + 1;
        continue;
      }
      i += 1; continue;
    }
    if (mode === "string") {
      if (c === "\\") { i += 2; continue; }
      if (c === '"') mode = "code";
      i += 1; continue;
    }
    if (mode === "line") { if (c === "\n") mode = "code"; i += 1; continue; }
    if (c === "*" && next === "/") { mode = "code"; i += 2; continue; }
    i += 1;
  }
  return null;
}

/**
 * Set (or insert) a top-level object key in a JSONC document.
 * - Existing key: only that value subtree is replaced; comments elsewhere stay.
 * - Missing key: inserted at the end of the top-level object.
 * Returns the new text. Throws on structurally invalid input (caller validates
 * before writing).
 */
export function setTopLevelKey(text, key, value) {
  const span = findTopLevelValueSpan(text, key);
  const rendered = JSON.stringify(value, null, 2);
  if (span) {
    return text.slice(0, span.start) + rendered + text.slice(span.end);
  }
  // Insert before the final closing brace of the top-level object.
  const lastBrace = text.lastIndexOf("}");
  if (lastBrace === -1) throw new Error("JSONC: no top-level object found");
  const before = text.slice(0, lastBrace).replace(/\s+$/, "");
  const needsComma = before !== "" && !before.endsWith("{") && !before.endsWith("[") && !before.endsWith(",");
  return before + (needsComma ? "," : "") + `\n  "${key}": ${rendered}\n` + text.slice(lastBrace);
}
